'use strict';

function tagWords(value){
  return norm(String(value||'')).replace(/[^\p{L}\p{N}]+/gu,' ').trim();
}
function inferredTags(text){
  const words=' '+tagWords(text)+' ';
  return prototypeState.tags.filter(tag=>[tag.name,...tag.keywords].some(word=>{
    const term=tagWords(word);return term&&words.includes(' '+term+' ');
  })).slice(0,3);
}
function recordTagText(kind,id){
  if(kind==='visit'){
    const v=visitById(id);return v?[person.doctors[v[3]]?.[1],v[2]].join(' '):'';
  }
  if(kind==='exam'){const exam=current().exams.find(e=>e.id===id);return exam?[exam.method,exam.region].join(' '):''}
  if(kind==='prevent'){
    const row=current().prevention.find(p=>p.id===id);return row?[preventionKinds[row.kind],row.title].join(' '):'';
  }
  const f=allFiles().find(f=>f.id===id);
  if(!f)return '';
  const lab=f.lab||f.labDraft;
  return [f.name,lab?.name,lab?.category,f.category,f.clinicalText,f.checked?f.context:''].filter(Boolean).join(' ');
}
function recordTags(kind,id){
  const key=kind+':'+id;
  const auto=new Set(inferredTags(recordTagText(kind,id)).map(tag=>tag.id));
  const overrides=current().tagEdits.find(row=>row.id===key);
  return prototypeState.tags.filter(tag=>overrides&&Object.hasOwn(overrides.values,tag.id)?overrides.values[tag.id]:auto.has(tag.id));
}
function tagLabels(kind,id){return recordTags(kind,id).map(tag=>tag.name).join(' · ')}
function tagStrip(kind,id){
  const tags=recordTags(kind,id);
  return '<div class="record-tags">'+tags.map(t=>'<span class="record-tag">'+esc(t.name)+'</span>').join('')+
    (readOnly?'':act('recordTags',tags.length?'Изменить теги':'Добавить теги',kind+':'+id,'inline-action','edit'))+'</div>';
}
function previewImportTags(form,anchor,evidence){
  const hint=document.createElement('p');hint.className='hint import-tags';
  anchor.before(hint);
  const refresh=()=>{
    const tags=inferredTags(evidence());
    hint.hidden=!tags.length;
    hint.textContent='Автоматические теги · '+tags.map(t=>t.name).join(' · ');
  };
  form.addEventListener('input',refresh);form.addEventListener('change',refresh);refresh();
}
function tagEditor(key){
  if(readOnly)return;
  const [kind,id]=key.split(':');
  const applied=new Set(recordTags(kind,id).map(t=>t.id));
  const auto=new Set(inferredTags(recordTagText(kind,id)).map(t=>t.id));
  openPanel(person.name,'Теги записи','<form class="edit-form" id="record-tags-form" data-key="'+esc(key)+'">'+
    (prototypeState.tags.map(t=>'<label class="source-choice"><input type="checkbox" name="tag" value="'+esc(t.id)+'" '+(applied.has(t.id)?'checked':'')+'>'+esc(t.name)+(auto.has(t.id)?' <small>по содержанию</small>':'')+'</label>').join('')||'<p>Справочник тегов пуст.</p>')+
    '<p class="error" role="alert"></p><button class="button primary">Сохранить теги</button></form>');
}
function saveRecordTags(form){
  if(readOnly)return;
  const key=form.dataset.key,[kind,id]=key.split(':');
  const checked=new Set(new FormData(form).getAll('tag'));
  const previous=current().tagEdits,old=previous.find(row=>row.id===key);
  const auto=new Set(inferredTags(recordTagText(kind,id)).map(t=>t.id));
  const values={};
  for(const tag of prototypeState.tags){
    if(checked.has(tag.id)!==auto.has(tag.id)||old&&Object.hasOwn(old.values,tag.id))values[tag.id]=checked.has(tag.id);
  }
  current().tagEdits=previous.filter(r=>r.id!==key);
  if(Object.keys(values).length)current().tagEdits.push({id:key,values});
  if(!saveState()){current().tagEdits=previous;form.querySelector('.error').textContent='Не удалось сохранить теги.';return}
  render();goBack();
}
function tagLibrary(){
  const admin=viewer==='admin'&&!previous?.access;
  openPanel('Настройки','Справочник тегов','<p class="hint">Эти теги общие для семьи. Название и ключевые слова используются для автоматической разметки на устройстве.</p>'+
    prototypeState.tags.map(t=>admin?resultRow('tagDefinition',t.id,t.name,t.keywords.join(' · '),'folder'):'<p class="note">'+esc(t.name)+'</p>').join('')+
    (admin?act('tagDefinition','Создать тег','','button primary','plus'):''));
}
function tagDefinition(id){
  if(viewer!=='admin'||previous?.access)return;
  const t=prototypeState.tags.find(t=>t.id===id);
  openPanel('Семейный справочник',t?'Редактировать тег':'Новый тег','<form id="tag-definition" class="edit-form" data-id="'+esc(id)+'"><label>Название<input required maxlength="48" name="title" value="'+esc(t?.name)+'"></label>'+
    '<label>Ключевые слова через запятую<textarea maxlength="400" name="keywords">'+esc(t?.keywords.join(', '))+'</textarea></label><p class="error" role="alert"></p><button class="button primary">Сохранить тег</button>'+
    (t?act('removeTag','Удалить тег',id,'text-button'):'')+'</form>');
  panelBody.querySelector('#tag-definition').tagBase=t;
}
function tagRemoval(id){
  const t=prototypeState.tags.find(t=>t.id===id);if(viewer!=='admin'||!t)return;
  openPanel('Семейный справочник','Удалить тег «'+t.name+'»?','<p>Тег исчезнет из карточек и поиска у всей семьи. Медицинские записи сохранятся.</p>'+
    act('back','Отмена','','button secondary')+act('confirmTagRemoval','Удалить из справочника',id,'button primary'));
  panelBody.querySelector('[data-action=confirmTagRemoval]').tagBase=t;
}
registerFieldRules('tag-definition',(form,add)=>{
  const name=tagWords(form.elements.title.value);
  if(!name)add('title','Введите название тега.');
  else if(prototypeState.tags.some(t=>t.id!==form.dataset.id&&tagWords(t.name)===name))add('title','Тег с таким названием уже есть.');
});
async function updateTagLibrary(form,removeId){
  if(viewer!=='admin')return;
  const before=prototypeState.tags,id=removeId||form.dataset.id||uid();
  const expected=removeId?panelBody.querySelector('[data-action=confirmTagRemoval]')?.tagBase:form.tagBase;
  const name=form?.elements.title.value.trim();
  const keywords=form?[...new Set(form.elements.keywords.value.split(',').map(word=>word.trim()).filter(Boolean))]:[];
  function change(list){
    const previous=list.find(tag=>tag.id===id);
    const signature=tag=>tag&&[tag.id,tag.name,tag.keywords];
    if(!syncMerge.same(signature(previous),signature(expected)))
      throw Error('Тег изменился на другом устройстве. Откройте справочник заново.');
    if(removeId)return list.filter(tag=>tag.id!==id);
    if(!tagWords(name)||list.some(tag=>tag.id!==id&&tagWords(tag.name)===tagWords(name)))throw Error('Проверьте название тега.');
    const aliases=[...keywords];
    if(previous&&tagWords(previous.name)!==tagWords(name)&&!aliases.some(word=>tagWords(word)===tagWords(previous.name)))aliases.push(previous.name);
    const tag={id,name,keywords:aliases};
    return previous?list.map(row=>row.id===id?tag:row):[...list,tag];
  }
  const submit=form?.querySelector('button[type=submit],button:not([type])')||panelBody.querySelector('[data-action=confirmTagRemoval]');
  if(submit?.disabled)return;
  if(submit)submit.disabled=true;
  try{
    prototypeState.tags=workingFamily&&prototypeState.sync?await deviceSync.changeFamilyTags(change):change(before);
    if(!saveState()){prototypeState.tags=before;throw Error('Не удалось сохранить справочник на этом устройстве.')}
    render();while(routes.length>1&&routes.at(-1).name!=='tagLibrary')routes.pop();displayRoute();
  }catch(error){
    const message=error instanceof TypeError?'Для изменения семейного справочника нужна связь.':error.message;
    const target=form?.querySelector('.error');
    if(target)target.textContent=message;else announce(message);
  }finally{if(submit)submit.disabled=false}
}
