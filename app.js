'use strict';

const icons = {
  search:'<circle cx="10" cy="10" r="6.5"/><path d="m15 15 6 6"/>',
  lab:'<path d="M9 3h6m-5 0v7l-6 9a1.5 1.5 0 0 0 1.3 2h13.4a1.5 1.5 0 0 0 1.3-2l-6-9V3M7 16h10"/>',
  clip:'<path d="m8 14 7-7a2 2 0 0 1 3 3l-9 9a4 4 0 0 1-6-6l10-10a5 5 0 0 1 7 7l-9 9"/>',
  grid:'<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
  settings:'<path d="M3 6h7m4 0h7M3 17h12m4 0h2"/><circle cx="12" cy="6" r="2.5"/><circle cx="17" cy="17" r="2.5"/>',
  edit:'<path d="m4 20 4-1L20 7l-3-3L5 16zM14 7l3 3"/>',plus:'<path d="M12 4v16M4 12h16"/>',
  trend:'<path d="m3 17 6-6 4 3 8-10m-6 0h6v6"/>',spark:'<path d="m12 3 2.1 5.9L20 11l-5.9 2.1L12 19l-2.1-5.9L4 11l5.9-2.1zM20 15v6m-3-3h6"/>',
  users:'<circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 5"/>',
  user:'<circle cx="12" cy="8" r="3.5"/><path d="M5 21v-2a7 7 0 0 1 14 0v2"/>',
  down:'<path d="m6 9 6 6 6-6"/>', right:'<path d="m9 5 7 7-7 7"/>', arrow:'<path d="M4 12h15m-6-6 6 6-6 6"/>',
  x:'<path d="m6 6 12 12m0-12L6 18"/>', check:'<path d="m4 12 5 5L20 6"/>',
  book:'<rect x="4" y="4" width="16" height="17" rx="2"/><path d="M8 4v17m3-11h6m-3-3v6"/>',
  scope:'<path d="M5 3H3v5a5 5 0 0 0 10 0V3h-2M8 13v2a5 5 0 0 0 10 0v-1"/><circle cx="18" cy="11" r="2.5"/>',
  sprout:'<path d="M5 20c1-6 4-8 7-10m-1 3c-6 1-8-3-8-7 5 0 8 3 8 7Zm0-1c0-6 4-9 10-9 0 6-3 10-10 9Z"/>',
  eye:'<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  pill:'<path d="m7 20-3-3a5 5 0 0 1 0-7l6-6a5 5 0 0 1 7 0l3 3a5 5 0 0 1 0 7l-6 6a5 5 0 0 1-7 0Z" transform="translate(2 2) scale(.82)"/><path d="m8 8 8 8"/>',
  spray:'<path d="M10 3h7v3h-4v4m-3-7v2m-1 5h6v3H9zm-1 3h8v8H8z"/>', drop:'<path d="M12 3c-2 4-7 9-7 13a7 7 0 0 0 14 0c0-4-5-9-7-13Zm-3 13a3 3 0 0 0 3 3"/>',
  calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 10h18"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',
  folder:'<path d="M3 7V5h6l2 2h10v12H3z"/>'
};
function icon(name, small = false) {
  return '<span aria-hidden="true" class="icon'+(small?' small':'')+'"><svg viewBox="0 0 24 24">'+icons[name]+'</svg></span>';
}
document.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon,el.classList.contains('small')); });
const params=new URLSearchParams(location.search);
const viewer=workingFamily?(previous.access?.role||'admin'):['child','adult'].includes(params.get('role'))?params.get('role'):'admin';
const readOnly=viewer==='child';
const viewerPerson=workingFamily?people.find(p=>p.id===(previous.access?.member||family.adminId)):readOnly?people.find(p=>p.role==='Ребёнок'):people.find(p=>p.id===family.adminId);
function accessibleProfiles(){return people.filter(p=>viewer==='admin'||p.id===viewerPerson.id||(viewer==='adult'&&p.role==='Ребёнок'))}
function actingForOtherAdult(){return viewer==='admin'&&person.id!==viewerPerson.id&&person.role==='Взрослый'}
function transferEvent(kind){return {id:uid(),kind,time:new Date().toISOString(),actorId:viewerPerson.id,actorName:viewerPerson.name,role:viewer}}
function transferHint(){return actingForOtherAdult()?'<p class="fact-note">Разовая передача из профиля '+esc(person.name)+'. Подтверждает администратор '+esc(viewerPerson.name)+'.</p>':''}
function transferHistory(record){
  const labels={provider:'Отправлено провайдеру',copy:'Скопировано для ручной передачи',answer:'Ответ добавлен'};
  return (record.transfers||[]).map(t=>'<p class="hint">'+esc(t.automatic&&t.kind==='provider'?'Отправлено автоматически':labels[t.kind]||'Передача')+' · '+esc(t.actorName)+(t.role==='admin'?' (администратор)':'')+' · '+esc(stamp(t.time))+'</p>').join('');
}
function mayChangeConsent(){return !readOnly&&(person.id===viewerPerson.id||(viewer==='admin'&&person.role==='Ребёнок'))}
let person=accessibleProfiles().find(p=>p.id===params.get('profile'))||viewerPerson;
let section=Object.hasOwn(sectionNames,params.get('section'))?params.get('section'):'overview';
if(section==='labs'&&params.get('view')==='prevention')analysisMode='prevention';
let sectionQuery='', labFilter='Все', routes=[], returnFocus;
const main=document.querySelector('main'),panel=document.querySelector('#panel'),panelBody=document.querySelector('#panel-body');
function announce(message){document.querySelector('#announcement').textContent=message}
function dateLabel(value,options={day:'numeric',month:'long'}){
  const date=new Date(value+'T12:00:00Z');
  return Number.isFinite(date.getTime())?new Intl.DateTimeFormat('ru-RU',{...options,timeZone:'UTC'}).format(date):'Дата неизвестна';
}
function act(action,text,id='',classes='text-button',mark=''){
  return '<button type="button" class="'+classes+'" data-action="'+action+'" data-id="'+esc(id)+'">'+(mark?icon(mark,true):'')+esc(text)+'</button>';
}
function external(url,title,classes='external'){return '<a class="'+classes+'" href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">'+esc(title)+' ↗</a>'}
function visitById(id){return person.visits.find(v=>v[0]===id)}
function visitRows(visits){
  return visits.map(([id,date,title,doctor,episode])=>`<button type="button" class="visit-row" data-action="visit" data-id="${esc(id)}" aria-label="${esc(title)}, ${dateLabel(date)}, ${esc(doctorLabel(doctor))}">
  <span class="dateflag" aria-hidden="true"><strong>${Number(date.slice(-2))}</strong><small>${dateLabel(date,{month:'short'}).slice(0,3)}</small></span>
  <span class="row-main"><strong>${esc(title)}</strong><span class="sub">${esc(doctorLabel(doctor))}</span><span class="row-inner">${icon('folder',true)}${esc(episode)}</span></span>${icon('right',true)}</button>`).join('');
}
const sectionIcons={overview:'grid',visits:'calendar',labs:'lab',exams:'book',files:'clip',consults:'spark',settings:'settings'};
function sectionNav(){return `<div class="workspace-tools"><nav class="section-nav" aria-label="Разделы профиля">${Object.entries(sectionNames).filter(([key])=>key!=='settings').map(([key,label])=>`<button data-action="section" data-id="${key}" ${section===key?'aria-current="page"':''}>${icon(sectionIcons[key],true)}${label}</button>`).join('')}</nav>
  <button class="global-search" data-action="search" aria-label="Поиск по профилю">${icon('search')}<span>Поиск по профилю</span></button></div>`;}
function overview(){
  return `<div class="dashboard"><section><div class="section-head"><h2>Последние визиты</h2>${act('section','Все визиты ('+person.visits.length+')','visits','all')}</div>
    <div class="visit-list overview-visits">${visitRows(person.visits.slice(0,3))}</div>${readOnly?'':act('newVisit','Создать визит','','button secondary add-visit','plus')}</section>
    <section><div class="section-head"><h2>Текущее лечение</h2></div>${courseCard()}</section></div>${reviewQueue()}${measureLinks()}`;
}
function pageSection(){
  if(section==='overview')return overview();
  if(section==='settings')return showSettings();
  if(section==='consults')return consultPage();
  return recordsPage();
}
function render(){
  const stats=[ageText(yearsAt(todayLocal())),field('height')?'Рост '+field('height'):'',field('weight')?'Вес '+field('weight'):''].filter(Boolean);
  main.innerHTML=`<nav class="crumbs" aria-label="Навигация"><button data-action="family">${esc(family.name)}</button>${icon('right',true)}<span>${section==='overview'?'Обзор профиля':esc(person.name)}</span></nav>
  <section class="hero ${section==='overview'?'':'compact-hero'}"><img alt="" class="foliage" src="assets/ginkgo.png"><div class="hero-body">
  <p class="hero-label">${icon('book')}Профиль здоровья</p><h1>${esc(person.name)}</h1><div class="quick-stats">${stats.map(s=>'<span>'+esc(s)+'</span>').join('')}</div>
  ${act('medical','Открыть медкарту','','button hero-btn','book')}</div></section>${sectionNav()}${pageSection()}`;
}
function openPanel(label,title,body){
  if(!panel.open)returnFocus=document.activeElement;
  panelBody.innerHTML=(routes.length>1?act('back','‹ Назад','','back-link'):'')+'<p class="panel-label">'+esc(label)+'</p><h2 id="panel-title" tabindex="-1">'+esc(title)+'</h2>'+body;
  if(!panel.open)panel.showModal();
  panel.scrollTop=0;panelBody.querySelector('h2').focus({preventScroll:true});
}
function showFamily(){
  const available=accessibleProfiles();
  openPanel(family.name,'Профили семьи','<p class="dialog-sub">'+(readOnly?'Детский режим просмотра.':viewer==='admin'?'Доступ администратора.':'Доступ взрослого.')+'</p>'+
  available.map(p=>`<button class="person-row" data-action="select" data-id="${p.id}"><span class="avatar ${p.role==='Ребёнок'?'child':''}">${esc(p.initials)}</span><span><strong>${esc(p.name)}</strong><small>${workingFamily&&p.id===family.adminId?'Администратор':p.role}</small></span>${icon(p===person?'check':'right',true)}</button>`).join('')+familyActions());
}
function visitClinic(v){return v[9]??person.doctors[v[3]]?.[2]??''}
function visitEditor(id){
  const v=visitById(id);if(!v||readOnly)return;
  openPanel(v[2],'Редактировать визит',`<form id="visit-edit-form" data-id="${esc(id)}" class="edit-form">
    <label>Название визита<input name="title" required maxlength="100" value="${esc(v[2])}"></label>
    <label>Дата визита<input name="date" type="date" required max="${todayLocal()}" value="${esc(v[1])}"></label>
    <label>Врач<select name="doctor"><option value="">Врач не указан</option>${Object.keys(person.doctors).map(key=>'<option value="'+esc(key)+'" '+(v[3]===key?'selected':'')+'>'+esc(doctorLabel(key))+'</option>').join('')}</select></label>
    <label>Клиника<input name="clinic" maxlength="160" value="${esc(visitClinic(v))}"></label>
    <label>Сведения о визите<textarea name="note" maxlength="2000">${esc(v[5])}</textarea></label>
    <p class="error" role="alert"></p><button class="button primary">Сохранить изменения</button></form>`);
  panelBody.querySelector('#visit-edit-form').visitBase=v;
}
function saveVisitEdit(form){
  const v=visitById(form.dataset.id);if(!v||readOnly)return;
  const updated=v.slice(),value=field=>form.elements[field].value.trim();
  if(!value('title')||!value('date')||value('doctor')&&!person.doctors[value('doctor')])return;
  Object.assign(updated,{1:value('date'),2:value('title'),3:value('doctor'),5:value('note'),9:value('clinic')});
  updated[8]??=[];
  storeVisitEdit(form,v,updated);
}
function visitClinicEditor(id){
  const v=visitById(id);if(!v||readOnly)return;
  openPanel(v[2],'Клиника визита','<form id="visit-clinic-form" class="edit-form" data-id="'+esc(id)+'"><label>Клиника<input name="clinic" maxlength="160" value="'+esc(visitClinic(v))+'"></label><p role="alert" class="error"></p><button class="button primary">Сохранить</button></form>');
  panelBody.querySelector('#visit-clinic-form').visitBase=v;
}
function saveVisitClinic(form){
  const id=form.dataset.id,v=visitById(id);if(!v||readOnly)return;
  const updated=v.slice();
  updated[8]??=[];updated[9]=form.elements.clinic.value.trim();
  storeVisitEdit(form,v,updated);
}
function storeVisitEdit(form,v,updated){
  const latest=latestProfile().addedVisits.find(row=>row[0]===v[0])||v,expected=form.visitBase||v;
  const fields=form.id==='visit-clinic-form'?[9]:[1,2,3,5,9];
  if(fields.some(i=>latest[i]!==expected[i])){
    form.querySelector('.error').textContent='Визит уже изменился. Откройте актуальную карточку перед сохранением.';return;
  }
  const id=v[0],rows=current().addedVisits,idx=rows.findIndex(r=>r[0]===id),match=sameVisit(updated);
  if(match&&visitIdentity(updated,person.doctors)!==visitIdentity(v,person.doctors))return duplicateCard(form,'visit',match[0],'Открыть существующий визит');
  if(idx>=0)rows[idx]=updated;else rows.push(updated);
  if(!saveState()){
    if(idx>=0)rows[idx]=v;else rows.pop();
    form.querySelector('.error').textContent='Не удалось сохранить визит.';return;
  }
  person.visits[person.visits.findIndex(r=>r[0]===id)]=updated;
  person.visits.sort((a,b)=>b[1].localeCompare(a[1]));
  render();goBack();
}
function showVisit(id){
  const v=visitById(id),meds=prescribedForReview(id),files=allFiles().filter(f=>f.visit===id),linked=labs().filter(l=>l.visit===id);
  const reviews=current().reviews.filter(r=>r.visit===id).slice().reverse(),notes=current().notes.filter(n=>n.visit===id);
  openPanel(person.name,v[2],`
    <p class="detail-meta">${icon('calendar')}${dateLabel(v[1],{day:'numeric',month:'long',year:'numeric'})}</p>
    <p class="detail-meta">${visitClinic(v)?'Клиника · '+esc(visitClinic(v)):''} ${readOnly?'':act('editVisitClinic',visitClinic(v)?'Изменить клинику':'Указать клинику',id,'text-button')}</p>
    ${tagStrip('visit',id)}<div class="visit-links">${v[7]?act('episode',v[4],v[7],'chip-link','folder'):''}${person.doctors[v[3]]?act('doctor',doctorLabel(v[3]),v[3],'chip-link','scope'):''}</div><p class="visit-summary">${esc(v[5])}</p>
    ${readOnly?'':act('editVisit','Редактировать визит',id,'button secondary','edit')}
    ${readOnly?'':act('intake',intakeFiles(id).some(f=>!f.checked)?'Продолжить сверку назначений':'Документы и сверка назначений',id,'button secondary','clip')}
    <div class="visit-options">${v[7]?act('brief','Сводка к приёму',v[7],'chip-link','book'):''}${readOnly?'':act('consult','Обсудить с ИИ','visit:'+id,'chip-link','spark')}
    ${!readOnly&&previousMeds(v[7],v[1],id).length?act('therapy','Пересмотреть предыдущую схему',id,'text-button','pill'):''}</div>
    ${current().changes.filter(c=>c.visit===id).map(c=>'<p class="fact-note">'+esc(decisionText(c))+'</p>').join('')}
    <nav class="visit-jumps"  aria-label="Содержание визита">${meds.length?act('jump','Назначения · '+meds.length,'visit-meds','jump-link'):''}${act('jump','Анализы · '+linked.length,'visit-labs','jump-link')}${act('jump','Вложения · '+files.length,'visit-files','jump-link')}${act('jump','Пометки · '+notes.length,'visit-notes','jump-link')}</nav>
    ${meds.length||reviews.length?`<section class="ai-box"><div><h3>${icon('spark')} Разбор лечения</h3><small>${intakeFiles(id).length||id!==person.course?.visit?'Один запрос по сверенным сведениям визита':'Деморежим · данные обрабатываются локально'}</small></div>
    ${readOnly?'':reviewReady(id)?act('analyze','Сделать ИИ-анализ лечения',id,'button primary'):'<p class="hint">Для нового разбора завершите сверку назначений.</p>'}${!readOnly&&current().auto&&reviewReady(id)&&!intakeFiles(id).length?act('manual','Разобрать в своём ChatGPT',id,'inline-action'):''}${reviews[0]?act('review','Последний разбор · '+stamp(reviews[0].time),reviews[0].id,'inline-action'):''}
    ${reviews.length>1?'<details><summary>Предыдущие разборы ('+(reviews.length-1)+')</summary>'+reviews.slice(1).map(r=>act('review',stamp(r.time),r.id,'text-button')).join('')+'</details>':''}</section>
    <section id="visit-meds" class="panel-section"><h3>Назначения врача</h3><div class="prescription-list">${meds.map((m,i)=>drugBlock(m,i,true,id)).join('')}</div></section>`:'<p class="fact-note">Пока нет сверенных лекарственных назначений.</p>'}
    <section class="panel-section"><h3>Рекомендации врача</h3>${recommendationsSection(id)}</section>
    <section id="visit-labs" class="panel-section"><h3>Лабораторные анализы</h3>${linked.length?linked.map(l=>resultRow('lab',l.id,reportInfo(l).name,dateLabel(reportInfo(l).date),'lab')).join(''):'<p class="hint">Нет связанных бланков.</p>'}</section>
    <section class="panel-section"><h3>Результаты обследований</h3>${examListing(current().exams.filter(e=>e.visit===id))||'<p class="hint">Нет связанных обследований.</p>'}${readOnly?'':act('newExam','Добавить обследование',id,'text-button','plus')}</section>
    <section id="visit-files" class="panel-section"><h3>Вложения</h3>${files.map(f=>resultRow('file',f.id,f.name,f.category,'clip')).join('')||'<p class="hint">Пока нет файлов.</p>'}${readOnly?'':act('upload','Прикрепить файл',id,'text-button','plus')}</section>
    <section id="visit-notes" class="panel-section"><h3>Пометки к визиту</h3>${notes.map(n=>'<div class="note"><small>'+esc(n.author)+' · '+esc(stamp(n.time))+'</small><p>'+esc(n.text)+'</p></div>').join('')||'<p class="hint">Пометок пока нет.</p>'}
    ${readOnly?'':act('addNote','Добавить пометку',id,'text-button','plus')}</section>${deletionButton('addedVisits',id,'Удалить визит')}`);
}
function showDoctor(id){
  const doctor=person.doctors[id];if(!doctor)return;
  const [name,spec,clinic]=doctor;
  openPanel(spec||'Карточка врача',name,'<p class="dialog-sub">'+esc(clinic)+'</p><div class="panel-section"><h3>Визиты пациента</h3><div class="visit-list">'+visitRows(person.visits.filter(v=>v[3]===id))+'</div></div>'+deletionButton('addedDoctors',id,'Удалить карточку врача'));
}
function addNote(id){
  openPanel('Пометка к визиту',visitById(id)[2],`<form id="note-form" class="edit-form" data-id="${id}"><label>Текст пометки<textarea required name="note" maxlength="800"></textarea></label><p class="hint">Увидят все, кому доступна карточка ${esc(person.name)}.</p><button class="button primary">Сохранить пометку</button></form>`);
}
const pages={manageRecords,removeRecord,resumeExam:id=>editExam(null,'',id),exam:showExam,newExam:visit=>editExam(null,visit),editExam:id=>editExam(id),editVisitClinic:visitClinicEditor,editVisit:visitEditor,editEpisode:showNewEpisode,drive:drivePanel,deviceUpdate:updateDevicePanel,joinDevice:joinDevicePanel,grantDevice:grantDevicePanel,revokeDevice:revokeDevicePanel,newFamily:()=>familyForm(true),newMember:()=>familyForm(false),recommendVisit:recommendationEditor,readDraft:id=>openImportDraft(id,'local'),manualDraft:id=>openImportDraft(id,'manual'),prevent:preventCard,editPrevent:preventionForm,completePrevent,tagLibrary,tagDefinition,removeTag:tagRemoval,recordTags:tagEditor,family:showFamily,medical:showMedical,visit:showVisit,doctor:showDoctor,episode:episodeCard,field:showField,removeField:showDelete,
  search:showSearch,lab:labCard,trend:indicatorView,file:showFile,upload:selectUpload,period:showPeriod,finish:showFinish,consent:showConsent,
  review:showReview,manual:showManual,directTreatment:directTreatmentForm,therapy:therapyEditor,brief:visitBrief,measure:measureForm,measureChart,measurePoint,consult:newConsult,consultRecord,
  providers,prompts:promptManager,template:templateForm,resetTemplate:id=>changeTemplate(id,true,false),deleteTemplate:id=>changeTemplate(id,false,false),
  devices:familyDevices,archive:archivePanel,exportBackup:exportForm,importBackup:importForm,linkDocument,verifyLab,resumeVisit,analogs:showAnalogs,addNote,newEpisode:showNewEpisode,newVisit:showNewVisit,photoVisit:showPhotoVisit,intake:showIntake,verifyFile:showVerification};
const restricted=new Set(['manageRecords','removeRecord','resumeExam','newExam','editExam','applyVisitTranscript','refreshRxDraft','editVisitClinic','editVisit','editEpisode','recommendVisit','readDraft','manualDraft','queueTreatment','editPrevent','completePrevent','tagDefinition','removeTag','recordTags','confirmTagRemoval','resumeVisit','directTreatment','therapy','verifyLab','linkDocument','measure','consult','providers','prompts','template','resetTemplate','deleteTemplate','exportBackup','importBackup','field','removeField','confirmDelete','finish','period','upload','analyze','consent','run','addNote','manual','copyPrompt','newEpisode','newVisit','photoVisit','visitMode','sampleVisit','intake','verifyFile','sampleRx','retryRead','appendMed','dropMed','deferVerify','intakeAnalyze']);
function displayRoute(){clearFileURL();const r=routes.at(-1);pages[r.name](r.id)}
function go(name,id=''){routes.push({name,id});displayRoute()}
function replaceRoute(name,id){routes.pop();go(name,id)}
function goBack(){if(routes.length<=1){panel.close();return}routes.pop();displayRoute()}
panel.addEventListener('close',()=>{
  if(['newExam','editExam','resumeExam'].includes(routes.at(-1)?.name))render();
  clearFileURL();routes=[];
  if(returnFocus?.isConnected)returnFocus.focus({preventScroll:true});else main.focus({preventScroll:true});
});
panel.addEventListener('click',e=>{
  if(e.target!==panel)return;const r=panel.getBoundingClientRect();
  if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)panel.close();
});
document.addEventListener('click',e=>{
  const button=e.target.closest('[data-action]');if(!button)return;
  const {action,id=''}=button.dataset;
  if(readOnly&&restricted.has(action))return;
  if(Object.hasOwn(pages,action)){go(action,id|| (action==='search'?'any':''));return}
  appExtrasClick(action,id,button);
  switch(action){
    case 'pinFile':case 'pinEpisode':deviceSync.pin(action==='pinEpisode',id,button);break;
    case 'switchSpace':if(viewer==='admin'&&['family','demo'].includes(id))enterSpace(id);break;
    case 'visitHome':routes=[];go('visit',id);break;
    case 'sampleRx':addExample(id,button);break;
    case 'sampleVisit':exampleForVisit(button);break;
    case 'deferVisit':{
      const draft=routes.at(-1)?.photo;
      if(!readOnly&&draft){keepVisitFields(button.form,draft);section='overview';render();panel.close()}break;
    }
    case 'visitMode':switchVisitMode(button.dataset.mode,id);break;
    case 'retryRead':retryRecognition(id);break;
    case 'applyVisitTranscript':applyVisitTranscript();break;
    case 'refreshRxDraft':refreshRxDraft(id);break;
    case 'appendMed':{
      document.querySelector('#rx-rows').insertAdjacentHTML('beforeend',medicineInputs({}));
      const none=document.querySelector('#verify-form [name=none]');if(none)none.checked=false;
      document.querySelector('#rx-rows fieldset:last-child input').focus();break;
    }
    case 'dropMed':button.closest('fieldset').remove();break;
    case 'deferVerify':storeVerification(button.form,true);break;
    case 'intakeAnalyze':if(reviewReady(id)){routes=[{name:'visit',id}];startReview(id)}break;
    case 'back':goBack();break;
    case 'close':panel.close();break;
    case 'jump':{
      const target=document.getElementById(id);target.tabIndex=-1;target.focus({preventScroll:true});target.scrollIntoView({block:'start'});break;
    }
    case 'section':section=id;sectionQuery='';render();break;
    case 'labFilter':labFilter=id;render();break;
    case 'select':{
      const next=accessibleProfiles().find(p=>p.id===id);if(!next)return;
      if(workingFamily)history.replaceState(null,'','?space=family&profile='+encodeURIComponent(next.id));
      person=next;labFilter='Все';section='overview';sectionQuery='';render();panel.close();break;
    }
    case 'confirmDelete':current().fields=current().fields.filter(f=>f.id!==id);saveState();render();routes=routes.filter(r=>r.name!=='field'&&r.name!=='removeField');displayRoute();break;
    case 'analyze':startReview(id);break;
    case 'run':completeReview(id);break;
    case 'copyPrompt':copyPrompt();break;
  }
});
document.addEventListener('input',e=>{
  if(!readOnly&&e.target.closest('#visit-form')&&routes.at(-1)?.photo)keepVisitFields(e.target.form,routes.at(-1).photo);
  if(e.target.id==='consult-source-search')filterConsultSources(e.target.form);
  if(e.target.id==='global-search')filterSearch();
  if(e.target.id==='section-filter'){sectionQuery=e.target.value;document.querySelector('#listing').innerHTML=recordsListing()}
});
document.addEventListener('change',e=>{
  const el=e.target;
  if(el.id==='search-kind'){filterSearch();return}
  if(readOnly)return;
  appExtrasChange(el);
  if(el.closest('#manual-form')){
    const f=el.form,saved=current().prompts[f.dataset.id];
    if(saved){saved.text=cleanClinicalText(f.elements.prompt.value);saved.answer=f.elements.answer.value;saveState()}
  }
  if(el.id==='visit-source'){preparePhotoVisit(el.files);return}
  if(el.id==='replace-visit-source'&&el.files[0]){replaceImportOriginal(el,el.files[0]);return}
  if(el.dataset.draftKind){
    const d=current().visitDrafts.find(d=>d.id===el.dataset.draftKind);
    if(d){d.kind=el.value;saveState()}return;
  }
  if(el.closest('#visit-form')){toggleVisitInputs();el.form.refreshClarifications?.()}
  if(el.closest('#period-form'))togglePeriodFields();
  if(el.hasAttribute('data-unknown'))el.form.elements['d'+el.dataset.unknown].disabled=el.checked;
  if(el.id==='auto-analysis'&&mayChangeConsent()){current().auto=el.checked;saveState()}
  if(el.id==='city'&&viewer==='admin'&&Object.hasOwn(pharmacyRegions,el.value)){prototypeState.city=el.value;saveState()}
});
document.addEventListener('submit',e=>{
  const f=e.target;e.preventDefault();
  if(f.id==='device-install'){installDeviceFile(f);return}
  if(readOnly)return;
  appExtrasSubmit(f);
  switch(f.id){
    case 'device-issue':issueDeviceFile(f);break;
    case 'device-revoke':revokeDevice(f);break;
    case 'family-form':saveFamilyForm(f);break;
    case 'episode-form':submitEpisode(f);break;
    case 'visit-clinic-form':saveVisitClinic(f);break;
    case 'visit-edit-form':saveVisitEdit(f);break;
    case 'visit-form':submitVisit(f,e.submitter?.value);break;
    case 'verify-form':storeVerification(f);break;
    case 'period-form':savePeriod(f);break;
    case 'finish-form':saveFinish(f);break;
    case 'field-form':saveField(f);break;
    case 'upload-form':saveUpload(f);break;
    case 'manual-form':saveManual(f);break;
    case 'note-form':{
      const text=f.elements.note.value.trim();if(!text)return;
      current().notes.push({id:uid(),visit:f.dataset.id,time:new Date().toISOString(),author:viewerPerson.name,text});
      saveState();goBack();break;
    }
  }
});
if(!workingFamily&&previous&&!previous.schemaVersion)saveState();
if(!workingFamily&&person.id==='anna'&&!current().reviews.length){
  const sample=createReview(person.course.visit);
  sample.time='2026-11-18T12:00:00+03:00';current().reviews.push(sample);saveState();
}
if(workingFamily)document.querySelector('.bar-actions .demo')?.remove();
document.querySelector('.bar-actions').inert=false;
render();
const returningFromChatGPT=chatGPT.usesBroker&&new URLSearchParams(location.hash.slice(1)).has('chatgpt');
chatGPT.refresh().then(()=>{
  if(!chatGPT.endpoint||readOnly)return;
  const settingsStatus=main.querySelector('.settings-menu [data-action="providers"] small');
  if(settingsStatus)settingsStatus.textContent=providerStatus();
  if(routes.at(-1)?.name==='providers')providers();
  if(!panel.open && section==='consults')render();
  if(routes.at(-1)?.name==='consultRecord' && !document.querySelector('#consult-answer :focus, #chatgpt-followup :focus'))consultRecord(routes.at(-1).id);
});
if(!readOnly&&(params.get('connect')==='chatgpt'||returningFromChatGPT))go('providers');
else if(driveSession.returned&&driveAllowed())go('drive');
else if(params.get('new')==='family'&&viewer==='admin')go('newFamily');
else if(params.get('visit')&&visitById(params.get('visit')))go('visit',params.get('visit'));
else if(params.get('brief')&&current().episodes.some(ep=>ep.id===params.get('brief')))go('brief',params.get('brief'));
else if(!readOnly&&params.get('new')==='exam')go('newExam');
else if(!readOnly&&params.get('new')==='visit')go(params.get('mode')==='photo'?'photoVisit':'newVisit');
else if(!readOnly&&params.get('new')==='episode')go('newEpisode');
else if(!readOnly&&params.get('new')==='consultation')go('consult',params.get('example')==='risk'?'risk-demo':'');
else if(workingFamily&&!['section','profile','visit','new','brief'].some(k=>params.has(k)))go('family');

document.addEventListener('keydown',event=>{
  const target=event.target.closest('.trend-chart [role=button]');
  if(target&&['Enter',' '].includes(event.key)){event.preventDefault();target.dispatchEvent(new MouseEvent('click',{bubbles:true}))}
});
if('serviceWorker' in navigator && window.isSecureContext && location.protocol!=='file:'){
  navigator.serviceWorker.register('sw.js').catch(()=>{});
}
window.addEventListener('storage',event=>{
  if(event.key===stateKey&&event.newValue&&event.newValue!==savedView){
    document.querySelector('#refresh-notice').hidden=false;
  }
});
document.querySelector('#refresh-local').addEventListener('click',()=>location.reload());
deviceSync.start();
