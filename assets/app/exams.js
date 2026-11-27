'use strict';

function examTitle(e){return [e.method,e.region].filter(Boolean).join(' · ')}
function examClinicalData(e){
  const clean=value=>anonymizeClinicalText(value,[e.doctor,e.clinic]);
  return {дата:e.date,вид:clean(e.method),область:clean(e.region),описание:clean(e.description),заключение:clean(e.conclusion),
    параметры:e.parameters.map(p=>({название:clean(p.name),значение:clean(p.value),единица:clean(p.unit)}))};
}
function examSearchRow(e){
  return {type:'exam',id:e.id,title:examTitle(e),meta:[preventionDate(e.date),e.clinic].filter(Boolean).join(' · '),
    terms:[e.date,e.doctor,e.description,e.conclusion,...e.parameters.flatMap(p=>[p.name,p.value,p.unit])].join(' '),icon:'book'};
}
function examListing(exams,query=''){
  const rows=exams.slice().sort((a,b)=>b.date.localeCompare(a.date)).map(e=>{
    const row=examSearchRow(e);row.terms+=' '+tagLabels('exam',e.id);return row;
  });
  return filterRows(rows,query).map(r=>resultRow('exam',r.id,r.title,r.meta,r.icon)).join('');
}
function showExam(id){
  const e=current().exams.find(row=>row.id===id);if(!e)return;
  const originals=allFiles().filter(f=>e.attachments.some(a=>a.id===f.id)),visit=visitById(e.visit);
  openPanel('Результаты обследований',examTitle(e),`<p class="detail-meta">${esc([preventionDate(e.date),e.clinic,e.doctor].filter(Boolean).join(' · '))}</p>
    ${tagStrip('exam',id)}${visit?resultRow('visit',e.visit,visit[2],preventionDate(visit[1]),'calendar'):''}
    ${e.parameters.length?'<section class="panel-section"><h3>Параметры</h3><dl class="field-list">'+e.parameters.map(p=>'<div class="field-line"><dt>'+esc(p.name)+'</dt><dd>'+esc([p.value,p.unit].filter(Boolean).join(' '))+'</dd></div>').join('')+'</dl></section>':''}
    ${e.description?'<h3>Описание</h3><p class="exam-text">'+esc(e.description)+'</p>':''}
    <h3>Заключение врача</h3><p class="exam-text">${esc(e.conclusion||'Заключение пока не добавлено.')}</p>
    ${originals.length?'<h3>Протокол и снимки</h3>'+originals.map(f=>resultRow('file',f.id,f.name,f.category,'clip')).join(''):''}
    ${readOnly?'':'<div class="actions">'+act('editExam','Редактировать',id,'button secondary','edit')+act('consult','Обсудить с ИИ','exam:'+id,'button secondary','spark')+'</div>'}${deletionButton('exams',id,'Удалить обследование')}`);
}
function examParameter(p={}){
  return `<fieldset class="rx-inputs exam-parameter" data-id="${esc(p.id||uid())}"><legend>Параметр</legend>
    <label>Название<input name="paramName" required value="${esc(p.name)}"></label>
    <div class="exam-reading"><label>Значение<input name="paramValue" required value="${esc(p.value)}"></label>
    <label>Единица<input name="paramUnit" value="${esc(p.unit)}"></label></div><button type="button" class="text-button" data-drop>Убрать параметр</button></fieldset>`;
}
const examExample='Протокол УЗИ\nОбласть исследования: Щитовидная железа\nДата исследования: 12.11.2026\nПараметры:\nПравая доля: 42 × 15 × 14 мм\nЛевая доля: 40 × 14 × 13 мм\nЭхоструктура: однородная\nОписание: Контуры ровные.\nЗаключение: Очаговые изменения не описаны.';
function examDraftListing(query=''){
  if(readOnly)return '';
  return (current().examDrafts||[]).filter(d=>norm([examTitle(d.fields),...d.sources.map(s=>s.name),'черновик'].join(' ')).includes(norm(query)))
    .map(d=>resultRow('resumeExam',d.id,examTitle(d.fields)||d.sources[0]?.name||'Обследование','Черновик · продолжить сверку','edit')).join('');
}
function editExam(id,visit='',resume=''){
  if(readOnly)return;
  const profile=current(),draft=profile.examDrafts.find(d=>resume?d.id===resume:id&&d.exam===id);
  if(resume&&!draft)return;
  id=draft?.exam||id;
  const savedExam=id?profile.exams.find(row=>row.id===id):null;
  if(id&&!savedExam)return;
  const e=draft?{...draft.fields,parameters:draft.parameters}:savedExam;
  const draftId=draft?.id||uid(),sourceList=structuredClone(draft?.sources||[]);
  const available=allFiles().filter(f=>['Заключения','Снимки'].includes(f.category)&&!savedExam?.attachments.some(a=>a.id===f.id)&&!sourceList.some(s=>s.id===f.id));
  const customMethod=e?.customMethod||(e?.method&&!examMethods.includes(e.method)?e.method:'');
  const fields=(name,label,type='text')=>`<label>${label}<input name="${name}" type="${type}" ${name==='date'?'required':''} value="${esc(e?.[name])}"></label>`;
  openPanel(person.name,id?'Редактировать обследование':'Новое обследование',`<form id="exam-form" class="edit-form">
    <label>Протокол врача · PDF, фото или TXT<input type="file" name="protocol" accept="application/pdf,image/*,.txt" multiple></label>
    <label>Снимки · фото, PDF или DICOM в ZIP<input type="file" name="images" accept="image/*,application/pdf,.zip" multiple></label>
    <p class="hint">${originalTransferHint()}</p>
    ${available.length?'<details><summary>Выбрать из документов профиля</summary><label>Документ<select name="existing">'+available.map(f=>'<option value="'+esc(f.id)+'">'+esc(f.name+' · '+preventionDate(f.date))+'</option>').join('')+'</select></label><button type="button" class="text-button" data-existing>Приложить выбранный документ</button></details>':''}
    ${!workingFamily&&!id?'<button class="text-button" type="button" data-example>Загрузить учебный протокол УЗИ</button>':''}
    <div data-originals></div><p class="hint" data-status role="status"></p><label>Вид обследования<select required name="method"><option value="">Выберите вид</option>${examMethods.map(m=>'<option '+((customMethod?'Другое':e?.method)===m?'selected':'')+'>'+m+'</option>').join('')}</select></label>
    <label data-custom-method ${customMethod?'':'hidden'}>Название вида обследования<input name="customMethod" value="${esc(customMethod)}" placeholder="Например, эластография"></label>
    ${fields('region','Область исследования')}${fields('date','Дата обследования','date')}${fields('clinic','Клиника')}${fields('doctor','Врач')}
    <label>Связанный визит<select name="visit"><option value="">Без привязки</option>${person.visits.map(v=>'<option value="'+esc(v[0])+'" '+((e?.visit||visit)===v[0]?'selected':'')+'>'+esc(preventionDate(v[1])+' · '+v[2])+'</option>').join('')}</select></label>
    <div data-parameters>${(e?.parameters||[]).map(examParameter).join('')}</div><button class="text-button" data-add type="button">Добавить параметр</button>
    <label>Описание<textarea name="description">${esc(e?.description)}</textarea></label><label>Заключение врача<textarea name="conclusion">${esc(e?.conclusion)}</textarea></label>
    <label class="source-choice" data-review hidden><input type="checkbox" name="reviewed">Я сверил(а) перенесённые сведения с протоколом</label>
    <p data-draft-status class="hint" role="status"></p><p class="error" role="alert"></p><div class="actions"><button type="button" class="button secondary" data-defer>Отложить сверку</button><button class="button primary">Сохранить обследование</button></div></form>`);
  const form=panelBody.querySelector('#exam-form'),params=form.querySelector('[data-parameters]'),status=form.querySelector('[data-status]'),submit=form.querySelector('.primary');
  const originals=form.querySelector('[data-originals]'),error=form.querySelector('.error'),owner=person.id,route=routes.at(-1);
  const active=()=>form.isConnected&&panel.open&&route===routes.at(-1)&&current()===profile&&!readOnly;
  const fieldNames=['method','customMethod','region','date','clinic','doctor','visit','description','conclusion'];
  let position=draft?.position||{},reading=false,saving=false;
  const fieldsNow=()=>Object.fromEntries(fieldNames.map(k=>[k,form.elements[k].value]));
  const listParams=()=>Array.from(params.children,r=>({id:r.dataset.id,name:r.querySelector('[name=paramName]').value.trim(),value:r.querySelector('[name=paramValue]').value.trim(),unit:r.querySelector('[name=paramUnit]').value.trim()}));
  const review=form.elements.reviewed;
  review.required=Boolean(draft?.needsReview);review.checked=Boolean(draft?.reviewed);
  form.querySelector('[data-review]').hidden=!review.required;
  function persist(){
    if(!active()||saving)return false;
    const before=profile.examDrafts;
    const next={id:draftId,exam:id||'',fields:fieldsNow(),parameters:listParams(),sources:structuredClone(sourceList),needsReview:review.required,reviewed:review.checked,position:{...position}};
    profile.examDrafts=before.filter(d=>d.id!==draftId).concat(next);
    if(!saveState()){
      profile.examDrafts=before;
      error.textContent='Не удалось сохранить черновик. Освободите место или обновите доступ к архиву.';return false;
    }
    form.querySelector('[data-draft-status]').textContent='Черновик сохранён на устройстве.';
    return true;
  }
  function rememberFocus(target){
    if(!fieldNames.includes(target.name)&&!['paramName','paramValue','paramUnit','reviewed'].includes(target.name))return;
    position={...position,field:target.name,parameter:target.closest('.exam-parameter')?.dataset.id||''};
  }
  form.oninput=ev=>{if(ev.target.name&&ev.target.type!=='file'){rememberFocus(document.activeElement);persist()}};
  form.addEventListener('focusin',ev=>{rememberFocus(ev.target);if(profile.examDrafts.some(d=>d.id===draftId))persist()});
  form.onchange=ev=>{if(fieldNames.includes(ev.target.name)||ev.target===review)persist()};
  form.elements.method.onchange=()=>{form.querySelector('[data-custom-method]').hidden=form.elements.method.value!=='Другое'};
  form.querySelector('[data-add]').onclick=()=>{params.insertAdjacentHTML('beforeend',examParameter());params.lastElementChild.querySelector('input').focus();persist()};
  params.onclick=ev=>{if(ev.target.closest('[data-drop]')){ev.target.closest('fieldset').remove();persist()}};
  form.querySelector('[data-defer]').onclick=()=>{if(!reading&&persist()){render();panel.close()}};
  async function originalFile(source){
    const meta=profile.files.find(f=>f.id===source.id)||allFiles().find(f=>f.id===source.id);
    const name=meta?.file?meta.file.split('/').at(-1):source.name;
    let blob=await fileBlob(owner+'/'+source.id);
    if(!blob&&meta?.file){const response=await fetch(meta.file);if(response.ok)blob=await response.blob()}
    if(!blob)throw Error('original');
    return new File([blob],name,{type:blob.type||source.type});
  }
  function setBusy(value){
    reading=value;
    for(const input of form.querySelectorAll('input[type=file],[data-example],[data-existing],[data-defer],button.primary,[data-reread]'))input.disabled=value;
  }
  function sourceView(source){
    const detail=document.createElement('details'),heading=document.createElement('summary'),preview=document.createElement('div');
    heading.textContent=source.name;detail.append(heading,preview);originals.append(detail);preview.className='source-preview';
    if(source.text){const pre=document.createElement('pre');pre.className='source-text';pre.textContent=source.text;detail.append(pre)}
    if(source.note){const note=document.createElement('p');note.className='fact-note';note.textContent=source.note;detail.append(note)}
    if(source.protocol&&!source.text){
      const retry=document.createElement('button');retry.type='button';retry.className='text-button';retry.dataset.reread='';retry.textContent='Распознать протокол';
      retry.onclick=async()=>{
        if(reading||!active())return;setBusy(true);
        try{await readSource(source,await originalFile(source))}catch{error.textContent='Оригинал недоступен. Попробуйте ещё раз при подключении к сети.'}finally{setBusy(false)}
      };detail.append(retry);
    }
    detail.addEventListener('change',ev=>{if(ev.target.matches('select')){source.page=Number(ev.target.value);persist()}});
    detail.open=source.open||false;
    detail.ontoggle=async()=>{
      if(!active()||!detail.isConnected)return;
      if(source.open!==detail.open){source.open=detail.open;persist()}
      if(!detail.open||preview.childNodes.length)return;
      if(/\.zip$/i.test(source.name)){preview.textContent='Архив DICOM открывается во внешнем просмотрщике.';return}
      preview.textContent='Открываем оригинал…';
      try{
        const file=await originalFile(source);
        if(!detail.isConnected)return;
        await previewOriginal(file,preview,file,source.page);
      }catch{preview.textContent='Оригинал недоступен. Проверьте связь.'}
    };
  }
  function drawSources(){originals.replaceChildren();sourceList.forEach(sourceView)}
  async function readSource(source,file){
    const issues=[];let text='';
    try{text=await recognizeDocument(file,isPdf(file),msg=>{if(active())status.textContent=msg},issues)}catch{/* Manual review remains available. */}
    if(!active())return;
    source.text=text;
    const parsed=parseExamProtocol(text),questions=[...parsed.questions];
    for(const key of ['method','region','date','clinic','doctor','description','conclusion']){
      if(!parsed[key])continue;
      const field=form.elements[key];
      if(!field.value)field.value=parsed[key];
      else if(field.value!==parsed[key])questions.push(field.labels[0].firstChild.textContent.trim()+' — '+parsed[key]);
    }
    for(const p of parsed.parameters)if(!listParams().some(r=>r.name===p.name&&r.value===p.value&&r.unit===p.unit))params.insertAdjacentHTML('beforeend',examParameter(p));
    questions.push(...issues.map(issue=>issue.text));
    source.note=!text?'Текст не распознан. Заполните сведения вручную.':questions.length?'Требуют сверки: '+questions.join(' · '):'';
    if(source.note)source.open=true;
    review.checked=false;review.required=true;form.querySelector('[data-review]').hidden=false;
    persist();drawSources();
  }
  async function attach(files,protocol,existing=null){
    if(reading||saving||!active())return;
    if(files.some(f=>!f.size||!(isPhoto(f)||isPdf(f)||(protocol?isTextFile(f):/\.zip$/i.test(f.name))))){error.textContent='Выберите непустые файлы в одном из указанных форматов.';return}
    setBusy(true);error.textContent='';
    try{
      const batch=[];
      for(const file of files){
        if(!active())return;
        const digest=existing?.sourceDigest||await sourceDigest(file);
        if(!active())return;
        const linkedIds=new Set([...(savedExam?.attachments||[]),...sourceList].map(s=>s.id));
        if(await matchingOriginal(owner,file,digest,profile.files.filter(f=>linkedIds.has(f.id))))continue;
        if(!id&&!existing&&files.length===1&&!sourceList.length){
          const snapshot=latestProfile();
          const usedIds=new Set(snapshot.exams.flatMap(e=>e.attachments.map(a=>a.id)));
          const used=await matchingOriginal(owner,file,digest,snapshot.files.filter(f=>usedIds.has(f.id)));
          const card=used&&snapshot.exams.find(e=>e.attachments.some(a=>a.id===used.id));
          if(card&&active()){duplicateCard(form,'exam',card.id,'Открыть обследование с этим документом');return}
        }
        if(!active())return;
        const source={id:existing?.id||uid(),name:existing?.name||file.name,type:file.type,protocol,existing:Boolean(existing)};
        if(!existing){
          await fileBlob(owner+'/'+source.id,file);
          if(!active()){await removeBlob(owner+'/'+source.id);return}
          profile.files.push({id:source.id,name:file.name,type:file.type,category:'Черновики обследований',date:todayLocal(),visit:'',examDraft:draftId,sourceDigest:digest});
        }
        sourceList.push(source);
        if(protocol){review.checked=false;review.required=true;form.querySelector('[data-review]').hidden=false}
        if(!persist()){
          sourceList.pop();
          if(!existing){profile.files=profile.files.filter(f=>f.id!==source.id);await removeBlob(owner+'/'+source.id)}return;
        }
        batch.push([source,file]);
      }
      drawSources();
      if(protocol)for(const [source,file] of batch){if(active())await readSource(source,file)}
      if(active())status.textContent=!batch.length?'Эти оригиналы уже приложены.':protocol?'Откройте оригинал и сверьте перенесённые поля. Дополните пропуски вручную.':'Снимки готовы к сохранению.';
    }catch{error.textContent='Не удалось сохранить вложение. Уже сохранённые файлы доступны в черновике.'}
    finally{setBusy(false)}
  }
  for(const name of ['protocol','images']){
    const input=form.elements[name];input.onchange=()=>{const files=Array.from(input.files);input.value='';attach(files,name==='protocol')};
  }
  const link=form.querySelector('[data-existing]');
  if(link)link.onclick=async()=>{
    const item=available.find(f=>f.id===form.elements.existing.value);
    if(!item||sourceList.some(s=>s.id===item.id)||reading||saving)return;
    setBusy(true);
    try{
      const file=await originalFile(item);setBusy(false);await attach([file],item.category==='Заключения',item);
      if(sourceList.some(s=>s.id===item.id))form.elements.existing.selectedOptions[0]?.remove();
    }catch{error.textContent='Оригинал недоступен. Проверьте связь или выберите файл на устройстве.'}
    finally{setBusy(false);link.disabled=!form.elements.existing.options.length}
  };
  const example=form.querySelector('[data-example]');
  if(example)example.onclick=()=>attach([new File([examExample],'Учебный протокол УЗИ.txt',{type:'text/plain'})],true);
  drawSources();
  if(position.field){
    const target=Array.from(form.elements).find(el=>el.name===position.field&&(!position.parameter||el.closest('.exam-parameter')?.dataset.id===position.parameter));
    target?.focus();
  }
  form.onsubmit=ev=>{
    ev.preventDefault();
    if(!active()||reading||saving||!form.reportValidity())return;
    const parameters=listParams();
    if(parameters.some(p=>!p.name||!p.value)){error.textContent='Введите название и значение каждого параметра.';return}
    const values=fieldsNow();if(values.method==='Другое'&&values.customMethod.trim())values.method=values.customMethod.trim();delete values.customMethod;
    if(!values.description.trim()&&!values.conclusion.trim()&&!parameters.length&&!sourceList.length&&!savedExam?.attachments.length){error.textContent='Добавьте снимок, протокол, параметр или текст результата.';return}
    const key=examIdentity({...values,parameters});
    const snapshot=latestProfile(),focusId=id||draftId;
    const sourceFiles=new Map([...profile.files,...snapshot.files].map(f=>[f.id,f]));
    const sourceKey=s=>sourceFiles.get(s.id)?.sourceDigest||s.id;
    const sourcesNow=[...(savedExam?.attachments||[]),...sourceList];
    const sourceKeys=JSON.stringify(sourcesNow.map(sourceKey).sort());
    const uploaded=sourceList.every(s=>!s.existing);
    const used=snapshot.exams.find(other=>{
      if(other.id===focusId)return false;
      const sameSources=sourceKeys===JSON.stringify(other.attachments.map(sourceKey).sort());
      if(sourcesNow.length&&sameSources&&uploaded)return true;
      return key&&key===examIdentity(other)&&(!sourcesNow.length||!other.attachments.length||sameSources);
    });
    if(used&&(!savedExam||key!==examIdentity(savedExam)||sourceList.length))return duplicateCard(form,'exam',used.id,'Открыть существующее обследование');
    saving=true;submit.disabled=true;
    const before={files:profile.files,exams:profile.exams,examDrafts:profile.examDrafts};
    const exam={...values,id:id||draftId,parameters,attachments:[...(savedExam?.attachments||[]),...sourceList.map(s=>({id:s.id}))]};
    profile.files=profile.files.map(f=>{
      if(f.examDraft===draftId){
        const source=sourceList.find(s=>s.id===f.id);
        if(source){const promoted={...f,examId:exam.id,date:values.date,visit:values.visit,category:source.protocol?'Заключения':'Снимки'};delete promoted.examDraft;return promoted}
      }
      return f.examId===exam.id?{...f,date:values.date,visit:values.visit}:f;
    });
    profile.exams=profile.exams.filter(r=>r.id!==exam.id).concat(exam);
    profile.examDrafts=profile.examDrafts.filter(d=>d.id!==draftId);
    if(!saveState()){Object.assign(profile,before);saving=false;submit.disabled=false;error.textContent='Не удалось подтвердить обследование. Черновик доступен для повтора.';return}
    render();if(routes.at(-2)?.name==='exam'&&routes.at(-2).id===exam.id)goBack();else replaceRoute('exam',exam.id);
  };
}
