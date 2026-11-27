const {chromium}=require('playwright-core');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process'),{randomUUID,createHash}=require('node:crypto');
const dir=process.argv[2], id=process.env.HS_DEVICE, simulator=process.env.HS_SIMULATOR==='1', bundle='by.healthstory.devicecheck';
const admin=process.env.HS_ADMIN_DEVICE==='1';
const reinstall=process.env.HS_VERIFY_REINSTALL==='1';
const x=(...args)=>execFileSync('xcrun',args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:30000});
const container=simulator?path.join(x('simctl','get_app_container',id,bundle,'data').trim(),'Documents'):null;
const marker=randomUUID(), name=n=>marker+'-'+n;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function send(filename,bytes) {
 if(container) {await fs.mkdir(container,{recursive:true});const temp=path.join(container,filename+'.part');await fs.writeFile(temp,bytes);await fs.rename(temp,path.join(container,filename));return}
 const local=path.join(dir,filename);await fs.writeFile(local,bytes,{mode:0o600});
 for(let attempt=0;attempt<3;attempt++) {
  try {
   x('devicectl','device','copy','to','--timeout','8','--device',id,'--domain-type','appDataContainer','--domain-identifier',bundle,'--source',local,'--destination','Documents/'+filename);
   return;
  }catch(error) {
   if(attempt===2)throw error;
   await pause(1500);
  }
 }
}
async function read(filename) {
 if(container)return fs.readFile(path.join(container,filename));
 const local=path.join(dir,filename);
 x('devicectl','device','copy','from','--timeout','5','--device',id,'--domain-type','appDataContainer','--domain-identifier',bundle,'--source','Documents/'+filename,'--destination',local);
 return fs.readFile(local);
}
async function waitFor(filename,failure='failed') {
 const deadline=Date.now()+120000;
 while(Date.now()<deadline){
  let failed;try{failed=await read(name(failure))}catch{}
  if(failed)throw Error('iOS: '+failed.toString());
  try{return await read(name(filename))}catch{}
  await pause(700);
 }
 throw Error('iOS timeout: '+filename);
}
function launch(args=[]) {
 if(simulator){
  try{x('simctl','terminate',id,bundle)}catch{}
  x('simctl','launch',id,bundle,...args);
 }else{
  x('devicectl','device','process','launch','--device',id,'--terminate-existing',bundle,...(args.length?['--',...args]:[]));
 }
}
(async()=>{
 const pdf=await fs.readFile(path.join(__dirname,'../../assets/documents/cbc.pdf'));
 const setup=(await fs.readFile(process.env.HS_SETUP_FILE,'utf8')).trim();
 await send('test-run',marker);await send(name('pdf'),pdf);await send(name('role'),admin?'admin':'adult');
 if(reinstall){
  assert(admin&&!simulator,'Use the disposable administrator app on a physical device');
  await send(name('reinstall'),'yes');
 }
 launch();
 const chrome=await chromium.launch({channel:'chrome'});
 try{
 const ctx=await chrome.newContext({serviceWorkers:'block'}),p=await ctx.newPage();
 const base='https://saveli0s.github.io/health-story-web/';
 await p.goto(base+'?new=family',{waitUntil:'domcontentloaded',timeout:60000});
 await p.locator('[name=familyName]').fill('Тест совместимости iPhone');await p.locator('[name=memberName]').fill('Администратор QA');await p.locator('#family-form button').click();
 await p.getByRole('heading',{name:'Администратор QA',exact:true}).waitFor();
 await p.evaluate(()=>{for(const [id,name,role] of [['p-adult','Взрослый QA','Взрослый'],['p-child','Ребёнок QA','Ребёнок']]){
  const m={id,name,role};family.members.push(m);prototypeState.profiles[id]=makeState(personFromMember(m));
 }if(!saveState())throw Error('save')});
 await p.goto(base+'?section=settings');await p.locator('main [data-action=archive]').click();
 await p.locator('#sync-setup').fill(setup);await p.locator('[data-sync=enable]').click();
 await p.locator('[data-sync=now]').waitFor();await p.evaluate(()=>deviceSync.synchronize());
 const adminId=await p.evaluate(()=>family.adminId);
 console.log('PASS hosted web family enabled');
 const request=await waitFor('request');
 const fp=createHash('sha256').update(Buffer.from(JSON.parse(request).spki,'base64')).digest('hex').slice(0,16);
 await p.goto(base+'?section=settings');await p.locator('main [data-action=devices]').click();await p.locator('[data-action=grantDevice]').click();
 const f=p.locator('#device-issue');await f.locator('[name=request]').setInputFiles({name:'device.health-request',mimeType:'application/octet-stream',buffer:request});
 await f.locator('[name=fingerprint]').fill(fp);await f.locator('[name=label]').fill('iPhone QA');await f.locator('[name=member]').selectOption(admin?adminId:'p-adult');
 await f.locator('button').click();const dl=p.waitForEvent('download');await f.getByRole('link').click();
 const packet=await fs.readFile(await (await dl).path()),code=await f.locator('[role=status] strong').innerText();
 await send(name('code'),code);await send(name('packet'),packet);await waitFor('uploaded');
 await p.goto(base+'?profile=p-child');await p.locator('main h1').waitFor();await p.evaluate(()=>deviceSync.synchronize());
 const check=await p.evaluate(async admin=>{
  const pr=current(),visit=pr.addedVisits.find(v=>v[2]==='Визит с iPhone');if(!visit)throw Error('Missing iPhone visit');
  const attachment=pr.files.find(f=>f.visit===visit[0]);const blob=await fileBlob('p-child/'+attachment.id);
  const bytes=new Uint8Array(await blob.arrayBuffer());
  await fileBlob('p-child/from-web',new Blob([bytes],{type:'application/pdf'}));
  pr.files.push({id:'from-web',name:'Веб-копия.pdf',category:'Лаборатория',date:visit[1],visit:visit[0]});
  if(admin){
    if(!pr.fields.some(f=>f.id==='qa-ios-field'&&f.value==='Проверено на iPhone'))throw Error('Missing administrator field from iPhone');
    const linked=pr.files.filter(f=>f.id==='native-existing-visit'&&f.visit===visit[0]&&f.intake&&!f.checked);
    if(linked.length!==1 || await (await fileBlob('p-child/native-existing-visit')).text()!=='QA synthetic attachment')throw Error('Missing original added to the existing iPhone visit');
    await fileBlob('p-child/backup-web',new Blob([bytes],{type:'application/pdf'}));
    pr.files.push({id:'backup-web',name:'Для полной копии.pdf',category:'Лаборатория',date:visit[1]});
  }
  visit[5]='Проверено в вебе';if(!saveState())throw Error('save');
  await deviceSync.synchronize();return Array.from(bytes);
 },admin);
 assert.deepEqual(Buffer.from(check),pdf);
 console.log('PASS native visit and PDF verified in web, reciprocal edit published');
 await send(name('web-edited'),'ok');
 console.log((await waitFor('passed')).toString());
 if(admin){
  const result=await p.evaluate(async()=>{
    await deviceSync.synchronize();
    const pr=current();
    return {source:pr.files.some(f=>f.id==='backup-web'),retained:pr.files.some(f=>f.id==='from-web'),visit:pr.addedVisits.some(f=>f[2]==='Визит с iPhone')};
  });
  assert.deepEqual(result,{source:false,retained:true,visit:true});
  console.log('PASS deletion reached hosted web with the other original and the visit intact');
 }
 launch(['--offline-readback']);
 console.log((await waitFor('offline-passed','offline-failed')).toString());
 await fs.writeFile(path.join(dir,'offline-preview.png'),await read(name('offline-preview.png')));
 if(reinstall){
  const app=path.join(dir,'build/Build/Products/Debug-iphoneos/HealthStory.app');
  x('devicectl','device','uninstall','app','--device',id,bundle);
  x('devicectl','device','install','app','--device',id,app);
  await send('test-run',marker);await send(name('pdf'),pdf);
  launch(['--reinstall-readback']);
  console.log((await waitFor('reinstall-passed','reinstall-failed')).toString());
 }
 }finally{await chrome.close()}
})().catch(e=>{console.error(e.message);process.exitCode=1});
