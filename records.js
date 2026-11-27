'use strict';

const sampleFiles = {
  anna: [
    {id:'rx', visit:'a1', name:'Лист назначений', category:'Назначения', date:'2026-11-18', file:'assets/documents/prescription.pdf'},
    {id:'cbc', visit:'a1', name:'Общий анализ крови', category:'Лаборатория', date:'2026-11-16', file:'assets/documents/cbc.pdf'},
    {id:'chem',visit:'a2',name:'Биохимия крови',category:'Лаборатория',date:'2026-10-28',file:'assets/documents/chem.pdf'},
    {id:'eye-note',visit:'a3',name:'Копия заключения офтальмолога',category:'Заключения',date:'2026-10-09',file:'assets/documents/eye-note.jpg'},
    {id:'cbc-old', visit:'a2', name:'Общий анализ крови', category:'Лаборатория', date:'2026-10-28', file:'assets/documents/cbc-oct.pdf'}
  ],
  misha:[{id:'exam',visit:'m1',name:'Заключение педиатра',category:'Заключения',date:'2026-11-12',file:'assets/documents/pediatric.pdf'}]
};
const labRows = [
  {name:'Гемоглобин',unit:'г/л',range:'120–150',values:{cbc:136,'cbc-old':132}},
  {name:'Лейкоциты',unit:'×10⁹/л',range:'4,0–9,0',values:{cbc:6.1,'cbc-old':5.7}},
  {name:'Глюкоза',unit:'ммоль/л',range:'3,9–5,5',values:{chem:4.8}}
];
const medicineDetails = [
  {strength:'50 мкг/доза', instructions:'По 2 впрыскивания в каждую ноздрю 1 раз в день', pack:'140 доз', term:'2026-12-01', search:'Мометазон'},
  {strength:'0,9 %', instructions:'По 1 орошению в каждую ноздрю 2 раза в день', pack:'100 мл', term:'2026-11-28', search:'Натрия хлорид'}
];
const guideline = 'https://www.entnet.org/resource/aao-hnsf-cpg-allergic-rhinitis-press-release-fact-sheet/';
const pharmacyRegions = {'Минск':'1001','Брест':'41','Гродно':'38','Витебск':'19'};
const marketExamples = [
  {name:'Моменекс',manufacturer:'Фортива Мед, Беларусь',price:'19,30–30,27',id:'20662'},
  {name:'Морис',manufacturer:'Lek, Словения',price:'26,10–37,03',id:'18728'},
  {name:'Назонекс',manufacturer:'Organon Heist, Бельгия',price:'34,19–48,86',id:'15971'}
];
const demoStateKey='health-story.demo.journal.v2';
const familyStateKey='health-story.family.journal';
function demoFamily(){
  return {id:'demo',name:'Семья Беловых',kind:'demo',adminId:'anna',members:demoPeople.map(({id,name,role})=>({id,name,role}))};
}
function personFromMember({id,name,role}){
  const parts=name.trim().split(/\s+/);
  return {id,name,role,short:parts[0],initials:parts.slice(0,2).map(s=>Array.from(s)[0]).join('').toUpperCase(),doctors:{},visits:[],course:null};
}
function familyStorageKey(data){return data?.family?.kind==='family'?familyStateKey:demoStateKey}
function validateFamily(data,allowDevice=false){
  const family=data?.family,validId=id=>typeof id==='string'&&/^p-[a-zA-Z0-9-]+$/.test(id);
  const text=name=>typeof name==='string'&&Boolean(name.trim())&&name.length<=100;
  if(data?.schemaVersion!==2||family?.kind!=='family'||!text(family.id)||!text(family.name)||!Array.isArray(family.members)||!family.members.length)throw Error('family');
  const ids=new Set();
  for(const m of family.members){
    if(!validId(m?.id)||ids.has(m.id)||!text(m.name)||!['Взрослый','Ребёнок'].includes(m.role)||!Array.isArray(data.profiles?.[m.id]?.files))throw Error('member');
    ids.add(m.id);
  }
  if(ids.size!==Object.keys(data.profiles).length)throw Error('roster');
  const grant=data.access;
  if(grant){
    const self=family.members.find(m=>m.id===grant.member);
    if(!allowDevice||!self||family.adminId!==null||!['adult','child'].includes(grant.role)||
      self.role!==(grant.role==='child'?'Ребёнок':'Взрослый')||
      family.members.some(m=>m!==self&&(grant.role==='child'||m.role!=='Ребёнок')))throw Error('device scope');
  }else if(!family.members.some(m=>m.id===family.adminId&&m.role==='Взрослый'))throw Error('admin');
  return family;
}
const requestedArchive=globalThis.location?new URL(location.href).searchParams:null;
const demoRequested=requestedArchive?.get('space')==='demo'||['adult','child'].includes(requestedArchive?.get('role'));
const installedFamily=readJson(familyStateKey);
const familyDisk=demoRequested&&!installedFamily?.access?null:installedFamily;
const stateKey=familyDisk?familyStateKey:demoStateKey;
const workingFamily=stateKey===familyStateKey;
const previous=workingFamily?familyDisk:readJson(demoStateKey);
const family=workingFamily?validateFamily(previous,true):demoFamily();
const people=workingFamily?family.members.map(personFromMember):demoPeople;
const fieldSpecs = [
  ['birthday','Дата рождения'],['height','Рост'],['weight','Вес'],['measured','Дата измерений'],
  ['allergy','Аллергии'],['chronic','Хронические заболевания']
];
const initialTags=[
  ['blood','Анализ крови','анализ крови, биохимия крови, ОАК, гематология'],
  ['urine','Анализ мочи','анализ мочи, ОАМ'],
  ['therapist','Терапевт','терапевт, терапевта'],
  ['pediatric','Педиатр','педиатр, педиатра'],
  ['allergy','Аллерголог','аллерголог, аллерголога'],
  ['fluoro','Флюорография','флюорография, флюорографии, флюрография, ФЛГ'],
  ['vaccine','Прививка','прививка, прививки, вакцинация, вакцинации, ревакцинация']
].map(([id,name,words])=>({id,name,keywords:words.split(', ')}));
function makeState(p) {
  return {fields:fieldSpecs.map(([id,label])=>({id,label,value:p[id]||''})),
    periods:(p.course?.meds || []).map((_,i)=>({start:p.course.start,planned:medicineDetails[i].term,end:'',closed:false,unknown:false})),
    auto:false,directAuto:false,notes:[],reviews:[],files:[],exams:[],examDrafts:[],episodes:[],addedVisits:[],addedDoctors:[],prompts:{},consultations:[],templates:[],measurements:[],changes:[],questions:[],marketCriteria:[],marketFindings:[],docLinks:[],visitLinks:[],visitDrafts:[],sampleAliases:{},prevention:[],tagEdits:[],recommendations:[],treatmentQueue:[]};
}
function readJson(key) {
  if(key===familyStateKey){
    const raw=localStorage.getItem(key);return raw?JSON.parse(localVault.open(raw)):null;
  }
  try {return JSON.parse(localStorage.getItem(key)||'null')} catch {return null}
}
const prototypeState = {schemaVersion:2,family,generation:'',tags:initialTags.map(t=>({...t,keywords:[...t.keywords]})),templates:[],city:'Минск', profiles:Object.fromEntries(people.map(p=>[p.id,makeState(p)]))};

if (previous?.profiles) {
  prototypeState.generation=previous.generation||'';
  if(workingFamily&&previous.sync)prototypeState.sync=structuredClone(previous.sync);
  if(workingFamily&&previous.access)prototypeState.access={...previous.access};
  if(Array.isArray(previous.tags))prototypeState.tags=previous.tags;
  if(Array.isArray(previous.templates))prototypeState.templates=previous.templates;
  if(Object.hasOwn(pharmacyRegions,previous.city)) prototypeState.city=previous.city;
  for(const p of people) {
    const data=previous.profiles[p.id], target=prototypeState.profiles[p.id];
    if(!data) continue;
    for(const key of ['fields','notes','reviews','files','exams','examDrafts','episodes','addedVisits','addedDoctors','consultations','templates','measurements','changes','questions','marketCriteria','marketFindings','docLinks','visitLinks','visitDrafts','prevention','tagEdits','recommendations','treatmentQueue']) if(Array.isArray(data[key])) target[key]=data[key];
    if(Array.isArray(data.savedConflicts))target.savedConflicts=data.savedConflicts;
    if(!workingFamily&&Array.isArray(data.hiddenDemoPrevention))target.hiddenDemoPrevention=data.hiddenDemoPrevention;
    if(data.sampleAliases)target.sampleAliases=data.sampleAliases;
    if(data.prompts && typeof data.prompts==='object')target.prompts=data.prompts;
    if(Array.isArray(data.periods) && data.periods.length===target.periods.length) target.periods=data.periods;
    target.auto=data.auto===true;target.directAuto=data.directAuto===true;
    if(data.chatGPTAuto===true)target.chatGPTAuto=true;
  }
} else {
  const old=readJson('health-story.demo.courses.v1');
  for(const p of people) {
    const periods=prototypeState.profiles[p.id].periods;
    if(Array.isArray(old?.[p.id]) && old[p.id].length===periods.length)
      old[p.id].forEach((date,i)=>Object.assign(periods[i],{closed:true,end:date||'',unknown:date===null}));
  }
}
for(const p of people){
  const profile=prototypeState.profiles[p.id], episodes=new Map();
  for(const visit of p.visits){
    if(!episodes.has(visit[4]))episodes.set(visit[4],'ep-'+visit[0]);
    visit[7]=episodes.get(visit[4]);
  }
  for(const [name,id] of episodes)if(!profile.episodes.some(e=>e.id===id))profile.episodes.push({id,name});
  for(const d of profile.addedDoctors)p.doctors[d.id]=d.values;
  const savedVisitIds=new Set(profile.addedVisits.map(v=>v[0]));
  p.visits=[...profile.addedVisits,...p.visits.filter(v=>!savedVisitIds.has(v[0]))].sort((a,b)=>b[1].localeCompare(a[1]));
}
// Stable fixture IDs also populate demo profiles saved by earlier versions.
const demoPrevention=[
  {id:'demo-flu-vaccine',kind:'vaccine',title:'Прививка от гриппа',date:'2026-10-30',source:'visit:a2'},
  {id:'demo-fluorography',kind:'procedure',title:'Флюорография органов грудной клетки',date:'2026-10-29',source:'visit:a2'},
  {id:'demo-blood',kind:'lab',title:'Общий анализ крови',date:'2026-10-28',source:'lab:cbc-old'}
];
for(const {id,kind,title,date,source} of workingFamily?[]:demoPrevention){
  const list=prototypeState.profiles.anna.prevention;
  if(!prototypeState.profiles.anna.hiddenDemoPrevention?.includes(id)&&!list.some(p=>p.id===id))list.push({id,kind,title,next:'',period:'',note:'',
    history:[{id:id+'-done',date,source,note:'Демонстрационная запись'}]});
}
function confirmedRecommendations(id){
  return [...current().recommendations.filter(r=>r.visit===id),
    ...current().files.filter(f=>f.visit===id&&f.checked&&f.recommendation).map(f=>({text:f.recommendation,source:f.id}))];
}
function current() {return prototypeState.profiles[person.id]}
function identityText(value) {
  return String(value??'').normalize('NFC').trim().replace(/\s+/gu,' ').toLocaleLowerCase('ru');
}
function identityRows(rows,keys) {
  return (Array.isArray(rows)?rows:[]).map(row=>JSON.stringify(keys.map(key=>identityText(row?.[key])))).sort();
}
function visitIdentity(row,doctors) {
  const doctor=doctors[row[3]]||[];
  return JSON.stringify([row[1],row[2],doctor[0]||row[3],doctor[1],row[9]??doctor[2],row[5]].map(identityText)
    .concat([identityRows(row[8],['name','strength','form','instructions'])]));
}
function examIdentity(row) {
  if(!row.description?.trim()&&!row.conclusion?.trim()&&!row.parameters?.length)return '';
  return JSON.stringify(['date','method','region','clinic','doctor','description','conclusion'].map(key=>identityText(row[key]))
    .concat([identityRows(row.parameters,['name','value','unit'])]));
}
function labIdentity(row) {
  return JSON.stringify(['date','name','laboratory'].map(key=>identityText(row[key]))
    .concat([identityRows(row.rows,['name','value','unit','range','specimen'])]));
}
function latestProfile() {
  const saved=readJson(stateKey)?.profiles?.[person.id];
  return saved?{...current(),...saved}:current();
}
function visitSource(row) {
  return row.category==='Назначения'&&(row.visitSource||row.visitImportRevision||!row.intake&&row.raw);
}
function sameVisit(row,doctors={}) {
  const profile=latestProfile(),lookup={...person.doctors,...Object.fromEntries(profile.addedDoctors.map(d=>[d.id,d.values])),...doctors};
  const rows=new Map([...person.visits,...profile.addedVisits].map(v=>[v[0],v]));
  const key=visitIdentity(row,lookup);
  return Array.from(rows.values()).find(v=>v[0]!==row[0]&&visitIdentity(v,lookup)===key);
}
async function sourceDigest(blob) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer())),byte=>byte.toString(16).padStart(2,'0')).join('');
}
async function matchingOriginal(owner,file,digest,rows) {
  for(const row of rows) {
    if(row.sourceDigest){
      if(row.sourceDigest===digest)return row;
      continue;
    }
    if(identityText(row.name)!==identityText(file.name))continue;
    const original=await fileBlob(owner+'/'+row.id);
    if(original?.size===file.size&&await sourceDigest(original)===digest)return row;
  }
}
function duplicateCard(form,kind,id,caption) {
  const error=form.querySelector('.error');
  const visible=kind==='visit'?visitById(id):kind==='exam'?current().exams.some(e=>e.id===id):
    kind==='episode'?current().episodes.some(e=>e.id===id):current().files.some(f=>f.id===id);
  if(!visible){error.textContent='Такая карточка сохранена в другой вкладке. Обновите профиль, чтобы открыть её.';return}
  error.innerHTML='В этом профиле уже есть карточка с такими данными. '+act(kind,caption||'Открыть существующую карточку',id,'text-button');
}
// Apply this tab's changes to the latest archive to preserve independent edits in another tab.
let savedView=JSON.stringify(previous?.profiles?previous:prototypeState);
function mergeLocalChanges(base,local,disk,key){
  if((key==='visitLinks'||key==='marketFindings')&&base===undefined)base=[];
  if(JSON.stringify(base)===JSON.stringify(local))return disk;
  if(base==null||disk==null||typeof local!=='object'||local==null)return local;
  if(Array.isArray(local)){
    if(!Array.isArray(base)||!Array.isArray(disk))return local;
    const id=x=>key==='addedVisits'?x?.[0]:x?.id;
    if(![...base,...local,...disk].every(x=>typeof id(x)==='string')){
      return base.length===local.length&&disk.length===base.length
        ?local.map((entry,i)=>mergeLocalChanges(base[i],entry,disk[i])):local;
    }
    const old=new Map(base.map(x=>[id(x),x])),edited=new Map(local.map(x=>[id(x),x]));
    const merged=new Map(disk.filter(x=>!old.has(id(x))||edited.has(id(x))).map(x=>[id(x),x]));
    for(const [k,x] of edited)if(!old.has(k)||JSON.stringify(old.get(k))!==JSON.stringify(x)){
      merged.set(k,mergeLocalChanges(old.get(k),x,merged.get(k)));
    }
    return [...merged.values()];
  }
  const result={...disk};
  for(const prop of Object.keys(base))if(!Object.hasOwn(local,prop))delete result[prop];
  for(const prop of Object.keys(local)){
    const next=mergeLocalChanges(base[prop],local[prop],disk[prop],prop);
    if(next!==undefined)result[prop]=next;
  }
  return result;
}
function saveState() {
  try {
    const local=JSON.stringify(prototypeState), latest=readJson(stateKey),disk=latest&&JSON.stringify(latest);
    if(workingFamily){
      if(!latest||latest.access?.role==='child')return false;
      validateFamily(prototypeState,true);
      const grant=latest.access,localGrant=prototypeState.access;
      if(Boolean(grant)!==Boolean(localGrant))return false;
      if(grant&&['deviceId','role','member','revision'].some(k=>grant[k]!==localGrant[k]))return false;
      if(latest.access){
        for(const k of ['family','templates','tags','city'])if(JSON.stringify(latest[k])!==JSON.stringify(prototypeState[k]))return false;
        for(const p of latest.family.members)if(p.id!==latest.access.member){
          for(const k of ['auto','directAuto','chatGPTAuto'])if((latest.profiles[p.id][k]===true)!==(prototypeState.profiles[p.id][k]===true))return false;
        }
      }
    }
    if(latest&&(latest.generation||'')!==prototypeState.generation){
      announce('В другой вкладке восстановили архив. Обновите страницу, чтобы продолжить.');return false;
    }
    let output=disk&&disk!==savedView?JSON.stringify(mergeLocalChanges(JSON.parse(savedView),prototypeState,latest)):local;
    if(workingFamily&&output!==disk){
      const changed=JSON.parse(output);
      if(latest.sync){
        changed.sync=structuredClone(latest.sync);
        deviceSync.noteChanges(latest,changed);
        prototypeState.sync=structuredClone(changed.sync);
      }
      if(latest.access){changed.access.edited=true;prototypeState.access.edited=true}
      output=JSON.stringify(changed);
    }
    if(output!==disk)localStorage.setItem(stateKey,workingFamily?localVault.seal(output):output);
    savedView=workingFamily?JSON.stringify(prototypeState):local;return true;
  }
  catch {document.querySelector('#announcement').textContent='Хранилище браузера недоступно. Изменения сохранены до закрытия страницы.';return false}
}
function field(id) {return current().fields.find(f=>f.id===id)?.value || ''}
function cleanClinicalText(value){
  const names=[...people.map(p=>p.name),...Object.values(person.doctors).map(d=>d[0])];
  const local=current();
  const clinics=[...Object.values(person.doctors).map(d=>d[2]),...person.visits.map(v=>v[9]),
    ...local.visitDrafts.map(d=>d.header?.clinic),...local.exams.map(e=>e.clinic)];
  const files=[...local.files,...local.visitDrafts].map(f=>f.name);
  return anonymizeClinicalText(redactClinicalLabels(value,clinics,files),names);
}
function reviewOutboundText(box,status){
  const safe=cleanClinicalText(box.value);
  if(safe===box.value)return true;
  box.value=safe;
  status.textContent='Личные сведения скрыты. Проверьте обновлённый текст и подтвердите ещё раз.';
  box.focus();
  return false;
}
function yearsAt(date) {
  const birth=field('birthday');
  if(!/^\d{4}-\d\d-\d\d$/.test(birth)||birth>date) return null;
  return Number(date.slice(0,4))-Number(birth.slice(0,4))-(date.slice(5)<birth.slice(5)?1:0);
}
function ageText(n) {
  if(n===null) return '';
  const f=new Intl.PluralRules('ru').select(n);
  return n+' '+({one:'год',few:'года',many:'лет',other:'лет'}[f]);
}
function esc(text) {
  return String(text??'').replace(/[&<>"']/g, char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
}
function uid(){return globalThis.crypto?.randomUUID?.() || Date.now().toString(36)+'-'+Math.random().toString(36).slice(2)}
function medicineSignature(m){
  return [m.name,m.strength,m.form,m.instructions].map(x=>String(x||'').toLocaleLowerCase('ru').replace(/\s+/g,' ').trim()).join('|');
}
function isActiveMed(m){return !m.period.closed&&!m.endedBy&&!m.continuedFrom}
function prescribedForReview(id){
  const meds=[...(courseAt(id)?.meds||[])];
  for(const c of current().changes.filter(c=>c.visit===id&&c.kind==='continue')){
    const source=courseAt(c.source)?.meds||[],sourceIndex=source.findIndex(m=>m.id===c.medId);
    const index=meds.findIndex(m=>medicineSignature(m)===medicineSignature(c.before));
    const original=source[sourceIndex],item={...original,...c.before,period:original?.period||emptyPeriod(),continuedFrom:c.source,
      sourceKey:sourceIndex>=0?medKey(c.source,sourceIndex):null};
    if(index<0)meds.push(item);else meds[index]=item;
  }
  return meds;
}
function courseAt(id){
  const direct=visitById(id)?.[8]||[];
  const meds=person.course?.visit===id?person.course.meds.map((m,i)=>{
    const fixtureId='fixture-'+i,edit=direct.find(row=>row.id===fixtureId);
    return {...m,id:fixtureId,...medicineDetails[i],...edit,period:current().periods[i],fixture:true};
  }):[];
  const fixtureIds=new Set(meds.map(m=>m.id));
  meds.push(...direct.filter(m=>!fixtureIds.has(m.id)));
  for(const f of current().files)if(f.visit===id && (f.checked||f.lastConfirmed))meds.push(...(f.meds||[]));
  for(const c of current().changes)if(c.visit===id&&c.replacement)meds.push(c.replacement);
  const history=current().changes.filter(c=>c.source===id&&c.kind!=='continue');
  // Multiple pages can repeat an identical prescription. Keep the physician's decision as its stable identity.
  const distinct=new Map(meds.map(m=>[medicineSignature(m),m]));
  const continued=current().changes.filter(c=>c.visit===id&&c.kind==='continue');
  return meds.length?{visit:id,meds:[...distinct.values()].map(m=>({...m,endedBy:history.find(c=>c.medId===m.id),continuedFrom:continued.find(c=>medicineSignature(c.before)===medicineSignature(m))?.source}))}:null;
}
function allCourses(){return person.visits.map(v=>courseAt(v[0])).filter(Boolean)}
function activeCourse(){return allCourses().some(c=>c.meds.some(isActiveMed))}
function medKey(visit,index){return visit===person.course?.visit?String(index):visit+':'+index}
function medFromKey(key){
  const parts=String(key).split(':'), visit=parts.length===1?person.course?.visit:parts[0], index=Number(parts.at(-1));
  return {visit,index,med:courseAt(visit)?.meds[index]};
}
function allFiles(){return [...(workingFamily?[]:sampleFiles[person.id]||[]),...current().files.filter(f=>!f.examDraft)]}
function labs(){return allFiles().filter(f=>f.category==='Лаборатория'&&(f.file||f.lab))}
function labCategory(id){return current().files.find(f=>f.id===id)?.lab?.category||(id==='chem'?'Биохимия':'Гематология')}
function labResults(id){const report=current().files.find(f=>f.id===id)?.lab;return report?report.rows.map(r=>({...r,values:{[id]:r.value}})):labRows.filter(row=>Object.hasOwn(row.values,id))}
function stamp(date){
  const value=new Date(date);
  return date!=null&&Number.isFinite(value.getTime())?new Intl.DateTimeFormat('ru',{dateStyle:'short',timeStyle:'short'}).format(value):'Дата неизвестна';
}
function storageDB(state=prototypeState) {
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(familyStorageKey(state)===familyStateKey?'health-story-family-files':'health-story-demo-files',1);
    req.onupgradeneeded=()=>req.result.createObjectStore('documents');
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error);
  });
}
async function removeBlob(id,state=prototypeState,cacheOnly=false){
  authorizeOriginal(id,state,!cacheOnly);
  const db=await storageDB(state);
  try{await new Promise((resolve,reject)=>{
    if(cacheOnly&&state.generation!==readJson(familyStateKey)?.generation){resolve();return}
    const tx=db.transaction('documents','readwrite');tx.objectStore('documents').delete(id);
    tx.oncomplete=resolve;tx.onabort=tx.onerror=()=>reject(tx.error);
  })}finally{db.close()}
}
function originalKey(state,id){
  const [patient,doc]=id.split('/'),profile=state.profiles[patient];
  const alias=profile?.files.find(f=>f.id===doc)?.blobId||profile?.visitDrafts?.find(f=>f.id===doc)?.blobId||profile?.sampleAliases?.[doc];
  return alias?patient+'/'+alias:id;
}
function authorizeOriginal(id,state,write){
  if(familyStorageKey(state)!==familyStateKey)return;
  const installed=readJson(familyStateKey),grant=installed?.access;
  if(state===prototypeState&&state.generation!==installed?.generation)throw Error('stale original');
  if(!grant)return;
  const [owner]=id.split('/');
  if(!Object.hasOwn(installed.profiles,owner)||state.family.id!==installed.family.id||(write&&grant.role==='child'))throw Error('device scope');
}
async function fileBlob(id, file, state=prototypeState) {
  const logicalId=id;
  authorizeOriginal(id,state,Boolean(file));
  if(!file)id=originalKey(state,id);

  // Store bytes instead of a File object so the record is portable across WebKit and Chromium.
  const secured=familyStorageKey(state)===familyStateKey;
  const bytes=file&&(secured||file.size<126*1024*1024?await file.arrayBuffer():file.slice());
  const entry=file?(secured?await localVault.sealFile(id,bytes,file.type):{bytes,type:file.type}):null;
  const db=await storageDB(state);
  try {const stored=await new Promise((resolve,reject)=>{
    const tx=db.transaction('documents',file?'readwrite':'readonly');
    const store=tx.objectStore('documents'), req=file?store.put(entry,id):store.get(id);
    tx.oncomplete=()=>{
      const result=req.result;
      resolve(!file && result?.bytes ? new Blob([result.bytes],{type:result.type}) : result);
    };
    tx.onabort=()=>reject(tx.error);
    tx.onerror=()=>reject(tx.error);
  });
    if(!file&&!stored&&secured&&state.sync)return deviceSync.loadOriginal(logicalId,state);
    return !file&&secured?await localVault.openFile(id,stored):stored
  } finally {db.close()}
}
