'use strict';

const importingDrafts=new Map();
function keepVisitFields(form,photo){
  const draft=current().visitDrafts.find(d=>d.id===photo?.draftId);if(!draft)return;
  const inputs={};
  for(const k of ['episode','episodeName','date','title','note','doctor','doctorName','specialty','clinic','recommendation'])inputs[k]=form.elements[k].value;
  if(form.querySelector('#rx-rows'))draft.manualMeds=medicineValues(form);
  draft.fields=inputs;draft.position=form.sourcePosition?.();saveState();
}
function resumeVisit(id){
  const draft=current().visitDrafts.find(d=>d.id===id);if(!draft||readOnly)return;
  const docs=draftGroup(draft);
  if(!docs.some(d=>d.state==='queued')&&!importingDrafts.has(id))return openImportDraft(id,'resume');
  openPanel(person.name,'Визит в очереди','<p>Оригиналы сохранены на этом устройстве. '+esc(providerStatus())+'.</p>'+
    docs.map(d=>'<p class="file-name">'+esc(d.name)+'</p>').join('')+
    '<div class="actions">'+act('readDraft','Распознать на устройстве',id,'button primary')+
    act('manualDraft','Заполнить вручную',id,'button secondary')+(!chatGPT.connected&&!routerKey?act('providers','Подключить ИИ-провайдера','','text-button'):'')+'</div>');
}
const visitImportRevision=4;
const visitHeaderFields=['episodeName','date','title','note','doctorName','specialty','clinic'];
function reparseVisitDocument(d){
  const text=d.transcription??d.raw??'';
  d.header=parseVisitHeader(text);
  d.proposed=proposedMedicines(text,d.issues||[]);
  d.visitImportRevision=visitImportRevision;
}
function applyVisitTranscript(){
  if(readOnly)return;
  const photo=routes.at(-1)?.photo,docs=current().visitDrafts;
  const draft=docs.find(d=>d.id===photo?.draftId),main=docs.find(d=>d.id===photo?.main);
  const form=document.querySelector('#visit-form'),input=document.querySelector('#visit-transcript');
  if(!draft||!main||!form||!input)return;
  const before={...main},previousFields=draft.fields;
  const text=input.value.trim();if(!text)return;
  const fields=Object.fromEntries(new FormData(form));
  main.transcription=text;reparseVisitDocument(main);
  // Only the fields listed on the button are replaced. Preserve the user's episode & doctor choices.
  for(const key of visitHeaderFields)fields[key]=main.header[key];
  draft.fields=fields;
  if(!saveState()){
    Object.keys(main).forEach(k=>delete main[k]);Object.assign(main,before);draft.fields=previousFields;
    form.querySelector('.error').textContent='Не удалось сохранить сверенный текст.';return;
  }
  Object.assign(photo,{header:{...main.header},transcription:text,proposed:main.proposed});
  showNewVisit(routes.at(-1).id,photo);
}
async function readDraftGroup(docs,patient,report){
  for(const [i,d] of docs.entries()){
    if(d.state==='read')continue;
    let raw='';const issues=[];
    try{
      const blob=await fileBlob(patient+'/'+d.id);if(!blob)throw Error();
      const file=new File([blob],d.name,{type:d.type});
      raw=await recognizeDocument(file,isPdf(file),msg=>report((i+1)+' / '+docs.length+' · '+d.name+' · '+msg),issues);
    }catch{/* An unreadable original stays available for manual verification. */}
    Object.assign(d,{raw,issues,readError:raw?'':'Не удалось разобрать текст.',header:parseVisitHeader(raw),proposed:proposedMedicines(raw,issues),
      kind:suggestImportKind(d.name,raw),state:'read',visitImportRevision});
    if(!saveState())throw Error();
  }
}
async function openImportDraft(id,mode){
  const profile=current(),patient=person.id,route=routes.at(-1),draft=profile.visitDrafts.find(d=>d.id===id);
  if(!draft||readOnly)return;
  const docs=draftGroup(draft,profile);
  openPanel(person.name,'Подготовка визита','<p role="status" id="read-group">Открываем сохранённые документы…</p>');
  const status=document.querySelector('#read-group');
  try{
    if(mode==='local'&&!importingDrafts.has(id))importingDrafts.set(id,readDraftGroup(docs,patient,msg=>status.textContent=msg).finally(()=>importingDrafts.delete(id)));
    if(importingDrafts.has(id))await importingDrafts.get(id);
    const old=docs.filter(d=>d.state==='read'&&d.raw&&d.visitImportRevision!==visitImportRevision);
    for(const d of old)reparseVisitDocument(d);
    if(old.length&&!saveState())throw Error();
    const main=docs.find(d=>d.header?.title||d.header?.doctorName)||draft;
    const blob=await fileBlob(patient+'/'+main.id);if(!blob)throw Error();
    if(route!==routes.at(-1)||patient!==person.id||!panel.open)return;
    const file=new File([blob],main.name,{type:main.type});
    if(mode==='manual'){
      const waiting=docs.filter(d=>d.state==='queued');for(const d of waiting)d.state='manual';
      if(!saveState()){for(const d of waiting)d.state='queued';throw Error()}
    }
    route.name=mode==='manual'||draft.state==='manual'?'newVisit':'photoVisit';route.id=draft.episode;route.photo={...main,header:{...main.header},draftId:id,file,docs,main:main.id};
    if(!route.photo.header.title&&main.header?.specialty)route.photo.header.title='Приём · '+main.header.specialty;
    showNewVisit(route.id,route.photo);
  }catch{if(status.isConnected)status.textContent='Не удалось открыть комплект. Оригиналы можно повторно открыть из очереди профиля.'}
}
function restoreVisitFields(form,photo){
  const draft=current().visitDrafts.find(d=>d.id===photo?.draftId);if(!draft?.fields)return;
  for(const [key,value] of Object.entries(draft.fields))if(form.elements[key])form.elements[key].value=value;
  const rows=form.querySelector('#rx-rows');if(rows&&draft.manualMeds)rows.innerHTML=draft.manualMeds.map(m=>medicineInputs(m)).join('');
  toggleVisitInputs();refreshPreviousFields(form);
}
async function replaceImportOriginal(input,file){
  const route=routes.at(-1),profile=current(),patient=person.id,draft=profile.visitDrafts.find(d=>d.id===route.photo?.draftId);
  if(!draft||draftGroup(draft).length!==1||readOnly)return;
  const error=document.querySelector('#visit-form .error');
  if(!file.size||!(isPhoto(file)||isPdf(file)||isTextFile(file))){error.textContent='Выберите непустое фото, PDF или TXT.';return}
  input.disabled=true;
  const newKey=uid(),oldKey=originalKey(prototypeState,patient+'/'+draft.id);
  try{
    const digest=await sourceDigest(file);
    await fileBlob(patient+'/'+newKey,file);
    if(route!==routes.at(-1)||!input.isConnected||!profile.visitDrafts.includes(draft)){await removeBlob(patient+'/'+newKey);return}
    const idx=profile.visitDrafts.indexOf(draft);
    profile.visitDrafts[idx]={id:draft.id,episode:draft.episode,name:file.name,type:file.type,blobId:newKey,state:'queued',kind:suggestImportKind(file.name),sourceDigest:digest};
    if(!saveState()){profile.visitDrafts[idx]=draft;await removeBlob(patient+'/'+newKey);throw Error()}
    await removeBlob(oldKey).catch(()=>{});
    if(route===routes.at(-1)&&input.isConnected)await openImportDraft(draft.id,'local');
  }catch{error.textContent='Не удалось заменить оригинал. Попробуйте снова.'}
  finally{input.disabled=false}
}
