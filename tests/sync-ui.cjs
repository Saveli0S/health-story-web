// Two browser engines and a real local encrypted relay, using synthetic profiles.
const {chromium,webkit,devices}=require('playwright-core');
const assert=require('node:assert/strict');
const base=process.env.HEALTH_SYNC_URL||'http://127.0.0.1:8765/';
(async()=>{
 const chrome=await chromium.launch({channel:'chrome'}),safari=await webkit.launch();
 let phase='',errors=[];
 async function page(browser,query=''){
   const ctx=await browser.newContext({...(browser===safari?devices['iPhone 13']:{}),serviceWorkers:'block'});
   const p=await ctx.newPage();p.on('pageerror',e=>errors.push(e.message));
   await goto(p,query);return p;
 }
 async function goto(p,q=''){await p.goto(base+q);await p.locator('main h1').waitFor({state:'attached'})}
 async function adminPanel(p){
   await goto(p,'?section=settings');await p.locator('main [data-action=archive]').click();
 }
 async function pair(master,recipient,id){
   await recipient.locator('header [data-action=family]').click();await recipient.locator('dialog [data-action=joinDevice]').click();
   const output=recipient.locator('#device-request');
   const download=async(p,link)=>{
     const result=p.waitForEvent('download');await link.click();
     return require('node:fs/promises').readFile(await (await result).path());
   };
   const request=await download(recipient,output.getByRole('link')),fingerprint=await output.locator('strong').innerText();
   await goto(master,'?section=settings');await master.locator('main [data-action=devices]').click();await master.locator('[data-action=grantDevice]').click();
   const f=master.locator('#device-issue');
   await f.locator('[name=request]').setInputFiles({name:'join.health-request',mimeType:'application/octet-stream',buffer:request});
   await f.locator('[name=fingerprint]').fill(fingerprint);await f.locator('[name=label]').fill(id);await f.locator('[name=member]').selectOption(id);
   await f.locator('button').click();const packet=await download(master,f.getByRole('link')),code=await f.locator('[role=status] strong').innerText();
   const install=recipient.locator('#device-install');
   await install.locator('[name=packet]').setInputFiles({name:'join.health-device',mimeType:'application/octet-stream',buffer:packet});
   await install.locator('[name=code]').fill(code);await install.locator('button').click();await recipient.waitForURL(u=>u.searchParams.get('profile')===id);
   await recipient.locator('main h1').waitFor();

 }
 async function sync(p){await p.evaluate(()=>deviceSync.synchronize())}
 const value=(p,id)=>(p.evaluate(id=>readJson(stateKey).profiles[id].fields.find(f=>f.id==='weight').value,id));
 async function edit(p,id,k,v){await goto(p,'?profile='+id);assert(await p.evaluate(([k,v])=>{current().fields.find(f=>f.id===k).value=v;return saveState()},[k,v]))}
 try{
   phase='setup';const master=await page(chrome,'?new=family'),webAdmin=await page(chrome),adult=await page(safari),child=await page(safari);
   await master.locator('[name=familyName]').fill('Семья синхронизации');await master.locator('[name=memberName]').fill('Администратор');
   await master.locator('#family-form button').click();await master.getByRole('heading',{name:'Администратор',exact:true}).waitFor();
   await master.evaluate(async()=>{
     for(const [id,name,role] of [['p-adult','Взрослый','Взрослый'],['p-child','Ребёнок','Ребёнок']]){
       const m={id,name,role};family.members.push(m);prototypeState.profiles[id]=makeState(personFromMember(m));
     }
     await fileBlob('p-child/original',new Blob(['encrypted-test-source'],{type:'text/plain'}));
     prototypeState.profiles['p-child'].files.push({id:'original',name:'Анализ.txt',category:'Другое',date:'2026-11-26'});
     if(!saveState())throw Error('save');
   });
   await adminPanel(master);
   if(await master.locator('#sync-setup').count())await master.locator('#sync-setup').fill((await require('node:fs/promises').readFile(process.env.HS_SETUP_FILE,'utf8')).trim());
   await master.locator('[data-sync=enable]').click();await master.locator('[data-sync=now]').waitFor();
   await sync(master);await pair(master,adult,'p-adult');await pair(master,child,'p-child');
   phase='additional Chrome administrator';
   const ownerId=await master.evaluate(()=>family.adminId);
   await pair(master,webAdmin,ownerId);
   await goto(master);
   await sync(webAdmin);
   assert.deepEqual(await webAdmin.evaluate(()=>[viewer,accessibleProfiles().length]),['admin',3]);
   await goto(webAdmin,'?section=settings');
   await webAdmin.locator('main [data-action=devices]').click();
   await webAdmin.getByText(/выдача и отзыв доступа доступны/i).waitFor();
   await edit(webAdmin,'p-adult','weight','70');await sync(webAdmin);await sync(master);
   assert.equal(await value(master,'p-adult'),'70');
   phase='child consent changes propagate only from admin';
   for(const allowed of [true,false]){
     await goto(webAdmin,'?profile=p-child&section=settings');
     await webAdmin.locator('#chatgpt-auto').setChecked(allowed);
     await sync(webAdmin);await sync(master);
     for(const recipient of [adult,child]){
       await sync(recipient);
       await goto(recipient,'?profile=p-child&section=settings');
       const toggle=recipient.locator('#chatgpt-auto');
       assert(await toggle.isDisabled());assert.equal(await toggle.isChecked(),allowed);
     }
   }
   phase='limited server access, lazy original';
   const forbidden=await child.evaluate(async()=>{
     const c=readJson(stateKey).sync,headers={Authorization:'Bearer '+c.token};
     const service=location.origin==='https://saveli0s.github.io'?'https://health-story-sync.xzx89s.workers.dev':'';
     const answers=await Promise.all([fetch(service+'/sync/'+c.space+'/profiles/p-adult/records',{headers}),fetch(service+'/sync/'+c.space+'/profiles/p-child/records',{method:'PUT',headers,body:'forbidden'})]);
     return answers.map(r=>r.status);
   });assert.deepEqual(forbidden,[403,403]);
   const count=()=>child.evaluate(async()=>{const db=await storageDB();try{return await new Promise(resolve=>{const r=db.transaction('documents').objectStore('documents').count();r.onsuccess=()=>resolve(r.result)})}finally{db.close()}});
   assert.equal(await count(),0);assert.equal(await child.evaluate(async()=>(await fileBlob('p-child/original')).text()),'encrypted-test-source');assert.equal(await count(),1);
   phase='offline edits and conflicts';
   await edit(master,'p-child','weight','61');await sync(master);
   await adult.context().setOffline(true);
   await adult.evaluate(()=>{const p=prototypeState.profiles['p-child'];p.fields.find(f=>f.id==='weight').value='62';p.fields.find(f=>f.id==='height').value='170';if(!saveState())throw Error()});
   await adult.context().setOffline(false);await adult.waitForFunction(()=>!readJson(stateKey).access.edited);await sync(master);
   const inspect=await master.evaluate(()=>{const d=readJson(stateKey),c=d.sync.profiles['p-child'].base.records.conflicts;return {height:d.profiles['p-child'].fields.find(f=>f.id==='height').value,alternatives:c.map(v=>[v.local.value,v.remote.value,v.local.author,v.remote.author])}});
   assert.equal(inspect.height,'170');assert.deepEqual(inspect.alternatives,[['62','61','Взрослый','Администратор']]);
   await adminPanel(master);await master.locator('#sync-view button').filter({hasText:'62'}).click();await sync(master);await sync(child);
   assert.equal(await value(child,'p-child'),'62');
   phase='incoming thumbnail, pin and complete backup';
   await goto(adult,'?profile=p-child');
   await adult.evaluate(async()=>{
     const image=document.createElement('canvas');image.width=image.height=12;image.getContext('2d').fillRect(0,0,12,12);
     const bytes=await new Promise(resolve=>image.toBlob(resolve,'image/png'));
     await fileBlob('p-child/photo',bytes);current().files.push({id:'photo',name:'Тестовое фото.png',type:'image/png',category:'Снимки',date:'2026-11-26'});
     if(!saveState())throw Error('add photo');
   });await sync(adult);await sync(child);await sync(master);
   assert(await child.evaluate(()=>readJson(stateKey).profiles['p-child'].files.find(f=>f.id==='photo').thumbnail.startsWith('data:image/jpeg;base64,')));
   await goto(child,'?profile=p-child&section=files');
   await child.locator('[data-action=pinFile][data-id=photo]').click();await child.getByText(/Доступно без сети/).waitFor();
   await child.context().setOffline(true);assert(await child.evaluate(async()=>(await fileBlob('p-child/photo')).size>0));await child.context().setOffline(false);
   const archiveOK=await master.evaluate(async()=>{
     const key=await archiveKey(deviceAuthority(family.id).recovery),file=await encryptedArchive(key),bytes=new Uint8Array(await file.arrayBuffer());
     const obj=JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes.slice(4,16)},key,bytes.slice(16))));
     return !obj.data.sync&&obj.files.some(f=>f.id==='p-child/photo'&&f.bytes&&f.type==='image/png');
   });assert(archiveOK);
   phase='deleted document leaves scoped devices and cached originals';
   await goto(master,'?profile=p-child&section=settings');
   await master.locator('main [data-action=manageRecords]').click();
   await master.locator('#remove-search').fill('Анализ.txt');
   await master.locator('#remove-list button').click();
   await master.locator('#remove-record-form input').check();
   await master.locator('#remove-record-form button[type=submit],#remove-record-form button.danger').first().click();
   await sync(master);await sync(adult);await sync(child);
   assert(!await child.evaluate(()=>current().files.some(f=>f.id==='original')));
   assert(!await child.evaluate(()=>fileBlob('p-child/original')));
   assert(await child.evaluate(()=>current().files.some(f=>f.id==='photo')));
   phase='new child is available automatically';
   await goto(master,'?profile=p-child');
   await master.evaluate(()=>{const m={id:'p-second',name:'Второй ребёнок',role:'Ребёнок'};family.members.push(m);prototypeState.profiles[m.id]=makeState(personFromMember(m));if(!saveState())throw Error()});
   await sync(master);await sync(adult);await sync(child);
   assert(await adult.evaluate(()=>Boolean(readJson(stateKey).profiles['p-second'])));
   assert(!await child.evaluate(()=>Boolean(readJson(stateKey).profiles['p-second'])));
   await sync(webAdmin);
   assert(await webAdmin.evaluate(()=>Boolean(readJson(stateKey).profiles['p-second'])));
   phase='revoke, rekey and preserve offline copy';
   const oldKey=await child.evaluate(()=>readJson(stateKey).sync.profiles['p-child'].key);
   await goto(master,'?section=settings');await master.locator('main [data-action=devices]').click();
   await master.locator('.plain-card').filter({hasText:'p-child'}).locator('[data-action=revokeDevice]').click();
   await master.locator('#device-revoke button').click();await master.getByText(/Доступ отозван/).waitFor();
   await sync(master);await sync(adult);
   assert(await adult.evaluate(k=>{const s=readJson(stateKey).sync.profiles['p-child'];return s.key!==k&&s.previousKeys.includes(k)},oldKey));
   const denied=await child.evaluate(async()=>{try{await deviceSync.synchronize();return false}catch(e){return e.status===403}});
   assert(denied);assert.equal(await value(child,'p-child'),'62');assert.deepEqual(errors,[]);
   console.log('PASS Chrome ↔ iPhone WebKit: real encrypted relay, role checks, lazy original, offline merge, conflict resolution, revocation');
 }catch(e){console.error(phase,e.message);process.exitCode=1}finally{await Promise.all([chrome.close(),safari.close()])}
})();
