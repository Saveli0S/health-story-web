// Start a scratch SQLite relay and run fixtures.py (see README). Never uses personal browser data.
const {chromium,webkit,devices}=require('playwright-core');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const crypto=require('node:crypto'),{execFileSync}=require('node:child_process');
const base=process.env.HEALTH_SYNC_URL||'http://127.0.0.1:18257/';
const cloud=process.argv.includes('--cloud');
const effective=cloud?'https://saveli0s.github.io/health-story-web/':base;
const run=process.env.HS_LARGE_SCRATCH,repo=path.resolve(__dirname,'../..');
const zip=n=>path.join(run,'files',n);
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const packetFile=(name,buffer)=>({name,mimeType:'application/octet-stream',buffer});
async function download(page,link){
  const waiting=page.waitForEvent('download');
  await link.click();return fs.readFile(await (await waiting).path());
}
async function go(p,q){
  await p.goto(effective+(q||''));await p.locator('main h1').waitFor();
}
const deltas={writes:new Map(),reads:new Map()};
const partID=url=>new URL(url).pathname.split('/').at(-1);
function routeParts(page,method,block,counts){
  return page.route('**/profiles/*/blob-part-*',async route=>{
    const request=route.request(),name=partID(request.url());
    if(request.method()!==method)return route.continue();
    counts.set(name,1+(counts.get(name)||0));
    if(block(name))return route.abort();
    return route.continue();
  });
}
async function device(browser){
  const c=await browser.newContext({...(browser.browserType().name()==='webkit'?devices['iPhone 13']:{}),serviceWorkers:'block'});
  const p=await c.newPage();p.setDefaultTimeout(25000);
  if(cloud){
    // Load the working client at the already permitted production origin. Sync
    // traffic itself goes to the real, unmodified Worker (never intercepted).
    await p.route('https://saveli0s.github.io/health-story-web/**',async route=>{
      const relative=decodeURIComponent(new URL(route.request().url()).pathname.slice('/health-story-web/'.length))||'index.html';
      assert(!relative.includes('..'));await route.fulfill({path:path.join(repo,relative)});
    });
  }
  await go(p);return p;
}
async function pair(master,recipient,id){
  await recipient.locator('header [data-action=family]').click();await recipient.locator('[data-action=joinDevice]').click();
  const output=recipient.locator('#device-request'),request=await download(recipient,output.getByRole('link'));
  const fingerprint=await output.locator('strong').innerText();
  await go(master,'?section=settings');await master.locator('main [data-action=devices]').click();await master.locator('[data-action=grantDevice]').click();
  const f=master.locator('#device-issue');await f.locator('[name=request]').setInputFiles(packetFile('qa.health-request',request));
  await f.locator('[name=fingerprint]').fill(fingerprint);await f.locator('[name=label]').fill('QA large');await f.locator('[name=member]').selectOption(id);await f.locator('button').click();
  const packet=await download(master,f.getByRole('link')),code=await f.locator('[role=status] strong').innerText();
  const install=recipient.locator('#device-install');
  await install.locator('[name=packet]').setInputFiles(packetFile('qa.health-device',packet));await install.locator('[name=code]').fill(code);await install.locator('button').click();
  await recipient.waitForURL(u=>u.searchParams.get('profile')===id);await recipient.locator('main h1').waitFor();
}
const sync=p=>p.evaluate(()=>deviceSync.synchronize());
async function digestInArchive(page){
  await go(page,'?section=settings');await page.locator('main [data-action=archive]').click();await page.locator('[data-action=exportBackup]').click();
  const form=page.locator('#backup-export'),key=await form.locator('[name=key]').inputValue();
  await form.locator('[type=checkbox]').check();await form.getByRole('button').click();
  const archive=await download(page,form.getByRole('link'));
  return {archive,key};
}
(async()=>{
 const desktop=await chromium.launch({channel:'chrome'}),mobile=await webkit.launch();
 let phase='create',errors=[];
 try{
   const master=await device(desktop),child=await device(mobile);
   for(const p of [master,child])p.on('pageerror',e=>errors.push(e.message));
   await go(master,'?new=family');await master.locator('[name=familyName]').fill('QA большие вложения');await master.locator('[name=memberName]').fill('Администратор QA');
   await master.locator('#family-form button').click();await master.getByRole('heading',{name:'Администратор QA',exact:true}).waitFor();
   const owner='p-large';
   await master.evaluate(([id,includeAdult])=>{
     const members=[{id,name:'Профиль QA',role:'Ребёнок'}];
     if(includeAdult)members.push({id:'p-author',name:'Автор QA',role:'Взрослый'});
     for(const member of members){family.members.push(member);prototypeState.profiles[member.id]=makeState(personFromMember(member))}
     if(!saveState())throw Error('family');
   },[owner,!cloud]);
   await go(master,'?section=settings');await master.locator('main [data-action=archive]').click();
   if(cloud)await master.locator('#sync-setup').fill((await fs.readFile(process.env.HS_SETUP_FILE,'utf8')).trim());
   await master.locator('[data-sync=enable]').click();await master.locator('[data-sync=now]').waitFor();await sync(master);
   await pair(master,child,owner);
   await go(master,'?profile='+owner+'&new=visit');const form=master.locator('#visit-form');
   await form.locator('[name=episodeName]').fill('Проверка архива');await form.locator('[name=doctorName]').fill('QA');await form.locator('[name=title]').fill('Исследование QA');await form.getByRole('button',{name:'Сохранить визит'}).click();
   const visit=await master.locator('#visit-files [data-action=upload]').getAttribute('data-id');
   const visitQuery='?profile='+owner+'&visit='+visit;
   phase='interrupted upload';
   let interruptUpload=true,failed=false;
   await routeParts(master,'PUT',name=>{if(!cloud && interruptUpload && name.endsWith('-1')){failed=true;return true}return false},deltas.writes);
   await master.locator('#visit-files [data-action=upload]').click();
   const upload=master.locator('#upload-form');await upload.locator('[name=category]').selectOption('Снимки');
   const filename='large.zip';
   await upload.locator('[type=file]').setInputFiles(zip(filename));await upload.getByRole('button',{name:'Прикрепить к визиту'}).click();
   await master.locator('dialog a[download]').waitFor();
   const id=await master.evaluate(name=>current().files.find(f=>f.name===name).id,filename);
   if(!cloud){
     await assert.rejects(sync(master));assert(failed);
     await sync(child);assert.equal(await child.evaluate(id=>current().files.filter(f=>f.id===id).length,id),0);
     await master.reload();await master.locator('main h1').waitFor();interruptUpload=false;
   }
   await sync(master);await sync(child);
   for(const [name,n] of deltas.writes)if(!name.endsWith('-1'))assert.equal(n,1,name);
   console.log('PASS published',filename,'with',deltas.writes.size,'immutable parts');
   phase='interrupted download and offline file';
   let pauseDownload=!cloud,gotFailure=false;
   await routeParts(child,'GET',name=>{if(pauseDownload&&name.endsWith('-1')){gotFailure=true;return true} return false},deltas.reads);
   await go(child,visitQuery);
   const row=()=>child.locator('#visit-files [data-action=file]').filter({hasText:filename});
   await row().click();
   if(!cloud){
     await child.getByText(/Оригинал сейчас недоступен/).waitFor();assert(gotFailure);
     await child.reload();await child.locator('main h1').waitFor();pauseDownload=false;
     await go(child,visitQuery);await child.locator('dialog [data-action=episode]').first().click();
     await child.locator('dialog [data-action=pinEpisode]').click();await child.getByText(/Доступно без сети/).waitFor();
     await go(child,visitQuery);await row().click();
   }
   const link=child.locator('dialog a[download]');await link.waitFor();
   for(const [name,n] of deltas.reads)if(!name.endsWith('-1'))assert.equal(n,1,name);
   const expected=sha(await fs.readFile(zip(filename)));
   await child.context().setOffline(true);
   assert.equal(sha(await download(child,link)),expected);
   // Reopen via the visit while actually offline, so the existing download URL
   // cannot hide a failure to commit the verified original to the local vault.
   await child.locator('dialog [data-action=visit]').click();await row().click();
   assert.equal(sha(await download(child,link)),expected);
   await child.context().setOffline(false);
   console.log('PASS offline reopening and SHA-256',expected);
   phase='archive via UI';
   const {archive,key}=await digestInArchive(master);const restore=await device(desktop);
   await go(restore,'?section=settings');await restore.locator('main [data-action=archive]').click();await restore.locator('[data-action=importBackup]').click();
   const importForm=restore.locator('#backup-import');await importForm.locator('[name=archive]').setInputFiles(packetFile('qa.health',archive));await importForm.locator('[name=key]').fill(key);
   await importForm.getByRole('button',{name:'Проверить копию'}).click();await importForm.locator('[name=replace]').check();await Promise.all([restore.waitForEvent('load'),importForm.getByRole('button',{name:'Восстановить'}).click()]);
   await go(restore,visitQuery);await restore.locator('#visit-files [data-action=file]').filter({hasText:filename}).click();
   assert.equal(sha(await download(restore,restore.locator('dialog a[download]'))),expected);
   console.log('PASS exported and restored family archive, identical original');
   if(!cloud){
     phase='oversized file stays with author and never produces an incomplete admin backup';
     const author=await device(desktop);await pair(master,author,'p-author');
     await go(author,visitQuery);await author.locator('#visit-files [data-action=upload]').click();
     const oversized=author.locator('#upload-form');await oversized.locator('[name=category]').selectOption('Снимки');
     await oversized.locator('[type=file]').setInputFiles(zip('over.zip'));
     await oversized.getByRole('button',{name:'Прикрепить к визиту'}).click();await author.locator('dialog a[download]').waitFor();
     await author.evaluate(()=>{current().fields.find(f=>f.id==='height').value='175';if(!saveState())throw Error('field')});
     await sync(author);await go(master,'?profile='+owner);await sync(master);await sync(child);
     assert.equal(await master.evaluate(()=>current().files.find(f=>f.name==='over.zip')?.syncLocalOnly?.limit),128*1024*1024);
     const status=await child.evaluate(()=>{
       const f=current().files.find(f=>f.name==='over.zip');
       return {flag:f?.syncLocalOnly,other:current().fields.find(f=>f.id==='height').value};
     });
     assert.equal(status.flag?.size,128*1024*1024+1);assert.equal(status.other,'175');
     assert.equal(await author.evaluate(async()=>{const f=current().files.find(f=>f.name==='over.zip');return (await fileBlob(person.id+'/'+f.id)).size}),status.flag.size);
     await assert.rejects(child.evaluate(async()=>{const f=current().files.find(f=>f.name==='over.zip');return (await fileBlob(person.id+'/'+f.id)).size}),/128 МиБ/);
     await go(master,'?section=settings');await master.locator('main [data-action=archive]').click();await master.locator('[data-action=exportBackup]').click();
     const exportForm=master.locator('#backup-export');await exportForm.locator('[type=checkbox]').check();await exportForm.getByRole('button').click();
     await exportForm.getByText(/Архив не создан/).waitFor();assert.equal(await exportForm.locator('a[download]').count(),0);
     console.log('PASS oversized file remains local to author, sibling record synchronizes, incomplete admin backup rejected');
   }
   if(!cloud && process.env.HS_NATIVE_LARGE_CHECK){
     phase='native interoperability and boundaries';
     const args=await master.evaluate(owner=>{const c=readJson(stateKey).sync;return {ctx:{space:c.space,token:c.token},keys:{key:c.profiles[owner].key},owner}},owner);
     const settings=path.join(run,'local-qa-session.json');
     try {
       async function native(file,id,write){
         await fs.writeFile(settings,JSON.stringify({...args,write,endpoint:base}),{mode:0o600});
         return execFileSync('xcrun',['simctl','spawn',process.env.HS_SIMULATOR_ID||'booted',process.env.HS_NATIVE_LARGE_CHECK,settings,zip(file),id],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
       }
       console.log((await native(filename,id,false)).trim());
       // Attach native-published immutable originals to the synthetic profile's
       // metadata, without a local copy, exercising the actual lazy web reader.
       for(const file of ['legacy.zip','edge-v1.zip','edge-v2.zip','max.zip']){
         const item='native-'+file.split('.')[0];console.log((await native(file,item,true)).trim());
         await master.evaluate(([owner,item,file])=>{let p=prototypeState.profiles[owner];p.files.push({id:item,name:file,type:'application/zip',category:'Снимки',date:'2026-01-01'});prototypeState.sync.profiles[owner].uploaded.push(item);if(!saveState())throw Error('fixture')},[owner,item,file]);
         const actual=await master.evaluate(async([owner,id])=>{
           const f=await fileBlob(owner+'/'+id);
           const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',await f.arrayBuffer()));return Array.from(bytes,n=>n.toString(16).padStart(2,'0')).join('');
         },[owner,item]);
         assert.equal(actual,sha(await fs.readFile(zip(file))));
       }
     }finally{await fs.rm(settings,{force:true})}
   }
   assert.deepEqual(errors,[]);console.log('PASS',cloud?'real Cloudflare relay':'scratch SQLite relay');
 }catch(e){console.error(phase,e);process.exitCode=1}
 finally{await Promise.all([desktop.close(),mobile.close()])}
})();
