'use strict';

// Only the administrator's browser keeps the family recovery key and issuance registry.
function storeDeviceAuthority(familyId,value){
  localStorage.setItem('health-story.family.authority.'+familyId,localVault.seal(JSON.stringify(value)));
}
function deviceAuthority(familyId){
  if(readJson(familyStateKey)?.access)throw Error('administrator required');
  const value=localStorage.getItem('health-story.family.authority.'+familyId);
  if(value)return JSON.parse(localVault.open(value));
  const result={recovery:base64url(localVault.random(32)),devices:[]};
  storeDeviceAuthority(familyId,result);return result;
}
function deviceMenu(){
  if(!workingFamily)return '<p class="hint">Подключение доступно для рабочего семейного архива.</p>';
  if(previous.access?.role==='admin')return '<p class="hint">У этого браузера есть доступ ко всем профилям. Выдача и отзыв доступа доступны в основном браузере семьи.</p>'+act('joinDevice','Получить обновление','','button secondary');
  if(viewer!=='admin')return '<p class="hint">Права назначил администратор семьи. Для получения новой копии используйте файл и код от него.</p>'+act('joinDevice','Получить обновление','','button secondary');
  const devices=deviceAuthority(family.id).devices;
  return '<section class="panel-section"><h3>Подключённые устройства</h3>'+
    (devices.map(d=>'<div class="plain-card"><strong>'+esc(d.label)+'</strong><p>'+esc(family.members.find(m=>m.id===d.member)?.name||'')+' · '+esc(shortDeviceId(d.id))+' · '+(d.revoked?'Доступ отозван':'Доступ выдан')+'</p>'+
      (d.revoked?'':(d.spki?act('deviceUpdate','Передать свежую копию',d.id,'button secondary'):'')+act('revokeDevice','Отозвать доступ',d.id,'text-button'))+'</div>').join('')||'<p>Пока подключено только ваше устройство.</p>')+
    act('grantDevice','Выдать доступ устройству','','button secondary')+'</section>';
}
function shortDeviceId(id){return id.slice(0,16).match(/.{4}/g).join(' ').toUpperCase()}
async function deviceFingerprint(spki){
  const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',spki));
  return [...digest].map(b=>b.toString(16).padStart(2,'0')).join('');
}
async function pairingIdentity(){
  await localVault.ensure();
  const registered=Boolean(readJson(familyStateKey)?.access);
  const pair=await localVault.deviceMaterial('pair-rsa',()=>crypto.subtle.generateKey(
    {name:'RSA-OAEP',modulusLength:3072,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},false,['encrypt','decrypt']),!registered);
  const spki=new Uint8Array(await crypto.subtle.exportKey('spki',pair.publicKey));
  return {privateKey:pair.privateKey,id:await deviceFingerprint(spki),spki:toBase64(spki)};
}
function fileLink(content,name,label){
  clearFileURL();fileURL=URL.createObjectURL(new Blob([JSON.stringify(content)],{type:'application/octet-stream'}));
  return '<a class="button secondary" href="'+esc(fileURL)+'" download="'+esc(name)+'">'+esc(label)+'</a>';
}
async function joinDevicePanel(){
  if((workingFamily&&!previous.access)||(!workingFamily&&readJson(familyStateKey))||!crypto.subtle)return;
  openPanel('Семья и устройства',workingFamily?'Получить обновление':'Подключиться к семье',
    '<div id="device-request" role="status">Подготавливаем ключ устройства…</div>'+
    '<form id="device-install" class="edit-form"><label>Файл доступа от администратора<input type="file" required name="packet" accept=".health-device"></label>'+
    '<label>Код от администратора<input name="code" required autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false"></label>'+
    '<button class="button primary">Открыть доступные профили</button><p role="status"></p></form>');
  const out=document.querySelector('#device-request');
  try{
    const ident=await pairingIdentity();if(!out.isConnected)return;
    out.innerHTML='<p>Передайте запрос администратору и сверьте отпечаток устройства.</p><p><strong>'+shortDeviceId(ident.id)+'</strong></p>'+
      fileLink({format:'HS-request-1',spki:ident.spki,revision:workingFamily?previous.access.revision:0,client:'web'},'device.health-request','Скачать запрос подключения');
  }catch{out.textContent='Не удалось подготовить ключ устройства. Проверьте доступ браузера к хранилищу.'}
}
function grantDevicePanel(){
  if(!workingFamily||viewer!=='admin'||previous.access)return;
  const adminEnabled=Boolean(readJson(familyStateKey)?.sync);
  const members=family.members.filter(m=>m.id!==family.adminId||adminEnabled);
  if(!members.length){openPanel('Семья и устройства','Выдать доступ','<p>Сначала добавьте профиль взрослого или ребёнка.</p>'+act('newMember','Добавить профиль','','button primary'));return}
  openPanel('Семья и устройства','Выдать доступ устройству','<form id="device-issue" class="edit-form">'+
    '<label>Запрос с нового устройства<input type="file" required name="request" accept=".health-request"></label>'+
    '<label>Отпечаток с экрана получателя<input name="fingerprint" required autocomplete="off" spellcheck="false" placeholder="4 группы по 4 символа"></label>'+
    '<label>Название устройства<input required name="label" maxlength="80" placeholder="Например, iPhone"></label>'+
    '<label>Владелец устройства<select required name="member">'+members.map(m=>'<option value="'+esc(m.id)+'">'+esc(m.name)+' · '+(m.id===family.adminId?'администратор, все профили':m.role==='Ребёнок'?'только своя карта, просмотр':'своя карта и все дети, редактирование')+'</option>').join('')+'</select></label>'+
    '<button class="button primary">Создать файл доступа</button><div role="status"></div></form>');
  const form=document.querySelector('#device-issue');
  if(adminEnabled && members.some(m=>m.id!==family.adminId))form.elements.member.value=members.find(m=>m.id!==family.adminId).id;
  form.oninput=()=>{form.querySelector('[role=status]').replaceChildren();clearFileURL()};
}
function projectForDevice(data,memberId,deviceId,revision){
  validateFamily(data);
  const member=data.family.members.find(m=>m.id===memberId);
  if(!member)throw Error('member');
  const role=member.id===data.family.adminId?'admin':member.role==='Ребёнок'?'child':'adult';
  const members=data.family.members.filter(m=>role==='admin'||m.id===member.id||(role==='adult'&&m.role==='Ребёнок'));
  return {schemaVersion:2,generation:uid(),family:{id:data.family.id,kind:'family',name:data.family.name,adminId:role==='admin'?member.id:null,members},
    access:{deviceId,member:memberId,role,revision,edited:false},city:data.city,tags:data.tags,templates:data.templates,
    profiles:Object.fromEntries(members.map(m=>[m.id,data.profiles[m.id]]))};
}
function packetParams(iv,id,code){return {name:'AES-GCM',iv,additionalData:new TextEncoder().encode('HS-device-1/'+id+'/'+code)}}
function updateDevicePanel(id){
  if(!workingFamily||viewer!=='admin')return;
  const d=deviceAuthority(family.id).devices.find(d=>d.id===id&&!d.revoked);
  if(!d?.spki)return;
  openPanel('Семья и устройства','Передать свежую копию','<form id="device-issue" class="edit-form" data-device="'+esc(id)+'"><p>Устройство «'+esc(d.label)+'» получит актуальные записи и оригиналы доступных профилей.</p><button class="button primary">Создать файл обновления</button><div role="status"></div></form>');
}
async function requestedDevice(f){
  if(f.dataset.device){
    const d=deviceAuthority(family.id).devices.find(d=>d.id===f.dataset.device&&!d.revoked);
    if(!d?.spki)throw Error();
    return {raw:fromBase64(d.spki),id:d.id,label:d.label,member:d.member,revision:d.revision};
  }
  const field=f.elements.request,file=field.files[0],status=f.querySelector('[role=status]');
  let req,raw;
  try{
    if(!file||file.size>8192)throw Error();
    req=JSON.parse(await file.text());if(req.format!=='HS-request-1')throw Error();
    raw=fromBase64(req.spki);
  }catch{
    status.textContent='';rejectFieldValue(field,'Выберите файл запроса с нового устройства.');return;
  }
  const id=await deviceFingerprint(raw),label=f.elements.label.value.trim();
  if(shortDeviceId(id).replaceAll(' ','')!==f.elements.fingerprint.value.toUpperCase().replace(/\s/g,'')){
    status.textContent='';rejectFieldValue(f.elements.fingerprint,'Сверьте отпечаток на принимающем устройстве и введите его целиком.',{related:field});return;
  }
  const revision=req.revision??0;
  if(!Number.isSafeInteger(revision)||revision<0||revision>=Number.MAX_SAFE_INTEGER-1)throw Error();
  return {raw,id,label,member:f.elements.member.value,revision,client:req.client};
}
async function issueDeviceFile(f){
  if(!workingFamily||viewer!=='admin'||f.dataset.busy)return;
  const msg=f.querySelector('[role=status]'),controls=Array.from(f.elements);
  f.dataset.busy='true';controls.forEach(el=>el.disabled=true);
  msg.textContent='Готовим зашифрованные профили и оригиналы…';
  try{
    const request=await requestedDevice(f);
    if(!request)return;
    const {raw,id,label,member}=request;
    const snapshot=localStorage.getItem(familyStateKey),data=JSON.parse(localVault.open(snapshot));
    if(data.family.id!==family.id||data.access)throw Error();
    if(member===data.family.adminId&&(!data.sync||(!f.dataset.device&&!['web','ios'].includes(request.client)))){
      msg.textContent='Для доступа администратора включите обмен и скачайте новый запрос подключения в браузере или приложении iPhone.';return;
    }
    const old=deviceAuthority(family.id).devices.find(d=>d.id===id);
    if(old&&(old.revoked||old.member!==member)){msg.textContent='Это устройство отозвано или закреплено за другим профилем.';return}
    const revision=Math.max(old?.revision||0,request.revision)+1,scoped=projectForDevice(data,member,id,revision),files=[];
    const sync=await deviceSync.grant(scoped,id);
    if(sync)scoped.sync=sync;
    for(const {owner,item} of sync?[]:archiveItems(scoped,true)){
      const blob=await fileBlob(owner+'/'+item.id,null,data);if(!blob)throw Error();
      files.push({id:owner+'/'+item.id,type:blob.type,bytes:toBase64(new Uint8Array(await blob.arrayBuffer()))});
    }
    const publicKey=await crypto.subtle.importKey('spki',raw,{name:'RSA-OAEP',hash:'SHA-256'},false,['encrypt']);
    if(publicKey.algorithm.modulusLength!==3072)throw Error();
    const secret=localVault.random(32),key=await crypto.subtle.importKey('raw',secret,'AES-GCM',false,['encrypt']);
    const code=base64url(localVault.random(16)),iv=localVault.random(12);
    const cipher=await crypto.subtle.encrypt(packetParams(iv,id,code),key,new TextEncoder().encode(JSON.stringify({version:2,data:scoped,files})));
    const wrapped=await crypto.subtle.encrypt('RSA-OAEP',publicKey,secret);
    if(!f.isConnected||!panel.open)return;
    await navigator.locks.request('health-story-device-registry',()=>{
      if(localStorage.getItem(familyStateKey)!==snapshot)throw Error();
      const auth=deviceAuthority(family.id),current=auth.devices.find(d=>d.id===id);
      if(current?.revoked||(current?.revision||0)!==(old?.revision||0))throw Error();
      const entry={id,label,member,space:sync?.space,spki:toBase64(raw),revision,issued:new Date().toISOString()};
      if(current)Object.assign(current,entry);else auth.devices.push(entry);
      storeDeviceAuthority(family.id,auth);
    });
    if(!f.isConnected)return;
    const owner=scoped.family.members.find(m=>m.id===member);
    msg.innerHTML='<p>Для '+esc(owner.name)+' · '+esc(shortDeviceId(id))+' · профилей '+scoped.family.members.length+'</p>'+fileLink({format:'HS-device-1',id,iv:toBase64(iv),wrapped:toBase64(new Uint8Array(wrapped)),cipher:toBase64(new Uint8Array(cipher))},'access.health-device','Скачать файл доступа')+
      '<p>Сообщите этот код получателю отдельно от файла.</p><strong>'+esc(code)+'</strong>';
  }catch{msg.textContent='Не удалось выдать доступ. Проверьте запрос, актуальность записей и наличие оригиналов.'}
  finally{delete f.dataset.busy;controls.forEach(el=>el.disabled=false)}
}
function revokeDevicePanel(id){
  if(!workingFamily||viewer!=='admin')return;
  const entry=deviceAuthority(family.id).devices.find(d=>d.id===id&&!d.revoked);if(!entry)return;
  openPanel('Семья и устройства','Отозвать доступ','<form class="edit-form" id="device-revoke" data-id="'+esc(id)+'"><p>Устройство «'+esc(entry.label)+'» больше не получит новые файлы доступа. Ранее выданные копии останутся у получателя.</p><button class="button primary">Подтвердить отзыв</button><p role="status"></p></form>');
}
async function revokeDevice(f){
  if(!workingFamily||viewer!=='admin')return;
  try{
    await navigator.locks.request('health-story-device-registry',async()=>{
      const local=readJson(familyStateKey);if(local?.family.id!==family.id||local.access)throw Error();
      const auth=deviceAuthority(family.id),entry=auth.devices.find(d=>d.id===f.dataset.id);
      if(!entry)throw Error();await deviceSync.revoke(entry.id);entry.revoked=new Date().toISOString();storeDeviceAuthority(family.id,auth);
    });
    replaceRoute('devices');
  }catch{f.querySelector('[role=status]').textContent='Не удалось сохранить отзыв. Обновите страницу.'}
}
// Stage encrypted originals under fresh identifiers. Switching the journal pointer is
// the commit; interruption cannot replace a currently referenced original.
async function installDeviceFile(f){
  if(f.dataset.busy)return;
  const msg=f.querySelector('[role=status]'),button=f.querySelector('button');
  f.dataset.busy='true';button.disabled=true;
  const staged=[];let db,committed=false;
  try{
    const snapshot=localStorage.getItem(familyStateKey),before=readJson(familyStateKey);
    if(before&&!before.access)throw Error();
    const ident=await pairingIdentity(),packet=JSON.parse(await f.elements.packet.files[0].text());
    if(packet.format!=='HS-device-1'||packet.id!==ident.id)throw Error();
    const secret=await crypto.subtle.decrypt('RSA-OAEP',ident.privateKey,fromBase64(packet.wrapped));
    const key=await crypto.subtle.importKey('raw',secret,'AES-GCM',false,['decrypt']);
    const plain=await crypto.subtle.decrypt(packetParams(fromBase64(packet.iv),ident.id,f.elements.code.value.trim()),key,fromBase64(packet.cipher));
    const archive=JSON.parse(new TextDecoder().decode(plain)),data=archive.data;
    validateFamily(data,true);
    const grant=data.access;
    if(archive.version!==2||!grant||grant.deviceId!==ident.id||grant.edited!==false||!Number.isSafeInteger(grant.revision)||grant.revision<1)throw Error();
    if(before&&(before.family.id!==data.family.id||before.access.member!==grant.member||before.access.role!==grant.role||before.access.revision>=grant.revision)){
      msg.textContent='Этот файл уже применён, устарел или выдан для другой семьи.';return;
    }
    if(before?.access.edited&&!data.sync){msg.textContent='На устройстве есть собственные изменения. Получите файл администратора с включённым обменом, чтобы объединить их.';return}
    const entries=data.sync?[]:archiveOriginals(archive,true);
    if(data.sync&&(archive.files?.length!==0||Object.keys(data.sync.profiles).length!==data.family.members.length||
      data.family.members.some(m=>!Object.hasOwn(data.sync.profiles,m.id))))throw Error('sync scope');
    db=await storageDB(data);
    function change(id,value){
      return new Promise((resolve,reject)=>{
        const tx=db.transaction('documents','readwrite'),store=tx.objectStore('documents');
        if(value)store.add(value,id);else store.delete(id);
        tx.oncomplete=resolve;tx.onabort=tx.onerror=()=>reject(tx.error);
      });
    }
    for(const p of Object.values(data.profiles)){p.sampleAliases={};if(data.sync)for(const item of [...p.files,...(p.visitDrafts||[])])delete item.blobId}
    for(const {owner,item,source} of entries){
      const blobId=uid(),dest=owner+'/'+blobId;
      const record=await localVault.sealFile(dest,fromBase64(source.bytes),source.type);
      await change(dest,record);staged.push(dest);item.blobId=blobId;
    }
    if(before?.access.edited&&data.sync)deviceSync.migrateEdits(before,data);
    if(!f.isConnected||!panel.open||localStorage.getItem(familyStateKey)!==snapshot)throw Error();
    localStorage.setItem(familyStateKey,localVault.seal(JSON.stringify(data)));committed=true;
    if(before){
      const old=archiveItems(before,true).map(({owner,item})=>originalKey(before,owner+'/'+item.id));
      const retained=new Set(archiveItems(data,true).map(({owner,item})=>originalKey(data,owner+'/'+item.id)));
      await Promise.allSettled(old.filter(id=>!retained.has(id)).map(id=>change(id,null)));
    }
    enterSpace('family',grant.member);
  }catch{
    if(!committed&&db)await Promise.allSettled(staged.map(id=>new Promise((resolve,reject)=>{
      const tx=db.transaction('documents','readwrite');tx.objectStore('documents').delete(id);
      tx.oncomplete=resolve;tx.onerror=tx.onabort=reject;
    })));
    msg.textContent='Доступ не открыт. Проверьте файл, код администратора и устройство, создавшее запрос.';
  }finally{db?.close();delete f.dataset.busy;button.disabled=false}
}
