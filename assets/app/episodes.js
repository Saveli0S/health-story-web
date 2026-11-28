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
    }
    changes.push({id:uid(),kind,visit:visit[0],episode:visit[7],date:visit[1],doctor:visit[3],source,medId,before,replacement});
  }
  return changes;
}
function therapyFieldRules(form,add){
  for(const row of form.querySelectorAll('.therapy-decision')){
    const control=name=>row.querySelector('[name="'+name+'"]');
    const kind=control('decision').value;
    if(kind!=='replace'&&kind!=='dose')continue;
    if(kind==='replace'&&!control('changeName').value.trim())add(control('changeName'),'Укажите название препарата.');
    const strength=control('changeStrength').value.trim();
    if(!strength||needsClarification(strength))add(control('changeStrength'),'Уточните дозировку.');
    if(!control('changeInstructions').value.trim())add(control('changeInstructions'),'Укажите схему приёма.');
  }
}
registerFieldRules('visit-form',therapyFieldRules);
registerFieldRules('therapy-form',therapyFieldRules);
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
  for(const m of current().measurements.filter(m=>m.episode===id))events.push({date:m.time.slice(0,10),order:3,html:resultRow('measureChart',measurementKey(m),m.name,m.value+' '+m.unit,'trend')});
  return events.sort((a,b)=>a.date.localeCompare(b.date)||a.order-b.order).map(e=>'<div class="timeline-entry"><small>'+dateLabel(e.date,{day:'numeric',month:'long',year:'numeric'})+'</small>'+e.html+'</div>').join('')||'<p class="hint">Эпизод пока пуст.</p>';
}
function episodeCard(id){
  const e=current().episodes.find(e=>e.id===id||e.id===visitById(id)?.[7]);if(!e)return;
  openPanel('Эпизод болезни',e.name,'<div class="actions left">'+act('brief','Сводка к приёму',e.id,'button primary','book')+
    (!readOnly?act('newVisit','Добавить визит в эпизод',e.id,'button secondary','plus')+act('editEpisode','Редактировать эпизод',e.id,'text-button','edit')+act('consult','Обсудить с ИИ','episode:'+e.id,'text-button','spark'):'')+
    (prototypeState.sync?act('pinEpisode','Сохранить эпизод без сети',e.id,'button secondary','clip'):'')+'</div><section class="panel-section"><h3>Хронология эпизода</h3>'+episodeTimeline(e.id)+'</section>'+deletionButton('episodes',e.id,'Удалить эпизод'));
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
const measurementPresets=[
  ['Температура','°C',['температура тела'],['°с','c','с','градусы цельсия']],
  ['Вес','кг',['масса тела'],['kg']],
  ['Рост','см',[],['cm']],
  ['Пульс','уд/мин',['частота пульса','чсс'],['уд./мин','уд в мин','bpm']],
  ['Систолическое давление','мм рт. ст.',['верхнее давление'],['мм рт ст','mmhg']],
  ['Диастолическое давление','мм рт. ст.',['нижнее давление'],['мм рт ст','mmhg']]
];
function measurementPreset(name){
  const key=norm(name).replace(/\s+/g,' ');
  return measurementPresets.find(([title,,aliases])=>norm(title)===key||aliases.includes(key));
}
function measurementUnit(m){
  const preset=measurementPreset(m.name);
  const unit=norm(m.unit).replace(/\s*\/\s*/g,'/').replace(/\s+/g,' ');
  return preset&&(unit===norm(preset[1])||preset[3].includes(unit))?preset[1]:m.unit;
}
function measurementKey(m){return indicatorKey(measurementPreset(m.name)?.[0]||m.name,measurementUnit(m))}
function measureForm(id='',repeat=false){
  const previous=current().measurements.find(m=>m.id===id);
  if(id&&!previous)return;
  const local=new Date(),time=new Date(local-local.getTimezoneOffset()*60000).toISOString().slice(0,16);
  const edit=previous&&!repeat;
  openPanel(person.name,edit?'Редактировать измерение':'Домашнее измерение',`<form id="measure-form" class="edit-form" data-id="${edit?esc(id):''}">
    <label>Готовые показатели<select name="preset"><option value="">Другое</option>${measurementPresets.map(([name,unit])=>'<option value="'+esc(name)+'" '+(measurementPreset(previous?.name||'')?.[0]===name?'selected':'')+'>'+esc(name+' · '+unit)+'</option>').join('')}</select></label>
    <label>Показатель<input name="marker" required value="${esc(previous?.name)}" placeholder="Например, температура"></label>
    <div class="intake-pair"><label>Значение<input name="reading" inputmode="decimal" value="${edit?esc(previous.value):''}" required></label><label>Единица<input name="unit" required value="${esc(previous&&measurementUnit(previous))}" placeholder="Например, °C"></label></div>
    <label>Дата и время<input name="time" type="datetime-local" required max="${time}" value="${edit?esc(previous.time):time}"></label><label>Эпизод<select name="episode"><option value="">Без привязки</option>${current().episodes.map(e=>'<option value="'+esc(e.id)+'" '+(e.id===previous?.episode?'selected':'')+'>'+esc(e.name)+'</option>').join('')}</select></label>
    <p role="alert" class="error"></p><button class="button primary">Сохранить измерение</button></form>`);
  const form=document.querySelector('#measure-form'),{marker,preset,unit}=form.elements;
  form.measureBase=edit?previous:null;
  preset.onchange=()=>{
    marker.value=preset.value;
    unit.value=measurementPreset(marker.value)?.[1]||'';
    (preset.value?form.elements.reading:marker).focus();
  };
  marker.oninput=()=>{
    const selected=measurementPreset(marker.value),old=measurementPreset(preset.value);
    if(!unit.value||unit.value===old?.[1])unit.value=selected?.[1]||'';
    preset.value=selected?.[0]||'';
  };
}
registerFieldRules('measure-form',(form,add)=>{
  if(!/^[-+]?\d+(?:[.,]\d+)?$/.test(form.elements.reading.value.trim()))add('reading','Введите числовое значение.');
});
function saveMeasure(f){
  const d=new FormData(f),get=k=>d.get(k).trim(),id=f.dataset.id,profile=current(),before=profile.measurements;
  const m={...f.measureBase,id:id||uid(),name:get('marker'),value:get('reading'),unit:get('unit'),time:get('time'),episode:get('episode')};
  m.unit=measurementUnit(m);
  if(id&&JSON.stringify(latestProfile().measurements.find(row=>row.id===id))!==JSON.stringify(f.measureBase)){
    f.querySelector('.error').textContent='Измерение изменилось. Откройте его снова.';return;
  }
  profile.measurements=id?before.map(row=>row.id===id?m:row):[...before,m];
  if(!saveState()){profile.measurements=before;f.querySelector('.error').textContent='Не удалось сохранить измерение.';return}
  render();replaceRoute('measureChart',measurementKey(m));
}
function measureChart(key){
  const rows=current().measurements.filter(m=>measurementKey(m)===key).sort((a,b)=>a.time.localeCompare(b.time));if(!rows.length)return;
  const recent=rows.at(-1),unit=measurementUnit(recent);
  openPanel('Домашние измерения',measurementPreset(recent.name)?.[0]||recent.name,'<p class="detail-meta">'+esc(unit)+'</p>'+pointChart(rows.map(m=>({date:m.time,value:m.value,unit,source:m.id})),'measurePoint')+
    rows.map(m=>resultRow('measurePoint',m.id,m.value+' '+unit,stamp(m.time),'trend')).join('')+(readOnly?'':act('repeatMeasure','Измерить ещё раз',recent.id,'button secondary','plus')));
}
function measurePoint(id){
  const m=current().measurements.find(m=>m.id===id);
  if(m)openPanel(m.name,m.value+' '+measurementUnit(m),'<p>'+esc(stamp(m.time))+'</p>'+
    (m.episode?act('episode','К эпизоду',m.episode,'button secondary'):'')+
    (readOnly?'':act('measure','Изменить измерение',id,'button secondary','edit'))+deletionButton('measurements',id,'Удалить измерение'));
}

function recommendationsSection(id){
  const sources=recommendationSources(current(),id);
  const checklist=recommendationChecklist(sources).map(group=>
    `<fieldset class="recommendation-group"><legend>${esc(group.title)}</legend>${group.items.map(item=>
      `<label class="recommendation-item"><input type="checkbox" data-recommendation-check="${esc(JSON.stringify([id,item.collection,item.source,item.id]))}"${item.done?' checked':''}${readOnly?' disabled':''}><span>${esc(item.text)}</span></label>`
    ).join('')}</fieldset>`).join('');
  return (checklist||
    '<p class="hint">Сюда можно записать указания врача или приложить отдельный лист.</p>')+
    sources.map(source=>`<div class="recommendation-source"><details><summary>${source.file?'Текст из бланка':'Исходный текст'}</summary><p class="preserve-lines">${esc(source.text)}</p></details>${source.file?act('file','Оригинал',source.file,'chip-link','clip'):''}</div>`).join('')+
    (readOnly?'':'<div class="actions left">'+act('recommendVisit','Записать вручную',id,'text-button','edit')+
      act('upload','Загрузить рекомендации','rec:'+id,'text-button','clip')+'</div>');
}
function saveRecommendationCheck(input){
  const [visit,collection,id,key]=JSON.parse(input.dataset.recommendationCheck);
  if(!['recommendations','files'].includes(collection))return;
  const source=recommendationSources(latestProfile(),visit).find(row=>row.collection===collection&&row.id===id);
  const row=current()[collection].find(entry=>entry.id===id&&entry.visit===visit);
  const before=row?.recommendationChecks;
  if(!row||!source||!recommendationTasks(source.text).some(item=>item.id===key)){
    input.checked=before?.[key]===true;
    announce('Рекомендация изменилась. Откройте актуальную карточку.');return;
  }
  row.recommendationChecks={...before};
  if(input.checked)row.recommendationChecks[key]=true;
  else delete row.recommendationChecks[key];
  if(!saveState()){
    if(before)row.recommendationChecks=before;else delete row.recommendationChecks;
    input.checked=before?.[key]===true;
    announce('Не удалось сохранить отметку.');
  }
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
  current().recommendations=[...before.filter(r=>r!==old),{...old,id:old?.id||uid(),visit,text}];
  if(!saveState()){current().recommendations=before;form.querySelector('.error').textContent='Не удалось сохранить изменения.';return}
  goBack();
}
