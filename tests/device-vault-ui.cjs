// Independent browser profiles. Only synthetic family records and attachments.
const {chromium,webkit,devices}=require('playwright-core');
const assert=require('node:assert/strict'),fs=require('node:fs/promises');
const base=process.env.HEALTH_PREVIEW_URL||'http://127.0.0.1:8764/';
const mobile=process.argv.includes('--iphone'),mixed=process.argv.includes('--mixed');
(async()=>{
  const browser=mobile?await webkit.launch():await chromium.launch({channel:'chrome'});
  const recipientBrowser=mixed?await webkit.launch():browser;
  const errors=[];
  let phase='';
  async function newDevice(offlineShell=false){
    const host=offlineShell?browser:recipientBrowser;
    const ctx=await host.newContext({...(mobile||mixed&&!offlineShell?devices['iPhone 13']:{viewport:{width:1280,height:900}}),serviceWorkers:offlineShell?'allow':'block'});
    return ctx.newPage();
  }
  async function visit(p,query=''){
    await p.goto(base+query);await p.locator('main h1').waitFor({state:'attached'});
  }
  function act(p,name){return p.locator('dialog [data-action="'+name+'"]').first().click()}
  async function navSubmit(p,selector){
    await Promise.all([p.waitForEvent('load'),p.locator(selector).click()]);
    await p.locator('main h1').waitFor({state:'attached'});
  }
  async function deviceSettings(p){
    await visit(p,'?section=settings');await p.locator('main [data-action=devices]').click();
  }
  async function download(p,element){
    const done=p.waitForEvent('download');await element.click();return fs.readFile(await (await done).path());
  }
  async function request(p){
    await visit(p);await p.locator('header [data-action=family]').click();await act(p,'joinDevice');
    const section=p.locator('#device-request');
    const buffer=await download(p,section.getByRole('link'));
    return {buffer,fingerprint:await section.locator('strong').innerText()};
  }
  async function issue(admin,req,member,revoked=false){
    await deviceSettings(admin);await act(admin,'grantDevice');const f=admin.locator('#device-issue');
    await f.locator('[name=request]').setInputFiles({name:'join.health-request',mimeType:'application/octet-stream',buffer:req.buffer});
    await f.locator('[name=fingerprint]').fill(req.fingerprint);await f.locator('[name=label]').fill('Устройство '+member);
    await f.locator('[name=member]').selectOption(member);await f.locator('button').click();
    if(revoked){await f.getByText(/устройство отозвано/).waitFor();return}
    return {buffer:await download(admin,f.getByRole('link')),code:await f.locator('[role=status] strong').innerText()};
  }
  async function update(admin,member){
    await deviceSettings(admin);
    await admin.locator('.plain-card').filter({hasText:'Устройство '+member}).locator('[data-action=deviceUpdate]').click();
    const f=admin.locator('#device-issue');await f.locator('button').click();
    return {buffer:await download(admin,f.getByRole('link')),code:await f.locator('[role=status] strong').innerText()};
  }
  async function install(p,pkg,negative){
    const f=p.locator('#device-install');
    await f.locator('[name=packet]').setInputFiles({name:'profiles.health-device',mimeType:'application/octet-stream',buffer:pkg.buffer});
    await f.locator('[name=code]').fill(pkg.code);
    if(negative){await f.locator('button').click();await f.getByText(negative).waitFor();return}
    await navSubmit(p,'#device-install button');
  }
  try{
    phase='migration and cold reopening';
    let admin=await newDevice(true);
    const child=await newDevice(),adult=await newDevice();
    for(const p of [admin,child,adult])p.on('pageerror',e=>errors.push(e.message));
    await visit(admin);
    await admin.evaluate(async()=>{
      const members=[['p-master','Админ Тест','Взрослый'],['p-adult','Взрослый Тест','Взрослый'],['p-child','Ребёнок Тест','Ребёнок'],['p-sibling','Второй Ребёнок','Ребёнок']].map(([id,name,role])=>({id,name,role}));
      const data={schemaVersion:2,generation:'legacy',family:{kind:'family',id:'f-test',adminId:'p-master',name:'Семья пример',members},
        profiles:{},tags:initialTags,templates:[],city:'Минск'};
      const db=await storageDB(data);
      for(const m of members){
        const p=data.profiles[m.id]=makeState(personFromMember(m));
        p.fields.push({id:'secret',label:'Личная запись',value:'clinical-value-'+m.id});
        p.visitDrafts.push({id:'draft',name:'источник-'+m.id});
        await new Promise((resolve,reject)=>{
          const tx=db.transaction('documents','readwrite');
          tx.objectStore('documents').put({bytes:new TextEncoder().encode('source-content-'+m.id).buffer,type:'text/plain'},m.id+'/draft');
          tx.oncomplete=resolve;tx.onerror=reject;
        });
      }
      db.close();localStorage.setItem(familyStateKey,JSON.stringify(data));
    });
    await visit(admin,'?profile=p-master');
    const audit=p=>p.evaluate(async()=>{
      const db=await storageDB();
      const entries=await new Promise((resolve,reject)=>{
        const req=db.transaction('documents').objectStore('documents').getAll();req.onsuccess=()=>resolve(req.result);req.onerror=reject;
      });db.close();
      return {sealed:localStorage.getItem(stateKey).startsWith('HSJ1.')&&!JSON.stringify(localStorage).includes('clinical-value-'),
        encryptedFiles:entries.every(e=>e.version===1&&e.iv.byteLength===12&&e.cipher&&!e.bytes&&!e.type),
        n:entries.length,profiles:Object.keys(prototypeState.profiles).sort(),role:viewer,
        original:await (await fileBlob(person.id+'/draft')).text(),type:(await fileBlob(person.id+'/draft')).type};
    });
    assert.deepEqual(await audit(admin),{sealed:true,encryptedFiles:true,n:4,profiles:['p-adult','p-child','p-master','p-sibling'],role:'admin',original:'source-content-p-master',type:'text/plain'});
    const ctx=admin.context();
    await admin.evaluate(()=>navigator.serviceWorker.ready.then(()=>true));
    await admin.waitForFunction(()=>Boolean(navigator.serviceWorker.controller));
    await ctx.setOffline(true);await admin.close();admin=await ctx.newPage();admin.on('pageerror',e=>errors.push(e.message));
    await visit(admin,'?profile=p-master');assert.equal(await admin.evaluate(()=>field('secret')),'clinical-value-p-master');
    const cached=await admin.evaluate(async()=>{
      const cache=await caches.open((await caches.keys()).find(k=>k.startsWith('health-story-shell-')));
      const requests=await cache.keys();
      return requests.map(r=>new URL(r.url).pathname);
    });
    assert(cached.includes('/assets/app/vault.js'));
    assert(cached.every(p=>(/\.(js|css|html|ttf|png)$/.test(p)||/\/assets\/recognition\/[\w.-]+\.(mjs|gz)$/.test(p))&&!p.includes('p-master')));
    await ctx.setOffline(false);
    phase='issuance, wrong device and wrong code';
    const childReq=await request(child),adultReq=await request(adult);
    const childPkg=await issue(admin,childReq,'p-child');
    assert(!childPkg.buffer.includes('clinical-value')&&!childPkg.buffer.includes(childPkg.code));
    await install(adult,childPkg,/Доступ не открыт/);await install(child,{...childPkg,code:'incorrect'},/Доступ не открыт/);
    await install(child,childPkg);
    phase='child scope, URL and storage permissions';
    await visit(child,'?role=admin&space=demo&profile=p-master');
    assert.deepEqual(await audit(child),{sealed:true,encryptedFiles:true,n:1,profiles:['p-child'],role:'child',original:'source-content-p-child',type:'text/plain'});
    assert(await child.evaluate(async()=>{
      const raw=localStorage.getItem(stateKey);
      current().notes.push({id:'blocked'});
      let rejected=0;
      for(const fn of [()=>fileBlob('p-child/new',new Blob(['x'])),()=>removeBlob('p-child/draft'),()=>fileBlob('p-master/draft')]){
        try{await fn()}catch{rejected++}
      }
      try{deviceAuthority(family.id)}catch{rejected++}
      return !saveState()&&rejected===4&&raw===localStorage.getItem(stateKey);
    }));
    phase='adult scope and local changes';
    const adultPkg=await issue(admin,adultReq,'p-adult');await install(adult,adultPkg);
    assert.deepEqual(await audit(adult),{sealed:true,encryptedFiles:true,n:3,profiles:['p-adult','p-child','p-sibling'],role:'adult',original:'source-content-p-adult',type:'text/plain'});
    await visit(adult,'?profile=p-sibling');
    assert(await adult.evaluate(()=>{current().notes.push({id:'new',text:'Local adult change'});return saveState()}));
    await visit(adult,'?role=admin&profile=p-sibling');assert(await adult.evaluate(()=>current().notes.some(n=>n.id==='new')&&viewer==='adult'));
    const nextAdult=await update(admin,'p-adult');
    await deviceSettings(adult);await act(adult,'joinDevice');await install(adult,nextAdult,/собственные изменения/);
    phase='new child snapshot and revocation';
    await visit(admin,'?profile=p-child');
    await admin.evaluate(()=>{current().fields.find(f=>f.id==='secret').value='updated';if(!saveState())throw Error()});
    const nextChild=await update(admin,'p-child');
    await deviceSettings(child);await act(child,'joinDevice');await install(child,nextChild);
    assert.equal(await child.evaluate(()=>field('secret')),'updated');assert.equal((await audit(child)).n,1);
    await deviceSettings(child);await act(child,'joinDevice');await install(child,childPkg,/устарел/);
    await deviceSettings(admin);await admin.locator('.plain-card').filter({hasText:'Устройство p-child'}).locator('[data-action=revokeDevice]').click();
    await admin.locator('#device-revoke button').click();await admin.getByText(/Доступ отозван/).waitFor();
    await issue(admin,childReq,'p-child',true);
    phase='corrupted journal fails closed';
    const corrupt=await child.evaluate(()=>{const v=localStorage.getItem(stateKey),i=v.lastIndexOf('.')+4;
      const bad=v.slice(0,i)+(v[i]==='A'?'B':'A')+v.slice(i+1);localStorage.setItem(stateKey,bad);return bad});
    await child.reload();await child.getByText(/Не удалось открыть дневник/).waitFor();
    assert.equal(await child.evaluate(()=>localStorage.getItem('health-story.family.journal')),corrupt);
    assert.deepEqual(errors,[]);
    console.log('PASS',mixed?'Chrome → iPhone WebKit':mobile?'iPhone WebKit':'desktop Chrome','legacy encryption, cold open, per-device originals, role isolation, updates, revocation and corruption');
  }catch(e){console.error(phase,e.message);process.exitCode=1}
  finally{if(mixed)await recipientBrowser.close();await browser.close()}
})();
