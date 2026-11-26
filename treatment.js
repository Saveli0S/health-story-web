'use strict';

function coursePeriod(p) {
  const end=p.closed ? (p.end?dateLabel(p.end):'дата неизвестна') : (p.planned?dateLabel(p.planned):'окончание не указано');
  return (p.start?dateLabel(p.start):'начало не указано')+' — '+end+(p.closed?' · завершён':' · по плану');
}
function drugBlock(m,i,detail=false,visit) {
  const key=m.continuedFrom&&Object.hasOwn(m,'sourceKey')?m.sourceKey:medKey(visit,i), review=current().reviews.filter(r=>r.visit===visit).at(-1);
  const status=m.endedBy?({dose:'Дозировка изменена',replace:'Препарат заменён',stop:'Препарат отменён'}[m.endedBy.kind]||'Схема изменена'):'';
  const item=review?.items?.[i], snapshot=review?.payload?.назначения?.[i];
  const matches=snapshot?.название===m.name && snapshot?.дозировка===m.strength && snapshot?.схема===m.instructions;
  return `<div class="medication">
    <div class="drug">${icon(m.fixture?(i?'drop':'spray'):'pill')}<div><strong>${esc(m.name)} · ${esc(m.strength)}</strong><small>${esc([m.form,m.pack].filter(Boolean).join(' · '))}</small></div></div>
    <p class="regimen">${esc(m.instructions)}</p>
    <div class="period-line">${icon('calendar',true)}<span>${coursePeriod(m.period)}${m.endedBy?' · '+status+' '+dateLabel(m.endedBy.date)+' · '+esc(doctorLabel(m.endedBy.doctor)):''}</span>
    ${readOnly||key===null?'':act('period','Изменить даты',key,'inline-action')}</div>
    ${detail?`<div class="med-links"><span class="rating">${esc((matches?(item?.label||(review?.kind==='provider'?'См. ответ провайдера':review?.kind==='manual'?'См. ответ из ChatGPT':'')):'')||'Ожидает разбора')}</span>${key===null?external(pharmacySearch([m.name,m.strength,m.form].filter(Boolean).join(' ')),'Искать на tabletka.by'):act('analogs','Найти аналоги',key,'inline-action')}</div>`:''}
  </div>`;
}
function courseCard() {
  if(!activeCourse()) return `<div class="empty"><strong>Сейчас нет активных курсов</strong>${person.course?'<p>Завершённое лечение сохранено в визите.</p>'+act('visit','Посмотреть запись',person.course.visit,'text-button'):'<p>Здесь появятся курсы, назначенные врачом.</p>'}</div>`;
  return allCourses().filter(c=>c.meds.some(isActiveMed)).map(c=>{const v=visitById(c.visit);
  return `<article class="course-card"><div class="course-top"><span class="status">Курс идёт</span>${act('visit','К визиту '+dateLabel(v[1]),v[0],'inline-action')}</div>
    <h3>${esc(v[4])}</h3><p class="course-source">${esc(doctorLabel(v[3]))}</p>
    <div class="drug-list">${c.meds.map((m,i)=>!isActiveMed(m)?'':drugBlock(m,i,false,c.visit)).join('')}</div>
    ${readOnly?'':act('finish','Завершить лечение',c.visit,'button finish-button', 'check')}</article>`;}).join('');
}
function showPeriod(id) {
  const {med:m}=medFromKey(id);if(!m)return;const p=m.period;
  openPanel('Период приёма',m.name,`<p class="dialog-sub">${esc(m.strength)} · ${esc(m.instructions)}</p>
    <form id="period-form" data-id="${esc(id)}" class="edit-form">
    <label>Фактическое начало<input name="start" type="date" max="${todayLocal()}" value="${esc(p.start)}"></label>
    <label>Плановое окончание<input name="planned" type="date" value="${esc(p.planned)}"></label>
    <label>Статус курса<select name="closed"><option value="no">Продолжается</option><option value="yes" ${p.closed?'selected':''}>Завершён</option></select></label>
    <div id="actual-end" ${!p.closed?'hidden':''}><label>Фактическое окончание<input type="date" name="end" max="${todayLocal()}" value="${esc(p.end)}"></label><label class="unknown"><input type="checkbox" name="unknown" ${p.unknown?'checked':''}>Дата неизвестна</label></div>
    <label>Пометка при прерывании<textarea name="note" maxlength="300">${esc(p.note||'')}</textarea></label>
    <p class="error" role="alert"></p><button class="button primary">Сохранить даты</button></form>`);
  togglePeriodFields();
}
function togglePeriodFields(){
  const f=document.querySelector('#period-form');if(!f)return;
  const closed=f.elements.closed.value==='yes';
  f.querySelector('#actual-end').hidden=!closed;
  f.elements.end.disabled=!closed||f.elements.unknown.checked;
  f.elements.end.required=closed&&!f.elements.unknown.checked;
  f.elements.end.min=f.elements.start.value;
  f.elements.planned.min=f.elements.start.value;
}
function savePeriod(f) {
  const d=new FormData(f), closed=d.get('closed')==='yes', start=d.get('start'), planned=d.get('planned');
  const end=closed?d.get('end')||'':'', unknown=closed && d.has('unknown');
  if((planned && planned<start) || (end && end<start)) {f.querySelector('.error').textContent='Окончание должно быть в день начала курса или позже.';return}
  Object.assign(medFromKey(f.dataset.id).med.period,{start,planned,end,closed,unknown,note:d.get('note').trim()});
  saveState();render();goBack();
}
function showFinish(id) {
  const c=courseAt(id);if(!c)return;
  openPanel(visitById(c.visit)[4],'Завершить лечение',`<form id="finish-form" data-id="${esc(id)}" class="edit-form">
    <p class="dialog-sub">Общая дата применяется к открытым курсам. У каждого препарата можно указать свою дату.</p>
    <label>Общая дата окончания<input required type="date" name="common" id="common-end" max="${todayLocal()}" value="${todayLocal()}"></label>
    <details class="med-overrides"><summary>Уточнить по препаратам</summary>
    ${c.meds.map((m,i)=>m.period.closed||m.endedBy?`<p>${esc(m.name)} · уже завершён</p>`:`<div class="finish-med"><label>${esc(m.name)}<input type="date" name="d${i}" min="${m.period.start}" max="${todayLocal()}"></label><label class="unknown"><input type="checkbox" name="u${i}" data-unknown="${i}">Дата неизвестна</label></div>`).join('')}</details>
    <p class="error" role="alert"></p><button class="button primary">Завершить лечение</button></form>`);
}
function saveFinish(f) {
  const d=new FormData(f);
  const meds=courseAt(f.dataset.id).meds;
  const periods=meds.map(({period:p},i)=>{
    if(p.closed||meds[i].endedBy)return p;
    const unknown=d.has('u'+i), end=unknown?'':(d.get('d'+i)||d.get('common'));
    return {...p,closed:true,unknown,end};
  });
  if(periods.some(p=>p.end && p.end<p.start)){f.querySelector('.error').textContent='Дата окончания раньше начала одного из курсов.';return}
  meds.forEach((m,i)=>Object.assign(m.period,periods[i]));saveState();render();panel.close();announce('Лечение завершено и сохранено в истории визита.');
}
function makePayload(id) {
  const v=visitById(id), c=courseAt(id), age=yearsAt(v[1]), measured=field('measured');
  const patient={'Возраст на дату визита':age===null?'Не указан':ageText(age)};
  if(measured && measured<=v[1]) for(const [key,label] of [['height','Рост'],['weight','Вес']]) if(field(key))patient[label]=field(key);
  for(const [key,label] of [['allergy','Аллергии'],['chronic','Хронические заболевания']]) if(field(key))patient[label]=field(key);
  const decisions=current().changes.filter(c=>c.visit===id);
  const otherMeds=allCourses().filter(other=>other.visit!==id && visitById(other.visit)[1]<=v[1]).flatMap(other=>
    other.meds.filter(m=>!m.continuedFrom && !decisions.some(c=>c.source===other.visit&&c.medId===m.id) && (!m.endedBy||m.endedBy.date>v[1]) && m.period.start && m.period.start<=v[1] &&
      (!m.period.closed || (m.period.end && m.period.end>=v[1]))).map(m=>({название:m.name,дозировка:m.strength,схема:m.instructions})));
  if(otherMeds.length)patient['Другие курсы на дату визита']=otherMeds;
  const data={пациент:patient,эпизод:v[4],запись:v[5],назначения:prescribedForReview(id).map(m=>({название:m.name,дозировка:m.strength,форма:m.form,схема:m.instructions})),
    измененияСхемы:current().changes.filter(c=>c.visit===id).map(c=>({решение:c.kind,ранее:c.before,назначено:c.replacement?[c.replacement.name,c.replacement.strength,c.replacement.instructions]:null})),
    сведенияИзДокументов:visitConclusions(id),рекомендацииВрача:confirmedRecommendations(id).map(r=>r.text),
    вариантыВрача:c?.meds.some(m=>m.fixture)?['Флутиказон · отдельно указан в демонстрационном листе назначений']:[],
    анализы:labs().filter(l=>l.visit===id).flatMap(l=>{
      const report=reportInfo(l);
      return report.rows.map(r=>({датаОбразца:report.date,исследование:reportTitleForAI(report,l),
        показатель:r.name,результат:r.value,единица:r.unit,материал:r.specimen||'Не указан',диапазон:r.range||'Не указан'}));
    })};
  const history=person.visits.filter(other=>other[7]===v[7]&&other[0]!==id&&other[1]<v[1]);
  if(history.length)data.предыдущиеВизитыЭпизода=history.slice().reverse().map(other=>({
    днейДоВизита:(Date.parse(v[1])-Date.parse(other[1]))/86400000,запись:other[5],
    назначения:(courseAt(other[0])?.meds||[]).map(m=>[m.name,m.strength,m.instructions].filter(Boolean).join(' · '))
  }));
  return JSON.parse(JSON.stringify(data,(_,v)=>typeof v==='string'?cleanClinicalText(v):v));
}
function createReview(id) {
  const payload=makePayload(id), age=yearsAt(visitById(id)[1]);
  const adult=age!==null && age>=18 && payload.эпизод==='Аллергический ринит' && field('allergy')===person.allergy && field('chronic')===person.chronic;
  const items=[
    adult?{label:'Рекомендуемое',reason:'В вымышленном эпизоде симптомы мешают сну. Рекомендация для взрослых с аллергическим ринитом и влиянием симптомов на качество жизни относится к классу интраназальных стероидов.',source:guideline}
      :{label:'Недостаточно данных для оценки',reason:'Демопример рассчитан на исходный профиль взрослого. Обновлённые сведения требуют отдельной проверки применимости источника.'},
    {label:'Недостаточно данных для оценки',reason:'В примере отсутствует источник для оценки роли конкретной схемы орошения.'}
  ];
  return {id:uid(),visit:id,time:new Date().toISOString(),payload,items};
}
function startReview(id){
  if(!reviewReady(id)||readOnly)return;
  if(routerKey){
    go('directTreatment',id);if(current().directAuto)sendTreatment(document.querySelector('#direct-treatment'));return;
  }
  if(current().auto && !demoReviewAvailable(id)){go('manual',id);return}
  if(current().auto){completeReview(id);return}
  go('consent',id);
}
function demoReviewAvailable(id){return id===person.course?.visit&&!intakeFiles(id).length&&!current().changes.some(c=>c.visit===id)}
function showConsent(id) {
  if(routerKey){directTreatmentForm(id);return}
  const payload=makePayload(id);
  if(!demoReviewAvailable(id)){
    openPanel('Разбор лечения','Проверить данные',workflowSteps(3)+`<p class="dialog-sub">Один запрос по всему визиту. Проверьте сведения перед переносом в свой ChatGPT.</p>
      <div class="summary-sheet"><strong>${esc(payload.эпизод)}</strong><p>${esc(Object.values(payload.пациент).filter(v=>typeof v==='string').join(' · '))}</p>
      <p>${esc(payload.назначения.map(m=>m.название+' '+m.дозировка).join(', '))}</p></div>
      <p class="hint">Имена пациента и врача, исходный текст распознавания и файлы исключены. Проверьте свободный текст на личные данные.</p>
      <details><summary>Точный состав запроса</summary><pre>${esc(JSON.stringify(payload,null,2))}</pre></details>
      <div class="actions">${act('manual','Подготовить запрос для ChatGPT',id,'button primary')}${act('providers','Подключить ИИ-провайдера','','button secondary','spark')}${act('queueTreatment','Отложить до подключения',id,'text-button')}</div>`);return;
  }
  openPanel('ИИ-анализ · деморежим','Проверить данные',`<p class="dialog-sub">Один запрос по визиту. Деморазбор выполняется в браузере.</p>
    <div class="summary-sheet"><strong>${esc(payload.эпизод)}</strong><p>${esc(Object.entries(payload.пациент).map(([k,v])=>k+' — '+v).join(' · '))}</p>
    <p>Препараты: ${esc(payload.назначения.map(m=>m.название).join(', '))}. Лабораторных показателей: ${payload.анализы.length}.</p></div>
    <details><summary>Точный состав запроса</summary><pre>${esc(JSON.stringify(payload,null,2))}</pre></details>
    <div class="panel-section">${act('manual','Разобрать в своём ChatGPT',id,'text-button','book')} ${act('providers','Подключить ИИ-провайдера','','text-button','spark')}</div>
    <div class="actions">${act('back','Отмена','','button secondary')}${act('run','Подтвердить деморазбор',id,'button primary')}</div>`);
}
function completeReview(id){
  if(readOnly||!reviewReady(id)||!demoReviewAvailable(id))return;
  const review=createReview(id);current().reviews.push(review);saveState();
  if(routes.at(-1)?.name==='consent')routes.pop();
  go('review',review.id);
}
function showReview(id){
  const r=current().reviews.find(r=>r.id===id);
  if(r.kind==='manual'||r.kind==='provider'){
    openPanel(r.provider||'Ответ из ChatGPT','Разбор лечения',`<p class="dialog-sub">${stamp(r.time)} · ${r.kind==='provider'?'Ответ подключённого провайдера.':'Ответ добавлен пользователем.'}</p>
      ${r.items?.map((item,i)=>'<div class="assessment"><strong>'+esc(r.payload.назначения[i].название)+'</strong><p class="rating">'+esc(item.label)+'</p><p>'+esc(item.reason)+'</p>'+(item.source?external(item.source,'Источник из ответа'):'')+'</div>').join('')||''}
      <div class="manual-answer">${esc(r.answer)}</div><details><summary>Точный запрос этой версии</summary><pre>${esc(r.prompt)}</pre></details>`);return;
  }
  openPanel('Демонстрационный разбор','Оценка лечения',`<p class="dialog-sub">${stamp(r.time)} · Сценарий на вымышленных данных, без обращения к внешнему ИИ.</p>
    ${r.items.map((item,i)=>`<div class="assessment"><div class="assessment-head"><strong>${esc(r.payload.назначения[i].название)}</strong><span class="rating">${esc(item.label)}</span></div>
    <p>${esc(item.reason)}</p>${item.source?external(guideline,'Источник · AAO-HNSF, раздел Topical Steroids'):''}
    ${act('analogs','Найти аналоги',medKey(r.visit,i),'text-button')}</div>`).join('')}
    <details><summary>Данные этой версии</summary><pre>${esc(JSON.stringify(r.payload,null,2))}</pre></details>`);
}
function pharmacySearch(name,city=true) {
  const u=new URL('https://tabletka.by/search/');u.searchParams.set('request',name);
  if(city)u.searchParams.set('region',pharmacyRegions[prototypeState.city]);return u.href;
}
function liveMarket(m,city) {
  const root=document.querySelector('#live-market');if(!root)return;
  const run=async(region)=>{
    root.replaceChildren();root.textContent='Проверяем предложения на tabletka.by…';
    const label=region==='0'?'Вся Беларусь':city;
    try {
      const response=await fetch('https://health-story-sync.xzx89s.workers.dev/pharmacy/search',{method:'POST',credentials:'omit',referrerPolicy:'no-referrer',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:m.name,region}),signal:AbortSignal.timeout(15000)});
      if(!response.ok)throw Error();
      const data=await response.json();if(!root.isConnected)return;
      if(data.region!==region || !Array.isArray(data.packages))throw Error();
      root.innerHTML='<p>'+esc(label)+' · '+esc(stamp(data.checked))+'</p>'+
        (data.packages.length?'<p>Сверьте назначение с конкретной упаковкой.</p>'+data.packages.map(p=>{
          const link=new URL('https://tabletka.by/result/');link.searchParams.set('ls',p.id);if(region!=='0')link.searchParams.set('region',region);
          return '<div class="market-row"><div><strong>'+esc(p.name)+'</strong><small>'+esc([p.form,p.manufacturer,p.substance].filter(Boolean).join(' · '))+'</small></div><div>'+esc(p.min.toFixed(2)+' – '+p.max.toFixed(2))+' BYN '+external(link.href,'Наличие')+'</div></div>';
        }).join(''):'<p>В выбранном регионе подтверждённых предложений нет.</p>');
    }catch{root.textContent='Сейчас получить цены из каталога не удалось. Поиск на tabletka.by доступен по ссылке.'}
    if(region!=='0' && root.isConnected){const b=document.createElement('button');b.className='text-button';b.textContent='Искать по всей Беларуси';b.onclick=()=>run('0');root.append(b)}
  };
  root.querySelector('button').onclick=()=>run(pharmacyRegions[city]);
}
function showAnalogs(id) {
  const {med:m,index:i}=medFromKey(id);if(!m)return;
  const info=m,city=prototypeState.city;
  if(!m.fixture){
    const search=[m.name,m.strength,m.form].filter(Boolean).join(' ');
    openPanel('Сравнение препаратов','Аналоги и цены',`<p class="dialog-sub">${esc(search)}</p>
      <p class="fact-note">Для сравнения аналогов проверьте действующее вещество, дозировку, форму, путь введения и тип высвобождения.</p>
      <div id="live-market"><button class="button secondary">Проверить текущие цены</button><small>Поиск по названию и городу через семейный сервер.</small></div>
      <div class="panel-section">${external(pharmacySearch(search),'Искать на tabletka.by · '+city)}<br>${external(pharmacySearch(search,false),'Искать по всей Беларуси')}</div>`);liveMarket(m,city);return;
  }
  openPanel('Сравнение препаратов','Аналоги и цены',`<p class="dialog-sub">${esc(m.name)} · ${esc(m.strength)} · ${esc([m.form,m.pack].filter(Boolean).join(' · '))}</p>
    ${!i?`<p class="fact-note">Мометазон, назальный дозированный спрей обычного высвобождения. В примере у всех флаконов 140 доз.</p>
    ${city==='Минск'?'<p class="panel-label">Минск · снимок цен 25.11.2026, 20:57</p>':'<p class="fact-note">Цены для города '+esc(city)+' можно проверить по ссылке.</p>'}
    ${marketExamples.map(a=>`<div class="market-row"><div><strong>${a.name}</strong><small>${a.manufacturer}</small></div><div>${city==='Минск'?'<strong>'+a.price+' BYN</strong>':''}${external('https://tabletka.by/result/?ls='+a.id+'&region='+pharmacyRegions[city],'Предложения')}</div></div>`).join('')}`
    :'<p class="fact-note">В демонстрационной подборке нет подтверждённого совпадения по дозировке, форме и упаковке.</p>'}
    ${i===0?`<div class="summary-sheet"><strong>Вариант, указанный врачом</strong><p>Флутиказон · другое действующее вещество. В листе назначений указан отдельно от текущей схемы.</p>${external(pharmacySearch('Флутиказон'),'Найти флутиказон на tabletka.by')}</div>`:''}
    <div class="panel-section">${external(pharmacySearch(info.search),'Искать на tabletka.by · '+city)}<br>${external(pharmacySearch(info.search,false),'Искать по всей Беларуси')}</div>`);
}

function showManual(id){
  if(!reviewReady(id))return;
  const input=makePayload(id), snapshot=JSON.stringify(input), saved=current().prompts[id];
  const template=promptLibrary().find(t=>t.id==='treatment')||builtinPrompts[0];
  const prompt=saved?.snapshot===snapshot&&saved.templateVersion===template.version?cleanClinicalText(saved.text):cleanClinicalText(template.text)+'\n\n'+JSON.stringify(input,null,2);
  const draft=saved?.snapshot===snapshot?saved.answer||'':'';
  current().prompts[id]={snapshot,text:prompt,answer:draft,templateVersion:template.version};saveState();
  openPanel('Ручной разбор','Разбор в своём ChatGPT',`<form class="edit-form" id="manual-form" data-id="${id}">
    <label>Текст для ChatGPT<textarea name="prompt" rows="6" required>${esc(prompt)}</textarea></label>
    <p class="hint">Проверьте данные и уберите личные сведения перед копированием. Вложения остаются в дневнике.</p>
    <div class="manual-links">${act('copyPrompt','Скопировать запрос','','button secondary')}${external('https://chatgpt.com/','Открыть ChatGPT')}</div>
    <p id="copy-status" class="hint" aria-live="polite"></p>
    <label>Ответ из ChatGPT<textarea rows="4" name="answer" required placeholder="Вставьте полученный ответ">${esc(draft)}</textarea></label>
    <button class="button primary">Сохранить версию разбора</button></form>`);
}
async function copyPrompt(){
  const box=document.querySelector('#manual-form textarea[name=prompt]'),msg=document.querySelector('#copy-status');
  if(!reviewOutboundText(box,msg))return;
  try{
    if(!navigator.clipboard?.writeText)throw Error();
    await navigator.clipboard.writeText(box.value);msg.textContent='Запрос скопирован.';
  }catch{box.focus();box.select();msg.textContent=document.execCommand('copy')?'Запрос скопирован.':'Текст выделен. Выберите «Скопировать».'}
}
function saveManual(f){
  const data=new FormData(f),answer=data.get('answer').trim(),prompt=data.get('prompt').trim();
  if(!answer||!prompt||!reviewOutboundText(f.elements.prompt,f.querySelector('#copy-status')))return;
  const payload=makePayload(f.dataset.id);
  const version={id:uid(),kind:'manual',time:new Date().toISOString(),visit:f.dataset.id,prompt,answer,payload,items:readAnswerItems(answer,payload)};
  const saved=current().prompts[f.dataset.id];if(saved)saved.text=prompt;
  current().reviews.push(version);
  if(!saveState()){current().reviews.pop();document.querySelector('#copy-status').textContent='Не удалось сохранить разбор в браузере. Текст остаётся в форме.';return}
  current().treatmentQueue=current().treatmentQueue.filter(q=>q.id!==f.dataset.id);if(saved)saved.answer='';saveState();render();
  routes=routes.filter(r=>!['manual','consent'].includes(r.name));go('review',version.id);
}
function readAnswerItems(answer,payload){
  let rows;
  try{rows=JSON.parse(answer.replace(/^```(?:json)?\s*|\s*```$/gi,'')).препараты}catch{return null}
  if(!Array.isArray(rows))return null;
  const allowed=['Необходимое','Рекомендуемое','Малоэффективное','Общее укрепление организма','Недостаточно данных для оценки'];
  return payload.назначения.map(m=>{
    const item=rows.find(r=>typeof r?.название==='string'&&norm(r.название)===norm(m.название));
    const label=allowed.find(l=>norm(l)===norm(String(item?.категория||''))),reason=String(item?.обоснование||'').trim();
    let source;try{const url=new URL(item.источник);if(url.protocol==='https:'||url.protocol==='http:')source=url.href}catch{}
    if(label&&reason&&(source||label===allowed.at(-1)))return {label,reason,source};
    return {label:allowed.at(-1),reason:'В ответе отсутствует оценка с обоснованием и источником для этого назначения.'};
  });
}
