'use strict';

function deletionButton(group,id,title='Удалить карточку'){
  if(readOnly||!recordRemoval.entries(current()).some(r=>r.group===group&&r.id===id))return '';
  return act('removeRecord',title,JSON.stringify({group,id}),'button danger');
}

function manageRecords(){
  if(readOnly)return;
  const items=recordRemoval.entries(current()),categories=[...new Set(items.map(row=>row.category))];
  openPanel(person.name,'Управление данными',`<div class="record-manager">
    <div class="edit-form record-filters">
      <div class="record-filter">
        <label for="remove-search">Поиск записи</label>
        <input type="search" id="remove-search">
      </div>
      <div class="record-filter">
        <label for="remove-category">Тип записи</label>
        <div class="record-type">
          <select id="remove-category"><option value="">Все записи</option>${categories.map(c=>'<option>'+esc(c)+'</option>').join('')}</select>
          ${icon('down',true)}
        </div>
      </div>
    </div>
    <div id="remove-list"></div>
    ${workingFamily?act('removeRecord','Очистить медицинские данные профиля','{"group":"profile"}','button danger'):''}
  </div>`);
  const search=panelBody.querySelector('#remove-search'),category=panelBody.querySelector('#remove-category');
  const list=panelBody.querySelector('#remove-list');
  function draw(){
    const shown=items.filter(r=>(!category.value||r.category===category.value)&&norm([r.title,r.context,r.category].join(' ')).includes(norm(search.value)));
    const rows=shown.map(r=>`<li class="record-row">
      <div class="record-info"><small>${esc(r.category)}</small><span>${esc(r.title)}</span>${r.context?`<small>${esc(r.context)}</small>`:''}</div>
      ${act('removeRecord','Удалить',JSON.stringify({group:r.group,id:r.id,index:r.index,other:r.other}),'button danger')}
    </li>`).join('');
    list.innerHTML=rows?`<ul class="record-list" role="list">${rows}</ul>`:'<p class="hint">Нет подходящих записей.</p>';
  }
  search.oninput=draw;category.onchange=draw;draw();
}

function removeRecord(token){
  if(readOnly)return;
  let spec;
  try{spec=JSON.parse(token)}catch{return}
  const profile=current(),owner=person.id;
  const selected=spec?.group==='profile'&&workingFamily
    ? {title:person.name,detail:'Очищаются медицинские записи, вложения, история ИИ и личные шаблоны этого профиля. Имя, роль и подключение сохраняются.'}
    : recordRemoval.entries(profile).find(r=>r.group===spec?.group&&r.id===spec.id&&r.index===spec.index&&r.other===spec.other);
  if(!selected)return;
  const snapshot=JSON.stringify(profile),saved=JSON.stringify(readJson(stateKey)?.profiles?.[owner]);
  const tabBaseline=JSON.stringify(JSON.parse(savedView)?.profiles?.[owner]);
  const all=spec.group==='profile';
  openPanel(person.name,all?'Очистить медицинские данные?':'Удалить запись?',`<p><strong>${esc(selected.title)}</strong></p>
    <p>${esc(selected.detail||'Запись исчезнет из дневника после сохранения.')}</p>
    <p class="hint">Ранее скачанные резервные копии сохраняют данные на момент их создания.</p>
    <form id="remove-record-form" class="edit-form"><label class="source-choice"><input type="checkbox" required>${all?'Подтверждаю очистку профиля':'Подтверждаю удаление'}</label>
      <p class="error" role="alert"></p><div class="actions"><button class="button danger">${all?'Очистить данные':'Удалить запись'}</button>${act('back','Отмена','','button secondary')}</div></form>`);
  const form=panelBody.querySelector('#remove-record-form');
  form.onsubmit=async event=>{
    event.preventDefault();
    if(readOnly||!form.reportValidity()||person.id!==owner||!form.isConnected)return;
    const status=form.querySelector('.error');
    if(tabBaseline!==saved||JSON.stringify(current())!==snapshot||JSON.stringify(readJson(stateKey)?.profiles?.[owner])!==saved){
      status.textContent='Данные изменились. Снова откройте запись для удаления.';return;
    }
    const before=JSON.parse(snapshot),next=recordRemoval.remove(profile,spec);
    if(!next){status.textContent='Запись уже изменилась.';return}
    if(!workingFamily&&spec.group==='prevention'&&spec.id?.startsWith('demo-')){
      next.hiddenDemoPrevention=[...new Set([...(next.hiddenDemoPrevention||[]),spec.id])];
    }
    const keys=p=>[...p.files,...(p.visitDrafts||[])].map(f=>owner+'/'+(f.blobId||f.id));
    const retained=new Set(keys(next));
    const obsolete=[...new Set(keys(before))].filter(key=>!retained.has(key));
    prototypeState.profiles[owner]=next;
    if(!saveState()){
      prototypeState.profiles[owner]=profile;
      status.textContent='Не удалось сохранить удаление.';return;
    }
    if(all||['addedVisits','addedDoctors','episodes'].includes(spec.group)){
      const storedIds=new Set(before.addedVisits.map(v=>v[0]));
      person.visits=[...next.addedVisits,...person.visits.filter(v=>!storedIds.has(v[0]))].sort((a,b)=>b[1].localeCompare(a[1]));
      const doctorIDs=new Set(next.addedDoctors.map(d=>d.id));
      for(const d of before.addedDoctors)if(!doctorIDs.has(d.id))delete person.doctors[d.id];
    }
    render();
    if(routes.at(-2)?.name==='manageRecords')goBack();
    else panel.close();
    const cleanup=await Promise.allSettled(obsolete.map(key=>removeBlob(key)));
    announce(cleanup.some(r=>r.status==='rejected')?'Запись удалена. Не удалось очистить часть локального кэша.':'Данные удалены.');
  };
}
