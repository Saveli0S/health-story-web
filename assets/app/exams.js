'use strict';

const examMethods=['УЗИ','Рентгенография','Флюорография','КТ','МРТ','ЭКГ','Эндоскопия','Другое'];
const examMethodPatterns=[
  /УЗИ|ультразвуков/iu,/рентген/iu,/флюорограф/iu,/(?:^|[^а-яё])КТ(?:$|[^а-яё])|компьютерн[а-яё]* томограф/iu,
  /МРТ|магнитно-резонанс/iu,/ЭКГ|электрокардиогра/iu,/эндоскоп|гастроскоп|колоноскоп/iu
];
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
function parseExamProtocol(text){
  const dates=new Set(),result={parameters:[],questions:[]},lines=text.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  const header=lines.filter(s=>!/^заключение|^рекомендации/iu.test(s)).slice(0,6).join('\n');
  const method=examMethodPatterns.findIndex(re=>re.test(header));
  if(method>=0)result.method=examMethods[method];
  let section='';
  for(const line of lines){
    const pair=line.match(/^([^:]{1,90})\s*:\s*(.*)$/u);
    if(/^(?:страница\s+\d+|\d+\s+из\s+\d+|синтетические данные|дата печати|подпись врача|протокол подписан|приложение к протоколу)/iu.test(line)){section='';continue}
    const label=pair?.[1].trim()||'',value=pair?.[2].trim()||'';
    if(/^дата(?:\s+(?:исследования|проведения|обследования|выполнения))?$/iu.test(label)){
      const iso=value.match(/^(\d{4}-\d{2}-\d{2})(?:\s|$)/u),local=value.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})(?:\s|$)/u);
      const date=iso?.[1]||(local&&[local[3],local[2].padStart(2,'0'),local[1].padStart(2,'0')].join('-'));
      if(date&&Number.isFinite(Date.parse(date))&&new Date(date).toISOString().slice(0,10)===date)dates.add(date);
      section='';continue;
    }
    const metadata=[['region',/^(?:область(?: исследования)?|зона исследования|орган)$/iu],['doctor',/^(?:врач(?:-диагност)?|специалист)$/iu],['clinic',/^(?:клиника|учреждение)$/iu]].find(([,re])=>re.test(label));
    if(metadata){result[metadata[0]]=value;section='';continue}
    if(/^(?:заключение|описание|параметры|измерения)\s*(?::|$)/iu.test(line)){
      const name=line.split(':')[0].trim().toLowerCase();
      section=name==='заключение'?'conclusion':name==='описание'?'description':'parameters';
      if(value&&section!=='parameters')result[section]=[result[section],value].filter(Boolean).join('\n');
      continue;
    }
    if(/^(?:пациент|фио|дата рождения|подпись|рекомендации)\s*:/iu.test(line)){section='';continue}
    const measure=line.match(/^(.{2,80}?)(?:\s*:\s*|\s+[–—-]\s+|\s+)([<>≤≥≈]?\s*\d+(?:[,.]\d+)?(?:\s*[×xх–-]\s*\d+(?:[,.]\d+)?)*)(?:\s*)(мм рт\.\s*ст\.?|мм|см|мл|мс|м\/с|см\/с|Гц|%|град(?:усов)?|°)\s*[.;]?$/iu);
    const descriptive=/^(?:контур|структур|эхоструктур|эхогенност|локализаци|положени|форм[аы]|подвижност|проходимост|васкуляризаци|кровоток|плотност|фракция выброса)/iu.test(label);
    if(section!=='conclusion'&&(measure||((section==='parameters'||descriptive)&&label&&value))){
      const [name,reading,unit]=measure?measure.slice(1):[label,value,''];
      result.parameters.push({name:name.trim(),value:reading.trim(),unit:unit.trim()});continue;
    }
    if(section==='description'||section==='conclusion')result[section]=[result[section],line].filter(Boolean).join('\n');
  }
  if(dates.size===1)result.date=[...dates][0];
  if(dates.size>1)result.questions.push('В протоколе несколько дат обследования. Уточните дату: '+[...dates].join(', ')+'.');
  return result;
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
    ${readOnly?'':'<div class="actions">'+act('editExam','Редактировать',id,'button secondary','edit')+act('consult','Обсудить с ИИ','exam:'+id,'button secondary','spark')+'</div>'}`);
}
function examParameter(p={}){
  return `<fieldset class="rx-inputs exam-parameter" data-id="${esc(p.id||uid())}"><legend>Параметр</legend>
    <label>Название<input name="paramName" required value="${esc(p.name)}"></label>
    <div class="exam-reading"><label>Значение<input name="paramValue" required value="${esc(p.value)}"></label>
    <label>Единица<input name="paramUnit" value="${esc(p.unit)}"></label></div><button type="button" class="text-button" data-drop>Убрать параметр</button></fieldset>`;
}
const examExample='Протокол УЗИ\nОбласть исследования: Щитовидная железа\nДата исследования: 12.11.2026\nПараметры:\nПравая доля: 42 × 15 × 14 мм\nЛевая доля: 40 × 14 × 13 мм\nЭхоструктура: однородная\nОписание: Контуры ровные.\nЗаключение: Очаговые изменения не описаны.';
function editExam(id,visit=''){
  if(readOnly)return;
  const profile=current(),e=id?profile.exams.find(row=>row.id===id):null;
  if(id&&!e)return;
  const available=allFiles().filter(f=>['Заключения','Снимки'].includes(f.category)&&!e?.attachments.some(a=>a.id===f.id));
  const customMethod=e&&!examMethods.includes(e.method)?e.method:'';
  const fields=(name,label,type='text')=>`<label>${label}<input name="${name}" type="${type}" ${name==='date'?'required':''} value="${esc(e?.[name])}"></label>`;
  openPanel(person.name,id?'Редактировать обследование':'Новое обследование',`<form id="exam-form" class="edit-form">
    <label>Протокол врача · PDF, фото или TXT<input type="file" name="protocol" accept="application/pdf,image/*,.txt" multiple></label>
    <label>Снимки · фото, PDF или DICOM в ZIP<input type="file" name="images" accept="image/*,application/pdf,.zip" multiple></label>
    ${available.length?'<details><summary>Выбрать из документов профиля</summary><label>Документ<select name="existing">'+available.map(f=>'<option value="'+esc(f.id)+'">'+esc(f.name+' · '+preventionDate(f.date))+'</option>').join('')+'</select></label><button type="button" class="text-button" data-existing>Приложить выбранный документ</button></details>':''}
    ${!workingFamily&&!id?'<button class="text-button" type="button" data-example>Загрузить учебный протокол УЗИ</button>':''}
    <div data-originals></div><p class="hint" data-status role="status"></p><label>Вид обследования<select required name="method"><option value="">Выберите вид</option>${examMethods.map(m=>'<option '+((customMethod?'Другое':e?.method)===m?'selected':'')+'>'+m+'</option>').join('')}</select></label>
    <label data-custom-method ${customMethod?'':'hidden'}>Название вида обследования<input name="customMethod" value="${esc(customMethod)}" placeholder="Например, эластография"></label>
    ${fields('region','Область исследования')}${fields('date','Дата обследования','date')}${fields('clinic','Клиника')}${fields('doctor','Врач')}
    <label>Связанный визит<select name="visit"><option value="">Без привязки</option>${person.visits.map(v=>'<option value="'+esc(v[0])+'" '+((e?.visit||visit)===v[0]?'selected':'')+'>'+esc(preventionDate(v[1])+' · '+v[2])+'</option>').join('')}</select></label>
    <div data-parameters>${(e?.parameters||[]).map(examParameter).join('')}</div><button class="text-button" data-add type="button">Добавить параметр</button>
    <label>Описание<textarea name="description">${esc(e?.description)}</textarea></label><label>Заключение врача<textarea name="conclusion">${esc(e?.conclusion)}</textarea></label>
    <label class="source-choice" data-review hidden><input type="checkbox" name="reviewed">Я сверил(а) перенесённые сведения с протоколом</label>
    <p class="error" role="alert"></p><button class="button primary">Сохранить обследование</button></form>`);
  const form=panelBody.querySelector('#exam-form'),params=form.querySelector('[data-parameters]'),status=form.querySelector('[data-status]'),submit=form.querySelector('.primary');
  const originals=form.querySelector('[data-originals]'),error=form.querySelector('.error'),pending=[],owner=person.id,route=routes.at(-1);
  const active=()=>form.isConnected&&panel.open&&route===routes.at(-1)&&current()===profile&&!readOnly;
  form.elements.method.onchange=()=>{form.querySelector('[data-custom-method]').hidden=form.elements.method.value!=='Другое'};
  const listParams=()=>Array.from(params.children,r=>({id:r.dataset.id,name:r.querySelector('[name=paramName]').value.trim(),value:r.querySelector('[name=paramValue]').value.trim(),unit:r.querySelector('[name=paramUnit]').value.trim()}));
  form.querySelector('[data-add]').onclick=()=>{params.insertAdjacentHTML('beforeend',examParameter());params.lastElementChild.querySelector('input').focus()};
  params.onclick=ev=>{if(ev.target.closest('[data-drop]'))ev.target.closest('fieldset').remove()};
  let reading=false,saving=false,loadingOriginal=false;
  async function attach(files,protocol,existing=null){
    if(reading||saving||loadingOriginal||!active())return;
    if(files.some(f=>!f.size||!(isPhoto(f)||isPdf(f)||(protocol?isTextFile(f):/\.zip$/i.test(f.name))))){
      error.textContent='Выберите непустые файлы в одном из указанных форматов.';return;
    }
    reading=true;error.textContent='';submit.disabled=true;
    const inputs=form.querySelectorAll('input[type=file],[data-example],[data-existing]');inputs.forEach(i=>i.disabled=true);
    try{
      for(const file of files){
        if(!active())return;
        const row=existing||{id:uid(),name:file.name,type:file.type,category:protocol?'Заключения':'Снимки'};
        pending.push({file,row,existing:Boolean(existing)});
        const original=document.createElement('details'),summary=document.createElement('summary'),preview=document.createElement('div');
        summary.textContent=file.name;original.append(summary,preview);originals.append(original);preview.className='source-preview';
        original.ontoggle=()=>{if(original.open&&!preview.childNodes.length){
          if(/\.zip$/i.test(file.name))preview.textContent='Архив DICOM открывается во внешнем просмотрщике.';
          else previewOriginal(file,preview,file);
        }};
        if(!protocol)continue;
        const issues=[];
        let text='';
        try{text=await recognizeDocument(file,isPdf(file),s=>status.textContent=s,issues)}catch{/* The original remains available for manual entry. */}
        if(!active())return;
        if(!text){original.append(document.createTextNode('Текст не распознан. Заполните сведения вручную.'));original.open=true;continue}
        const transcript=document.createElement('pre');transcript.className='source-text';transcript.textContent=text;original.append(transcript);
        const parsed=parseExamProtocol(text);
        const differences=[...parsed.questions];
        for(const key of ['method','region','date','clinic','doctor','description','conclusion']){
          if(!parsed[key])continue;
          const field=form.elements[key];
          if(!field.value)field.value=parsed[key];
          else if(field.value!==parsed[key])differences.push(field.labels[0].firstChild.textContent.trim()+' — '+parsed[key]);
        }
        if(differences.length){
          const note=document.createElement('p');note.className='fact-note';note.textContent='Сверьте отличающиеся сведения из этого протокола: '+differences.join(' · ');
          original.append(note);original.open=true;
        }
        const equal=(a,b)=>a.name===b.name&&a.value===b.value&&a.unit===b.unit;
        for(const p of parsed.parameters)if(!listParams().some(r=>equal(r,p)))params.insertAdjacentHTML('beforeend',examParameter(p));
        if(issues.length){const note=document.createElement('p');note.className='fact-note';note.textContent='Требуют сверки: '+issues.map(i=>i.text).join(' · ');original.append(note);original.open=true}
        form.querySelector('[data-review]').hidden=false;form.elements.reviewed.checked=false;form.elements.reviewed.required=true;
      }
      if(active())status.textContent=protocol?'Откройте оригинал и сверьте перенесённые поля. Дополните пропуски вручную.':'Снимки готовы к сохранению.';
    }finally{reading=false;inputs.forEach(i=>i.disabled=false);submit.disabled=false}
  }
  for(const name of ['protocol','images']){
    const input=form.elements[name];input.onchange=()=>{const files=Array.from(input.files);input.value='';attach(files,name==='protocol')};
  }
  const link=form.querySelector('[data-existing]');
  if(link)link.onclick=async()=>{
    const item=available.find(f=>f.id===form.elements.existing.value);
    if(!item||pending.some(p=>p.row.id===item.id)||reading||saving)return;
    link.disabled=true;submit.disabled=true;loadingOriginal=true;
    try{
      const local=await fileBlob(owner+'/'+item.id);
      let blob=local;
      if(!blob&&item.file){const response=await fetch(item.file);if(response.ok)blob=await response.blob()}
      if(!blob)throw Error();
      const name=item.file?item.file.split('/').at(-1):item.name;
      loadingOriginal=false;
      await attach([new File([blob],name,{type:blob.type||item.type})],item.category==='Заключения',item);
      const option=Array.from(form.elements.existing.options).find(o=>o.value===item.id);
      if(pending.some(p=>p.row.id===item.id)&&option)option.remove();
    }catch{error.textContent='Оригинал недоступен. Проверьте связь или выберите файл на устройстве.'}
    finally{loadingOriginal=false;submit.disabled=reading||saving;link.disabled=!form.elements.existing.options.length}
  };
  const example=form.querySelector('[data-example]');
  if(example)example.onclick=()=>attach([new File([examExample],'Учебный протокол УЗИ.txt',{type:'text/plain'})],true);
  form.onsubmit=async ev=>{
    ev.preventDefault();
    if(!active()||reading||loadingOriginal||saving||!form.reportValidity())return;
    const parameters=listParams();
    if(parameters.some(p=>!p.name||!p.value)){error.textContent='Введите название и значение каждого параметра.';return}
    const values=Object.fromEntries(['method','region','date','clinic','doctor','visit','description','conclusion'].map(k=>[k,form.elements[k].value.trim()]));
    if(values.method==='Другое'&&form.elements.customMethod.value.trim())values.method=form.elements.customMethod.value.trim();
    if(!values.description&&!values.conclusion&&!parameters.length&&!pending.length&&!e?.attachments.length){error.textContent='Добавьте снимок, протокол, параметр или текст результата.';return}
    const added=[],originalFiles=profile.files,previousExams=profile.exams;
    const exam={...values,id:e?.id||uid(),parameters,attachments:[...(e?.attachments||[]),...pending.map(({row})=>({id:row.id}))]};
    saving=true;submit.disabled=true;error.textContent='';
    try{
      for(const {file,row} of pending.filter(p=>!p.existing)){await fileBlob(owner+'/'+row.id,file);added.push(row.id)}
      if(!active())throw Error();
      profile.files=profile.files.map(f=>f.examId===exam.id?{...f,date:values.date,visit:values.visit}:f)
        .concat(pending.filter(p=>!p.existing).map(({row})=>({...row,examId:exam.id,date:values.date,visit:values.visit})));
      profile.exams=e?profile.exams.map(r=>r.id===id?exam:r):profile.exams.concat(exam);
      if(!saveState()){profile.files=originalFiles;profile.exams=previousExams;throw Error()}
    }catch{
      await Promise.allSettled(added.map(fileId=>removeBlob(owner+'/'+fileId)));
      error.textContent='Не удалось сохранить обследование. Проверьте свободное место и повторите попытку.';saving=false;submit.disabled=false;return;
    }
    render();if(routes.at(-2)?.name==='exam'&&routes.at(-2).id===exam.id)goBack();else replaceRoute('exam',exam.id);
  };
}
