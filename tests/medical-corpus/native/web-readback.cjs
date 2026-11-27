// Restore an isolated XCTest app's encrypted archive in an empty web journal.
const {chromium,webkit,devices}=require('playwright-core');
const {execFileSync}=require('node:child_process');
const {createHash}=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const mode=process.argv[2],sim=process.argv[3],mobile=process.argv.includes('--iphone');
const bundles={lab:'by.healthstory.labintake',batch:'by.healthstory.batchvisit',chatgpt:'by.healthstory.chatgpt.qa'};
if(!bundles[mode]||!sim)throw Error('Expected lab, batch or chatgpt and a simulator UUID');
const bundle=bundles[mode];
const dir=execFileSync('xcrun',['simctl','get_app_container',sim,bundle,'data'],{encoding:'utf8'}).trim();
const archive=path.join(dir,'Library/Application Support/family.health'),base=process.argv.includes('--published')?'https://saveli0s.github.io/health-story-web/':'http://127.0.0.1:8764/';
(async()=>{
 const b=mobile?await webkit.launch():await chromium.launch({channel:'chrome'});
 try{
  const ctx=await b.newContext({...mobile?devices['iPhone 13']:{},serviceWorkers:'block'});
  await ctx.route(/^https?:/,route=>new URL(route.request().url()).origin===new URL(base).origin?route.continue():route.abort());
  const p=await ctx.newPage();p.on('pageerror',err=>console.error('Web journal:',err.stack));p.setDefaultTimeout(8000);const d=p.locator('dialog[open]');
  await p.goto(base+'?section=settings');await p.locator('main [data-action=archive]').click();await d.locator('[data-action=importBackup]').click();
  await d.locator('[name=archive]').setInputFiles(archive);await d.locator('[name=key]').fill(Buffer.alloc(32,66).toString('base64url'));
  await d.getByRole('button',{name:'Проверить копию'}).click();await d.locator('[name=replace]').check();await d.getByRole('button',{name:'Восстановить',exact:true}).click();
  await p.getByRole('heading',{name:'Мая Макетова',exact:true}).waitFor();
  if(mode==='chatgpt'){
   await p.goto(base+'?profile=p-main&section=consults');
   await p.locator('main [data-action=consultRecord]').filter({hasText:'QA ChatGPT'}).click();
   await d.getByText('Второй учебный ответ',{exact:true}).waitFor();
   const sent=d.locator('details').filter({has:p.getByText('Отправленный контекст',{exact:true})});
   await sent.locator('summary').click();
   await sent.locator('pre').filter({hasText:/Первый \[имя скрыто\] ответ/}).waitFor();
   const row=await p.evaluate(()=>current().consultations.find(c=>c.id==='chatgpt-qa'));
   assert.equal(row.answer,'Первый учебный ответ: Стенд, Учебный протокол.txt');
   assert.equal(row.turns.length,1);
   assert.equal(row.turns[0].transfers[0].actorId,'p-main');
   assert.equal(row.turns[0].sentHistory[1].content,'Первый [имя скрыто] ответ: [клиника скрыта], [имя файла скрыто]');
   assert.equal(row.nextQuestion,'');
   await d.locator('#chatgpt-followup textarea').fill('QA release draft');
   await d.getByRole('button',{name:'Сохранить черновик'}).click();
   await d.getByText('Черновик сохранён.',{exact:true}).waitFor();
   await p.reload();
   await p.locator('main [data-action=consultRecord]').filter({hasText:'Старый черновик'}).click();
   await d.locator('#consult-answer textarea[name=prompt]').waitFor();
   assert.match(await d.locator('#consult-answer textarea[name=prompt]').inputValue(),/\[почта скрыта\]/);
   await p.reload();
   await p.locator('main [data-action=consultRecord]').filter({hasText:'QA ChatGPT'}).click();
   assert.equal(await d.locator('#chatgpt-followup textarea').inputValue(),'QA release draft');
   console.log('PASS',mode,mobile?'WebKit':'Chrome','restored replies and sent context, opens an old draft, saves a follow-up after reload');
   return;
  }
  await p.goto(base+'?profile=p-main&section='+(mode==='lab'?'labs':'history'));
  await p.locator('main h1, main h2').first().waitFor();
  const files=await p.evaluate(async()=>Promise.all(current().files.map(async f=>{
    const blob=await fileBlob(person.id+'/'+f.id);
    return {id:f.id,name:f.name,visit:f.visit,lab:f.lab||null,sha:Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer())),x=>x.toString(16).padStart(2,'0')).join('')}
  })));
  assert.equal(files.length,2);
  if(mode==='lab'){
   for(const f of files)assert.equal(f.sha,createHash('sha256').update(fs.readFileSync(path.join(__dirname,'../labs',f.name))).digest('hex'));
   const lab=files.find(f=>f.lab);assert(!lab.visit);assert.equal(lab.lab.date,'2025-01-08');
   assert(lab.lab.rows.some(r=>r.name==='Гемоглобин'&&r.value==='132'&&r.unit==='г/л'));
   await p.locator('main [data-action=lab]').first().click();await d.locator('.lab-value').filter({hasText:'Гемоглобин'}).getByRole('button',{name:'Динамика'}).click();await d.getByRole('heading',{name:/Гемоглобин/}).waitFor();
   assert.equal(await p.evaluate(()=>indicatorGroups().filter(g=>g.name==='Гемоглобин').flatMap(g=>g.points).length),1);
  }else{
   const row=await p.evaluate(()=>current().addedVisits.find(v=>v[2]==='Визит из веба'));assert(row);assert.equal(row[8][0].strength,'2 мг');
   assert(files.every(f=>f.visit===row[0]));assert.equal(await p.evaluate(()=>current().visitDrafts.length),0);
   for(const [id,raw] of [['source1','FIRST FILE QA'],['source2','SECOND FILE QA']]) assert.equal(files.find(f=>f.id===id).sha,createHash('sha256').update(raw).digest('hex'));
  }
  console.log('PASS',mode,mobile?'WebKit':'Chrome','restored native encrypted archive with two SHA-256 matches');
 }finally{await b.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
