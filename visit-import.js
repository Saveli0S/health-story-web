'use strict';

function visitModes(mode,episodeId){
  return '<div class="visit-modes" role="group" aria-label="Способ создания визита">'+
    [['manual','Вручную','edit'],['photo','По фото или PDF','clip']].map(([key,label,mark])=>
      '<button type="button" data-action="visitMode" data-mode="'+key+'" data-id="'+esc(episodeId)+'" aria-pressed="'+(key===mode)+'">'+icon(mark,true)+label+'</button>').join('')+'</div>';
}
function switchVisitMode(mode,episodeId){
  const route=routes.at(-1),name=mode==='photo'?'photoVisit':'newVisit';
  if(!route||route.name===name)return;
  const form=document.querySelector('#visit-form');
  if(form?.dataset.saving)return;
  const drafts=route.modeDrafts||{};
  if(form)drafts[route.name]={fields:Object.fromEntries(new FormData(form)),meds:medicineValues(form)};
  const next={name,id:episodeId,modeDrafts:drafts,manualId:route.manualId,imported:route.photo||route.imported};
  if(next.imported)next.photo=next.imported;
  routes[routes.length-1]=next;displayRoute();
  const restored=document.querySelector('#visit-form'),saved=drafts[name];
  if(!restored||!saved)return;
  for(const key of ['episode','episodeName','date','title','note','doctor','doctorName','specialty','clinic','recommendation']){
    if(Object.hasOwn(saved.fields,key))restored.elements[key].value=saved.fields[key];
  }
  const rows=restored.querySelector('#rx-rows');if(rows)rows.innerHTML=saved.meds.map(m=>medicineInputs(m)).join('');
  toggleVisitInputs();
}
const importAccept=photoAccept+',application/pdf,.pdf,text/plain,.txt';
const importKinds=['Назначения','Рекомендации','Лаборатория','Снимки','Заключения','Другое'];
function suggestImportKind(name,raw=''){
  const blood=/анализ (?:крови|мочи)|лаборатор|гемоглобин|биохими|\bcbc\b/iu;
  if(hasTreatmentRecommendations(raw))return 'Назначения';
  if(/рекомендац/iu.test(name))return 'Рекомендации';
  if(blood.test(name))return 'Лаборатория';
  if(/снимок|рентген/iu.test(name))return 'Снимки';
  if(/^(?:визит|врач|диагноз|назначения)\s*[:.]|лист назначений/imu.test(raw))return 'Назначения';
  if(blood.test(raw.slice(0,350)))return 'Лаборатория';
  if(recommendationText(raw))return 'Рекомендации';
  return 'Назначения';
}
function draftGroup(draft,profile=current()){
  return [draft,...profile.visitDrafts.filter(d=>d.parent===draft.id)];
}
function kindOptions(active){return importKinds.map(k=>'<option '+(k===active?'selected':'')+'>'+k+'</option>').join('')}
function visitImportSource(photo){
  const draft=current().visitDrafts.find(d=>d.id===photo.draftId);
  const docs=draftGroup(draft);
  return '<div class="import-source"><strong>Документы визита · '+docs.length+'</strong>'+
    docs.map(d=>'<label>'+esc(d.name)+'<select aria-label="'+esc('Назначение файла '+d.name)+'" data-draft-kind="'+esc(d.id)+'">'+kindOptions(d.kind||'Назначения')+'</select></label>').join('')+
    '<p class="hint">Проверьте тип каждого файла. Бланки анализов и рекомендации можно сверить отдельно.</p>' +
    (docs.length===1?'<label class="text-button file-picker">Выбрать другой документ<input type="file" id="replace-visit-source" accept="'+importAccept+'"></label>':'')+
    (photo.raw?'<details><summary>Распознанный текст основного документа</summary><pre class="source-text">'+esc(photo.raw)+'</pre></details>':'')+
    '<details class="document-transcript"><summary>Исправить распознанный текст</summary>'+
    '<p class="hint">Сверьте текст с оригиналом. Для неразборчивой дозировки поставьте знак вопроса. При применении будут заново заполнены дата, название, врач, специальность, клиника, диагноз, жалобы и предложенные препараты.</p>'+
    '<label>Текст основного документа<textarea id="visit-transcript" rows="8" maxlength="60000">'+esc(photo.transcription??photo.raw??'')+'</textarea></label>'+
    act('applyVisitTranscript','Применить текст и заменить распознанные поля','','button secondary')+'</details>'+'</div>';
}
function showPhotoVisit(episodeId){
  const route=routes.at(-1);
  if(route.photo){showNewVisit(episodeId,route.photo);return}
  openPanel(person.name,'Новый визит',visitModes('photo',episodeId)+`<div class="upload-zone">
    <span class="upload-icon">${icon('clip')}</span><strong>Документы одного визита</strong>
    <p class="hint">Выберите сразу несколько фото, PDF или текстовых файлов. Можно приложить назначение, рекомендации и бланки анализов.</p>
    <label>После выбора файлов<select id="visit-processing"><option value="local">Распознать на устройстве</option><option value="queue" ${(chatGPT.connected||routerKey)?'':'selected'}>Сохранить в очереди</option><option value="manual">Заполнить вручную по оригиналам</option></select></label>
    <label class="button primary file-picker">Выбрать документы<input id="visit-source" type="file" multiple accept="${importAccept}" aria-label="Выбрать документы для нового визита"></label>
    ${act('sampleVisit','Попробовать с примером PDF',episodeId,'text-button')}</div>
    <p class="hint">${originalTransferHint()}</p><p class="hint" id="import-progress" role="status">${(chatGPT.connected||routerKey)?'ИИ-провайдер подключён.':'ИИ-провайдер не подключён.'} Локальное распознавание доступно без входа.${workingFamily?'':' В демопрофиле используйте учебные документы.'}</p>`);
}
async function preparePhotoVisit(input,requestedMode){
  const route=routes.at(-1),files=input instanceof File?[input]:Array.from(input||[]);
  if(readOnly||route?.name!=='photoVisit'||!files.length||route.reading)return;
  const status=document.querySelector('#import-progress'),mode=requestedMode||document.querySelector('#visit-processing').value;
  if(files.some(f=>!f.size||!(isPhoto(f)||isPdf(f)||isTextFile(f)))){
    rejectFieldValue(document.querySelector('#visit-source'),'Выберите непустые фото, PDF или TXT.');return;
  }
  route.reading=true;
  const buttonList=document.querySelectorAll('#visit-source,[data-action=sampleVisit],#visit-processing');
  buttonList.forEach(b=>b.disabled=true);
  const profile=current(),patient=person.id,docs=[],before=profile.visitDrafts;
  const manual=before.find(d=>d.id===route.manualId&&d.manualOnly);
  try{
    const unique=new Map();
    for(const file of files){
      const digest=await sourceDigest(file);if(!unique.has(digest))unique.set(digest,file);
    }
    if(route!==routes.at(-1)||patient!==person.id||readOnly){route.reading=false;return}
    if(unique.size===1){
      const [digest,file]=unique.entries().next().value;
      const recent=latestProfile();
      const saved=await matchingOriginal(patient,file,digest,recent.files.filter(f=>f.visit&&visitSource(f)));
      const pending=saved?null:await matchingOriginal(patient,file,digest,recent.visitDrafts.filter(d=>!d.parent&&!d.manualOnly));
      if(saved||pending){
        if(route===routes.at(-1)&&patient===person.id){
          status.innerHTML=saved?'Этот документ уже есть в визите. '+act('visit','Открыть существующий визит',saved.visit,'text-button'):
            'Этот документ уже есть в черновике. '+act('resumeVisit','Открыть существующий черновик',pending.id,'text-button');
          document.querySelector('#visit-source').value='';
        }
        route.reading=false;buttonList.forEach(b=>b.disabled=false);return;
      }
    }
    for(const [digest,file] of unique){
      if(current()!==profile||route!==routes.at(-1)||patient!==person.id||readOnly)throw Error();
      const first=!docs.length,d={id:first&&manual?manual.id:uid(),parent:docs[0]?.id,episode:manual?.episode||route.id||'',name:file.name,type:file.type,date:todayLocal(),kind:suggestImportKind(file.name),state:'queued',sourceDigest:digest};
      if(first&&manual){
        const latest=latestProfile().visitDrafts.find(item=>item.id===manual.id);
        if(JSON.stringify(latest)!==JSON.stringify(manual))throw Error('Черновик изменился');
        d.fields=Object.fromEntries(Object.entries(manual.fields||{}).filter(([key,value])=>
          (value||key==='doctor')&&!(key==='date'&&value===todayLocal())));
        d.manualMeds=manual.manualMeds;
      }
      await fileBlob(patient+'/'+d.id,file);docs.push(d);
    }
    if(current()!==profile||route!==routes.at(-1)||patient!==person.id)throw Error();
    profile.visitDrafts=profile.visitDrafts.filter(d=>d!==manual).concat(docs);
    if(!saveState())throw Error();
  }catch{
    profile.visitDrafts=profile.visitDrafts.filter(d=>!docs.includes(d));
    if(manual&&!profile.visitDrafts.some(d=>d.id===manual.id))profile.visitDrafts.push(manual);
    await Promise.allSettled(docs.map(d=>removeBlob(patient+'/'+d.id)));
    route.reading=false;status.textContent='Не удалось сохранить комплект. Проверьте свободное место и повторите загрузку.';buttonList.forEach(b=>b.disabled=false);return;
  }
  route.reading=false;delete route.manualId;
  if(patient!==person.id||route!==routes.at(-1)||!panel.open)return;
  render();
  if(mode==='queue'){replaceRoute('resumeVisit',docs[0].id);return}
  route.id=docs[0].episode;
  await openImportDraft(docs[0].id,mode);
}
async function exampleForVisit(button){
  const route=routes.at(-1);button.disabled=true;
  try{
    const response=await fetch('assets/documents/prescription.pdf');if(!response.ok)throw Error();
    const blob=await response.blob();
    if(route===routes.at(-1)&&button.isConnected)await preparePhotoVisit(new File([blob],'Пример назначения.pdf',{type:'application/pdf'}),'local');
  }catch{if(button.isConnected)document.querySelector('#import-progress').textContent='Не удалось открыть пример. Выберите файл с устройства.'}
  finally{button.disabled=false}
}

