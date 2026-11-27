// Exercise an already cached release and a normal reload, then reopen the same data offline.
// Invoke with the web root of the previous release as the first argument.
const fs=require('node:fs/promises');
const path=require('node:path');
const http=require('node:http');
const crypto=require('node:crypto');
const assert=require('node:assert/strict');
const {chromium,webkit,devices}=require('playwright-core');
const previous=process.argv[2];
if(!previous)throw Error('Specify the previous release directory');
const current=path.resolve(__dirname,'..');
const mobile=process.argv.includes('--iphone');
const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.ttf':'font/ttf'};
async function run(){
  let root=path.resolve(previous);
  const server=http.createServer(async(req,res)=>{
    try {
      const pathname=new URL(req.url,'http://localhost').pathname;
      const name=pathname.replace(/^\/health-story-web\//,'')||'index.html';
      if(!pathname.startsWith('/health-story-web/')||name.includes('..'))throw Error();
      const bytes=await fs.readFile(path.join(root,name));
      const etag='"'+crypto.createHash('sha256').update(bytes).digest('hex')+'"';
      res.setHeader('Cache-Control','public, max-age=600');
      res.setHeader('Content-Type',mime[path.extname(name)]||'application/octet-stream');
      res.setHeader('ETag',etag);
      if(req.headers['if-none-match']===etag)res.writeHead(304).end();
      else res.end(bytes);
    } catch {res.writeHead(404).end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser;
  try {
    const base='http://127.0.0.1:'+server.address().port+'/health-story-web/';
    browser=mobile?await webkit.launch():await chromium.launch({channel:'chrome'});
    const ctx=await browser.newContext(mobile?devices['iPhone 13']:{});
    const p=await ctx.newPage();
    p.setDefaultTimeout(15000);
    const family=process.argv.includes('--family');
    const pdf=await fs.readFile(path.join(__dirname,'medical-corpus/visits/V02-two-page-visit.pdf'));
    const digest=crypto.createHash('sha256').update(pdf).digest('hex');
    const marker='Заметка до обновления веб-приложения';
    if(family){
      await p.goto(base+'?new=family');
      await p.locator('[name=familyName]').fill('Семья до обновления');
      await p.locator('[name=memberName]').fill('Родитель');
      await p.locator('#family-form button').click();
      await p.getByRole('heading',{name:'Родитель',exact:true}).waitFor();
      await p.goto(base+'?section=settings');
      await p.locator('#direct-auto').check();
      await p.evaluate(async bytes=>{
        await fileBlob(person.id+'/old-pdf',new Blob([Uint8Array.from(bytes)],{type:'application/pdf'}));
        current().files.push({id:'old-pdf',name:'Учебный визит.pdf',category:'Другое',type:'application/pdf',date:'2026-11-25'});
        if(!saveState())throw Error('Failed to persist the PDF record');
      },Array.from(pdf));
      await p.goto(base+'?section=files');
    }else{
      await p.goto(base+'?visit=a1');
      await p.locator('dialog [data-action=addNote]').click();
      await p.locator('#note-form [name=note]').fill(marker);
      await p.locator('#note-form button.primary').click();
      await p.locator('dialog').getByText(marker,{exact:true}).waitFor();
    }
    await p.evaluate(()=>navigator.serviceWorker.ready);
    await p.waitForFunction(()=>navigator.serviceWorker.controller!=null);
    root=current;
    const wanted=(await fs.readFile(path.join(current,'sw.js'),'utf8')).match(/const version='([^']+)'/)[1];
    await p.evaluate(async()=>{
      const reg=await navigator.serviceWorker.getRegistration();
      const claimed=new Promise(resolve=>navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true}));
      await reg.update();
      await claimed;
    });
    await p.waitForFunction(async v=>(await caches.keys()).filter(k=>k.startsWith('health-story-shell-')).join('')===v,wanted,{timeout:30000});
    for(const offline of [false,true]){
      await ctx.setOffline(offline);
      await p.reload({waitUntil:'domcontentloaded',timeout:30000});
      if(family){
        await p.locator('[data-action=file][data-id=old-pdf]').first().click();
        await p.locator('#file-paper canvas').waitFor();
        const actual=await p.evaluate(async()=>{
          const file=await fileBlob(person.id+'/old-pdf');
          const hash=await crypto.subtle.digest('SHA-256',await file.arrayBuffer());
          return {digest:Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join(''),router:current().directAuto,chat:current().chatGPTAuto===true};
        });
        assert.deepEqual(actual,{digest,router:true,chat:false});
      }else await p.locator('dialog').getByText(marker,{exact:true}).waitFor();
      const safe=await p.evaluate(()=>typeof anonymizeClinicalText==='function'&&cleanClinicalText('Карта QA-789.').includes('[номер скрыт]'));
      assert.equal(safe,true,offline?'old code after offline reload':'old code after online reload');
    }
    console.log('PASS',mobile?'iPhone WebKit':'desktop Chrome',family?'updated encrypted family, provider consent and rendered PDF verified online and offline by checksum':'note survived online and offline upgrade');
  } finally {await browser?.close();await new Promise(resolve=>server.close(resolve))}
}
run().catch(e=>{console.error(e.message);process.exitCode=1});
