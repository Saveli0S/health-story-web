'use strict';

const defaultTreatment='Разбери исходное назначение врача по предоставленным сведениям. Для каждого препарата укажи цель, краткое обоснование и ссылку на источник, применимый к заболеванию и возрасту. Категории: необходимое, рекомендуемое, малоэффективное, общее укрепление организма. Если сведений или источника не хватает, укажи «Недостаточно данных для оценки» и что нужно уточнить. Сохрани назначение врача. Верни JSON вида {"препараты":[{"название":"…","категория":"…","обоснование":"…","источник":"https://…"}]}.';
const builtinPrompts=[
  {id:'treatment',name:'Разбор лечения',text:defaultTreatment,scope:'family',version:1},
  {id:'risk-factors',name:'Оценка факторов риска',scope:'family',version:1,text:'Разбери, какие данные из выбранных записей относятся к риску указанного заболевания. Уточни заболевание и период прогноза, если они не названы. Отдели установленные факторы от неизвестных. Численную вероятность приводи только по валидированной для такого пациента шкале при наличии всех её входных данных. Укажи шкалу, источник и ограничения. В остальных случаях объясни, каких данных недостаёт, и предложи вопросы для врача.'},
  {id:'doctor-questions',name:'Подготовка к приёму',text:'По выбранным записям составь краткую историю и вопросы к следующему приёму. Отметь, каких сведений не хватает.',scope:'family',version:1}
];
function actorTemplates(){return prototypeState.profiles[viewerPerson.id].templates}
function promptLibrary(){
  const items=new Map(builtinPrompts.map(t=>[t.id,t]));
  for(const t of prototypeState.templates)items.set(t.id,t);
  if(!readOnly)for(const t of actorTemplates())items.set(t.id,t);
  return [...items.values()].filter(t=>!t.deleted);
}
function promptManager(){
  openPanel('Настройки','Промпты',promptLibrary().map(t=>resultRow('template',t.id,t.name,(t.scope==='family'?'Семейный':'Личный')+' · версия '+t.version,'book')).join('')+
    (readOnly?'':act('template','Создать промпт','','button primary','plus')));
}
function templateForm(id){
  const copy=id.startsWith('copy:'),t=promptLibrary().find(t=>t.id===(copy?id.slice(5):id));
  const editable=!readOnly&&(!t||copy||t.scope==='personal'||viewer==='admin');
  const builtin=!copy&&builtinPrompts.some(b=>b.id===id);
  openPanel('Библиотека промптов',copy?'Копия промпта':t?t.name:'Новый промпт',`<form class="edit-form" id="template-form" data-id="${esc(!copy&&t?t.id:'')}">
    <label>Название<input required maxlength="120" name="title" value="${esc((t?.name||'')+(copy?' · копия':''))}" ${editable?'':'readonly'}></label>
    <label>Инструкция<textarea name="body" rows="6" required ${editable?'':'readonly'}>${esc(t?.text||'')}</textarea></label>
    <label>Доступ<select name="scope" ${t&&!copy||viewer!=='admin'?'disabled':''}><option value="personal">Личный</option><option value="family" ${t?.scope==='family'&&!copy?'selected':''}>Семейный</option></select></label>
    <div class="actions left">${editable?'<button class="button primary">Сохранить промпт</button>':''}${t&&!copy&&!readOnly?act('template','Создать личную копию','copy:'+id,'button secondary'):''}</div>
    ${editable&&t&&!copy?(builtin?act('resetTemplate','Восстановить исходный текст',id,'text-button'):act('deleteTemplate','Удалить промпт',id,'text-button')):''}</form>`);
}
function saveTemplate(f){
  const old=promptLibrary().find(t=>t.id===f.dataset.id),scope=old?.scope||(viewer==='admin'?f.elements.scope.value:'personal');
  if(readOnly||(scope==='family'&&viewer!=='admin'))return;
  const t={id:old?.id||uid(),scope,name:f.elements.title.value.trim(),text:f.elements.body.value.trim(),version:(old?.version||0)+1};
  if(!t.name||!t.text)return;
  const list=scope==='family'?prototypeState.templates:actorTemplates(),idx=list.findIndex(x=>x.id===t.id);
  if(idx>=0)list[idx]=t;else list.push(t);
  if(saveState())replaceRoute('prompts','');
}
function changeTemplate(id,reset,confirm){
  const old=promptLibrary().find(t=>t.id===id);if(!old||readOnly||(old.scope==='family'&&viewer!=='admin'))return;
  if(!confirm){openPanel('Библиотека промптов',reset?'Восстановить исходный текст?':'Удалить промпт?','<p>Сохранённые консультации останутся в истории.</p><div class="actions">'+act('back','Отмена','','button secondary')+act(reset?'applyReset':'applyDelete',reset?'Восстановить':'Удалить',id,'button primary')+'</div>');return}
  const list=old.scope==='family'?prototypeState.templates:actorTemplates(),idx=list.findIndex(t=>t.id===id);
  if(reset){const t=builtinPrompts.find(t=>t.id===id);if(!t)return;const restored={...t,version:old.version+1};if(idx>=0)list[idx]=restored;else list.push(restored)}
  else if(idx>=0&&!builtinPrompts.some(t=>t.id===id))list.splice(idx,1);
  if(saveState()){routes=routes.filter(r=>!['template','resetTemplate','deleteTemplate'].includes(r.name));go('prompts')}
}
function consultPage(){
  const rows=current().consultations.slice().reverse();
  return '<section class="section-page"><div class="section-head"><h2>ИИ-консультация</h2>'+(!readOnly?act('consult','Новая консультация','','button primary','plus'):'')+'</div>'+
    (!readOnly?'<p class="listing-hint">'+providerStatus()+' · '+act('providers',routerKey?'Управлять подключением':'Подключить ИИ','','inline-action')+'</p>':'')+
    (person.id==='anna'&&!readOnly?act('consult','Пример оценки риска','risk-demo','button secondary','spark'):'')+'<h3>История профиля</h3>'+(rows.map(r=>resultRow('consultRecord',r.id,r.question,stamp(r.time)+' · '+(r.answer?'Ответ сохранён':'Запрос подготовлен'),'spark')).join('')||'<p class="empty">Здесь появятся запросы и ответы для '+esc(person.name)+'.</p>')+'</section>';
}
function newConsult(initial){
  if(readOnly)return;
  const demo=initial==='risk-demo'&&person.id==='anna';
  const prior=initial.startsWith('again:')?current().consultations.find(r=>r.id===initial.slice(6)):null;
  const indicators=indicatorGroups(),seed=new Set();
  for(const source of prior?(prior.sources||[]):initial&&!demo?[initial]:[]){
    if(!source.startsWith('indicator:')){seed.add(source);continue}
    const id=source.slice(10),exact=indicators.find(g=>g.key===id);
    const priorMatches=indicators.filter(g=>g.points.some(p=>indicatorKey(p.raw.name,p.raw.unit)===id||norm(p.raw.name)+'|'+norm(p.raw.unit)===id));
    const match=exact||(priorMatches.length===1?priorMatches[0]:null);
    if(match)seed.add('indicator:'+match.key);
  }
  const templates=promptLibrary();
  if(prior?.template.id&&!templates.some(t=>t.id===prior.template.id))templates.push(prior.template);
  const picker=consultSourcePicker(consultSourceGroups(),seed);
  openPanel(person.name,'Новая ИИ-консультация',`<form id="consult-form" class="edit-form"><label>Промпт<select name="template"><option value="">Свой запрос</option>${templates.map(t=>'<option value="'+esc(t.id)+'" '+((demo?'risk-factors':prior?.template.id)===t.id?'selected':'')+'>'+esc(t.name)+'</option>').join('')}</select></label>
    <details id="template-details"><summary>Инструкция для ИИ</summary><p id="template-preview" class="hint"></p></details><label>Что нужно разобрать?<textarea name="question" maxlength="15000" placeholder="Например, что изменилось между двумя анализами?">${esc(demo?'Оцени риск диабета 2-го типа за ближайшие 10 лет. Каких данных не хватает?':prior?.question||'')}</textarea></label>
    ${demo?'<p class="fact-note">Выберите тег «Терапевт» и визит «Плановый осмотр» от 30 октября. Затем смените тег на «Анализ крови» и добавьте «Биохимия крови» от 28 октября.</p>':''}${picker}
    <button class="button primary">Проверить запрос</button></form>`);
  const form=document.querySelector('#consult-form');form.templateOptions=templates;updateConsultTemplate(form);filterConsultSources(form);
  form.querySelector('#selected-sources').onclick=e=>{
    const remove=e.target.closest('[data-unselect]');if(!remove)return;
    const input=[...form.querySelectorAll('[name=source]')].find(el=>el.value===remove.dataset.unselect);
    if(input){input.checked=false;filterConsultSources(form)}
  };
}
function updateConsultTemplate(f){
  const t=f.templateOptions.find(t=>t.id===f.elements.template.value);
  const risk=t?.id==='risk-factors';
  f.elements.question.required=!t||risk;
  f.elements.question.placeholder=risk?'Укажите заболевание и период, например риск диабета 2-го типа за ближайшие 10 лет.':'Например, что изменилось между двумя анализами?';
  f.querySelector('#template-details').hidden=!t;
  f.querySelector('#template-preview').textContent=t?t.text:'';
}
function consultContext(selected){
  const visitIds=new Set(),labIds=new Set(),documentIds=new Set(),data={},refs=[];
  const addRef=(kind,id,label)=>{if(!refs.some(r=>r.kind===kind&&r.id===id))refs.push({kind,id,label})};
  for(const key of selected){
    const cut=key.indexOf(':'),type=cut<0?key:key.slice(0,cut),id=key.slice(cut+1);
    if(type==='profile'){
      data.профиль={возраст:ageText(yearsAt(todayLocal())),рост:field('height'),вес:field('weight'),датаИзмерений:field('measured'),
        аллергии:field('allergy'),хронические:field('chronic'),
        текущиеПрепараты:allCourses().flatMap(c=>c.meds.filter(isActiveMed).map(m=>[m.name,m.strength,m.instructions].filter(Boolean).join(' · ')))};
      addRef('medical','', 'Медкарта');
    }
    if(type==='episode'){
      const ep=current().episodes.find(e=>e.id===id);if(!ep)continue;
      addRef('episode',id,ep.name);
      (data.эпизоды??=[]).push({название:ep.name,измерения:current().measurements.filter(m=>m.episode===id).sort((a,b)=>a.time.localeCompare(b.time)).map(m=>[m.time,m.name,m.value,m.unit].join(' ')),
        вопросы:current().questions.filter(q=>q.episode===id).map(q=>q.text)});
      for(const v of episodeVisits(id)){
        visitIds.add(v[0]);
        for(const l of labs().filter(f=>f.visit===v[0]))labIds.add(l.id);
        for(const f of current().files.filter(f=>f.visit===v[0]&&f.category==='Заключения'&&f.clinicalText))documentIds.add(f.id);
      }
    }
    if(type==='prevent'){
      const p=current().prevention.find(row=>row.id===id);if(!p)continue;
      (data.профилактика??=[]).push({вид:preventionKinds[p.kind],название:p.title,следующаяДата:p.next,периодичность:p.period,примечание:p.note,
        выполнения:p.history.map(h=>({дата:h.date,заметка:h.note}))});
      addRef('prevent',p.id,p.title);
    }
    if(type==='document')documentIds.add(id);
    if(type==='visit'&&visitById(id))visitIds.add(id);
    if(type==='lab'&&labs().some(l=>l.id===id))labIds.add(id);
  }
  for(const id of [...visitIds].sort((a,b)=>visitById(a)[1].localeCompare(visitById(b)[1]))){
    const v=visitById(id);addRef('visit',id,v[2]);
    (data.визиты??=[]).push({дата:v[1],эпизод:v[4],специальность:person.doctors[v[3]][1],запись:v[5],
      назначения:(courseAt(id)?.meds||[]).map(m=>[m.name,m.strength,m.form,m.instructions].filter(Boolean).join(' · ')),
      рекомендацииВрача:confirmedRecommendations(id).map(r=>r.text),сведенияИзНазначений:intakeFiles(id).filter(f=>f.checked&&f.context).map(f=>f.context),решения:current().changes.filter(c=>c.visit===id).map(decisionText),
      пометки:current().notes.filter(n=>n.visit===id).map(n=>n.text)});
  }
  for(const id of documentIds){
    const f=current().files.find(f=>f.id===id&&f.category==='Заключения'&&f.clinicalText);
    if(f){(data.заключения??=[]).push({датаЗаписи:f.date,текст:f.clinicalText});addRef('file',id,f.name)}
  }
  const indicators=new Set(selected.filter(key=>key.startsWith('indicator:')).map(key=>key.slice(10)));
  for(const lab of labs()){
    const info=reportInfo(lab);
    const results=[];
    for(const row of info.rows){
      const point=labSeriesPoint(row,info.name,lab.id);
      const selectedTrend=indicators.has(point.key);
      if(!labIds.has(lab.id)&&!selectedTrend)continue;
      const result={показатель:row.name,результат:row.value,единица:row.unit,диапазон:row.range,биоматериал:point.specimen||'Не указан'};
      if(selectedTrend)result.дляСравнения={показатель:point.name,результат:point.value,единица:point.unit};
      results.push(result);
    }
    if(!results.length)continue;
    (data.анализы??=[]).push({дата:info.date,исследование:info.name,результаты:results});
    addRef('lab',lab.id,info.name+' · '+dateLabel(info.date));
  }
  data.анализы?.sort((a,b)=>a.дата.localeCompare(b.дата));
  return {data:JSON.parse(JSON.stringify(data,(_,v)=>typeof v==='string'?cleanClinicalText(v):v)),refs};
}
function prepareConsult(f){
  const chosen=f.templateOptions.find(t=>t.id===f.elements.template.value);
  const custom=cleanClinicalText(f.elements.question.value.trim()),question=custom||chosen?.name;if(!question)return;
  const template=chosen?{id:chosen.id,name:chosen.name,text:chosen.text,version:chosen.version}:{id:'',name:'Свой запрос',text:'',version:1};
  const sources=new FormData(f).getAll('source'),{data,refs}=consultContext(sources);
  const prompt=[cleanClinicalText(template.text),custom,Object.keys(data).length?JSON.stringify(data,null,2):''].filter(Boolean).join('\n\n');
  const row={id:uid(),time:new Date().toISOString(),question,template,refs,sources,prompt,answer:'',provider:''};
  current().consultations.push(row);if(!saveState()){current().consultations.pop();return}
  render();replaceRoute('consultRecord',row.id);
}
function consultRecord(id){
  const r=current().consultations.find(r=>r.id===id);if(!r)return;
  const info='<p class="detail-meta">'+esc(stamp(r.time))+' · '+esc(r.template.name)+' · версия '+r.template.version+'</p><h3>'+esc(r.question)+'</h3>';
  const sent=r.sentAt?'<p class="hint">Передан '+esc(stamp(r.sentAt))+'</p>':'';
  const refs=sent+'<div class="consult-refs">'+r.refs.map(s=>act(s.kind,s.label,s.id,'chip-link','folder')).join('')+'</div>';
  if(r.answer||readOnly){
    openPanel(person.name,'История консультации',info+refs+(r.answer?'<section class="panel-section"><h3>Ответ · '+esc(r.provider)+'</h3><div class="manual-answer">'+esc(r.answer)+'</div></section>':'<p>Ответ пока не добавлен.</p>')+
      '<details><summary>Запрос и версия промпта</summary><pre>'+esc(r.prompt)+'</pre><p>'+esc(r.template.text)+'</p></details>'+(readOnly?'':act('consult','Повторить с актуальными данными','again:'+id,'button secondary')));return;
  }
  openPanel(person.name,'Проверить и передать запрос',info+refs+`<form class="edit-form" id="consult-answer" data-id="${esc(id)}"><label>Точный текст для провайдера<textarea name="prompt" rows="7" required ${r.sentAt?'readonly':''}>${esc(r.sentAt?r.prompt:cleanClinicalText(r.prompt))}</textarea></label>
    <p class="hint">Проверьте свободный текст на личные сведения. Файлы и имена владельцев карточек в запрос не включаются автоматически.</p>
    <div class="actions left">${act('askProvider',routerKey?'Подтвердить и отправить в OpenRouter':'Подключить OpenRouter',id,'button primary','spark')}${act('consultCopy','Скопировать для ChatGPT',id,'button secondary')}${external('https://chatgpt.com/','Открыть ChatGPT')}</div>
    <p class="hint" role="status" id="provider-result">${esc(r.lastError||'')}</p>
    <label>Ответ из своего чата<textarea name="answer" rows="4">${esc(r.replyDraft||'')}</textarea></label>
    <button class="button secondary">Сохранить ответ</button></form>`);
}
function saveConsultAnswer(f,provider='ChatGPT · ручной перенос'){
  const r=current().consultations.find(r=>r.id===f.dataset.id);
  const answer=f.elements.answer.value.trim(),prompt=f.elements.prompt.value.trim();
  if(!r||r.answer||!answer||!prompt){f.querySelector('[role=status]').textContent='Заполните запрос и ответ.';return}
  if(!r.sentAt&&!reviewOutboundText(f.elements.prompt,f.querySelector('[role=status]')))return;
  const old={...r};Object.assign(r,{answer,prompt,provider,answeredAt:new Date().toISOString(),replyDraft:''});
  if(!saveState()){Object.assign(r,old);f.querySelector('[role=status]').textContent='Не удалось сохранить ответ.';return}
  render();consultRecord(r.id);
}
