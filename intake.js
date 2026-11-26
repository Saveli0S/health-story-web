'use strict';

function workflowSteps(step){
  return '<ol class="intake-steps" aria-label="Этапы">'+['Визит','Сверка','Разбор'].map((s,i)=>'<li '+(i+1===step?'aria-current="step"':'')+'><span>'+(i+1)+'</span>'+s+'</li>').join('')+'</ol>';
}
function showNewEpisode(){
  openPanel(person.name,'Новый эпизод',`<form id="episode-form" class="edit-form">
    <label>Название эпизода<input required maxlength="100" name="episode" placeholder="Например, весеннее обострение"></label>
    <p class="hint">В одном эпизоде можно собрать несколько визитов к разным врачам.</p>
    <p class="error" role="alert"></p><button class="button primary">Создать эпизод</button></form>`);
}
function submitEpisode(f){
  const name=f.elements.episode.value.trim();if(!name){f.elements.episode.focus();return}
  const episode={id:uid(),name};current().episodes.push(episode);
  if(!saveState()){current().episodes.pop();f.querySelector('.error').textContent='Не удалось сохранить эпизод в браузере.';return}
  render();replaceRoute('episode',episode.id);
}
function showNewVisit(episodeId,photo){
  photo??=routes.at(-1)?.photo;
  const manual=routes.at(-1)?.name==='newVisit'||!photo;
  const episodes=current().episodes,d=photo?.header||{};
  // A shared diagnosis alone does not establish that this is the same episode.
  const doctors=Object.entries(person.doctors);
  const existing=doctors.filter(([,doctor])=>d.doctorName&&norm(doctor[0])===norm(d.doctorName));
  const doctorId=existing.length===1?existing[0][0]:'new';
  openPanel(person.name,photo?'Проверить данные визита':'Новый визит',visitModes(manual?'manual':'photo',episodeId)+
    (photo?visitImportSource(photo):'')+`<form id="visit-form" class="edit-form">
    <label>Эпизод болезни<select name="episode"><option value="new">Создать новый эпизод</option>${episodes.map(e=>'<option value="'+esc(e.id)+'" '+(e.id===episodeId?'selected':'')+'>'+esc(e.name)+'</option>').join('')}</select></label>
    <label data-new-episode>Название эпизода<input name="episodeName" value="${esc(d.episodeName)}" maxlength="100" placeholder="Например, боль в колене"></label>
    <div class="intake-pair"><label>Название визита<input required name="title" value="${esc(d.title)}" maxlength="100" placeholder="Например, первичная консультация"></label>
    <label>Дата визита<input required type="date" name="date" max="${todayLocal()}" value="${photo?esc(d.date):todayLocal()}"></label></div>
    <label>Врач<select name="doctor"><option value="new">Добавить врача</option>${doctors.map(([id,doc])=>'<option value="'+esc(id)+'" '+(id===doctorId?'selected':'')+'>'+esc(doctorLabel(id))+'</option>').join('')}</select></label>
    <div class="intake-pair" data-new-doctor><label>Специальность <small>по желанию</small><input name="specialty" maxlength="80" value="${esc(d.specialty)}"></label><label>ФИО врача<input name="doctorName" maxlength="100" value="${esc(d.doctorName)}"></label></div>
    <label>Клиника <small>по желанию</small><input name="clinic" maxlength="160" value="${esc(d.clinic)}"></label>
    <label>Сведения о визите <small>по желанию</small><textarea name="note" maxlength="2000" placeholder="Причина обращения, диагноз или выводы врача">${esc(d.note)}</textarea></label>
    <label>Рекомендации врача <small>по желанию</small><textarea name="recommendation" maxlength="3600" placeholder="Что рекомендовал врач, когда пройти контроль"></textarea></label>
    <div id="previous-therapy"></div>${manual?'<div id="rx-rows"></div>'+act('appendMed','Добавить препарат вручную','','button secondary','plus'):''}
    <p class="error" role="alert"></p><button class="button primary">${photo?'Создать визит и сверить назначения':'Сохранить визит'}</button>
    ${photo?act('deferVisit','Уточнить позже',photo.draftId,'text-button'):'<button class="text-button" value="attach" name="next">Создать визит и перейти к вложениям</button>'}</form>`);
  toggleVisitInputs();refreshPreviousFields(document.querySelector('#visit-form'));
  if(photo){
    const form=document.querySelector('#visit-form');restoreVisitFields(form,photo);
    setupSourceView(photo.file,form,photo.file,current().visitDrafts.find(d=>d.id===photo.draftId)?.position);
    setupBatchPreview(form,photo,current().visitDrafts.find(d=>d.id===photo.draftId)?.position);
    showUncertainText(form,photo.issues||[]);
    clarifyFields(form,[['date','Какую дату визита указал врач?'],['title','Как называется визит?'],['episodeName','Какой эпизод или диагноз указан?'],['doctorName','Как зовут врача?']]);
  }
  const visitForm=document.querySelector('#visit-form'),inputs=visitForm.elements;
  previewImportTags(visitForm,visitForm.querySelector('#previous-therapy'),()=>[inputs.title.value,
    inputs.doctor.value==='new'?inputs.specialty.value:person.doctors[inputs.doctor.value]?.[1]].join(' '));

}
function todayLocal(){
  const d=new Date();return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
}
function toggleVisitInputs(){
  const f=document.querySelector('#visit-form');if(!f)return;
  for(const [select,group,field] of [['episode','[data-new-episode]','episodeName'],['doctor','[data-new-doctor]','doctorName']]){
    const add=f.elements[select].value==='new';f.querySelector(group).hidden=!add;
    f.elements[field].required=add;
  }
}
async function submitVisit(f,next){
  if(f.dataset.saving)return;
  const val=k=>f.elements[k].value.trim(), profile=current(),route=routes.at(-1),photo=route.photo,patient=person.id;
  const episode=val('episode')==='new'?{id:uid(),name:val('episodeName')}:profile.episodes.find(e=>e.id===val('episode'));
  const doctor=val('doctor')==='new'?{id:uid(),values:[val('doctorName'),val('specialty'),val('clinic')]}:null;
  if(!episode?.name||!val('title')||(doctor&&!doctor.values[0])){f.querySelector('.error').textContent='Заполните название эпизода, визита и имя врача.';return}
  if(photo&&[val('title'),val('episode')==='new'?val('episodeName'):'',doctor?.values[0]||''].some(needsClarification)){f.querySelector('.error').textContent='Уточните отмеченные поля визита по оригиналу.';return}
  const visit=[uid(),val('date'),val('title'),doctor?.id||val('doctor'),episode.name,val('note'),'scope',episode.id];
  let decisions;try{decisions=readTherapyChanges(f,visit)}catch(e){f.querySelector('.error').textContent=e.message;return}
  const meds=medicineValues(f);
  if(meds.some(m=>!m.name||!m.strength||!m.instructions||[m.name,m.strength,m.instructions].some(unclearRxField))){
    f.querySelector('.error').textContent='Уточните название, дозировку и схему каждого препарата.';return;
  }
  if(val('clinic')){visit[8]=[];visit[9]=val('clinic')}
  if(meds.length)visit[8]=meds.map(m=>({...m,period:emptyPeriod()}));
  const archived=photo&&profile.visitDrafts.find(d=>d.id===photo.draftId);
  if(photo&&!archived){f.querySelector('.error').textContent='Откройте исходный черновик из профиля.';return}
  if(archived&&!readJson(stateKey)?.profiles?.[patient]?.visitDrafts?.some(d=>d.id===archived.id)){
    f.querySelector('.error').textContent='Этот черновик уже изменён в другой вкладке. Обновите профиль.';return;
  }
  const originals=archived?draftGroup(archived,profile):[];
  const rows=originals.map(d=>{
    const kind=d.kind||'Назначения',row={id:d.id,blobId:d.blobId,visit:visit[0],category:kind,name:d.name,type:d.type,date:visit[1]};
    if(d.issues?.length)row.issues=d.issues;
    if(['Назначения','Рекомендации'].includes(kind))Object.assign(row,{intake:true,raw:d.raw||'',transcription:d.transcription,visitImportRevision:d.visitImportRevision,proposed:kind==='Рекомендации'?[]:d.proposed||[],readError:d.readError,checked:false,meds:[]});
    if(kind==='Лаборатория'&&d.raw){row.labRaw=d.raw;row.labDraft=parseLabText(d.raw,d.name)}
    return row;
  });
  profile.visitDrafts=profile.visitDrafts.filter(d=>!originals.includes(d));profile.files.push(...rows);
  const recommendation=val('recommendation')&&{id:uid(),visit:visit[0],text:val('recommendation')};
  if(recommendation)profile.recommendations.push(recommendation);
  if(doctor)profile.addedDoctors.push(doctor);
  if(val('episode')==='new')profile.episodes.push(episode);
  profile.changes.push(...decisions);profile.addedVisits.unshift(visit);
  if(!saveState()){
    profile.changes.splice(profile.changes.length-decisions.length,decisions.length);profile.addedVisits.shift();if(doctor)profile.addedDoctors.pop();if(val('episode')==='new')profile.episodes.pop();
    profile.files=profile.files.filter(d=>!rows.includes(d));profile.visitDrafts.push(...originals);if(recommendation)profile.recommendations.pop();
    f.querySelector('.error').textContent='Не удалось сохранить визит в браузере.';return;
  }
  if(doctor)person.doctors[doctor.id]=doctor.values;
  person.visits.unshift(visit);person.visits.sort((a,b)=>b[1].localeCompare(a[1]));
  render();routes=[{name:'visit',id:visit[0]}];
  const first=rows.find(r=>r.intake)||rows.find(r=>r.category==='Лаборатория');
  if(first){routes.push({name:'intake',id:visit[0]});go(first.intake?'verifyFile':'verifyLab',first.id)}
  else if(next==='attach')go('intake',visit[0]);
  else if(prescribedForReview(visit[0]).length)startReview(visit[0]);
  else displayRoute();
}
function intakeFiles(visit){return current().files.filter(f=>f.visit===visit&&f.intake)}
function pendingVisitLabs(id){return current().files.filter(f=>f.visit===id&&f.category==='Лаборатория'&&(!f.lab||f.labDraft))}
function reviewReady(id){return prescribedForReview(id).length>0 && !intakeFiles(id).some(f=>!f.checked) && !pendingVisitLabs(id).length && !visitBusy(person.id,id)}
const jobs=new Map(), intakeErrors=new Map();
let archiveQueue=Promise.resolve(),workQueue=Promise.resolve();
function visitBusy(patient,id){return [...jobs.values()].some(j=>j.patient===patient&&j.visit===id)}
function intakeFileRows(visit){
  const files=intakeFiles(visit);
  const waiting=[...jobs.values()].filter(j=>j.visit===visit&&j.patient===person.id&&!files.some(f=>f.id===j.row.id));
  files.push(...waiting.map(j=>j.row));
  return files.map(f=>{
    const job=jobs.get(f.id),status=job?.status||(f.checked?'Сверено':f.readError?'Нужна ручная сверка':f.raw?'Проверьте распознанное':'Требует сверки');
    return '<div class="intake-file">'+icon('clip')+'<div><strong>'+esc(f.name)+'</strong><small data-file-status="'+esc(f.id)+'">'+esc(status)+'</small></div>'+
      (job?'':act('verifyFile',f.checked?'Посмотреть':'Сверить',f.id,'button secondary'))+'</div>';
  }).join('');
}
function showIntake(visit){
  const v=visitById(visit);if(!v)return;
  const busy=visitBusy(person.id,visit),files=intakeFiles(visit),done=files.filter(f=>f.checked).length;
  openPanel(v[2],'Назначение и вложения',workflowSteps(2)+`<p class="dialog-sub">Приложите лист назначения или заключение. Распознавание выполняется на этом устройстве. Для прототипа используйте тестовые документы.</p>
    <div class="upload-zone"><span class="upload-icon">${icon('clip')}</span><strong>Документы визита</strong>
    ${act('upload','Выбрать документы','rx:'+visit,'button primary','clip')}
    ${act('sampleRx','Попробовать с примером PDF',visit,'text-button')}</div>
    <div id="intake-list">${intakeFileRows(visit)}${pendingVisitLabs(visit).map(f=>resultRow('verifyLab',f.id,f.name,'Сверить лабораторный бланк','lab')).join('')}</div>
    <p class="hint" role="status">${busy?'Идёт локальное распознавание.':files.length?'Сверено документов: '+done+' из '+files.length+'.':'Можно выбрать несколько документов за один раз.'}</p>
    <p class="error" role="alert">${esc(intakeErrors.get(person.id+'/'+visit)||'')}</p>
    <div class="actions">${act('visitHome','К карточке визита',visit,'button secondary')}
    <button type="button" class="button primary" data-action="intakeAnalyze" data-id="${esc(visit)}" ${reviewReady(visit)?'':'disabled'}>Сохранить и перейти к анализу</button></div>`);
}
function refreshIntake(patient,visit){
  if(patient!==person.id)return;
  const r=routes.at(-1);
  if(panel.open&&r?.name==='intake'&&r.id===visit)showIntake(visit);
  if(panel.open&&r?.name==='visit'&&r.id===visit)showVisit(visit);
}
function enqueueFiles(visit,files,category='Назначения'){
  if(readOnly||!visitById(visit))return;
  const patient=person.id,profile=current(),key=patient+'/'+visit;
  intakeErrors.delete(key);
  for(const file of files){
    if(!file.size||!(isPdf(file)||isPhoto(file)||isTextFile(file))){
      intakeErrors.set(key,'Выберите непустой PDF или фотографию.');continue;
    }
    const row={id:uid(),visit,intake:true,category,name:file.name,date:todayLocal(),type:file.type,checked:false,meds:[]};
    const job={patient,visit,row,status:'Сохранение оригинала…'};jobs.set(row.id,job);
    // Save every selected original before the slower, sequential recognition work.
    archiveQueue=archiveQueue.then(async()=>{
      try{
        await fileBlob(patient+'/'+row.id,file);
        profile.files.push(row);
        if(!saveState()){profile.files.pop();await removeBlob(patient+'/'+row.id);throw Error()}
        job.status='В очереди на распознавание';refreshIntake(patient,visit);
        workQueue=workQueue.then(async()=>{
          try{await readIntakeFile(row,file,job)}
          finally{jobs.delete(row.id);refreshIntake(patient,visit);if(person.id===patient)render()}
        });
      }catch{
        jobs.delete(row.id);intakeErrors.set(key,'Не удалось сохранить документ. Проверьте свободное место и повторите загрузку.');refreshIntake(patient,visit);
      }
    });
  }
  refreshIntake(patient,visit);
}
async function readIntakeFile(row,blob,job){
  try{
    const issues=[];
    row.raw=await recognizeDocument(blob,isPdf(row)||isPdf(blob),msg=>{
      job.status=msg;
      if(person.id===job.patient){
        const status=document.querySelector('[data-file-status="'+row.id+'"]');
        if(status)status.textContent=msg;
      }
    },issues);
    row.issues=issues;
    row.visitImportRevision=visitImportRevision;
    row.proposed=row.category==='Рекомендации'?[]:proposedMedicines(row.raw,issues);
    row.readError=row.raw?'':'Текст не удалось прочитать. Сверьте оригинал и введите назначение вручную.';
  }catch{
    row.readError='Не удалось прочитать документ. Можно повторить распознавание или внести назначение вручную.';
  }
  if(!saveState())intakeErrors.set(job.patient+'/'+job.visit,'Для распознанного текста не хватило места. Оригинал сохранён.');
}
async function retryRecognition(id){
  const row=current().files.find(f=>f.id===id);if(!row||row.checked||jobs.has(id))return;
  const patient=person.id,job={patient,visit:row.visit,row,status:'В очереди'};jobs.set(id,job);
  replaceRoute('intake',row.visit);
  workQueue=workQueue.then(async()=>{
    try{const blob=await fileBlob(patient+'/'+id);if(!blob)throw Error();await readIntakeFile(row,blob,job)}
    catch{row.readError='Оригинал недоступен на этом устройстве.'}
    finally{jobs.delete(id);refreshIntake(patient,row.visit)}
  });
}
async function addExample(visit,button){
  const patient=person.id;button.disabled=true;
  try{
    const response=await fetch('assets/documents/prescription.pdf');if(!response.ok)throw Error();
    const blob=await response.blob();
    if(patient===person.id&&button.isConnected)enqueueFiles(visit,[new File([blob],'Пример назначения.pdf',{type:'application/pdf'})]);
  }catch{intakeErrors.set(patient+'/'+visit,'Не удалось открыть пример. Можно выбрать свой файл.');refreshIntake(patient,visit)}
  finally{button.disabled=false}
}
function medicineInputs(m){
  return `<fieldset class="rx-inputs" data-med="${esc(m.id||uid())}"><legend>Препарат</legend>
    <div class="intake-pair"><label>Название<input name="drug" maxlength="120" value="${esc(m.name)}" required></label>
    <label>Дозировка<input name="strength" maxlength="100" value="${esc(m.strength)}" required placeholder="Как в назначении"></label></div>
    <label>Форма выпуска <small>если указана</small><input name="form" maxlength="100" value="${esc(m.form)}"></label>
    <label>Схема приёма<input name="instructions" maxlength="400" value="${esc(m.instructions)}" placeholder="Разовая доза, частота, длительность" required></label>
    ${act('dropMed','Убрать строку','','inline-action')}</fieldset>`;
}
function refreshRxDraft(id){
  const f=current().files.find(row=>row.id===id);
  const form=document.querySelector('#verify-form');if(readOnly||!form||!f||f.checked||f.category!=='Назначения')return;
  const fresh=proposedMedicines(f.transcription??f.raw??'',f.issues||[]);
  form.querySelector('#rx-rows').innerHTML=fresh.map(medicineInputs).join('');
  form.elements.none.checked=false;
  form.refreshClarifications?.();
}
function showVerification(id){
  const f=current().files.find(file=>file.id===id);if(!f||jobs.has(id))return;
  const clinical=f.transcription??f.raw??'';
  const auto=!f.checked&&!f.lastConfirmed&&f.visitImportRevision!==visitImportRevision&&f.category==='Назначения'&&clinical;
  const meds=f.checked?f.meds:(f.draft?.meds??(auto?proposedMedicines(clinical,f.issues||[]):f.proposed)??[]);
  const rec=f.category==='Рекомендации';
  const historical=historyMedicationLines(clinical);
  openPanel(visitById(f.visit)[2],rec?'Сверить рекомендации врача':'Сверка назначения',workflowSteps(2)+`<p class="dialog-sub">${esc(f.name)}. ${rec?'Сверьте текст указаний врача по оригиналу.':'Сверьте название, дозировку и схему.'} Неразборчивую запись можно отложить до уточнения у врача.</p>

    <details ${meds.length?'':'open'}><summary>Распознанный текст</summary><pre class="source-text">${esc(f.raw||'Текст отсутствует.')}</pre></details>
    ${f.readError?'<p class="fact-note">'+esc(f.readError)+'</p>':''}
    ${!f.checked&&(!f.raw||f.readError)?act('retryRead','Повторить распознавание',id,'text-button'):''}
    ${historical.length?'<details><summary>Анамнез и отмены в оригинале</summary><pre class="source-text">'+esc(historical.join('\n'))+'</pre></details>':''}
    ${f.transcription?'<details><summary>Внесённый после сверки текст</summary><pre class="source-text">'+esc(f.transcription)+'</pre></details>':''}
    <form class="edit-form" id="verify-form" data-id="${esc(id)}">
    <label>Рекомендации врача<textarea name="recommendation" maxlength="3600" ${rec?'required':''}>${esc(f.draft?.recommendation??f.recommendation??(recommendationText(clinical)||(rec?clinical:'')))}</textarea></label>
    <div ${rec?'hidden':''}><div id="rx-rows">${meds.map(medicineInputs).join('')}</div>
    ${act('appendMed','Добавить препарат','','button secondary','plus')}
    ${auto&&f.draft?act('refreshRxDraft','Заменить список препаратов по исходному тексту',f.id,'text-button'):''}
    <label class="unknown"><input type="checkbox" name="none" ${rec||(f.checked&&!meds.length)||f.draft?.none?'checked':''}>В документе нет лекарственных назначений</label></div>
    <label>Другие сведения для разбора <small>по желанию</small><textarea name="context" maxlength="1800" placeholder="Только нужные сведения из документа, без имён и контактов">${esc(f.draft?.context??f.context)}</textarea></label>
    <label class="unknown"><input type="checkbox" name="verified" required>Я сверил(а) сведения с оригиналом</label><p role="alert" class="error"></p>
    <div class="actions">${act('deferVerify','Уточнить позже',id,'button secondary')}<button class="button primary">Подтвердить сведения</button></div></form>`);
  const form=document.querySelector('#verify-form');
  setupSourceView(f,form,null,f.draft?.position);
  showUncertainText(form,f.issues);
  clarifyFields(form,[['drug','Как называется препарат?'],['strength','Какая дозировка указана?'],['instructions','Какую схему приёма указал врач?'],['recommendation','Что именно рекомендовал врач?']],!rec&&!meds.length?'Есть ли на оригинале лекарственные назначения? Добавьте пропущенные строки или отметьте отсутствие.':'');
}
async function previewOriginal(f,container,original){
  container.textContent='Открываем оригинал…';
  try{
    const blob=original||await fileBlob(person.id+'/'+f.id);if(!container.isConnected||!panel.open)return;if(!blob)throw Error();
    if(isTextFile(f)||isTextFile(blob)){
      const pre=document.createElement('pre');pre.className='source-text';pre.textContent=await blob.text();container.replaceChildren(pre);return;
    }
    if(!isPdf(f)&&!isPdf(blob)){
      const url=URL.createObjectURL(blob);
      const img=new Image();img.alt='Исходное фото';img.className='paper-preview';img.onload=()=>URL.revokeObjectURL(url);img.onerror=()=>{URL.revokeObjectURL(url);container.textContent='Браузер не может показать этот формат фото.'};img.src=url;
      container.replaceChildren(img);return;
    }
    const pdf=await openLocalPdf(blob);
    const select=document.createElement('select');select.setAttribute('aria-label','Страница оригинала');
    for(let i=1;i<=pdf.numPages;i++)select.add(new Option('Страница '+i+' из '+pdf.numPages,i));
    const paper=document.createElement('div');
    const cleanup=()=>{dispose.disconnect();panel.removeEventListener('close',cleanup);pdf.destroy()};
    const dispose=new MutationObserver(()=>{if(!container.isConnected)cleanup()});
    if(!container.isConnected||!panel.open){await pdf.destroy();return}
    panel.addEventListener('close',cleanup,{once:true});
    dispose.observe(panelBody,{childList:true,subtree:true});
    container.replaceChildren(select,paper);
    const draw=async()=>{const n=Number(select.value);try{const canvas=await drawPaper(await pdf.getPage(n),1100);if(n===Number(select.value)&&paper.isConnected)paper.replaceChildren(canvas)}catch{if(paper.isConnected)paper.textContent='Не удалось открыть страницу.'}};
    select.onchange=draw;await draw();
  }catch{if(container.isConnected)container.textContent='Предпросмотр недоступен. Оригинал можно скачать из вложений визита.'}
}
function emptyPeriod(){return {start:'',planned:'',end:'',unknown:false,closed:false}}
function needsClarification(value){return /[?？�]|неразборчив|неизвестн|уточнить|не\s*указан/i.test(value)}
function unclearRxField(value){return needsClarification(value)||!/[\p{L}\d]/u.test(value)}
function medicineValues(form){
  return [...form.querySelectorAll('[data-med]')].map(row=>{
    const result={id:row.dataset.med};
    for(const [field,name] of [['name','drug'],['strength','strength'],['form','form'],['instructions','instructions']])result[field]=row.querySelector('[name="'+name+'"]').value.trim();
    return result;
  });
}
function storeVerification(form,defer=false){
  const file=current().files.find(f=>f.id===form.dataset.id);if(!file)return;
  const values={meds:medicineValues(form),recommendation:form.elements.recommendation.value.trim(),context:form.elements.context.value.trim(),none:form.elements.none.checked}, before={...file};
  if(defer){
    const position=form.sourcePosition?.()||{};const missing=values.meds.find(m=>!m.strength||needsClarification(m.strength));
    if(missing){position.med=missing.id;position.field='strength'}
    file.draft={...values,position};file.checked=false;
  }else{
    if(!form.elements.verified.checked)return;
    if(values.none===Boolean(values.meds.length)||values.meds.some(m=>!m.name||!m.strength||!m.instructions)){
      form.querySelector('.error').textContent='Заполните назначение для каждой строки или оставьте список пустым и отметьте отсутствие препаратов.';return;
    }
    if(needsClarification(values.recommendation)||values.meds.some(m=>[m.name,m.strength,m.instructions].some(unclearRxField))){
      form.querySelector('.error').textContent='Сведения требуют уточнения. Исправьте отмеченные поля по оригиналу или выберите «Уточнить позже».';return;
    }
    file.meds=values.meds.map(m=>({...m,period:file.meds.find(old=>old.id===m.id)?.period||emptyPeriod()}));
    file.recommendation=values.recommendation;file.context=values.context;file.checked=true;file.lastConfirmed=new Date().toISOString();delete file.draft;
  }
  if(!saveState()){
    Object.keys(file).forEach(key=>delete file[key]);Object.assign(file,before);
    form.querySelector('.error').textContent='Не удалось сохранить сверку. Проверьте свободное место.';return;
  }
  render();routes=[{name:'visit',id:file.visit}];go('intake',file.visit);
}

