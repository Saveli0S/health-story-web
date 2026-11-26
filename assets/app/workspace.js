'use strict';

let historyMode='dates',analysisMode='reports',documentFilter='Все';
function choices(action,items,active){
  return '<div class="category-filters">'+items.map(([id,title])=>'<button type="button" data-action="'+action+'" data-id="'+esc(id)+'" aria-pressed="'+(id===active)+'">'+esc(title)+'</button>').join('')+'</div>';
}
function historyRows(){
  if(historyMode==='episodes'){
    const entries=current().episodes.filter(e=>norm(e.name+' '+episodeVisits(e.id).map(v=>[v[2],doctorLabel(v[3]),tagLabels('visit',v[0])].join(' ')).join(' ')).includes(norm(sectionQuery)));
    return entries.map(e=>resultRow('episode',e.id,e.name,'Визитов · '+episodeVisits(e.id).length,'folder')).join('');
  }
  const rows=filterRows(searchIndex().filter(r=>r.type==='visit'),sectionQuery);return visitRows(rows.map(r=>visitById(r.id)));
}
function recordsListing(){
  let content='';
  if(section==='exams')content=examDraftListing(sectionQuery)+examListing(current().exams,sectionQuery);
  if(section==='visits')content=historyRows();
  if(section==='labs'){
    if(analysisMode==='prevention')content=preventionListing(sectionQuery);
    else if(analysisMode==='reports'){
      const rows=filterRows(searchIndex().filter(r=>r.type==='lab'&&(labFilter==='Все'||labCategory(r.id)===labFilter)),sectionQuery);
      content=rows.map(r=>resultRow('lab',r.id,r.title,r.meta,'lab')).join('');
    }else content=indicatorGroups().filter(g=>norm(g.name+' '+g.specimen+' '+g.points.map(p=>p.raw.name+' '+reportInfo(labs().find(l=>l.id===p.source)).name+' '+tagLabels('lab',p.source)).join(' ')).includes(norm(sectionQuery)))
      .map(g=>resultRow('trend',g.key,g.name,seriesDescription(g)+' · результатов '+g.points.length,'trend')).join('');
  }
  if(section==='files')content=filterRows(searchIndex().filter(r=>r.type==='file'&&(documentFilter==='Все'||allFiles().find(f=>f.id===r.id)?.category===documentFilter)),sectionQuery)
    .map(r=>{const row=resultRow('file',r.id,r.title,r.meta,'clip');return prototypeState.sync?
      '<div class="sync-document">'+deviceSync.thumb(current().files.find(f=>f.id===r.id))+row+
      act('pinFile','Сохранить без сети',r.id,'inline-action')+'</div>':row}).join('');
  return content||'<p class="empty">'+(sectionQuery?'По запросу ничего не найдено.':'Пока нет записей.')+'</p>';
}
function recordsPage(){
  if(section==='exams')return '<section class="section-page"><div class="section-head"><h2>Результаты обследований</h2>'+(readOnly?'':act('newExam','Добавить обследование','','button primary','plus'))+'</div><label class="searchbox section-filter">'+icon('search')+'<input id="section-filter" type="search" aria-label="Поиск обследований" placeholder="Вид, область, параметр или тег" value="'+esc(sectionQuery)+'"></label><div id="listing">'+recordsListing()+'</div></section>';
  const isHistory=section==='visits',isLabs=section==='labs';
  const action=isHistory?act('newVisit','Создать визит','','button primary','plus'):isLabs&&analysisMode==='prevention'?act('editPrevent','Добавить запись','','button primary','plus'):isLabs?act('upload','Загрузить бланк','lab','button primary','plus'):act('upload','Прикрепить файл','','button primary','clip');
  let filters;
  if(isHistory)filters=choices('historyMode',[['dates','По датам'],['episodes','По эпизодам']],historyMode)+(historyMode==='episodes'&&!readOnly?act('newEpisode','Создать эпизод','','text-button','plus'):'');
  else if(isLabs)filters=choices('analysisMode',[['reports','Бланки'],['indicators','Показатели'],['prevention','Профилактика']],analysisMode)+(analysisMode==='reports'?choices('labFilter',['Все','Гематология','Биохимия','Другое'].map(x=>[x,x]),labFilter):'');
  else filters=choices('docFilter',['Все','Назначения','Лаборатория','Снимки','Заключения','Рекомендации','Другое'].map(x=>[x,x]),documentFilter);
  return '<section class="section-page"><div class="section-head"><h2>'+sectionNames[section]+'</h2>'+(readOnly?'':action)+'</div>'+filters+
    '<label class="searchbox section-filter">'+icon('search')+'<input type="search" id="section-filter" value="'+esc(sectionQuery)+'" aria-label="Поиск в разделе" placeholder="'+(isLabs?'Название, показатель или тег':isHistory?'Врач, визит или эпизод':'Название документа')+'"></label><div id="listing">'+recordsListing()+'</div></section>';
}
function settingsMenu(){
  const entries=[['providers','ИИ-провайдеры',providerStatus(),'spark'],['prompts','Промпты','Семейные и личные шаблоны','book'],['tagLibrary','Справочник тегов','Названия и правила авторазметки','folder'],['devices','Семья и устройства','Профили и права просмотра','users'],['archive','Синхронизация и резервная копия','Локальный архив семьи','folder']];
  return '<div class="settings-menu">'+entries.filter(e=>!readOnly||!['providers','prompts'].includes(e[0])).map(e=>resultRow(e[0],'',e[1],e[2],e[3])).join('')+'</div>';
}
function visitConclusions(id){
  return [...intakeFiles(id).filter(f=>f.checked&&f.context).map(f=>f.context),...current().files.filter(f=>f.visit===id&&f.category==='Заключения'&&f.clinicalText).map(f=>f.clinicalText)];
}
function documentLinks(f){
  const files=allFiles();
  const links=current().docLinks.filter(l=>l.id===f.id||l.other===f.id);
  const linked=files.filter(other=>other.id!==f.id&&links.some(l=>l.id===other.id||l.other===other.id));
  const canLink=['Снимки','Заключения'].includes(f.category)&&!readOnly;
  const exams=current().exams.filter(e=>e.attachments.some(a=>a.id===f.id));
  return exams.map(e=>resultRow('exam',e.id,examTitle(e),'Карточка обследования','book')).join('')+(f.clinicalText?'<div class="summary-sheet"><strong>Текст заключения для разбора</strong><p>'+esc(f.clinicalText)+'</p></div>':'')+(linked.length?'<h3>Связанные документы</h3>'+linked.map(other=>resultRow('file',other.id,other.name,other.category,'clip')).join(''):'')+
    (canLink?act('linkDocument','Связать снимок и заключение',f.id,'text-button','clip'):'');
}
function linkDocument(id){
  const f=allFiles().find(f=>f.id===id);if(!f)return;
  const options=allFiles().filter(o=>o.visit===f.visit&&o.category===(f.category==='Снимки'?'Заключения':'Снимки'));
  openPanel(f.name,'Связанные документы','<form id="link-document" class="edit-form" data-id="'+esc(id)+'"><label>Документ этого визита<select name="related"><option value="">Без связи</option>'+
    options.map(o=>'<option value="'+esc(o.id)+'" '+(current().docLinks.some(l=>(l.id===id&&l.other===o.id)||(l.other===id&&l.id===o.id))?'selected':'')+'>'+esc(o.name)+'</option>').join('')+'</select></label><button class="button primary">Сохранить связь</button></form>');
}
function appExtrasClick(action,id,button){
  if(action==='historyMode'){historyMode=id;render()}
  if(action==='analysisMode'){analysisMode=id;render()}
  if(action==='docFilter'){documentFilter=id;render()}
  if(action==='offlineKit')prepareOffline(button);
  if(readOnly)return;
  if(action==='queueTreatment'&&reviewReady(id)){
    const queue=current().treatmentQueue,entry=queue.find(q=>q.id===id);
    if(!entry){queue.push({id});if(!saveState()){queue.pop();return}}
    render();panel.close();announce('Разбор сохранён в очереди профиля.');
  }
  if(action==='confirmTagRemoval')updateTagLibrary(null,id);
  if(action==='editQuestion')editBriefQuestion(id);
  if(action==='cancelQuestion')visitBrief(id);
  if(action==='appendLab')document.querySelector('#lab-rows').insertAdjacentHTML('beforeend',labInput());
  if(action==='dropLab')button.closest('.lab-input').remove();
  if(action==='deferLab')saveLab(button.form,true);
  if(action==='applyReset'||action==='applyDelete')changeTemplate(id,action==='applyReset',true);
  if(action==='connectChatGPT')chatGPT.connect(button);
  if(action==='disconnectChatGPT')chatGPT.disconnect(button);
  if(action==='beginAI')beginProvider();
  if(action==='disconnectAI'){routerKey='';pendingLogin=null;routerDelivery='';providers();render()}
  if(action==='askProvider')askProvider(id);
  if(action==='consultCopy')copyConsult(button.form);
}
function appExtrasChange(el){
  if(el.closest('#upload-form')&&['category','visit'].includes(el.name)){
    if(el.name==='category')for(const select of el.form.querySelectorAll('[data-file-index]'))select.value=el.value;
    uploadOptions(el.form);
  }
  if(el.closest('#consult-form')&&['sourceTag','source'].includes(el.name))filterConsultSources(el.form);
  if(el.closest('#consult-form')&&el.name==='template')updateConsultTemplate(el.form);
  if(['direct-auto','chatgpt-auto'].includes(el.id)&&mayChangeConsent()){
    const profile=current(),key=el.id==='chatgpt-auto'?'chatGPTAuto':'directAuto',before=profile[key];
    profile[key]=el.checked;
    if(!saveState()){profile[key]=before;el.checked=before===true;announce('Не удалось сохранить настройку отправки.')}
  }
  if(el.name==='decision'){
    const fields=el.closest('.therapy-decision').querySelector('.decision-fields');
    fields.hidden=!['dose','replace'].includes(el.value);fields.querySelector('[name=changeName]').readOnly=el.value==='dose';
  }
  if(el.closest('#visit-form')&&['episode','date'].includes(el.name))refreshPreviousFields(el.form);
  if(!readOnly&&el.closest('#chatgpt-followup')){const record=current().consultations.find(r=>r.id===el.form.dataset.id);if(record){record.nextQuestion=el.value;saveState()}}
  if(el.closest('#consult-answer')){
    const f=el.form,r=current().consultations.find(r=>r.id===f.dataset.id);
    if(r&&!r.answer){if(!r.sentAt)r.prompt=cleanClinicalText(f.elements.prompt.value);r.replyDraft=f.elements.answer.value;saveState()}
  }
}
function appExtrasSubmit(f){
  switch(f.id){
    case 'tag-definition':updateTagLibrary(f);break;
    case 'record-tags-form':saveRecordTags(f);break;
    case 'prevention-form':case 'prevent-event':savePrevention(f);break;
    case 'direct-treatment':sendTreatment(f,true);break;
    case 'rec-form':saveVisitRecommendation(f);break;
    case 'lab-form':saveLab(f);break;
    case 'therapy-form':saveTherapy(f);break;
    case 'measure-form':saveMeasure(f);break;
    case 'template-form':saveTemplate(f);break;
    case 'consult-form':prepareConsult(f);break;
    case 'chatgpt-followup':sendFollowup(f);break;
    case 'consult-answer':saveConsultAnswer(f);break;
    case 'provider-code':finishProvider(f);break;
    case 'backup-export':exportArchive(f);break;
    case 'backup-import':importArchive(f);break;
    case 'question-form':saveBriefQuestion(f);break;
    case 'link-document':{
      const id=f.dataset.id,other=f.elements.related.value,file=allFiles().find(x=>x.id===id);
      if(!file||other&&!allFiles().some(x=>x.id===other&&x.visit===file.visit&&x.category!==file.category))return;
      const links=current().docLinks;
      for(let i=links.length-1;i>=0;i--)if(links[i].id===id||links[i].other===id)links.splice(i,1);
      if(other)links.push({id,other});
      if(saveState())goBack();break;
    }
  }
}
function measureLinks(){
  const groups=new Map(current().measurements.map(m=>[indicatorKey(m.name,m.unit),m]));
  return '<div class="home-measures"><div class="section-head"><h2>Домашние измерения</h2>'+(!readOnly?act('measure','Добавить измерение','','text-button','plus'):'')+'</div>'+
    ([...groups].map(([key,m])=>act('measureChart',m.name+' · '+m.unit,key,'chip-link','trend')).join('')||'<p class="hint">Вес, температура и другие показатели можно записывать между визитами.</p>')+'</div>';
}
