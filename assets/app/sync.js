'use strict';

const deviceSync=(()=>{
  let timer,running,lastError='';
  const time=()=>new Date().toISOString(),secret=()=>base64url(localVault.random(32));
  const clone=v=>structuredClone(v);
  function config(data){return data?.sync}
  function records(p){
    const result=clone(p);delete result.auto;delete result.directAuto;delete result.sampleAliases;delete result.savedConflicts;
    for(const item of [...result.files,...(result.visitDrafts||[])])delete item.blobId;
    return result;
  }
  const consent=p=>({auto:p.auto===true,directAuto:p.directAuto===true});
  function installRecords(p,value){
    const aliases=new Map([...p.files,...(p.visitDrafts||[])].map(f=>[f.id,f.blobId]));
    Object.assign(p,clone(value));
    for(const f of [...p.files,...(p.visitDrafts||[])])if(aliases.get(f.id))f.blobId=aliases.get(f.id);
  }
  function profileContext(){return {key:secret(),base:{},stamps:{},uploaded:[],choices:[]}}
  const options=(ctx,id,name)=>({name:'AES-GCM',iv:localVault.random(12),additionalData:new TextEncoder().encode('HS-sync-1/'+ctx.space+'/'+id+'/'+name)});
  async function seal(ctx,id,name,bytes){
    const key=await crypto.subtle.importKey('raw',fromBase64(ctx.profiles[id].key.replaceAll('-','+').replaceAll('_','/')),'AES-GCM',false,['encrypt']);
    const opt=options(ctx,id,name),cipher=await crypto.subtle.encrypt(opt,key,bytes);return new Blob([opt.iv,cipher]);
  }
  async function decryptRevision(ctx,id,name,bytes){
    const state=ctx.profiles[id],opt=options(ctx,id,name);opt.iv=bytes.slice(0,12);
    for(const candidate of [state.key,...(state.previousKeys||[])]){
      const key=await crypto.subtle.importKey('raw',fromBase64(candidate.replaceAll('-','+').replaceAll('_','/')),'AES-GCM',false,['decrypt']);
      try{return {bytes:await crypto.subtle.decrypt(opt,key,bytes.slice(12)),primary:candidate===state.key}}catch(e){if(e.name!=='OperationError')throw e}
    }
    throw Error('Не удалось проверить данные. Обновите доступ устройства.');
  }
  async function open(ctx,id,name,bytes){return (await decryptRevision(ctx,id,name,bytes)).bytes}
  const cloudOrigin='https://health-story-sync.xzx89s.workers.dev';
  const cloudHosted=location.origin==='https://saveli0s.github.io';
  async function request(ctx,path,method='GET',body,rev,setupCode){
    const site=new URL('sync/'+ctx.space+path,cloudHosted?cloudOrigin:document.baseURI);
    const headers={Authorization:'Bearer '+ctx.token};
    if(setupCode)headers['X-Family-Setup']=setupCode;
    if(rev!==undefined)headers['If-Match']='"'+rev+'"';
    const r=await fetch(site,{method,body,headers,credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer'});
    if(!r.ok)throw Object.assign(Error(({403:'Доступ устройства отозван или ограничен.',404:'Сервер обмена или запись недоступны.',412:'Данные изменились во время обмена.',413:'Файл превышает лимит сервера.'})[r.status]||'Сервер обмена недоступен.'),{status:r.status});
    return r;
  }
  async function getObject(ctx,id,name){
    try{
      const r=await request(ctx,'/profiles/'+id+'/'+name);
      const rev=Number(r.headers.get('ETag')?.replaceAll('"',''));
      if(!Number.isSafeInteger(rev)||rev<1)throw Error('Некорректная версия данных.');
      return {rev,...await decryptRevision(ctx,id,name,await r.arrayBuffer())};
    }catch(e){if(e.status===404)return null;throw e}
  }
  async function put(ctx,id,name,bytes,rev){
    const encrypted=await seal(ctx,id,name,bytes);
    return request(ctx,'/profiles/'+id+'/'+name,'PUT',await encrypted.arrayBuffer(),rev);
  }
  function items(p){return [...p.files,...(p.visitDrafts||[])]}
  async function thumbnail(item,blob){
    if(item.thumbnail||(!isPhoto(item)&&!isPdf(item)))return;
    let canvas,pdf;
    try{
      if(isPdf(item)){pdf=await openLocalPdf(blob);canvas=await drawPaper(await pdf.getPage(1),144)}
      else canvas=await photoCanvas(blob,144);
      const image=canvas.toDataURL('image/jpeg',0.58);
      if(image.length<24000)item.thumbnail=image;
    }catch{/* Unsupported image formats keep their original. */}
    finally{if(canvas)canvas.width=canvas.height=1;if(pdf)await pdf.destroy()}
  }
  function thumb(item){
    const src=item?.thumbnail;
    return typeof src==='string'&&src.length<24000&&/^data:image\/jpeg;base64,[a-zA-Z0-9+/=]+$/.test(src)?'<img class="sync-thumbnail" alt="Миниатюра документа" src="'+src+'">':'';
  }
  async function pin(episode,id,button){
    const owner=person.id,data=readJson(familyStateKey),files=items(data.profiles[owner]);
    const visits=new Set(episode?episodeVisits(id).map(v=>v[0]):[]);
    const examFiles=new Set((data.profiles[owner].exams||[]).filter(e=>visits.has(e.visit)).flatMap(e=>e.attachments.map(a=>a.id)));
    const chosen=files.filter(f=>episode?visits.has(f.visit)||f.episode===id||examFiles.has(f.id):f.id===id);
    button.disabled=true;
    try{for(const [i,item] of chosen.entries()){
      button.textContent='Сохраняем '+(i+1)+' из '+chosen.length;
      if(!await fileBlob(owner+'/'+item.id,null,data))throw Error();
    }button.textContent=chosen.length?'Доступно без сети · '+chosen.length:'В эпизоде пока нет вложений'}
    catch{button.disabled=false;button.textContent='Повторить сохранение без сети'}
  }
  async function ensureOriginals(data,id){
    const ctx=config(data),state=ctx.profiles[id];
    for(const item of items(data.profiles[id])){
      if(state.uploaded.includes(item.id))continue;
      const blob=await fileBlob(id+'/'+item.id,null,data);
      if(!blob)throw Error('Не найден оригинал для передачи.');
      await thumbnail(item,blob);
      const name='blob-'+item.id;
      const bytes=await new Blob([new TextEncoder().encode(JSON.stringify(blob.type)+'\n'),blob]).arrayBuffer();
      try{await put(ctx,id,name,bytes,0)}catch(e){if(e.status!==412)throw e;
        const existing=await getObject(ctx,id,name);
        if(!existing||!await sameBytes(existing.bytes,bytes))throw Error('У оригинала с таким ID другое содержимое.');
      }
      state.uploaded.push(item.id);
    }
  }
  async function sameBytes(a,b){
    if(a.byteLength!==b.byteLength)return false;
    const [x,y]=await Promise.all([a,b].map(v=>crypto.subtle.digest('SHA-256',v)));
    return toBase64(new Uint8Array(x))===toBase64(new Uint8Array(y));
  }
  async function loadOriginal(id,data){
    const [owner,doc]=id.split('/'),ctx=config(data);
    if(!ctx?.profiles[owner]||!items(data.profiles[owner]).some(f=>f.id===doc))return;
    const obj=await getObject(ctx,owner,'blob-'+doc);if(!obj)return;
    const bytes=new Uint8Array(obj.bytes),end=bytes.indexOf(10);if(end<0||end>1024)throw Error('Некорректное вложение.');
    const type=JSON.parse(new TextDecoder().decode(bytes.slice(0,end))),blob=new Blob([bytes.slice(end+1)],{type});
    const storedId=originalKey(data,id),entry=await localVault.sealFile(storedId,await blob.arrayBuffer(),blob.type);
    const db=await storageDB(data);try{await new Promise((resolve,reject)=>{
      const tx=db.transaction('documents','readwrite');tx.objectStore('documents').put(entry,storedId);
      tx.oncomplete=resolve;tx.onerror=tx.onabort=()=>reject(tx.error);
    })}finally{db.close()}
    return blob;
  }
  async function lane(data,id,name,writer){
    const ctx=config(data),state=ctx.profiles[id],p=data.profiles[id],current=name==='records'?records(p):consent(p);
    const cached=state.base[name],obj=await getObject(ctx,id,name);
    if(cached?.rev&&(!obj||obj.rev<cached.rev))throw Error('Сервер вернул устаревшую версию. Локальная копия сохранена.');
    const remote=obj?JSON.parse(new TextDecoder().decode(obj.bytes)):null;
    if(!remote&&!writer)throw Error('Ожидаем первую передачу администратора.');
    const actor={author:viewerPerson.name,time:time(),stamps:state.stamps[name]||{}};
    const merged=remote&&writer?syncMerge.merge(cached?.value??current,current,remote.value,{local:actor,remote}):{value:remote?.value??current,conflicts:[]};
    const choices=state.choices.filter(c=>c.lane===name),remoteConflicts=remote?.conflicts||[];
    const imported=(data.profiles[id].savedConflicts||[]).filter(c=>c.lane===name);
    const remaining=[...remoteConflicts,...imported].filter(c=>!choices.some(x=>x.id===c.id));
    for(const choice of choices){
      const c=[...remoteConflicts,...imported].find(c=>c.id===choice.id);if(!c)continue;
      const currentValue=syncMerge.read(merged.value,c.path);
      if(syncMerge.same(currentValue,c.remote.value)||syncMerge.same(currentValue,c.local.value))
        syncMerge.choose(merged.value,c.path,c[choice.side]);
      else merged.conflicts.push({path:c.path,local:c[choice.side],remote:{value:currentValue,author:remote.author,time:remote.time}});

    }
    const conflicts=[...remaining];
    for(const c of merged.conflicts)if(!conflicts.some(old=>syncMerge.same(old.path,c.path)&&syncMerge.same(old.local,c.local)&&syncMerge.same(old.remote,c.remote)))conflicts.push({...c,id:uid()});
    const changed=!remote||!data.access&&!obj.primary||!syncMerge.same(remote.value,merged.value)||!syncMerge.same(conflicts,remoteConflicts);
    if(changed&&writer){
      const stamps={...(remote?.stamps||{})};
      for(const path of syncMerge.changes(remote?.value,merged.value))stamps[path]=actor.stamps[path]||{author:actor.author,time:actor.time};
      const payload={value:merged.value,conflicts,author:actor.author,time:actor.time,stamps};
      await put(ctx,id,name,new TextEncoder().encode(JSON.stringify(payload)),obj?.rev||0);
    }
    if(name==='records'){
      installRecords(p,merged.value);
      // Existing published originals can be downloaded on demand or pinned for offline use.
      state.uploaded=[...new Set([...state.uploaded,...items(p).map(f=>f.id)])];
    }else Object.assign(p,merged.value);
    state.base[name]={rev:(obj?.rev||0)+(changed&&writer?1:0),value:clone(merged.value),conflicts};
    state.choices=state.choices.filter(c=>c.lane!==name);state.stamps[name]={};
    if(p.savedConflicts){p.savedConflicts=p.savedConflicts.filter(c=>c.lane!==name);if(!p.savedConflicts.length)delete p.savedConflicts}
  }
  function pending(data){
    const ctx=config(data);if(!ctx)return [];
    return Object.entries(ctx.profiles).filter(([id,s])=>data.profiles[id]&&(data.profiles[id].savedConflicts?.length||!syncMerge.same(records(data.profiles[id]),s.base.records?.value)||
      !syncMerge.same(consent(data.profiles[id]),s.base.consent?.value)||s.choices.length)).map(([id])=>id);
  }
  function noteChanges(before,next){
    if(!before?.sync||!next.sync)return;
    for(const [id,s] of Object.entries(next.sync.profiles)){
      if(!before.profiles[id]||!next.profiles[id])continue;
      for(const [name,read] of [['records',records],['consent',consent]]){
        const marks=s.stamps[name]||(s.stamps[name]={});
        for(const path of syncMerge.changes(read(before.profiles[id]),read(next.profiles[id])))marks[path]={author:viewerPerson.name,time:time()};
      }
    }
    schedule();
  }
  function commit(raw,data,clinical){
    if(localStorage.getItem(familyStateKey)!==raw)throw Object.assign(Error('Появились локальные изменения.'),{status:412});
    if(clinical)data.generation=uid();
    localStorage.setItem(familyStateKey,localVault.seal(JSON.stringify(data)));
    if(clinical){
      Object.assign(family,data.family);
      Object.assign(prototypeState,{...data,family});
      const members=family.members.map(m=>{
        const target=people.find(p=>p.id===m.id)||{};
        Object.assign(target,personFromMember(m));
        const profile=data.profiles[m.id];for(const doctor of profile.addedDoctors)target.doctors[doctor.id]=doctor.values;
        target.visits=[...profile.addedVisits].sort((a,b)=>b[1].localeCompare(a[1]));return target;
      });
      people.splice(0,people.length,...members);
      savedView=JSON.stringify(data);render();
      if(panel.open&&!document.querySelector('#sync-view'))document.querySelector('#refresh-notice').hidden=false;
    }else{
      prototypeState.sync=clone(data.sync);
      if(prototypeState.access&&data.access)prototypeState.access.edited=data.access.edited;
    }
  }
  async function synchronize(){
    if(!workingFamily)return;
    if(running)return running;
    running=navigator.locks.request('health-story-sync',async()=>{
      for(let attempt=0;attempt<3;attempt++){
        const raw=localStorage.getItem(familyStateKey),data=JSON.parse(localVault.open(raw)),ctx=config(data);
        if(!ctx)return;
        try{
          const clinical=()=>JSON.stringify([data.profiles,data.family,data.tags,data.templates,data.city]);
          const initial=clinical();
          if(data.access)await receiveRoster(data);
          if(!data.access)for(const {id} of data.family.members)ctx.profiles[id]||=profileContext();
          for(const id of Object.keys(ctx.profiles)){
            if(!data.profiles[id])throw Error('Изменился доступ к профилю.');
            const writer=data.access?.role!=='child';
            if(writer)await ensureOriginals(data,id);
            await lane(data,id,'records',writer);
            await lane(data,id,'consent',!data.access||data.access.member===id&&writer);
          }
          if(!data.access)await updateRosters(data);
          ctx.last=time();if(data.access)data.access.edited=false;
          const incoming=clinical()!==initial;
          if(incoming&&(jobs.size||providerJobs.size||panel.open&&panelBody.querySelector('form'))){
            lastError='Получены изменения. Они появятся после завершения работы с открытой формой.';return;
          }
          commit(raw,data,incoming);lastError='';return;
        }catch(e){if(e.status===412&&attempt<2)continue;throw e}
      }
    }).catch(e=>{lastError=e instanceof TypeError?'Нет связи с сервером. Правки остаются на устройстве.':e.message;throw e}).finally(()=>{running=null;refresh()});
    return running;
  }
  function schedule(){clearTimeout(timer);timer=setTimeout(()=>{if(navigator.onLine)synchronize().catch(()=>{})},900)}
  async function enable(){
    const raw=localStorage.getItem(familyStateKey),data=readJson(familyStateKey);
    if(!workingFamily||viewer!=='admin'||data.access||data.sync)return;
    const ctx={space:secret(),token:secret(),rosterMaster:secret(),profiles:{}};
    for(const m of data.family.members)ctx.profiles[m.id]=profileContext();
    const setupCode=cloudHosted?document.querySelector('#sync-setup')?.value.trim():undefined;
    if(cloudHosted&&!setupCode)throw Error('Введите код подключения семейного сервера.');
    await request(ctx,'','PUT',undefined,undefined,setupCode);data.sync=ctx;commit(raw,data,false);await synchronize();
  }
  async function derived(secretValue,context){
    const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secretValue),{name:'HMAC',hash:'SHA-256'},false,['sign']);
    return base64url(new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(context))));
  }
  async function register(ctx,deviceId,token,grants){
    const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token));
    await request(ctx,'/devices/'+deviceId,'PUT',JSON.stringify({tokenHash:[...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,'0')).join(''),grants}));
  }
  function rosterFor(data,scoped){
    const ctx=config(data),profiles={},grants={};
    for(const m of scoped.family.members){
      const s=ctx.profiles[m.id];if(!s?.base.records||!s.base.consent)throw Error('Сначала синхронизируйте семью.');
      profiles[m.id]={key:s.key,previousKeys:s.previousKeys||[]};
      grants[m.id]=scoped.access.role==='child'?'read':m.id===scoped.access.member?'self':'edit';
    }
    return {family:scoped.family,city:scoped.city,tags:scoped.tags,templates:scoped.templates,profiles,grants};
  }
  function rosterKey(ctx,id,secret){
    return {space:ctx.space,profiles:{[id]:{key:secret}}};
  }
  async function writeRoster(data,scoped,id,token,key){
    const ctx=config(data),roster=rosterFor(data,scoped),path='/devices/'+id+'/roster';
    const encryptCtx=rosterKey(ctx,id,key);
    let rev=0;
    try{
      const r=await request(ctx,path);rev=Number(r.headers.get('ETag').replaceAll('"',''));
      const old=JSON.parse(new TextDecoder().decode(await open(encryptCtx,id,'roster',await r.arrayBuffer())));
      if(syncMerge.same(old,roster))return;
    }catch(e){if(e.status!==404)throw e}
    await register(ctx,id,token,roster.grants);
    const cipher=await seal(encryptCtx,id,'roster',new TextEncoder().encode(JSON.stringify(roster)));
    await request(ctx,path,'PUT',await cipher.arrayBuffer(),rev);
  }
  async function grant(scoped,deviceId){
    const data=readJson(familyStateKey),ctx=config(data);if(!ctx)return null;
    const token=await derived(ctx.token,'device/'+deviceId),key=await derived(ctx.rosterMaster,'roster/'+deviceId),profiles={};
    for(const m of scoped.family.members){
      const s=ctx.profiles[m.id];
      if(!s?.base.records||!s.base.consent||!syncMerge.same(s.base.records.value,records(scoped.profiles[m.id]))||!syncMerge.same(s.base.consent.value,consent(scoped.profiles[m.id])))throw Error('Сначала синхронизируйте семью.');
      profiles[m.id]={key:s.key,previousKeys:[...(s.previousKeys||[])],base:clone(s.base),stamps:{},uploaded:[...s.uploaded],choices:[]};
    }
    await writeRoster(data,scoped,deviceId,token,key);
    return {space:ctx.space,token,rosterKey:key,profiles,last:ctx.last};
  }
  async function updateRosters(data){
    const ctx=config(data);
    for(const entry of deviceAuthority(data.family.id).devices){
      if(entry.revoked||entry.space!==ctx.space)continue;
      const scope=projectForDevice(data,entry.member,entry.id,entry.revision);
      await writeRoster(data,scope,entry.id,await derived(ctx.token,'device/'+entry.id),await derived(ctx.rosterMaster,'roster/'+entry.id));
    }
  }
  async function receiveRoster(data){
    const ctx=config(data),id=data.access.deviceId,resp=await request(ctx,'/devices/'+id+'/roster');
    const raw=await open(rosterKey(ctx,id,ctx.rosterKey),id,'roster',await resp.arrayBuffer());
    const r=JSON.parse(new TextDecoder().decode(raw));
    if(r.family.id!==data.family.id||r.family.adminId!==null||Object.keys(r.profiles).length!==r.family.members.length)throw Error('Неверная область доступа.');
    for(const member of r.family.members){
      if(!Object.hasOwn(r.profiles,member.id))throw Error('Неполный доступ.');
      if(!data.profiles[member.id])data.profiles[member.id]=makeState(personFromMember(member));
      const keys=r.profiles[member.id],entry=ctx.profiles[member.id]||{base:{},uploaded:[],choices:[],stamps:{}};
      entry.key=typeof keys==='string'?keys:keys.key;entry.previousKeys=keys.previousKeys||[];ctx.profiles[member.id]=entry;
    }
    Object.assign(data,{family:r.family,tags:r.tags,city:r.city,templates:r.templates});
    validateFamily(data,true);
  }
  async function revoke(id){
    await navigator.locks.request('health-story-sync',async()=>{
      const data=readJson(familyStateKey),ctx=config(data);if(!ctx)return;
      const entry=deviceAuthority(data.family.id).devices.find(d=>d.id===id);
      if(!entry||entry.space!==ctx.space||entry.revoked)return;
      await request(ctx,'/devices/'+id,'DELETE');
      const raw=localStorage.getItem(familyStateKey),fresh=JSON.parse(localVault.open(raw));
      if(fresh.sync?.space!==ctx.space||fresh.access)throw Error('Изменился рабочий архив.');
      const scope=projectForDevice(fresh,entry.member,id,entry.revision);
      for(const m of scope.family.members){
        const s=fresh.sync.profiles[m.id];
        if(s){s.previousKeys=[s.key,...(s.previousKeys||[])];s.key=secret()}
      }
      commit(raw,fresh,false);schedule();
    });
  }
  function keepConflicts(data){
    for(const [id,state] of Object.entries(data.sync?.profiles||{})){
      const p=data.profiles[id],kept=[...(p.savedConflicts||[])];
      for(const [lane,b] of Object.entries(state.base))for(const c of b.conflicts||[])
        if(!kept.some(x=>x.id===c.id))kept.push({...c,lane});
      if(kept.length)p.savedConflicts=kept;
    }
    delete data.sync;
  }
  function migrateEdits(before,data){
    for(const [id,p] of Object.entries(data.profiles)){
      const old=before.profiles[id];if(!old)continue;
      const author=before.family.members.find(m=>m.id===before.access.member).name,stamp=time();
      const m=syncMerge.merge(undefined,records(old),records(p),{local:{author,time:stamp},remote:{author:'Архив администратора',time:stamp}});
      installRecords(p,m.value);
      if(m.conflicts.length)p.savedConflicts=m.conflicts.map(c=>({...c,id:uid(),lane:'records'}));
      for(const f of items(p)){const existing=items(old).find(o=>o.id===f.id);if(existing?.blobId)f.blobId=existing.blobId}
      if(id===before.access.member)Object.assign(p,consent(old));
    }
    data.access.edited=true;
  }
  function refresh(){if(document.querySelector('#sync-view'))draw()}
  function draw(){
    const root=document.querySelector('#sync-view');if(!root||!workingFamily)return;
    const data=readJson(familyStateKey),ctx=config(data);
    if(!ctx){root.innerHTML=viewer==='admin'?(cloudHosted?'<label>Код подключения семейного сервера<input id="sync-setup" type="password" autocomplete="off"></label>':'<p>Можно подключить эту семью к серверу обмена по адресу дневника.</p>')+'<button class="button secondary" data-sync="enable">Включить обмен между устройствами</button>':'<p>Для подключения обмена получите новый файл доступа у администратора.</p>'}
    else{
      const names=pending(data).map(id=>{
        const p=data.profiles[id],b=ctx.profiles[id].base.records?.value||{},changes=[];
        for(const [key,label] of Object.entries({fields:'медкарта',addedVisits:'визиты',files:'вложения',visitDrafts:'черновики',notes:'пометки',measurements:'измерения',consultations:'консультации'}))
          if(!syncMerge.same(p[key],b[key]))changes.push(label);
        return data.family.members.find(m=>m.id===id)?.name+(changes.length?' ('+changes.join(', ')+')':'');
      });
      root.innerHTML='<p>'+ (running?'Идёт обмен…':!navigator.onLine?'Без сети':names.length?'Ожидают отправки · '+esc(names.join(', ')):'Локальные изменения переданы')+'</p><p>Последний успешный обмен · '+(ctx.last?esc(stamp(ctx.last)):'пока не было')+'</p>'+
        '<button class="button secondary" data-sync="now">Синхронизировать</button>';
    }
    for(const [id,p] of Object.entries(data.profiles)){
      const cases=[...(p.savedConflicts||[])];
      for(const [lane,b] of Object.entries(ctx?.profiles[id]?.base||{}))
        for(const c of b.conflicts||[])if(!cases.some(x=>x.id===c.id))cases.push({...c,lane});
      for(const c of cases){
        const title=document.createElement('p'),record=c.path[1]?.id;
        const labels={fields:'Медкарта',addedVisits:'Визит',notes:'Пометка',files:'Документ',measurements:'Измерение',episodes:'Эпизод',consultations:'Консультация',auto:'Автоанализ',directAuto:'Автоотправка'};
        const item=c.path[0]==='fields'?p.fields.find(f=>f.id===record)?.label:c.path[0]==='addedVisits'?p.addedVisits.find(v=>v[0]===record)?.[2]:null;
        title.textContent='Расхождение · '+data.family.members.find(m=>m.id===id)?.name+' · '+(labels[c.path[0]]||'Запись')+(item?' · '+item:'');root.append(title);
        const editable=!readOnly&&(c.lane!=='consent'||!data.access||data.access.member===id);
        for(const side of ['local','remote']){
          const candidate=c[side],node=document.createElement(editable?'button':'p');
          const value=typeof candidate.value==='object'?JSON.stringify(candidate.value):String(candidate.value??'');
          node.textContent=(candidate.removed?'Удалено':value)+' · '+candidate.author+' · '+stamp(candidate.time);
          if(editable){node.type='button';node.className='button secondary';node.onclick=()=>perform(async()=>{
            const raw=localStorage.getItem(familyStateKey),fresh=readJson(familyStateKey);if(fresh.access?.role==='child')return;
            if(fresh.sync){fresh.sync.profiles[id].choices.push({id:c.id,side,lane:c.lane});commit(raw,fresh,false);await synchronize()}
            else{
              const local=fresh.profiles[id],held=local.savedConflicts?.find(x=>x.id===c.id);if(!held)return;
              syncMerge.choose(local,held.path,held[side]);local.savedConflicts=local.savedConflicts.filter(x=>x.id!==c.id);
              commit(raw,fresh,true);
            }
          })}root.append(node);
        }
      }
    }
    const status=document.createElement('p');status.setAttribute('role','status');status.textContent=lastError;root.append(status);
    for(const b of root.querySelectorAll('[data-sync]'))b.onclick=()=>perform(b.dataset.sync==='enable'?enable:synchronize);
  }
  async function perform(fn){try{await fn()}catch(e){lastError=e.status===404?'По этому адресу сервер обмена пока не включён.':e.message}refresh()}
  function start(){
    if(!workingFamily)return;
    panel.addEventListener('close',()=>{if(prototypeState.sync)schedule()});
    window.addEventListener('online',schedule);window.addEventListener('offline',refresh);
    if(previous.sync)schedule();
    setInterval(()=>{if(!document.hidden&&navigator.onLine&&prototypeState.sync)schedule()},60000);
  }
  return {start,draw,thumb,pin,keepConflicts,migrateEdits,enable,synchronize,noteChanges,loadOriginal,grant,revoke,records};
})();
