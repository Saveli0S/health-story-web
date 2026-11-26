'use strict';

function episodeVisits(id){return person.visits.filter(v=>v[7]===id).slice().sort((a,b)=>a[1].localeCompare(b[1]))}
const therapyLabels={continue:'Продолжить',dose:'Изменить дозу',replace:'Заменить',stop:'Отменить'};
function previousMeds(episode,date,visit){
  return episodeVisits(episode).filter(v=>v[0]!==visit&&v[1]<=date).flatMap(v=>(courseAt(v[0])?.meds||[])
    .filter(m=>!m.continuedFrom&&!m.endedBy&&(!m.period.closed||m.period.end>date)&&!current().changes.some(c=>c.visit===visit&&c.source===v[0]&&c.medId===m.id))
    .map(m=>({m,source:v[0]})));
}
function previousMedicineFields(episode,date,visit=''){
  const available=previousMeds(episode,date,visit);
  if(!available.length)return '';
  return '<fieldset class="rx-inputs"><legend>Предыдущая схема эпизода</legend>'+available.map(({m,source})=>
    `<div class="therapy-decision" data-source="${esc(source)}" data-med-id="${esc(m.id)}"><strong>${esc(m.name)} · ${esc(m.strength)}</strong><p class="hint">${esc(m.instructions)}</p>
    <label>Решение врача<select name="decision"><option value="">Решение не указано</option>${Object.entries(therapyLabels).map(([k,v])=>'<option value="'+k+'">'+v+'</option>').join('')}</select></label>
    <div class="decision-fields" hidden><label>Название препарата<input name="changeName" value="${esc(m.name)}"></label><label>Дозировка<input name="changeStrength" value="${esc(m.strength)}"></label>
    <label>Форма<input name="changeForm" value="${esc(m.form)}"></label><label>Схема приёма<input name="changeInstructions" value="${esc(m.instructions)}"></label></div></div>`).join('')+'</fieldset>';
}
function refreshPreviousFields(f){
  const slot=f.querySelector('#previous-therapy');if(!slot)return;
  const key=f.elements.episode.value+'|'+f.elements.date.value;
  if(slot.dataset.key===key)return;
  slot.dataset.key=key;slot.innerHTML=previousMedicineFields(f.elements.episode.value,f.elements.date.value);
}
function readTherapyChanges(f,visit){
  const changes=[];
  for(const row of f.querySelectorAll('.therapy-decision')){
    const get=n=>row.querySelector('[name="'+n+'"]').value.trim(),kind=get('decision');if(!kind)continue;
    const {source,medId}=row.dataset;
    const old=previousMeds(visit[7],visit[1],visit[0]).find(x=>x.source===source&&x.m.id===medId)?.m;
    if(!old)throw Error('Предыдущая схема уже изменилась. Откройте визит повторно.');
    const before={name:old.name,strength:old.strength,form:old.form,instructions:old.instructions};
    let replacement=null;
    if(kind==='dose'||kind==='replace'){
      replacement={id:uid(),name:kind==='dose'?old.name:get('changeName'),strength:get('changeStrength'),form:get('changeForm'),instructions:get('changeInstructions'),period:emptyPeriod()};
      if(!replacement.name||!replacement.strength||!replacement.instructions||needsClarification(replacement.strength))throw Error('Укажите препарат, уточнённую дозировку и схему приёма.');
    }
    changes.push({id:uid(),kind,visit:visit[0],episode:visit[7],date:visit[1],doctor:visit[3],source,medId,before,replacement});
  }
  return changes;
}
function therapyEditor(id){
  const v=visitById(id);if(!v)return;
  openPanel(v[2],'Решения по предыдущей схеме','<form class="edit-form" id="therapy-form" data-id="'+esc(id)+'">'+
    (previousMedicineFields(v[7],v[1],id)||'<p>Доступных курсов из предыдущих визитов нет.</p>')+'<p role="alert" class="error"></p><button class="button primary">Сохранить решения</button></form>');
}
function saveTherapy(f){
  try{
    const changes=readTherapyChanges(f,visitById(f.dataset.id));current().changes.push(...changes);
    if(!saveState()){current().changes.splice(current().changes.length-changes.length,changes.length);throw Error('Не удалось сохранить решения.')}
    render();goBack();
  }catch(e){f.querySelector('.error').textContent=e.message}
}
function decisionText(c){
  const detail=m=>[m.name,m.strength,m.instructions].filter(Boolean).join(' · ');
  return therapyLabels[c.kind]+' · '+detail(c.before)+(c.replacement?' → '+detail(c.replacement):'');
}
function episodeReports(id){return labs().filter(f=>visitById(f.visit)?.[7]===id)}
function episodeTimeline(id){
  const events=episodeVisits(id).map(v=>({date:v[1],order:0,html:resultRow('visit',v[0],v[2],doctorLabel(v[3]),'scope')}));
  for(const c of current().changes.filter(c=>c.episode===id))events.push({date:c.date,order:1,html:resultRow('visit',c.visit,decisionText(c),doctorLabel(c.doctor),'pill')});
  for(const e of current().exams.filter(e=>visitById(e.visit)?.[7]===id))events.push({date:e.date,order:2,html:resultRow('exam',e.id,examTitle(e),e.conclusion,'book')});
  for(const f of episodeReports(id)){const l=reportInfo(f);events.push({date:l.date,order:2,html:resultRow('lab',f.id,l.name,l.laboratory,'lab')})}
  for(const m of current().measurements.filter(m=>m.episode===id))events.push({date:m.time.slice(0,10),order:3,html:resultRow('measureChart',indicatorKey(m.name,m.unit),m.name,m.value+' '+m.unit,'trend')});
  return events.sort((a,b)=>a.date.localeCompare(b.date)||a.order-b.order).map(e=>'<div class="timeline-entry"><small>'+dateLabel(e.date,{day:'numeric',month:'long',year:'numeric'})+'</small>'+e.html+'</div>').join('')||'<p class="hint">Эпизод пока пуст.</p>';
}
function episodeCard(id){
  const e=current().episodes.find(e=>e.id===id||e.id===visitById(id)?.[7]);if(!e)return;
  openPanel('Эпизод болезни',e.name,'<div class="actions left">'+act('brief','Сводка к приёму',e.id,'button primary','book')+
    (!readOnly?act('newVisit','Добавить визит в эпизод',e.id,'button secondary','plus')+act('consult','Обсудить с ИИ','episode:'+e.id,'text-button','spark'):'')+
    (prototypeState.sync?act('pinEpisode','Сохранить эпизод без сети',e.id,'button secondary','clip'):'')+'</div><section class="panel-section"><h3>Хронология эпизода</h3>'+episodeTimeline(e.id)+'</section>');
}
function visitBrief(id){
  const ep=current().episodes.find(e=>e.id===id);if(!ep)return;
  const visits=episodeVisits(id),changes=current().changes.filter(c=>c.episode===id).sort((a,b)=>a.date.localeCompare(b.date));
  const active=visits.flatMap(v=>(courseAt(v[0])?.meds||[]).filter(isActiveMed).map(m=>resultRow('visit',v[0],m.name+' · '+m.strength,m.instructions,'pill')));
  const reports=episodeReports(id).sort((a,b)=>reportInfo(b).date.localeCompare(reportInfo(a).date));
  const block=(heading,content)=>'<section class="panel-section"><h3>'+heading+'</h3>'+(content||'<p class="hint">Пока нет записей.</p>')+'</section>';
  openPanel(person.name,'Сводка к приёму','<p class="detail-meta">'+esc(ep.name)+'</p>'+
    block('Повод обращения',visits[0]?'<p>'+esc(visits[0][5]||visits[0][2])+'</p>':'')+
    block('Визиты',visits.map(v=>resultRow('visit',v[0],dateLabel(v[1])+' · '+v[2],doctorLabel(v[3]),'scope')).join(''))+
    block('Действующие назначения',active.join(''))+block('Что менялось',changes.map(c=>resultRow('visit',c.visit,decisionText(c),dateLabel(c.date)+' · '+doctorLabel(c.doctor),'pill')).join(''))+
    block('Последние анализы',reports.slice(0,3).map(f=>{const l=reportInfo(f);return resultRow('lab',f.id,l.name+' · '+dateLabel(l.date),l.rows.map(r=>r.name+' '+r.value+' '+r.unit).join(' · '),'lab')}).join(''))+
    block('Результаты обследований',examListing(current().exams.filter(e=>visitById(e.visit)?.[7]===id)))+
    block('Вопросы врачу',current().questions.filter(q=>q.episode===id).map(q=>'<div class="note"><p>'+esc(q.text)+'</p>'+(readOnly?'':act('editQuestion','Редактировать вопрос',q.id,'text-button','edit'))+'</div>').join(''))+
    (readOnly?'':'<form id="question-form" class="edit-form" data-id="'+esc(id)+'"><label>Новый вопрос<textarea required name="question" maxlength="800"></textarea></label><button class="button secondary">Добавить вопрос</button></form>'));
}
function editBriefQuestion(id){
  const form=document.querySelector('#question-form'),q=current().questions.find(q=>q.id===id&&q.episode===form?.dataset.id);
  if(!form||!q||readOnly)return;
  form.dataset.question=q.id;form.elements.question.value=q.text;
  form.querySelector('label').firstChild.textContent='Вопрос врачу';
  form.querySelector('button').textContent='Сохранить вопрос';form.elements.question.focus();
  if(!form.querySelector('[data-action=cancelQuestion]'))form.insertAdjacentHTML('beforeend',act('cancelQuestion','Отмена',q.episode,'text-button'));
}
function saveBriefQuestion(f){
  const text=f.elements.question.value.trim(),id=f.dataset.id;if(!text)return;
  const questions=current().questions,old=questions.find(q=>q.id===f.dataset.question&&q.episode===id);
  const previous=old?.text;
  if(old)old.text=text;
  else questions.push({id:uid(),episode:id,text});
  if(saveState())visitBrief(id);
  else if(old)old.text=previous;
  else questions.pop();
}
function measureForm(){
  const local=new Date(),time=new Date(local-local.getTimezoneOffset()*60000).toISOString().slice(0,16);
  openPanel(person.name,'Домашнее измерение',`<form id="measure-form" class="edit-form"><label>Показатель<input name="marker" required list="measure-names" placeholder="Например, температура"><datalist id="measure-names">${['Температура','Вес','Пульс','Систолическое давление','Диастолическое давление','Рост'].map(x=>'<option>'+x+'</option>').join('')}</datalist></label>
    <div class="intake-pair"><label>Значение<input name="reading" inputmode="decimal" required></label><label>Единица<input name="unit" required placeholder="Например, °C"></label></div>
    <label>Дата и время<input name="time" type="datetime-local" required max="${time}" value="${time}"></label><label>Эпизод<select name="episode"><option value="">Без привязки</option>${current().episodes.map(e=>'<option value="'+esc(e.id)+'">'+esc(e.name)+'</option>').join('')}</select></label>
    <p role="alert" class="error"></p><button class="button primary">Сохранить измерение</button></form>`);
}
function saveMeasure(f){
  const d=new FormData(f),get=k=>d.get(k).trim(),m={id:uid(),name:get('marker'),value:get('reading'),unit:get('unit'),time:get('time'),episode:get('episode')};
  if(!m.name||!m.unit||!/^[-+]?\d+(?:[.,]\d+)?$/.test(m.value)){f.querySelector('.error').textContent='Введите название, числовой результат и единицу.';return}
  current().measurements.push(m);
  if(!saveState()){current().measurements.pop();return}
  render();replaceRoute('measureChart',indicatorKey(m.name,m.unit));
}
function measureChart(key){
  const rows=current().measurements.filter(m=>indicatorKey(m.name,m.unit)===key).sort((a,b)=>a.time.localeCompare(b.time));if(!rows.length)return;
  openPanel('Домашние измерения',rows[0].name,pointChart(rows.map(m=>({date:m.time,value:m.value,unit:m.unit,source:m.id})),'measurePoint')+
    rows.map(m=>resultRow('measurePoint',m.id,m.value+' '+m.unit,stamp(m.time),'trend')).join('')+(readOnly?'':act('measure','Добавить измерение','','button secondary','plus')));
}
function measurePoint(id){const m=current().measurements.find(m=>m.id===id);if(m)openPanel(m.name,m.value+' '+m.unit,'<p>'+esc(stamp(m.time))+'</p>'+(m.episode?act('episode','К эпизоду',m.episode,'button secondary'):''))}

function recommendationsSection(id){
  const list=confirmedRecommendations(id);
  return (list.map(r=>'<div class="note"><p class="preserve-lines">'+esc(r.text)+'</p>'+
    (r.source?act('file','Оригинал',r.source,'chip-link','clip'):'')+'</div>').join('')||
    '<p class="hint">Сюда можно записать указания врача или приложить отдельный лист.</p>')+
    (readOnly?'':'<div class="actions left">'+act('recommendVisit','Записать вручную',id,'text-button','edit')+
      act('upload','Загрузить рекомендации','rec:'+id,'text-button','clip')+'</div>');
}
function recommendationEditor(id){
  if(readOnly||!visitById(id))return;
  const row=current().recommendations.find(r=>r.visit===id);
  openPanel(visitById(id)[2],'Рекомендации врача','<form id="rec-form" data-id="'+esc(id)+'" class="edit-form"><label>Указания врача<textarea name="text" required maxlength="3600">'+esc(row?.text)+'</textarea></label><p class="error" role="alert"></p><button class="button primary">Сохранить рекомендации</button></form>');
}
function saveVisitRecommendation(form){
  const visit=form.dataset.id,text=form.elements.text.value.trim();
  if(readOnly||!visitById(visit)||!text)return;
  const old=current().recommendations.find(r=>r.visit===visit),before=current().recommendations;
  current().recommendations=[...before.filter(r=>r!==old),{id:old?.id||uid(),visit,text}];
  if(!saveState()){current().recommendations=before;form.querySelector('.error').textContent='Не удалось сохранить изменения.';return}
  goBack();
}
