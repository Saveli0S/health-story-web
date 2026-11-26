'use strict';

function familyDevices(){
  const visible=accessibleProfiles();
  openPanel('Настройки','Семья и устройства','<p class="detail-meta">Этот браузер · '+({admin:'администратор',adult:'взрослый',child:'ребёнок'}[viewer])+'</p>'+
    visible.map(p=>resultRow('select',p.id,p.name,readOnly?'Только просмотр':p.role+' · доступно редактирование','user')).join('')+familyActions()+
    deviceMenu());
}
function archivePanel(){
  const canCrypt=Boolean(globalThis.crypto?.subtle);
  const offline=window.isSecureContext&&'serviceWorker' in navigator?act('offlineKit','Скачать распознавание для работы без сети','','button secondary','clip')+'<p role="status" id="offline-result"></p>':'';
  openPanel('Настройки','Синхронизация и резервная копия','<div class="summary-sheet"><strong>Сохранено в этом браузере</strong><div id="sync-view"></div></div>'+
    (viewer==='admin'?(canCrypt?'<p>Семейная копия включает записи всех профилей и оригиналы. Ключ восстановления храните отдельно от файла.</p><div class="actions left">'+act('exportBackup','Создать зашифрованный бэкап','','button primary')+act('importBackup','Проверить или восстановить копию','','button secondary')+'</div>':'<p>Создание и восстановление зашифрованной копии доступны по HTTPS или на localhost.</p>'):'<p>Семейный архив доступен администратору.</p>')+(driveAllowed()?act('drive','Google Диск','','button secondary','folder'):'')+offline);
  deviceSync.draw();
}
function toBase64(data){
  return localVault.encode64(data);
}
function fromBase64(text){return localVault.decode64(text)}
function exportForm(){
  if(viewer!=='admin')return;
  const key=workingFamily?deviceAuthority(family.id).recovery:base64url(crypto.getRandomValues(new Uint8Array(32)));
  openPanel('Семейный архив','Сохранить резервную копию',`<form class="edit-form" id="backup-export"><p class="hint">Сохраните ключ отдельно от файла. Если хотите использовать ранее записанный семейный ключ, вставьте его в поле.</p><label>Ключ восстановления семьи<input required spellcheck="false" autocomplete="off" name="key" value="${key}"></label>
    <label class="source-choice"><input required type="checkbox">Ключ записан отдельно</label><button class="button primary">Подготовить файл</button><p role="status"></p></form>`);
}
function importForm(cloudFile){
  if(viewer!=='admin')return;
  openPanel('Семейный архив','Проверить резервную копию',`<form id="backup-import" class="edit-form">
    <label>Зашифрованный архив<input required type="file" name="archive" accept=".health"></label>
    <label>Ключ восстановления<input required name="key" type="password" autocomplete="off"></label>
    <p class="hint">Проверка читает файл на этом устройстве. После неё можно закрыть окно или восстановить данные.</p>
    <p role="status"></p>
    <label class="source-choice" hidden><input type="checkbox" name="replace">Восстановить указанную семью из копии, заменив её текущие записи</label>
    <button class="button primary">Проверить копию</button></form>`);
  const form=document.querySelector('#backup-import');
  if(cloudFile instanceof Blob){
    form.cloudFile=cloudFile;
    const label=form.elements.archive.parentElement;
    form.elements.archive.required=false;label.hidden=true;
    const info=document.createElement('p');info.textContent='Выбрана зашифрованная копия из Google Диска. ';
    clearFileURL();fileURL=URL.createObjectURL(cloudFile);
    const download=document.createElement('a');download.href=fileURL;download.download='google-drive-backup.health';
    download.textContent='Скачать зашифрованный файл';info.append(download);form.prepend(info);
  }
  function resetCheck(){
    const message=form.querySelector('[role=status]');
    if(!form.dataset.verified&&!message.textContent)return;
    form.elements.replace.checked=false;
    form.elements.replace.required=false;
    form.elements.replace.parentElement.hidden=true;
    form.querySelector('button').textContent='Проверить копию';
    message.textContent='';
    delete form.dataset.verified;delete form.verifiedTarget;
  }
  form.elements.key.oninput=resetCheck;form.elements.archive.onchange=resetCheck;
}
async function archiveKey(text){
  const bytes=fromBase64(text.trim().replaceAll('-','+').replaceAll('_','/'));
  if(bytes.length!==32)throw Error();
  return crypto.subtle.importKey('raw',bytes,'AES-GCM',false,['encrypt','decrypt']);
}
async function encryptedArchive(key){
  if(viewer!=='admin'||readJson(familyStateKey)?.access)throw Error('permission');
  const data=readJson(stateKey)||JSON.parse(JSON.stringify(prototypeState)),files=[];
    if(!workingFamily&&!data.schemaVersion){data.schemaVersion=2;data.family=demoFamily()}
    for(const {owner,item,sample} of archiveItems(data)){
      let blob=await fileBlob(owner+'/'+item.id,null,data);
      if(!blob&&sample){const res=await fetch(item.file);if(res.ok)blob=await res.blob()}
      if(!blob)throw Error();
      files.push({id:owner+'/'+item.id,type:blob.type,bytes:toBase64(new Uint8Array(await blob.arrayBuffer()))});
    }
    deviceSync.keepConflicts(data);
    const iv=crypto.getRandomValues(new Uint8Array(12));
    const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(JSON.stringify({version:2,data,files})));
  return new Blob(['HS01',iv,ciphertext],{type:'application/octet-stream'});
}
async function exportArchive(f){
  if(viewer!=='admin')return;
  const msg=f.querySelector('[role=status]'),button=f.querySelector('button');
  button.disabled=true;let key;
  try{key=await archiveKey(f.elements.key.value)}catch{button.disabled=false;msg.textContent='Проверьте ключ восстановления семьи.';return}
  msg.textContent='Собираем оригиналы…';
  try{
    const blob=await encryptedArchive(key);
    if(!f.isConnected)return;
    clearFileURL();fileURL=URL.createObjectURL(blob);
    msg.innerHTML='<a class="button primary" href="'+esc(fileURL)+'" download="family-'+todayLocal()+'.health">Скачать зашифрованный файл</a>';
  }catch{msg.textContent='Архив не создан. Проверьте доступность всех оригиналов и свободную память.'}finally{button.disabled=false}
}
function archiveItems(data,allowDevice=false){
  const isDemo=data?.family?.kind==='demo';
  const members=isDemo?demoPeople:validateFamily(data,allowDevice).members;
  if(data.schemaVersion!==2||!data.profiles||Object.keys(data.profiles).length!==members.length)throw Error();
  const items=[];
  for(const {id:owner} of members){
    const profile=data.profiles[owner];
    if(!Array.isArray(profile?.files)||!Array.isArray(profile.visitDrafts??[]))throw Error();
    for(const item of [...profile.files,...(profile.visitDrafts||[])])items.push({owner,profile,item,sample:false});
    if(isDemo)for(const item of sampleFiles[owner])items.push({owner,profile,item,sample:true});
  }
  return items;
}
// Keep legacy identifiers and originals in the demo archive when reading HS01/v1.
function archiveOriginals(archive,allowDevice=false){
  if(!Array.isArray(archive?.files)||!archive.data||![1,2].includes(archive.version))throw Error();
  const data=archive.version===1?{...archive.data,schemaVersion:2,family:demoFamily()}:archive.data;
  const originals=new Map();
  for(const entry of archive.files){
    if(!entry||typeof entry.id!=='string'||typeof entry.bytes!=='string'||!entry.bytes||typeof entry.type!=='string'||originals.has(entry.id))throw Error();
    originals.set(entry.id,entry);
  }
  const result=[];
  for(const entry of archiveItems(data,allowDevice)){
    const {owner,item}=entry;
    if(typeof item?.id!=='string'||!item.id||item.id.includes('/'))throw Error();
    const id=owner+'/'+item.id,source=originals.get(id);
    if(!source)throw Error();
    originals.delete(id);result.push({...entry,source});
  }
  if(originals.size)throw Error();
  return result;
}
async function importArchive(f){
  if(viewer!=='admin'||f.dataset.busy)return;
  const restore=f.dataset.verified==='true';
  if(restore&&!f.elements.replace.checked)return;
  const msg=f.querySelector('[role=status]'),button=f.querySelector('button'),file=f.cloudFile||f.elements.archive.files[0];
  const controls=[...f.elements];controls.forEach(el=>el.disabled=true);
  f.dataset.busy='true';msg.textContent=restore?'Восстанавливаем данные…':'Проверяем ключ и комплектность оригиналов…';
  const staged=[];let committed=false,targetData;
  try{
    const snapshots=restore?new Map([demoStateKey,familyStateKey].map(k=>[k,localStorage.getItem(k)])):null;
    const bytes=new Uint8Array(await file.arrayBuffer());
    if(new TextDecoder().decode(bytes.slice(0,4))!=='HS01')throw Error();
    const key=await archiveKey(f.elements.key.value),plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes.slice(4,16)},key,bytes.slice(16));
    const archive=JSON.parse(new TextDecoder().decode(plain)),originals=archiveOriginals(archive);
    targetData=archive.data;delete targetData.sync;
    if(archive.version===1){targetData.schemaVersion=2;targetData.family=demoFamily()}
    const destKey=familyStorageKey(targetData),demoTarget=destKey===demoStateKey;
    if(!demoTarget&&readJson(familyStateKey)?.access)throw Error('permission');
    if(!demoTarget&&restore)await localVault.ensure();
    const destName=demoTarget?'Демонстрационная семья':targetData.family.name;
    const profiles=Object.values(targetData.profiles);
    if(restore)for(const profile of profiles)profile.sampleAliases={};
    for(const {owner,profile,item,source,sample} of originals){
      const content=fromBase64(source.bytes);
      if(!content.length)throw Error();
      if(!restore)continue;
      const blobId=uid(),dest=owner+'/'+blobId;
      if(sample)profile.sampleAliases[item.id]=blobId;else item.blobId=blobId;
      await fileBlob(dest,new Blob([content],{type:source.type}),targetData);staged.push(dest);
    }
    if(!panel.open||!f.isConnected)throw Error();
    if(!restore){
      msg.textContent='Копия проверена. Профилей: '+profiles.length+'. Оригиналов: '+originals.length+'. Черновиков визитов: '+
        profiles.reduce((count,p)=>count+(p.visitDrafts||[]).filter(d=>!d.parent).length,0)+'. Восстановление: '+destName+'.';
      f.verifiedTarget=localStorage.getItem(destKey);
      const localTarget=readJson(destKey);
      if(localTarget?.family?.kind==='family')msg.textContent+=' Текущая семья в этом браузере: '+localTarget.family.name+'.';
      f.dataset.verified='true';f.elements.replace.parentElement.hidden=false;f.elements.replace.required=true;
      button.textContent='Восстановить';return;
    }
    const startState=snapshots.get(destKey);
    if(startState!==f.verifiedTarget||localStorage.getItem(destKey)!==startState)throw Error('changed');
    const before=readJson(destKey);
    archive.data.generation=uid();
    if(demoTarget)localStorage.setItem(destKey,JSON.stringify(targetData));
    else{
      const id=targetData.family.id,authoritySlot='health-story.family.authority.'+id;
      const earlierAuthority=localStorage.getItem(authoritySlot),sealed=localVault.seal(JSON.stringify(targetData));
      try{
        const authority=deviceAuthority(id);
        authority.recovery=base64url(fromBase64(f.elements.key.value.trim().replaceAll('-','+').replaceAll('_','/')));
        storeDeviceAuthority(id,authority);
        localStorage.setItem(destKey,sealed);
      }catch(error){
        if(earlierAuthority===null)localStorage.removeItem(authoritySlot);
        else localStorage.setItem(authoritySlot,earlierAuthority);
        throw error;
      }
    }
    committed=true;
    if(before){
      const replaced=new Set();
      for(const [owner,old] of Object.entries(before.profiles)){
        for(const item of [...old.files,...(old.visitDrafts||[])])replaced.add(originalKey(before,owner+'/'+item.id));
        for(const alias of Object.values(old.sampleAliases||{}))replaced.add(owner+'/'+alias);
      }
      await Promise.allSettled([...replaced].filter(id=>!staged.includes(id)).map(id=>removeBlob(id,targetData)));
    }
    if(destKey===stateKey)location.reload();else enterSpace(demoTarget?'demo':'family');
  }catch(error){
    if(committed){enterSpace(familyStorageKey(targetData)===demoStateKey?'demo':'family');return}
    await Promise.allSettled(staged.map(id=>removeBlob(id,targetData)));
    if(error.message==='changed'){
      delete f.dataset.verified;delete f.verifiedTarget;f.elements.replace.checked=false;f.elements.replace.required=false;
      f.elements.replace.parentElement.hidden=true;button.textContent='Проверить копию';
      msg.textContent='После проверки записи изменились. Проверьте копию ещё раз перед восстановлением.';
    }
    else msg.textContent=restore?'Не удалось восстановить архив. Действующий архив сохранён.':'Проверка не пройдена. Проверьте файл, ключ и версию копии.';
  }finally{
    delete f.dataset.busy;controls.forEach(el=>el.disabled=false);
  }
}

async function prepareOffline(button){
  const msg=document.querySelector('#offline-result');button.disabled=true;msg.textContent='Сохраняем локальные движки…';
  try{
    const reg=await Promise.race([navigator.serviceWorker.ready,new Promise((_,reject)=>setTimeout(()=>reject(Error()),7000))]);
    const channel=new MessageChannel();
    const ok=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error()),120000);channel.port1.onmessage=e=>{clearTimeout(timer);resolve(e.data)};
      reg.active.postMessage('offline-engines',[channel.port2])});
    if(!ok)throw Error();msg.textContent='Приложение и распознавание доступны без сети.';
  }catch{msg.textContent='Не удалось загрузить компоненты. Проверьте соединение и повторите.'}
  finally{button.disabled=false}
}
