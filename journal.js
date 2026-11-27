'use strict';

const sectionNames={overview:'Обзор',visits:'История',labs:'Анализы',exams:'Результаты обследований',files:'Документы',consults:'ИИ-консультация',settings:'Настройки'};
const groups={visit:'Визиты',lab:'Анализы',exam:'Обследования',file:'Вложения',med:'Препараты',note:'Пометки',prevent:'Профилактика'};
function resultRow(action,id,title,meta,mark='folder'){
  return `<button class="result-row" data-action="${action}" data-id="${esc(id)}">${icon(mark)}<span><strong>${esc(title)}</strong><small>${esc(meta)}</small></span>${icon('right',true)}</button>`;
}
function searchIndex(){
  const rows=person.visits.map(v=>({type:'visit',id:v[0],title:v[2],meta:dateLabel(v[1])+' · '+doctorLabel(v[3]),terms:v[4]+' '+v[5]+' '+v[1],icon:'calendar'}));
  for(const l of labs()){const report=reportInfo(l);rows.push({type:'lab',id:l.id,title:report.name,meta:[labCategory(l.id),dateLabel(report.date),report.laboratory].filter(Boolean).join(' · '),terms:report.rows.map(r=>r.name).join(' ')+' '+report.date,icon:'lab'})}
  for(const exam of current().exams)rows.push(examSearchRow(exam));
  for(const f of allFiles()) rows.push({type:'file',id:f.id,title:f.name,meta:f.category+' · '+dateLabel(f.date)+(f.syncLocalOnly?' · Оригинал на устройстве добавления':''),terms:[f.file,f.type,f.date].join(' '),icon:'clip'});
  for(const c of allCourses())for(const m of c.meds)rows.push({type:'med',id:c.visit,title:m.name,meta:[m.strength,m.form].filter(Boolean).join(' · '),terms:m.instructions,icon:'pill'});
  for(const n of current().notes)rows.push({type:'note',id:n.visit,title:n.text,meta:n.author+' · '+stamp(n.time),terms:'',icon:'book'});
  for(const row of rows){
    if(['visit','lab','file','exam'].includes(row.type)){
      const kind=row.type==='file'&&allFiles().some(f=>f.id===row.id&&f.category==='Лаборатория')?'lab':row.type;
      row.terms+=' '+tagLabels(kind,row.id);
    }
  }
  return rows.concat(preventionRows());
}
function norm(q){return q.toLocaleLowerCase('ru').replaceAll('ё','е').trim()}
function filterRows(rows,q){const words=norm(q).replace(/(^|\s)#/g,'$1').split(/\s+/);return rows.filter(r=>words.every(w=>norm([r.title,r.meta,r.terms].join(' ')).includes(w)))}
function searchResults(query, scope) {
  const rows=filterRows(searchIndex(),query).filter(r=>scope==='any'||r.type===scope);
  return rows.length?Object.entries(groups).map(([type,title])=>{
    const group=rows.filter(r=>r.type===type);if(!group.length)return '';
    return '<section class="search-group"><h3>'+title+'</h3>'+group.map(r=>resultRow(['med','note'].includes(type)?'visit':type,r.id,r.title,r.meta,r.icon)).join('')+'</section>';
  }).join(''):'<p class="fact-note">Совпадений нет. Попробуйте название, фамилию врача или другую дату.</p>';
}
function showSearch(scope='any'){
  const s=routes.at(-1);s.query??='';s.filter??=scope;
  openPanel(person.name,'Поиск по профилю',`<div class="profile-search"><div class="search-tools"><label class="searchbox">${icon('search')}<input type="search" id="global-search" placeholder="Врач, показатель, препарат…" aria-label="Поиск по профилю" value="${esc(s.query)}"></label>
    <div class="search-kind"><select id="search-kind" aria-label="Тип записи">${Object.entries({any:'Все разделы',...groups}).map(([k,v])=>'<option value="'+k+'" '+(k===s.filter?'selected':'')+'>'+v+'</option>').join('')}</select>${icon('down',true)}</div></div>
    <div id="hits">${searchResults(s.query,s.filter)}</div></div>`);document.querySelector('#global-search').focus({preventScroll:true});
}
function filterSearch(){
  const s=routes.at(-1),hits=document.querySelector('#hits');
  s.query=document.querySelector('#global-search').value;s.filter=document.querySelector('#search-kind').value;
  hits.innerHTML=searchResults(s.query,s.filter);hits.scrollTop=0;
}
function medicalFieldValue(f) {
  return ['birthday','measured'].includes(f.id) && /^\d{4}-\d\d-\d\d$/.test(f.value)?dateLabel(f.value,{day:'numeric',month:'long',year:'numeric'}):f.value;
}
function showMedical(){
  openPanel('Медкарта',person.name,`<div class="field-list">${current().fields.map(f=>`<div class="field-line"><div><small>${esc(f.label)}</small><strong>${esc(medicalFieldValue(f))}</strong></div>
    ${readOnly?'':act('field','Изменить',f.id,'inline-action','edit')}</div>`).join('')}</div>
    ${readOnly?'':act('field','Добавить поле','','button secondary','plus')+act('manageRecords','Управление данными','','button secondary')}
    <section class="panel-section"><div class="section-head"><h3>Прививки и профилактика</h3>${readOnly?'':act('editPrevent','Добавить запись','','text-button','plus')}</div>${preventionListing()}</section>
    <div class="panel-section"><h3>Текущее лечение</h3>${allCourses().filter(c=>c.meds.some(isActiveMed)).map(c=>act('visit',c.meds.filter(isActiveMed).map(m=>m.name).join(', '),c.visit,'text-button')).join('')||'<p>Активных курсов нет.</p>'}</div>`);
}
function showField(id){
  const f=current().fields.find(f=>f.id===id),isDate=['birthday','measured'].includes(id);
  openPanel('Медкарта',f?'Изменить поле':'Новое поле',`<form id="field-form" class="edit-form" data-id="${esc(id)}">
    <label>Название поля<input required name="label" maxlength="64" value="${esc(f?.label)}" placeholder="Например, группа крови"></label>
    <label>Значение<input required name="value" type="${isDate?'date':'text'}" ${isDate?'max="'+todayLocal()+'"':''} maxlength="280" value="${esc(f?.value)}"></label>
    <p class="error" role="alert"></p><div class="actions">${f?act('removeField','Удалить поле',id,'button danger'):''}<button class="button primary">Сохранить поле</button></div></form>`);
}
function availableFieldSpec(label){
  return fieldSpecs.find(([key,name])=>norm(name)===norm(label)&&!current().fields.some(f=>f.id===key));
}
registerFieldRules('field-form',(form,add)=>{
  const label=form.elements.label.value.trim(),id=form.dataset.id;
  if(label&&current().fields.some(f=>f.id!==id&&norm(f.label)===norm(label)))add('label','Поле с таким названием уже есть.');
  if(current().fields.some(f=>f.id===id)||!['birthday','measured'].includes(availableFieldSpec(label)?.[0]))return;
  const value=form.elements.value.value.trim(),parsed=new Date(value+'T12:00:00Z');
  if(!/^\d{4}-\d\d-\d\d$/.test(value)||Number.isNaN(parsed.getTime())||parsed.toISOString().slice(0,10)!==value||value>todayLocal())
    add('value','Введите действительную дату в формате ГГГГ-ММ-ДД, не позже сегодняшней.');
});
function saveField(form){
  const data=new FormData(form), label=data.get('label').trim(), value=data.get('value').trim(), id=form.dataset.id;
  const f=current().fields.find(f=>f.id===id);
  if(f)Object.assign(f,{label,value});else {
    const standard=availableFieldSpec(label);
    current().fields.push({id:standard?.[0]||uid(),label,value});
  }
  saveState();render();goBack();
}
function showDelete(id){
  const f=current().fields.find(f=>f.id===id);
  openPanel('Медкарта','Удалить поле?',`<p class="dialog-sub">${esc(f.label)} · ${esc(medicalFieldValue(f))}</p><div class="actions">${act('back','Оставить','','button secondary')}${act('confirmDelete','Удалить поле',id,'button danger')}</div>`);
}
let fileURL;
function clearFileURL(){if(fileURL){URL.revokeObjectURL(fileURL);fileURL=''}}
async function showFile(id){
  const f=allFiles().find(f=>f.id===id);if(!f)return;
  const route=routes.at(-1);let url=f.file,blob;
  if(current().sampleAliases[id])url='';
  if(!url){
    openPanel('Вложение',f.name,deviceSync.thumb(f)+'<p>Открываем оригинал…</p>');
    try{
      blob=await fileBlob(person.id+'/'+id);if(route!==routes.at(-1)||!panel.open)return;
      if(!blob)throw Error();
      url=URL.createObjectURL(blob);fileURL=url;
    }catch{if(route===routes.at(-1))openPanel('Вложение',f.name,deviceSync.thumb(f)+(f.syncLocalOnly?'<p>Оригинал превышает предел обмена 128 МиБ. Откройте его на устройстве добавления или восстановите полную локальную копию.</p>':'<p>Оригинал сейчас недоступен. Проверьте связь или откройте предварительно сохранённую копию.</p>'));return}
  }
  const ext=(f.file||f.name).split('.').at(-1).toUpperCase(),pdf=isPdf(f)||ext==='PDF',photo=isPhoto(f)||/\.(png|jpe?g|webp)$/i.test(f.file||'');
  const area=photo||pdf||isTextFile(f)?'<div id="file-paper" class="source-preview"></div>':
    '<p class="hint">Этот формат можно открыть во внешнем просмотрщике.</p>';
  openPanel('Вложение · '+f.category,f.name,`<p class="dialog-sub">${dateLabel(f.date)} · ${esc(ext)}</p>
    ${tagStrip(f.category==='Лаборатория'?'lab':'file',id)}${area}
    <div class="actions">${f.visit?act('visit','К визиту',f.visit,'button secondary'):''}${pdf?external(url,'Открыть PDF','button secondary'):''}<a class="button primary" download="${esc(f.name)}" href="${esc(url)}">Скачать оригинал</a></div>${documentLinks(f)}${!readOnly&&f.category==='Лаборатория'&&!f.file?act('verifyLab','Сверить результаты',f.id,'button secondary'):''}${!readOnly&&f.intake&&!jobs.has(id)?act('verifyFile','Сверить документ',id,'button secondary'):''}${deletionButton('files',id,'Удалить документ')}`);
  const paper=document.querySelector('#file-paper');
  if(paper){
    try{const source=blob||(await fetch(url)).blob();await previewOriginal(f,paper,await source)}
    catch{if(paper.isConnected)paper.textContent='Не удалось открыть предпросмотр.'}
  }
}
const uploadKinds=['Заключения','Лаборатория','Назначения','Рекомендации','Снимки','Другое'];
function uploadKindOptions(selected){return uploadKinds.map(k=>'<option '+(k===selected?'selected':'')+'>'+k+'</option>').join('')}
function originalTransferHint(){return 'Файлы больше 128 МиБ сохраняются на устройстве добавления. В облачный обмен входит только их карточка.'}
function selectUpload(visit){
  const labEntry=visit==='lab',recEntry=visit.startsWith('rec:'),rxEntry=visit.startsWith('rx:');
  if(recEntry||rxEntry)visit=visit.slice(visit.indexOf(':')+1);
  openPanel(person.name,recEntry?'Загрузить рекомендации врача':'Прикрепить файлы',`<form id="upload-form" class="edit-form"><p class="dialog-sub">Выберите один или несколько файлов. Оригиналы сохраняются в этом браузере.</p>
    <label>Визит<select name="visit">${labEntry?'<option value="">Без визита</option>':''}${person.visits.map(v=>'<option value="'+esc(v[0])+'" '+(v[0]===visit?'selected':'')+'>'+esc(v[2])+' · '+dateLabel(v[1])+'</option>').join('')}</select></label>
    <label>Категория<select name="category">${uploadKindOptions(labEntry?'Лаборатория':recEntry?'Рекомендации':rxEntry?'Назначения':'Заключения')}</select></label>
    <label>Файлы<input multiple required type="file" name="file" accept="${importAccept},.zip"></label><p class="hint">Фото, PDF, TXT или исследование DICOM в ZIP. ${originalTransferHint()}</p>
    <div id="upload-manifest"></div>
    <label id="upload-conclusion">Текст заключения для разбора <small>по желанию, только проверенные сведения</small><textarea name="clinical" maxlength="2400"></textarea></label>
    <p class="error" role="alert"></p><button class="button primary">Прикрепить к визиту</button></form>`);
  const form=document.querySelector('#upload-form');
  form.elements.file.onchange=()=>uploadManifest(form);
  uploadOptions(form);
}
function uploadOptions(form){
  form.querySelector('#upload-conclusion').hidden=form.elements.category.value!=='Заключения'||form.elements.file.files.length>1;
  form.querySelector('button.primary').textContent=form.elements.visit.value?'Прикрепить к визиту':'Сохранить в профиле';
}
function uploadManifest(form){
  const files=Array.from(form.elements.file.files),area=form.querySelector('#upload-manifest');
  area.replaceChildren();uploadOptions(form);if(!files.length)return;
  if(files.length>1){
    area.innerHTML=files.map((f,i)=>'<label>'+esc(f.name)+'<select data-file-index="'+i+'">'+uploadKindOptions(form.elements.category.value)+'</select></label>').join('');
  }
  const pick=document.createElement('select');pick.setAttribute('aria-label','Файл для предпросмотра');
  for(const [i,f] of files.entries())pick.add(new Option(f.name,i));
  const label=document.createElement('label');label.textContent='Предпросмотр';label.append(pick);area.append(label);
  const holder=document.createElement('div');holder.className='upload-preview';area.append(holder);
  pick.onchange=()=>{
    const container=document.createElement('div'),f=files[Number(pick.value)];holder.replaceChildren(container);
    if(isPdf(f)||isPhoto(f)||isTextFile(f))previewOriginal(f,container,f);
    else container.textContent='Для ZIP доступно скачивание оригинала.';
  };
  pick.onchange();
}
function uploadCategoryControl(form,index){return form.querySelector('[data-file-index="'+index+'"]')||form.elements.category}
registerFieldRules('upload-form',(form,add)=>{
  for(const [i,file] of [...form.elements.file.files].entries()){
    const category=uploadCategoryControl(form,i),zip=/\.zip$/i.test(file.name);
    if(!file.size)add('file','Выберите непустой файл.');
    else if(!zip&&!(isPdf(file)||isPhoto(file)||isTextFile(file)))add('file','Выберите фото, PDF, TXT или ZIP.');
    if(zip&&!['Снимки','Заключения','Другое'].includes(category.value))add(category,'Для ZIP выберите «Снимки», «Заключения» или «Другое».');
    if(['Назначения','Рекомендации'].includes(category.value)&&!form.elements.visit.value)add('visit','Выберите визит для назначения или рекомендаций.');
  }
});
async function saveUpload(form){
  if(form.dataset.busy)return;
  const files=Array.from(form.elements.file.files),profile=current(),patient=person.id,visit=form.elements.visit.value;
  const rows=files.map((file,i)=>{
    const category=uploadCategoryControl(form,i).value;
    return {id:uid(),visit,category,name:file.name,type:file.type,date:todayLocal(),...(category==='Заключения'&&files.length===1?{clinicalText:form.elements.clinical.value.trim()}:{}),
      ...(['Назначения','Рекомендации'].includes(category)?{intake:true,checked:false,meds:[]}: {})};
  });
  const error=form.querySelector('.error'),staged=[];
  form.dataset.busy='true';const submit=form.querySelector('button.primary');submit.disabled=true;
  const accepted=[];let existing;
  try{
    for(const [i,f] of files.entries()){
      const row=rows[i],digest=await sourceDigest(f);
      if(patient!==person.id||!form.isConnected||readOnly)throw Error();
      const candidates=[...latestProfile().files,...staged].filter(x=>
        row.category==='Лаборатория'?x.category==='Лаборатория':x.visit===visit);
      const duplicate=await matchingOriginal(patient,f,digest,candidates);
      if(duplicate){existing??=duplicate;continue}
      row.sourceDigest=digest;
      if(patient!==person.id||!form.isConnected||readOnly)throw Error();
      await fileBlob(patient+'/'+row.id,f);staged.push(row);accepted.push([row,f]);
    }
    if(!accepted.length&&existing){
      const lab=existing.category==='Лаборатория';
      const kind=lab?(existing.lab?'lab':'verifyLab'):existing.intake&&!existing.checked?'verifyFile':'file';
      duplicateCard(form,kind,existing.id,lab?'Открыть существующий бланк':'Открыть существующее вложение');
      submit.disabled=false;delete form.dataset.busy;return;
    }
    profile.files.push(...staged);if(!saveState())throw Error();
  }catch{
    profile.files=profile.files.filter(f=>!rows.includes(f));await Promise.allSettled(staged.map(f=>removeBlob(patient+'/'+f.id)));
    error.textContent='Не удалось сохранить комплект. Проверьте свободное место и повторите загрузку.';submit.disabled=false;delete form.dataset.busy;return;
  }
  for(const [row,file] of accepted)if(row.intake){
    const job={patient,visit,row,status:'В очереди на распознавание'};jobs.set(row.id,job);
    workQueue=workQueue.then(async()=>{
      try{await readIntakeFile(row,file,job)}finally{jobs.delete(row.id);refreshIntake(patient,visit);if(patient===person.id)render()}
    });
  }
  if(form.isConnected&&patient===person.id){
    render();const first=staged[0];
    if(existing)announce('Повторный файл уже есть в дневнике.');
    replaceRoute(first.intake?'intake':first.category==='Лаборатория'?'verifyLab':'file',first.intake?visit:first.id);
  }
}
function showSettings(){
  const canAuto=mayChangeConsent();
  return `<section class="section-page"><div class="section-head"><h2>Настройки</h2></div>${settingsMenu()}<div class="settings-grid"><article class="plain-card"><h3>Разбор лечения</h3>
    <p>Параметры профиля · ${esc(person.name)}</p><label class="switch-line"><input type="checkbox" id="auto-analysis" ${current().auto?'checked':''} ${canAuto?'':'disabled'}>Без подключённого ИИ сразу открывать разбор по сохранённым данным</label>
    <label class="switch-line"><input type="checkbox" id="direct-auto" ${current().directAuto?'checked':''} ${canAuto?'':'disabled'}>Автоматически отправлять сверенное лечение в подключённый OpenRouter</label>
    <label class="switch-line"><input type="checkbox" id="chatgpt-auto" ${current().chatGPTAuto===true?'checked':''} ${canAuto?'':'disabled'}>Автоматически отправлять сверенное лечение в подключённый личный ChatGPT</label>
    <small>Автоотправка действует для выбранного профиля. Перед разовой отправкой из карты другого взрослого администратор проверяет запрос.</small></article>
    <article class="plain-card"><h3>Поиск в аптеках</h3><label>Город семьи<select id="city" ${viewer==='admin'?'':'disabled'}>${Object.keys(pharmacyRegions).map(city=>'<option '+(city===prototypeState.city?'selected':'')+'>'+esc(city)+'</option>').join('')}</select></label><small>Один город для всех профилей семьи.</small></article>
    <article class="plain-card"><h3>Хранение данных</h3><p>${workingFamily?'Записи и оригиналы зашифрованы на этом устройстве.':'Открыта демонстрационная семья. Для личных записей создайте свой архив.'} ${prototypeState.sync?'Между доверенными устройствами включён зашифрованный обмен.':'Открыть параметры обмена можно в разделе «Синхронизация и резервная копия».'}</p></article></div></section>`;
}
