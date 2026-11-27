'use strict';

function visitMedicineRecords(visit){
  const v=visitById(visit);if(!v)return [];
  return (courseAt(visit)?.meds||[]).filter(m=>m.id).map(m=>({
    target:m.id,source:visit,title:[m.name,m.strength].filter(Boolean).join(' · '),
    detail:[v[2],preventionDate(v[1])].filter(Boolean).join(' · ')
  }));
}

function visitLinkOptions(visit){
  const options=(kind,rows)=>rows.map(({target,source='',title,detail})=>({
    link:{id:JSON.stringify([visit,kind,source,target]),visit,kind,source,target},title,detail
  }));
  return [
    ['Анализы',options('lab',labs().filter(f=>f.visit!==visit).map(f=>{
      const report=reportInfo(f);
      return {target:f.id,title:report.name,detail:[preventionDate(report.date),report.laboratory].filter(Boolean).join(' · ')};
    }))],
    ['Лекарства',options('med',person.visits.filter(v=>v[0]!==visit).flatMap(v=>visitMedicineRecords(v[0])))],
    ['Документы',options('file',allFiles().filter(f=>f.visit!==visit).map(f=>({
      target:f.id,title:f.name,detail:[f.category,preventionDate(f.date)].filter(Boolean).join(' · ')
    })))]
  ];
}

function visitLinksEditor(visit){
  const v=visitById(visit);if(!v||readOnly)return;
  const groups=visitLinkOptions(visit).filter(([,rows])=>rows.length);
  const selected=new Set(current().visitLinks.filter(link=>link.visit===visit).map(link=>link.id));
  openPanel(v[2],'Связанные записи',groups.length?`<form id="visit-links-form" class="edit-form" data-id="${esc(visit)}">
    <p class="hint">Отметьте записи этого пациента, которые нужно открыть из визита.</p>
    <label>Найти запись<input type="search" id="visit-link-search" placeholder="Название, дата или визит"></label>
    <p class="hint" id="visit-link-status" role="status"></p>
    ${groups.map(([name,rows])=>`<details class="pick-group" open><summary>${esc(name)} <small>(${rows.length})</small></summary>
      ${rows.map(({link,title,detail})=>`<label class="source-choice picker-source" data-visit-option data-search="${esc(norm(title+' '+detail))}">
        <input type="checkbox" name="related" value="${esc(link.id)}" ${selected.has(link.id)?'checked':''}>
        <span><strong>${esc(title)}</strong><small>${esc(detail)}</small></span></label>`).join('')}</details>`).join('')}
    <p class="error" role="alert"></p><button class="button primary">Сохранить связи</button></form>`:
    '<p class="hint">В профиле пока нет других анализов, лекарств или документов для привязки.</p>');
  const form=document.querySelector('#visit-links-form');if(!form)return;
  function update(){
    const words=norm(form.querySelector('#visit-link-search').value).split(/\s+/).filter(Boolean);
    for(const row of form.querySelectorAll('[data-visit-option]'))row.hidden=!words.every(word=>row.dataset.search.includes(word));
    const matches=form.querySelectorAll('[data-visit-option]:not([hidden])').length;
    for(const group of form.querySelectorAll('.pick-group'))group.hidden=!group.querySelector('[data-visit-option]:not([hidden])');
    form.querySelector('#visit-link-status').textContent=(words.length?(matches?'Найдено: '+matches:'Совпадений нет')+' · ':'')+
      'Выбрано: '+form.querySelectorAll('[name=related]:checked').length;
  }
  form.addEventListener('input',update);
  update();
}

function saveVisitLinks(form){
  const visit=form.dataset.id,profile=current(),latest=latestProfile();
  if(readOnly||!visitById(visit))return;
  if(workingFamily&&!latest.addedVisits.some(row=>row[0]===visit)){
    form.querySelector('.error').textContent='Визит был удалён в другой вкладке. Обновите профиль.';return;
  }
  const selected=new Set(new FormData(form).getAll('related'));
  const links=visitLinkOptions(visit).flatMap(([,rows])=>rows).map(row=>row.link).filter(link=>selected.has(link.id));
  const before=profile.visitLinks;
  profile.visitLinks=[...before.filter(link=>link.visit!==visit),...links];
  if(!saveState()){
    profile.visitLinks=before;
    form.querySelector('.error').textContent='Не удалось сохранить связи.';return;
  }
  profile.visitLinks=latestProfile().visitLinks;
  goBack();
}

function linkedVisitMedicine(id){
  const link=current().visitLinks.find(row=>row.id===id&&row.kind==='med');
  if(!link)return;
  const source=visitById(link.source),meds=courseAt(link.source)?.meds||[];
  const index=meds.findIndex(m=>m.id===link.target);
  if(!source||index<0)return;
  const med=meds[index];
  openPanel('Карточка лекарства',med.name,drugBlock(med,index,false,link.source)+
    resultRow('visit',link.source,source[2],dateLabel(source[1]),'calendar'));
}

function visitLinkedRecords(visit){
  const links=current().visitLinks.filter(row=>row.visit===visit);
  const targets=kind=>new Set(links.filter(link=>link.kind===kind).map(link=>link.target));
  const labIds=targets('lab'),fileIds=targets('file');
  const medicines=links.filter(link=>link.kind==='med').flatMap(link=>visitMedicineRecords(link.source)
    .filter(m=>m.target===link.target).map(m=>({...m,id:link.id})));
  return {files:allFiles().filter(f=>f.visit===visit||fileIds.has(f.id)),
    reports:labs().filter(f=>f.visit===visit||labIds.has(f.id)),medicines};
}
