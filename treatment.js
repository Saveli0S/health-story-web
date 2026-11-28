'use strict';

function coursePeriod(p) {
  if(p.unconfirmed)return 'Приём не подтверждён';
  const end=p.closed ? (p.end?dateLabel(p.end):'дата неизвестна') : (p.planned?dateLabel(p.planned):'окончание не указано');
  return (p.start?dateLabel(p.start):'начало не указано')+' — '+end+(p.closed?' · завершён':' · по плану');
}
function drugBlock(m,i,detail=false,visit) {
  const continued=m.continuedFrom&&Object.hasOwn(m,'sourceKey');
  const key=continued?m.sourceKey:medKey(visit,i),review=current().reviews.filter(r=>r.visit===visit).at(-1);
  const source=continued&&key!==null?medFromKey(key):{visit,med:m};
  const editKey=source.med?.id?JSON.stringify([source.visit,source.med.id]):null;
  const status=m.endedBy?({dose:'Дозировка изменена',replace:'Препарат заменён',stop:'Препарат отменён'}[m.endedBy.kind]||'Схема изменена'):'';
  const item=effectiveReviewItems(review)[i], snapshot=review?.payload?.назначения?.[i];
  const matches=snapshot?.название===m.name&&snapshot?.дозировка===m.strength&&snapshot?.форма===m.form&&snapshot?.схема===m.instructions;
  return `<div class="medication">
    <div class="drug">${icon(m.fixture?(i?'drop':'spray'):'pill')}<div><strong>${esc(m.name)} · ${esc(m.strengthUnspecified?'дозировка не указана':m.strength)}</strong><small>${esc([m.form,m.pack].filter(Boolean).join(' · '))}</small></div></div>
    <p class="regimen">${esc(m.instructions)}</p>
    <div class="period-line">${icon('calendar',true)}<span>${coursePeriod(m.period)}${m.endedBy?' · '+status+' '+dateLabel(m.endedBy.date)+' · '+esc(doctorLabel(m.endedBy.doctor)):''}</span>
    ${readOnly||key===null?'':'<span class="period-actions">'+(editKey?act('editMedicine','Редактировать',editKey,'inline-action'):'')+
      act('period','Изменить даты',key,'inline-action')+'</span>'}</div>
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
  document.querySelector('#period-form').localFieldRules=[periodFieldRules];
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
function periodFieldRules(form,add){
  for(const name of ['planned','end']){
    const date=form.elements[name].value;
    if(date&&date<form.elements.start.value)add(name,'Укажите дату окончания не раньше начала курса.');
  }
}
function savePeriod(f) {
  const d=new FormData(f), closed=d.get('closed')==='yes', start=d.get('start'), planned=d.get('planned');
  const end=closed?d.get('end')||'':'', unknown=closed && d.has('unknown');
  const period=medFromKey(f.dataset.id).med.period;
  Object.assign(period,{start,planned,end,closed,unknown,note:d.get('note').trim()});
  if(start||end||!closed)delete period.unconfirmed;
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
  document.querySelector('#finish-form').localFieldRules=[finishFieldRules];
}
function finishFieldRules(form,add){
  const meds=courseAt(form.dataset.id)?.meds||[];
  const common=form.elements.common.value;
  for(const [i,med] of meds.entries()){
    const override=form.elements['d'+i];
    if(!override||form.elements['u'+i].checked)continue;
    const end=override.value||common;
    if(end&&end<med.period.start)add(override.value?override:'common','Укажите дату окончания не раньше начала курса.');
  }
}
function saveFinish(f) {
  const d=new FormData(f);
  const meds=courseAt(f.dataset.id).meds;
  const periods=meds.map(({period:p},i)=>{
    if(p.closed||meds[i].endedBy)return p;
    const unknown=d.has('u'+i), end=unknown?'':(d.get('d'+i)||d.get('common'));
    return {...p,closed:true,unknown,end};
  });
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
  const alternatives=(current().marketCriteria||[]).filter(criteria=>criteria.visit===id&&criteria.alternative&&
    c?.meds.some(m=>criteria.id===id+'/'+(m.id||medicineSignature(m))&&criteria.prescription===marketPrescriptionKey(m))).map(c=>c.alternative);
  if(alternatives.length)data.вариантыВрача=[...new Set([...data.вариантыВрача,...alternatives])];
  const exams=current().exams.filter(e=>e.visit===id);
  if(exams.length)data.обследования=exams.map(examClinicalData);
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
  if(connectedProviders().length){
    go('directTreatment',id);
    if(canAutoSendTreatment())sendTreatment(document.querySelector('#direct-treatment'));
    return;
  }
  if(current().auto && !demoReviewAvailable(id)){go('manual',id);return}
  if(current().auto){completeReview(id);return}
  go('consent',id);
}
function demoReviewAvailable(id){return id===person.course?.visit&&!intakeFiles(id).length&&!current().changes.some(c=>c.visit===id)}
function showConsent(id) {
  if(connectedProviders().length){directTreatmentForm(id);return}
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
      ${transferHistory(r)}${effectiveReviewItems(r).map((item,i)=>reviewItemHTML(r,item,i)).join('')}
      <details class="manual-answer" open><summary>Исходный ответ</summary><p>${esc(r.answer)}</p></details><details><summary>Точный запрос этой версии</summary><pre>${esc(r.prompt)}</pre></details>`);bindEvidenceChecks(r);return;
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

const marketNorm=value=>String(value??'').toLocaleLowerCase('ru').replace(/ё/g,'е').replaceAll(',','.').replace(/\s+/g,' ').trim();
function marketDoseKey(value){
  // Only compare explicitly stated quantities. Keep the denominator and its unit.
  const raw=marketNorm(value).replace(/\s+/g,'').replace(/[μµ]г/gu,'мкг');
  const dose=raw.match(/^(\d+(?:\.\d+)?)(мкг|мг|г|ме|%)(?:\/(?:(\d+(?:\.\d+)?))?(доза|дозу|мл|г))?$/u);
  if(!dose)return raw;
  const [,amount,unit,perAmount,perUnit]=dose;
  function decimal(number,shift=0){
    const [whole,fraction='']=number.split('.');
    const digits=whole+fraction.padEnd(shift,'0'),cut=whole.length+shift;
    const integer=digits.slice(0,cut).replace(/^0+(?=\d)/,'');
    const tail=digits.slice(cut).replace(/0+$/,'');
    return tail?integer+'.'+tail:integer;
  }
  const shift={мкг:0,мг:3,г:6}[unit];
  const quantity=decimal(amount,shift),per=decimal(perAmount||'1');
  if(quantity==='0'||per==='0')return raw;
  return [quantity,shift===undefined?unit:'мкг',per,perUnit==='дозу'?'доза':perUnit||''].join(':');
}
function marketPackKey(value){
  const v=marketNorm(value).replace(/\s+/g,'');
  const count=v.match(/^(?:№|n|no\.?|#)(\d+)$/u)||v.match(/^(\d+)(?:шт\.?|таблет(?:ок|ки|ка)|капсул(?:ы|а)?)$/u);
  if(count)return '№'+count[1];
  const measure=v.match(/^(\d+(?:\.\d+)?)(доз(?:а|ы)?|мл|г)(?:(?:№|n|#)(\d+))?$/u);
  if(!measure)return v;
  const unit=measure[2].startsWith('доз')?'доз':measure[2];
  return measure[1]+unit+'№'+(measure[3]||'1');
}
function marketDescription(form){
  let rest=marketNorm(form);
  const take=re=>{const m=rest.match(re);if(m)rest=rest.replace(m[0],' ').trim();return m?.[0]||''};
  const count=take(/(?:^|\s)(?:n|№|#)\s*\d+(?=\s|$)/u);
  const strength=take(/(?<![\d.])\d+(?:\.\d+)?\s*(?:мкг|[μµ]г|мг|ме|%|г)(?:\s*\/\s*(?:\d+(?:\.\d+)?\s*)?(?:доза|дозу|мл|г))?(?![\p{L}])/u);
  const pack=take(/(?<![\d./])\d+(?:\.\d+)?\s*(?:доз(?:ы|а)?|мл|г)(?![\p{L}])/u);
  // A volume plus a count describes the whole package: two vials are different from one.
  const packageText=[pack,count].filter(Boolean).map(s=>s.trim()).join(' ');
  const has=re=>re.test(rest);
  const route=has(/назальн|в нос|для носа/)?'Назальный':has(/пероральн|для приема внутрь/)?'Пероральный':has(/глазн|офтальм/)?'Глазной':has(/наружн/)?'Наружный':has(/ректальн/)?'Ректальный':'';
  const release=has(/пролонг|модифицированн|замедленн|ретард|кишечнорастворим|отсроченн/)
    ?(has(/пролонг|ретард/)?'Пролонгированное':has(/кишечнорастворим|отсроченн/)?'Отсроченное':has(/замедленн/)?'Замедленное':'Модифицированное')
    :has(/обычн\w* высвобожд|обычного высвобождения|немедленн[а-я]* высвобожден/)?'Обычное':'';
  // Keep unrecognised qualifiers verbatim. A novel formulation cannot become a match by accident.
  const bare=rest.replace(/(?:для приема внутрь|пероральн[а-я]*|назальн[а-я]*|для носа|глазн[а-я]*|наружн[а-я]*|ректальн[а-я]*)/gu,' ')
    .replace(/(?:пролонгированн|модифицированн|замедленн|немедленн|обычн|отсроченн)[а-я]*\s+(?:высвобождени[ея]|действи[ея])/gu,' ')
    .replace(/^[\s,.;·-]+|[\s,.;·-]+$/g,'').replace(/\s+/g,' ').trim();
  return {form:bare,route,release,strength:strength.trim(),pack:packageText};
}
function marketPrescriptionKey(m){return [m.name,m.strength,m.form].map(marketNorm).join('|')}
function packageAssessment(item,med,criteria){
  const facts=marketDescription(item.form),target=marketDescription(med.form||criteria.form);
  const checks=[
    ['вещество',marketNorm(criteria.substance),marketNorm(item.substance)],
    ['дозировка',marketDoseKey(med.strength),marketDoseKey(facts.strength)],
    ['форма',target.form,facts.form],
    ['путь введения',marketNorm(target.route||criteria.route),marketNorm(facts.route)],
    ['тип высвобождения',marketNorm(target.release||criteria.release),marketNorm(facts.release)]
  ];
  const different=checks.filter(([,a,b])=>a&&b&&a!==b).map(([field])=>field);
  const unknown=checks.filter(([,a,b])=>!a||!b).map(([field])=>field);
  const sameDrug=marketNorm(item.name)===marketNorm(med.name);
  const packMatch=Boolean(criteria.pack&&facts.pack&&marketPackKey(criteria.pack)===marketPackKey(facts.pack));
  if(different.length)return {group:'different',why:'Отличается: '+different.join(', '),facts};
  if(!(Number.isInteger(item.pharmacyCount)&&item.pharmacyCount>0))return {group:'unverified',why:'Источник не подтвердил наличие в аптеках.',facts};
  if(unknown.length||!facts.pack)return {group:'unverified',why:'Уточнить: '+[...unknown,...(facts.pack?[]:['упаковка каталога'])].join(', '),facts};
  if(sameDrug&&packMatch)return {group:'exact',why:'Совпали характеристики и упаковка.',facts};
  const difference=!criteria.pack?'Размер назначенной упаковки не указан.':packMatch?'Размер упаковки совпал.':'Упаковка отличается: '+facts.pack+'.';
  return {group:sameDrug?'otherPack':'analogue',why:(sameDrug?'То же торговое название. ':'Другое торговое название. ')+difference,facts};
}

function safeMarketQuery(value){
  const text=String(value||'').trim();
  return text&&text.length<=90&&/^[\p{L}\p{N}\s.,+()%-]+$/u.test(text)&&cleanClinicalText(text)===text?text:'';
}
function validCatalogPackage(p){
  return p&&/^\d{1,12}$/.test(p.id)&&typeof p.name==='string'&&typeof p.form==='string'&&p.name&&p.form&&
    typeof p.substance==='string'&&Number.isFinite(p.min)&&Number.isFinite(p.max)&&p.min>0&&p.max>=p.min;
}
function packageFromPrescription(visit,med){
  if(med.pack)return med.pack;
  const dose=marketDoseKey(med.strength),name=marketNorm(med.name);
  if(!dose||!name)return '';
  const sources=[...confirmedRecommendations(visit).map(r=>r.text),
    ...intakeFiles(visit).filter(f=>f.checked).map(f=>f.transcription||f.raw||'')];
  const packages=new Set();
  for(const raw of sources){
    for(const line of raw.split(/\r?\n/)){
      const text=marketNorm(stripRxBullet(line.replace(/^\s*рекомендации по (?:медикаментозному )?лечению\s*:\s*/iu,'')));
      if(!text.startsWith(name)||!/^[:\s·,(–—-]/u.test(text.slice(name.length)))continue;
      const facts=marketDescription(text.slice(name.length));
      if(facts.pack&&marketDoseKey(facts.strength)===dose)packages.add(marketPackKey(facts.pack));
    }
  }
  return packages.size===1?[...packages][0]:'';
}

function catalogSubstance(packages,med,criteria){
  const target=marketDescription(med.form||criteria.form),dose=marketDoseKey(med.strength);
  if(!target.form||!dose)return '';
  const matches=packages.filter(p=>{
    const facts=marketDescription(p.form);
    return marketNorm(p.name)===marketNorm(criteria.trade||med.name)&&
      facts.form===target.form&&marketDoseKey(facts.strength)===dose;
  });
  if(matches.some(p=>!safeMarketQuery(p.substance)))return '';
  const substances=new Map(matches.map(p=>[marketNorm(p.substance),p.substance]));
  return substances.size===1?[...substances.values()][0]:'';
}

async function queryMarket(name,region){
  const response=await fetch('https://health-story-sync.xzx89s.workers.dev/pharmacy/search',{
    method:'POST',credentials:'omit',referrerPolicy:'no-referrer',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({name,region}),signal:AbortSignal.timeout(15000)
  });
  if(!response.ok)throw Error();
  const data=await response.json();
  if(data.region!==region||!Array.isArray(data.packages)||data.packages.some(p=>!validCatalogPackage(p))||
    !Number.isFinite(Date.parse(data.checked))||Math.abs(Date.now()-Date.parse(data.checked))>30*60*1000)throw Error();
  return data;
}

async function searchMarket(med,criteria,region){
  const trade=criteria.trade||med.name;
  const names=[...new Set([trade,criteria.substance].filter(Boolean))];
  const attempts=await Promise.allSettled(names.map(name=>queryMarket(name,region)));
  if(!criteria.substance&&attempts[0]?.status==='fulfilled'){
    const substance=catalogSubstance(attempts[0].value.packages,med,criteria);
    if(substance&&marketNorm(substance)!==marketNorm(trade)){
      criteria.substance=substance;
      criteria.substanceFromCatalog=true;
      attempts.push(...await Promise.allSettled([queryMarket(substance,region)]));
    }
  }
  const responses=attempts.filter(r=>r.status==='fulfilled').map(r=>r.value);
  if(!responses.length)throw Error();
  const packages=[...new Map(responses.flatMap(r=>r.packages).map(p=>[String(p.id),p])).values()];
  const snapshots=packages.slice(0,80).map(({id,name,form,manufacturer,substance,min,max,pharmacyCount})=>
    ({id,name,form,manufacturer,substance,min,max,pharmacyCount}));
  const {lastSearch,...snapshotCriteria}=criteria;
  return {region,checked:new Date(Math.min(...responses.map(r=>Date.parse(r.checked)))).toISOString(),
    partial:responses.some(r=>r.partial),incomplete:responses.length<attempts.length,
    limited:snapshots.length<packages.length,packages:snapshots,criteria:snapshotCriteria};
}

function marketPlace(region){
  return region==='0'?'Вся Беларусь':Object.keys(pharmacyRegions).find(city=>pharmacyRegions[city]===region)||'Регион поиска';
}

function marketFindingRows(search,criteriaId,visit,prescription){
  if(!Array.isArray(search?.packages)||!Number.isFinite(Date.parse(search.checked)))return [];
  const {region,checked}=search;
  return search.packages.filter(validCatalogPackage).map(p=>({
    id:JSON.stringify([criteriaId,prescription,region,String(p.id)]),criteriaId,visit,prescription,
    observation:JSON.stringify({...p,id:String(p.id),region,checked})
  }));
}

function mergeMarketFindings(existing,incoming){
  const rows=new Map(existing.map(row=>[row.id,row]));
  for(const row of incoming){
    const old=rows.get(row.id);
    if(!old||Date.parse(savedMarketSearch(row.observation)?.checked)>Date.parse(savedMarketSearch(old.observation)?.checked))rows.set(row.id,row);
  }
  return [...rows.values()];
}

function showMarketResults(root,med,search,criteria,findings,findNationwide){
  if(!search&&!findings.length)return;
  const observations=findings.map(row=>savedMarketSearch(row.observation))
    .filter(p=>validCatalogPackage(p)&&Number.isFinite(Date.parse(p.checked)))
    .sort((a,b)=>Date.parse(b.checked)-Date.parse(a.checked));
  const packages=new Map();
  for(const p of observations){
    if(!packages.has(p.id))packages.set(p.id,[]);
    packages.get(p.id).push(p);
  }
  const groupNames={exact:'Назначенная упаковка',analogue:'Совпадают состав и характеристики',otherPack:'Другие упаковки этого препарата',unverified:'Требуют сверки',different:'Отличаются от назначения'};
  root.innerHTML=(search?'<h3>Последний поиск</h3><p>'+esc(marketPlace(search.region))+' · '+esc(stamp(search.checked))+'</p>':'')+
    (search?.partial?'<p>У части строк каталога не удалось подтвердить цену или наличие.</p>':'')+
    (search?.incomplete?'<p>Один из поисков недоступен. Список может быть неполным.</p>':'')+
    (search?.limited?'<p>Сохранены первые 80 предложений этого поиска.</p>':'')+
    (search&&(search.packageCount??search.packages?.length)===0?'<p>В выбранном регионе подтверждённых предложений нет.</p>':'')+
    (packages.size?'<h3>Сохранённые результаты · '+packages.size+'</h3>':'');
  const groups=new Map(),catalogPrices=new Map();
  for(const entries of packages.values()){
    const [p]=entries;
    const assessment=packageAssessment(p,med,criteria),group=groups.get(assessment.group)||[];
    const displayPrice=['exact','analogue','otherPack'].includes(assessment.group);
    const canInspect=assessment.group==='unverified'&&p.pharmacyCount>0&&assessment.facts.strength&&assessment.facts.form&&assessment.facts.pack;
    const regionalPrices=withPrice=>entries.map(offer=>{
      const link=new URL('https://tabletka.by/result/');
      link.searchParams.set('ls',offer.id);
      if(offer.region!=='0')link.searchParams.set('region',offer.region);
      const price=offer.min.toFixed(2)+' – '+offer.max.toFixed(2)+' BYN';
      const details=[withPrice?price:'',marketPlace(offer.region),stamp(offer.checked)].filter(Boolean).join(' · ');
      return '<div class="market-price">'+esc(details)+' '+external(link.href,'Наличие')+'</div>';
    }).join('');
    if(canInspect)catalogPrices.set(p.id,regionalPrices(true));
    const selected=canInspect?'<button type="button" class="text-button" data-catalog-price="'+esc(p.id)+'">Посмотреть цену этой упаковки</button>':'';
    group.push('<div class="market-row" data-package-id="'+esc(p.id)+'"><div><strong>'+esc(p.name)+'</strong>'+
      '<small class="market-substance">'+esc(p.substance?'Действующее вещество · '+p.substance:'Действующее вещество не указано')+'</small>'+
      '<small>'+esc([p.form,p.manufacturer].filter(Boolean).join(' · '))+'</small><small>'+esc(assessment.why)+'</small></div>'+
      '<div class="market-prices">'+selected+regionalPrices(displayPrice)+'</div></div>');
    groups.set(assessment.group,group);
  }
  for(const [key,label] of Object.entries(groupNames)){
    const rows=groups.get(key);if(!rows)continue;
    const summary=esc(label)+' · '+rows.length;
    const expanded=key==='unverified'&&!['exact','analogue','otherPack'].some(group=>groups.has(group));
    root.insertAdjacentHTML('beforeend',['different','unverified'].includes(key)?
      '<details'+(expanded?' open':'')+'><summary>'+summary+'</summary>'+rows.join('')+'</details>':'<h4>'+summary+'</h4>'+rows.join(''));
  }
  for(const button of root.querySelectorAll('[data-catalog-price]'))button.onclick=()=>{
    button.parentElement.innerHTML='<strong>Выбранная упаковка каталога</strong>'+catalogPrices.get(button.dataset.catalogPrice);
  };
  if(search&&search.region!=='0'){
    const nationwide=document.createElement('button');
    nationwide.type='button';nationwide.className='text-button';nationwide.textContent='Искать по всей Беларуси';
    nationwide.onclick=findNationwide;
    root.append(nationwide);
  }
}

function savedMarketSearch(value){
  if(typeof value!=='string')return null;
  try{return JSON.parse(value)}catch{return null}
}

function showAnalogs(id){
  const {visit,index,med:m}=medFromKey(id);if(!m)return;
  const key=visit+'/'+(m.id||medicineSignature(m)),city=prototypeState.city,region=pharmacyRegions[city],profile=current();
  const prescription=marketPrescriptionKey(m);
  const original=marketDescription(m.form),fixture=m.fixture&&index===0;
  const criteriaFor=data=>data.marketCriteria?.find(c=>c.id===key&&c.prescription===prescription);
  const saved=criteriaFor(latestProfile());
  let criteria=saved?Object.fromEntries(Object.entries(saved).filter(([k])=>!['id','visit','prescription','lastSearch'].includes(k))):{trade:m.name,form:m.form,substance:fixture?'Мометазон':'',pack:packageFromPrescription(visit,m),
    route:original.route,release:fixture?'Обычное':original.release,alternative:fixture?'Флутиказон':''};
  const fields=[['trade','Торговое название'],['substance','Действующее вещество / МНН'],['form','Лекарственная форма'],['pack','Размер упаковки'],['route','Путь введения'],['release','Тип высвобождения'],['alternative','Другой вариант, указанный врачом']];
  const input=(k,l)=>'<label>'+l+'<input name="'+k+'" maxlength="90" value="'+esc(criteria[k])+'" '+(k==='form'&&m.form||k==='route'&&original.route||k==='release'&&original.release?'readonly':'')+'></label>';
  openPanel('Сравнение препаратов','Аналоги и цены','<p class="dialog-sub">'+esc([m.name,m.strength,m.form,criteria.pack].filter(Boolean).join(' · '))+'</p>'+
    '<p id="market-substance" class="dialog-sub"></p>'+
    '<form class="edit-form" id="market-criteria"><div class="actions left"><button class="button primary" value="find">Найти аналоги и цены</button></div>'+
    (readOnly?'':'<details><summary>Уточнить данные для поиска</summary><fieldset class="rx-inputs"><label>Дозировка из назначения<input name="strength" readonly value="'+esc(m.strength)+'"></label>'+fields.map(([k,l])=>input(k,l)).join('')+
      '<button class="button secondary" value="save">Сохранить данные поиска</button></fieldset></details>')+
    '<p class="hint" id="market-status" role="status"></p></form>'+
    '<p class="hint">Для сравнения нужны действующее вещество, дозировка, форма, путь введения и тип высвобождения.</p>'+
    '<div id="live-market" class="panel-section"></div><div id="market-links"></div>');
  const form=document.querySelector('#market-criteria'),status=form.querySelector('#market-status'),root=document.querySelector('#live-market');
  const controls=form.querySelector('fieldset'),find=form.querySelector('[value=find]'),substance=document.querySelector('#market-substance');
  const rowsFrom=search=>marketFindingRows(search,key,visit,prescription);
  const belongs=row=>row.criteriaId===key&&row.prescription===prescription;
  let lastSearch=savedMarketSearch(saved?.lastSearch),findings=[],busy=false;
  function savedFindings(data){
    return mergeMarketFindings((data.marketFindings||[]).filter(belongs),rowsFrom(savedMarketSearch(criteriaFor(data)?.lastSearch)));
  }
  function refresh(){
    substance.textContent=criteria.substance?'Действующее вещество · '+criteria.substance:'Действующее вещество пока не определено';
    find.textContent=lastSearch?'Повторить поиск':'Найти аналоги и цены';
    linkSection(criteria);
    showMarketResults(root,m,lastSearch,criteria,findings,()=>run('0'));
  }
  function linkSection(values){
    const search=[values.trade||m.name,m.strength,m.form||values.form,values.pack].filter(Boolean).join(' ');
    const other=safeMarketQuery(values.alternative);
    form.parentElement.querySelector('#market-links').innerHTML=
      (other?'<div class="summary-sheet"><strong>Отдельный вариант от врача</strong><p>'+esc(other)+'</p>'+external(pharmacySearch(other),'Искать вариант врача')+'</div>':'')+
      (safeMarketQuery(values.trade||m.name)&&cleanClinicalText(search)===search?'<div class="panel-section">'+external(pharmacySearch(search),'Искать на tabletka.by · '+city)+'<br>'+
        external(pharmacySearch(search,false),'Искать по всей Беларуси на tabletka.by')+'</div>':'');
  }
  function readCriteria(){
    const values=readOnly?{...criteria}:Object.fromEntries(fields.map(([k])=>[k,form.elements[k].value.trim()]));
    if(!readOnly&&!validateInlineFields(form))return null;
    if([values.trade||m.name,values.substance,values.alternative].some(v=>v&&!safeMarketQuery(v))){
      status.textContent='Проверьте поисковые названия и уберите личные сведения.';return null;
    }
    if(criteria.substanceFromCatalog&&marketNorm(values.substance)===marketNorm(criteria.substance))values.substanceFromCatalog=true;
    return values;
  }
  if(!readOnly)form.localFieldRules=[(f,add)=>{
    for(const name of ['trade','substance','alternative']){
      const value=f.elements[name].value.trim()||(name==='trade'?m.name:'');
      if(value&&!safeMarketQuery(value))add(name,'Проверьте название препарата и уберите личные сведения.');
    }
  }];
  function store(values,search,rows){
    if(current()!==profile||readOnly)return false;
    const previous=profile.marketCriteria,previousFindings=profile.marketFindings;
    // The region, prices and timestamp belong to one snapshot during synchronization.
    profile.marketCriteria=[...previous.filter(c=>c.id!==key),{...values,id:key,visit,prescription,
      ...(search?{lastSearch:JSON.stringify(search)}:{})}];
    if(rows?.length)profile.marketFindings=mergeMarketFindings(previousFindings,rows);
    if(saveState())return true;
    profile.marketCriteria=previous;
    profile.marketFindings=previousFindings;
    return false;
  }
  async function run(searchRegion){
    if(busy)return;
    const values=readCriteria();if(!values)return;
    busy=true;find.disabled=true;if(controls)controls.disabled=true;
    status.textContent='Проверяем предложения на tabletka.by…';
    try{
      const result=await searchMarket(m,values,searchRegion);
      if(!form.isConnected||current()!==profile)return;
      const latest=latestProfile();
      const rows=mergeMarketFindings(savedFindings(latest),rowsFrom(result));
      const {packages,...summary}=result;
      lastSearch={...summary,packageCount:packages.length};
      const persisted=store(values,lastSearch,rows);
      findings=persisted?savedFindings(latestProfile()):rows;
      if(controls&&values.substanceFromCatalog)form.elements.substance.value=values.substance;
      criteria=values;
      refresh();
      status.textContent=(values.substanceFromCatalog?'МНН заполнено по каталогу. ':'')+
        (persisted?'Поиск сохранён.':readOnly?'':'Не удалось сохранить поиск.');
    }catch{
      if(form.isConnected)status.textContent='Сейчас получить цены из каталога не удалось. Поиск на tabletka.by доступен по ссылке.';
    }finally{busy=false;find.disabled=false;if(controls)controls.disabled=false}
  }
  form.onsubmit=e=>{
    e.preventDefault();
    if(e.submitter?.value!=='save'){run(region);return}
    const values=readCriteria();if(!values)return;
    const currentSearch=savedMarketSearch(criteriaFor(latestProfile())?.lastSearch);
    const persisted=store(values,currentSearch);
    if(persisted){criteria=values;lastSearch=currentSearch;findings=savedFindings(latestProfile());refresh()}
    status.textContent=persisted?'Данные поиска сохранены.':'Не удалось сохранить.';
  };
  findings=savedFindings(latestProfile());refresh();
}

function showManual(id){
  if(!reviewReady(id))return;
  const input=makePayload(id), snapshot=JSON.stringify(input), saved=current().prompts[id];
  const template=promptLibrary().find(t=>t.id==='treatment')||builtinPrompts[0];
  const prompt=saved?.snapshot===snapshot&&saved.templateVersion===template.version?cleanClinicalText(saved.text):buildTreatmentPrompt(template,input);
  const draft=saved?.snapshot===snapshot?saved.answer||'':'';
  current().prompts[id]={snapshot,text:prompt,answer:draft,templateVersion:template.version,transfers:saved?.snapshot===snapshot?saved.transfers||[]:[]};saveState();
  openPanel('Ручной разбор','Разбор в своём ChatGPT',`<form class="edit-form" id="manual-form" data-id="${id}">
    <label>Текст для ChatGPT<textarea name="prompt" rows="6" required>${esc(prompt)}</textarea></label>
    <p class="hint">Проверьте данные и уберите личные сведения перед копированием. Вложения остаются в дневнике.</p>
    ${transferHint()}<div class="manual-links">${act('copyPrompt','Скопировать запрос','','button secondary')}${external('https://chatgpt.com/','Открыть ChatGPT')}</div>
    <p id="copy-status" class="hint" aria-live="polite"></p>
    <label>Ответ из ChatGPT<textarea rows="4" name="answer" required placeholder="Вставьте полученный ответ">${esc(draft)}</textarea></label>
    <button class="button primary">Сохранить версию разбора</button></form>`);
}
async function copyPrompt(){
  const box=document.querySelector('#manual-form textarea[name=prompt]'),msg=document.querySelector('#copy-status');
  if(!reviewOutboundText(box,msg))return;
  const draft=current().prompts[box.form.dataset.id];if(!draft||readOnly)return;
  let copied=false;
  try{await navigator.clipboard.writeText(box.value);copied=true}
  catch{box.focus();box.select();copied=document.execCommand('copy')}
  if(copied){
    draft.transfers=[...(draft.transfers||[]),transferEvent('copy')];
    msg.textContent=saveState()?'Запрос скопирован.':'Запрос скопирован. Не удалось сохранить отметку в истории.';
  }else msg.textContent='Текст выделен. Выберите «Скопировать».';
}
function saveManual(f){
  const data=new FormData(f),answer=data.get('answer').trim(),prompt=data.get('prompt').trim();
  if(!answer||!prompt||!reviewOutboundText(f.elements.prompt,f.querySelector('#copy-status')))return;
  const payload=makePayload(f.dataset.id);
  const version={id:uid(),kind:'manual',time:new Date().toISOString(),visit:f.dataset.id,prompt,answer,payload,items:readAnswerItems(answer,payload)};
  const saved=current().prompts[f.dataset.id];if(saved)saved.text=prompt;
  version.transfers=[...(saved?.transfers||[]),transferEvent('answer')];
  current().reviews.push(version);
  if(!saveState()){current().reviews.pop();document.querySelector('#copy-status').textContent='Не удалось сохранить разбор в браузере. Текст остаётся в форме.';return}
  current().treatmentQueue=current().treatmentQueue.filter(q=>q.id!==f.dataset.id);if(saved){saved.answer='';saved.transfers=[]}saveState();render();
  routes=routes.filter(r=>!['manual','consent'].includes(r.name));go('review',version.id);
}
const insufficientRating='Недостаточно данных для оценки';
const treatmentRatings=['Необходимое','Рекомендуемое','Малоэффективное','Общее укрепление организма',insufficientRating];
const evidenceContract='В каждой строке JSON используй точные название и дозировку из назначения. Для ссылки укажи разделИсточника, заболевание и возрастнуюГруппу из самого источника и, если известны, числовые границы возрастОт/возрастДо в полных годах. Поле уточнить содержит недостающие данные. Если оснований нет, поставь «Недостаточно данных для оценки».';

function buildTreatmentPrompt(template,payload){
  return cleanClinicalText(template.text)+'\n\n'+evidenceContract+'\n\n'+JSON.stringify(payload,null,2);
}
function evidenceLink(value){
  try{
    const url=new URL(value);
    if(url.protocol!=='https:'||url.username||url.password||url.port||url.hostname==='localhost'||!url.hostname.includes('.')||
      /^\d+\.\d+\.\d+\.\d+$/.test(url.hostname)||url.hash.includes('?')||url.pathname==='/'&&!url.searchParams.has('id'))return '';
    return url.href;
  }catch{return ''}
}
function citedAgeBounds(item){
  const num=v=>typeof v==='number'&&Number.isInteger(v)&&v>=0&&v<=130;
  const group=String(item.возрастнаяГруппа||'').toLocaleLowerCase('ru').trim();
  // Use only bounds explicitly stated by the source descriptor. Do not assume an age for “учащиеся” or “подростки”.
  const explicit=num(item.возрастОт)&&(!Object.hasOwn(item,'возрастДо')||item.возрастДо===null||num(item.возрастДо)&&item.возрастДо>=item.возрастОт)
    ?[item.возрастОт,item.возрастДо??Infinity]:null;
  let described=null;
  if(/^взросл(ые|ым|ых)(?: пациенты| пациенты с .+)?$/u.test(group))described=[18,Infinity];
  if(/^дети$/u.test(group))described=[0,17];
  const range=group.match(/^(?:от\s*)?(\d+)\s*(?:до|[-–—])\s*(\d+)\s*(?:лет|года|год)$/u);
  if(range)described=[Number(range[1]),Number(range[2])];
  const from=group.match(/^(?:от|с)\s*(\d+)\s*(?:лет|года|год)(?: и старше)?$/u);
  if(from)described=[Number(from[1]),Infinity];
  if(described&&explicit)return [Math.max(described[0],explicit[0]),Math.min(described[1],explicit[1])];
  return explicit||described;
}
function readAnswerItems(answer,payload,attestations=[]){
  let rows;
  try{rows=JSON.parse(String(answer).trim().replace(/^```(?:json)?\s*|\s*```$/gi,'')).препараты}catch{}
  const medications=payload?.назначения||[],age=payload?.пациент?.['Возраст на дату визита'],diagnosis=String(payload?.эпизод||'').trim();
  return medications.map((m,index)=>{
    const missing=(reason,extra={})=>({label:insufficientRating,reason,...extra});
    if(!Array.isArray(rows))return missing('В ответе отсутствуют отдельные структурированные оценки препаратов. Запросите сведения по каждому назначению и ссылки на источники.');
    const duplicates=medications.filter(x=>norm(x.название)===norm(m.название)).length>1;
    const matches=rows.filter(x=>typeof x?.название==='string'&&norm(x.название)===norm(m.название)&&
      norm(String(x.дозировка??''))===norm(m.дозировка||''));
    if(matches.length!==1||duplicates&&!m.дозировка)return missing('Не удалось однозначно сопоставить ответ с названием и дозировкой назначения.');
    if(duplicates&&medications.filter(x=>norm(x.название)===norm(m.название)&&norm(x.дозировка||'')===norm(m.дозировка||'')).length>1)
      return missing('Одинаковое название и дозировка встречаются в нескольких назначениях. Уточните, к какой схеме относится оценка.');
    const item=matches[0],label=treatmentRatings.find(l=>norm(l)===norm(String(item.категория||'')));
    const reason=String(item.обоснование||'').trim(),clarify=String(item.уточнить||'').trim();
    if(label===insufficientRating)return missing([reason,clarify].filter(Boolean).join(' ')||'Уточните сведения о заболевании, возрасте и назначении.');
    const source=evidenceLink(item.источник);
    if(!source||!label||!reason)return missing('Требуются допустимая категория, обоснование и прямая HTTPS-ссылка на клинический материал.');
    const section=String(item.разделИсточника||'').trim(),sourceDisease=String(item.заболевание||'').trim(),sourceAge=String(item.возрастнаяГруппа||'').trim();
    const candidate={source,claim:label,claimReason:reason,section,sourceDisease,sourceAge};
    if(!diagnosis||!/^\d+\s+(?:год|года|лет)$/u.test(String(age))||!section||!sourceDisease||!sourceAge)
      return missing('Уточните возраст на дату визита, диагноз, раздел источника и возрастную группу, для которой дана рекомендация.',{candidate});
    if(norm(sourceDisease)!==norm(diagnosis))return missing('Указанное для источника заболевание отличается от диагноза визита.',{candidate});
    const bounds=citedAgeBounds(item),years=Number.parseInt(age,10);
    if(!bounds)return missing('Уточните числовую возрастную группу, к которой относится рекомендация источника.',{candidate});
    if(years<bounds[0]||years>bounds[1])return missing('Возраст пациента не входит в заявленную возрастную группу источника.',{candidate});
    // Use a clinician/user reading the actual cited section, not the model's claims about its own citation.
    const check=attestations.find(a=>a.index===index&&a.source===source&&a.label===label&&a.diagnosis===diagnosis&&a.age===age&&a.section===section);
    if(check)return {label,reason,source,verifiedBy:check.by,verifiedAt:check.at,candidate};
    return missing('Применимость источника к возрасту, заболеванию и этому препарату требует сверки.',{candidate,canVerify:true});
  });
}
function effectiveReviewItems(r){
  return r?.kind==='provider'||r?.kind==='manual'?readAnswerItems(r.answer,r.payload,r.sourceChecks):r?.items||[];
}
function reviewItemHTML(r,item,index){
  const med=r.payload.назначения[index],candidate=item.candidate;
  const subject=esc([med.название,med.дозировка].filter(Boolean).join(' · '));
  const link=item.source||candidate?.source;
  const details=candidate?'<small>'+esc([candidate.section,candidate.sourceDisease,candidate.sourceAge].filter(Boolean).join(' · '))+'</small>':'';
  const verified=item.verifiedAt?'<p class="hint">Применимость сверил(а) '+esc(item.verifiedBy)+' · '+esc(stamp(item.verifiedAt))+'</p>':'';
  const check=!readOnly&&item.canVerify?'<details><summary>Сверить применимость источника</summary><form class="edit-form evidence-check" data-index="'+index+'">'+
    '<p>'+esc(r.payload.эпизод)+' · '+esc(r.payload.пациент['Возраст на дату визита'])+' · '+subject+'</p><p>Предложенная категория: '+esc(candidate.claim)+'</p><p>'+esc(candidate.claimReason)+'</p>'+
    '<label><input type="checkbox" required> Я прочитал(а) раздел источника. Он относится к заболеванию, возрасту и конкретному назначению и подтверждает указанную категорию.</label>'+
    '<button class="button secondary">Сохранить сверку</button><p role="status"></p></form></details>':'';
  return '<div class="assessment"><strong>'+subject+'</strong><p class="rating">'+esc(item.label)+'</p><p>'+esc(item.reason)+'</p>'+
    (link?external(link,'Открыть указанный источник'):'')+details+verified+check+'</div>';
}
function bindEvidenceChecks(r){
  for(const f of document.querySelectorAll('.evidence-check'))f.onsubmit=e=>{
    e.preventDefault();if(readOnly||!current().reviews.includes(r)||!f.checkValidity())return;
    const index=Number(f.dataset.index),item=effectiveReviewItems(r)[index];if(!item?.canVerify)return;
    const old=r.sourceChecks||[],c=item.candidate;
    r.sourceChecks=[...old.filter(a=>a.index!==index),{index,source:c.source,label:c.claim,section:c.section,diagnosis:r.payload.эпизод,age:r.payload.пациент['Возраст на дату визита'],by:viewerPerson.name,at:new Date().toISOString()}];
    if(!saveState()){r.sourceChecks=old;f.querySelector('[role=status]').textContent='Не удалось сохранить сверку.';return}
    render();showReview(r.id);
  };
}
