'use strict';

function familyActions(){
  if(viewer!=='admin')return '';
  if(previous?.access)return '';
  if(workingFamily)return '<div class="actions left">'+act('newMember','Добавить профиль','','button primary','plus')+
    act('switchSpace','Открыть демо','demo','text-button')+'</div>';
  const exists=Boolean(readJson(familyStateKey));
  return '<div class="actions left">'+(exists?act('switchSpace','Открыть свою семью','family','button primary'):
    (act('newFamily','Создать свою семью','','button primary','plus')+(crypto.subtle?act('joinDevice','Подключиться к семье','','button secondary'):'')))+'</div>';
}
function enterSpace(space,profileId=''){
  const url=new URL(location.href);url.search='';url.hash='';
  url.searchParams.set('space',space);
  if(profileId)url.searchParams.set('profile',profileId);
  location.assign(url.href);
}
function familyForm(creating){
  if(viewer!=='admin'||previous?.access)return;
  if(creating&&!crypto.subtle){openPanel('Семейный архив','Нужно защищённое соединение','<p>Откройте дневник по HTTPS или на localhost, чтобы создать ключ устройства.</p>');return}
  if(creating&&(workingFamily||readJson(familyStateKey))){showFamily();return}
  if(!creating&&!workingFamily)return;
  openPanel(creating?'Семейный архив':family.name,creating?'Создать свою семью':'Добавить профиль',
    '<form id="family-form" class="edit-form" data-creating="'+creating+'">'+
    (creating?'<p class="hint">Новый архив начнётся с вашей пустой медкарты. Демонстрационные записи останутся в демо. Записи и вложения шифруются на этом устройстве. Для переноса сохраните семейную резервную копию и отдельно её ключ.</p><label>Название семьи<input required maxlength="100" name="familyName" placeholder="Моя семья"></label>':'')+
    '<label>'+(creating?'Ваше имя в профиле администратора':'Имя в профиле')+'<input required maxlength="100" name="memberName" autocomplete="off"></label>'+
    (creating?'':'<label>Член семьи<select name="role"><option>Взрослый</option><option>Ребёнок</option></select></label>')+
    '<label>Дата рождения <small>по желанию</small><input type="date" name="birthday" max="'+todayLocal()+'"></label>'+
    '<p role="alert" class="error"></p><button class="button primary">'+(creating?'Создать семейный архив':'Сохранить профиль')+'</button></form>');
}
async function saveFamilyForm(form){
  if(viewer!=='admin'||previous?.access||form.dataset.busy)return;
  const creating=form.dataset.creating==='true',name=form.elements.memberName.value.trim(),role=creating?'Взрослый':form.elements.role.value;
  const error=form.querySelector('.error'),title=form.elements.familyName?.value.trim();
  if(!['Взрослый','Ребёнок'].includes(role))return;
  const member={id:'p-'+uid(),name,role},patient=personFromMember(member);
  const profile=makeState({...patient,birthday:form.elements.birthday.value});
  form.dataset.busy='true';
  try{
    if(creating){
      await localVault.ensure();
      if(workingFamily||localStorage.getItem(familyStateKey)){error.textContent='Семья уже создана в этом браузере. Откройте её в списке профилей.';return}
      const data={schemaVersion:2,generation:uid(),family:{id:'f-'+uid(),kind:'family',name:title,adminId:member.id,members:[member]},
        profiles:{[member.id]:profile},tags:initialTags,templates:[],city:'Минск'};
      deviceAuthority(data.family.id);
      localStorage.setItem(familyStateKey,localVault.seal(JSON.stringify(data)));
    }else{
      if(!workingFamily)return;
      family.members.push(member);prototypeState.profiles[member.id]=profile;
      if(!saveState()){family.members.pop();delete prototypeState.profiles[member.id];throw Error()}
    }
    enterSpace('family',member.id);
  }catch{error.textContent='Не удалось сохранить профиль. Проверьте свободное место и актуальность данных.'}
  finally{delete form.dataset.busy}
}
