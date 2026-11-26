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
  const next={name,id:episodeId,modeDrafts:drafts,imported:route.photo||route.imported};
  if(next.imported)next.photo=next.imported;
  routes[routes.length-1]=next;displayRoute();
  const restored=document.querySelector('#visit-form'),saved=drafts[name];
  if(!restored||!saved)return;
  for(const key of ['episode','episodeName','date','title','note','doctor','doctorName','specialty','recommendation']){
    if(Object.hasOwn(saved.fields,key))restored.elements[key].value=saved.fields[key];
  }
  const rows=restored.querySelector('#rx-rows');if(rows)rows.innerHTML=saved.meds.map(medicineInputs).join('');
  toggleVisitInputs();
}
function parseVisitHeader(raw){
  const lines=raw.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
  function labelled(pattern){
    for(let i=0;i<lines.length;i++){
      const match=lines[i].match(pattern);
      if(match)return (match[1]||lines[i+1]||'').trim();
    }
    return '';
  }
  const episodeName=labelled(/^(?:эпизод(?: болезни)?|(?:основной |предварительный |клинический )?диагноз)(?:\s*[:·–—-]\s*(.*)|\s*)$/iu);
  const specialtyLine=lines.map(line=>line.match(/^((?:[а-яё-]+олог|терапевт|педиатр|хирург|врач общей практики|лор))\s*(?:[·:–—-]\s*|\s+)([\p{L}][\p{L}.'’\s-]+)$/iu)).find(Boolean);
  const doctorName=labelled(/^(?:(?:лечащий )?врач(?:\s+при[её]ма)?|фио врача)\s*(?:[:·–—-]\s*(.*)|\s*)$/iu)||specialtyLine?.[2]||'';
  const specialty=labelled(/^специальность\s*[:·–—-]\s*(.*)$/iu)||specialtyLine?.[1]||'';
  const title=labelled(/^(?:название визита|тип при[её]ма|вид посещения|визит)\s*[:·–—-]\s*(.*)$/iu)||
    lines.find(l=>/^(?:первичный |повторный )?(?:при[её]м|консультация|осмотр)\s+\p{L}/iu.test(l))||'';
  const note=labelled(/^(?:заключение(?: врача)?|жалобы|сведения о визите)(?:\s*[:·–—-]\s*(.*)|\s*)$/iu);
  const visitDate=labelled(/^дата(?: визита| при[её]ма| осмотра| консультации| посещения)?\s*[:·–—-]\s*(.*)$/iu);
  const candidate=visitDate?[visitDate]:lines.filter(l=>!/рожд|д\.\s*р\.|начал|окончан|повторный визит|контроль через/iu.test(l));
  const dates=new Set();
  for(const line of candidate){
    for(const m of line.matchAll(/(?<!\d)(?:(\d{4})-(\d\d)-(\d\d)|(\d{1,2})[./](\d{1,2})[./](\d{4}))(?!\d)/g)){
      const iso=m[1]?m[0]:[m[6],m[5].padStart(2,'0'),m[4].padStart(2,'0')].join('-');
      const date=new Date(iso+'T12:00:00Z');
      if(Number.isFinite(date.valueOf())&&date.toISOString().slice(0,10)===iso&&iso<=todayLocal())dates.add(iso);
    }
  }
  return {episodeName,doctorName,specialty,title,note,date:dates.size===1?[...dates][0]:''};
}
const importAccept='image/*,application/pdf,.pdf,text/plain,.txt';
const importKinds=['Назначения','Рекомендации','Лаборатория','Снимки','Заключения','Другое'];
function recommendationText(raw){
  const block=[];
  for(const line of raw.split(/\r?\n/)){
    const match=line.match(/^\s*(?:рекомендации(?: врача)?|рекомендовано)(?=\s|[:.—–-]|$)\s*[:.—–-]?\s*(.*)$/iu);
    if(match){block.push(match[1]);continue}
    if(!block.length)continue;
    if(/^\s*(?:назначения|диагноз|жалобы|дата|врач|подпись|обследование|заключение|результаты)(?=[:\s]|$)/iu.test(line))break;
    block.push(line.trim());
  }
  return block.join('\n').trim();
}
function suggestImportKind(name,raw=''){
  const blood=/анализ (?:крови|мочи)|лаборатор|гемоглобин|биохими|\bcbc\b/iu;
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
    (photo.raw?'<details><summary>Распознанный текст основного документа</summary><pre class="source-text">'+esc(photo.raw)+'</pre></details>':'')+'</div>';
}
function showPhotoVisit(episodeId){
  const route=routes.at(-1);
  if(route.photo){showNewVisit(episodeId,route.photo);return}
  openPanel(person.name,'Новый визит',visitModes('photo',episodeId)+`<div class="upload-zone">
    <span class="upload-icon">${icon('clip')}</span><strong>Документы одного визита</strong>
    <p class="hint">Выберите сразу несколько фото, PDF или текстовых файлов. Можно приложить назначение, рекомендации и бланки анализов.</p>
    <label>После выбора файлов<select id="visit-processing"><option value="local">Распознать на устройстве</option><option value="queue" ${routerKey?'':'selected'}>Сохранить в очереди</option><option value="manual">Заполнить вручную по оригиналам</option></select></label>
    <label class="button primary file-picker">Выбрать документы<input id="visit-source" type="file" multiple accept="${importAccept}" aria-label="Выбрать документы для нового визита"></label>
    ${act('sampleVisit','Попробовать с примером PDF',episodeId,'text-button')}</div>
    <p class="hint" id="import-progress" role="status">${routerKey?'ИИ-провайдер подключён.':'ИИ-провайдер не подключён.'} Локальное распознавание доступно без входа. Для прототипа используйте тестовые документы.</p>`);
}
async function preparePhotoVisit(input,requestedMode){
  const route=routes.at(-1),files=input instanceof File?[input]:Array.from(input||[]);
  if(readOnly||route?.name!=='photoVisit'||!files.length||route.reading)return;
  const status=document.querySelector('#import-progress'),mode=requestedMode||document.querySelector('#visit-processing').value;
  if(files.some(f=>!f.size||!(isPhoto(f)||isPdf(f)||isTextFile(f)))){
    status.textContent='Выберите непустые фото, PDF или TXT.';return;
  }
  route.reading=true;
  const buttonList=document.querySelectorAll('#visit-source,[data-action=sampleVisit],#visit-processing');
  buttonList.forEach(b=>b.disabled=true);
  const profile=current(),patient=person.id,docs=[];
  try{
    for(const file of files){
      const d={id:uid(),parent:docs[0]?.id,episode:route.id||'',name:file.name,type:file.type,date:todayLocal(),kind:suggestImportKind(file.name),state:'queued'};
      await fileBlob(patient+'/'+d.id,file);docs.push(d);
    }
    profile.visitDrafts.push(...docs);
    if(!saveState())throw Error();
  }catch{
    profile.visitDrafts=profile.visitDrafts.filter(d=>!docs.includes(d));
    await Promise.allSettled(docs.map(d=>removeBlob(patient+'/'+d.id)));
    route.reading=false;status.textContent='Не удалось сохранить комплект. Проверьте свободное место и повторите загрузку.';buttonList.forEach(b=>b.disabled=false);return;
  }
  route.reading=false;
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

