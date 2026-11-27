// Isolated browser accounts and an intercepted Drive API. No Google account is used.
const {chromium,webkit,devices}=require('playwright-core');
const assert=require('node:assert/strict');
const base=process.env.HEALTH_PREVIEW_URL||'http://127.0.0.1:8764/';
const client='314159-test.apps.googleusercontent.com',scope='https://www.googleapis.com/auth/drive.file';
(async()=>{
 const mobile=process.argv.includes('--iphone'),browser=mobile?await webkit.launch():await chromium.launch({channel:'chrome'});
 const files=new Map(),sessions=new Map(),errors=[];
 let diag;
 let quota=false,drop=false,deny=false,phase='',trashDenied=false;
 const trashRequests=[];
 async function device(){
   const ctx=await browser.newContext({...(mobile?devices['iPhone 13']:{}),serviceWorkers:'block'});
   await ctx.route('https://accounts.google.com/o/oauth2/v2/auth**',async r=>{
     const q=new URL(r.request().url()).searchParams;
     assert.equal(q.get('scope'),scope);assert.equal(q.get('client_id'),client);
     const target=q.get('redirect_uri')+'#'+new URLSearchParams(deny?{state:q.get('state'),error:'access_denied'}:
       {state:q.get('state'),scope,access_token:'synthetic-test-token',token_type:'Bearer',expires_in:'3600'});
     await r.fulfill({contentType:'text/html',body:'<script>location.replace('+JSON.stringify(target)+')</script>'});
   });
   await ctx.route('https://www.googleapis.com/**',async r=>{
     const req=r.request(),url=new URL(req.url());
     assert.equal(req.headers().authorization,'Bearer synthetic-test-token');
     if(url.pathname==='/upload/drive/v3/files'&&req.method()==='POST'){
       if(quota)return r.fulfill({status:403,json:{error:{errors:[{reason:'storageQuotaExceeded'}]}}});
       const data=req.postDataJSON();assert.equal(data.appProperties.healthArchive,'HS01');assert(!data.name.includes('Тест'));
       const id=String(sessions.size+1);sessions.set(id,{name:data.name});
       return r.fulfill({status:200,headers:{'Access-Control-Expose-Headers':'Location, Range',Location:'https://www.googleapis.com/upload/drive/v3/files?upload_id='+id}});
     }
     if(req.method()==='PUT'){
       const id=url.searchParams.get('upload_id'),s=sessions.get(id);
       if(req.headers()['content-range'].startsWith('bytes */')){
         assert(files.has(id));return r.fulfill({json:{id,size:String(files.get(id).bytes.length)}});
       }
       const bytes=req.postDataBuffer();assert.equal(bytes.subarray(0,4).toString(),'HS01');assert(!bytes.includes('sensitive-original'));
       files.set(id,{...s,bytes});if(drop){drop=false;return r.abort('failed')}
       return r.fulfill({json:{id,size:String(bytes.length)}});
     }
     if(url.pathname==='/drive/v3/files'){
       assert.match(url.searchParams.get('q'),/trashed = false.*healthArchive.*HS01/);
       return r.fulfill({json:{files:[...files.entries()].filter(([,f])=>!f.trashed).map(([id,f])=>({id,name:f.name,size:String(f.bytes.length),modifiedTime:'2026-11-26T10:00:00Z',capabilities:{canTrash:!f.locked}}))}});
     }
     if(req.method()==='PATCH'){
       const id=url.pathname.split('/').at(-1);trashRequests.push(id);
       assert.equal(url.searchParams.get('fields'),'id,trashed');
       assert.deepEqual(req.postDataJSON(),{trashed:true});
       assert.equal(id,'disposable');assert(files.has(id));
       if(trashDenied)return r.fulfill({status:403,json:{error:{}}});
       files.get(id).trashed=true;return r.fulfill({json:{id,trashed:true}});
     }
     const f=files.get(url.pathname.split('/').at(-1));assert.equal(url.searchParams.get('alt'),'media');
     return r.fulfill({contentType:'application/octet-stream',body:f.bytes});
   });
   await ctx.route('https://oauth2.googleapis.com/revoke',r=>r.fulfill({status:200,body:'{}'}));
   const p=await ctx.newPage();diag=p;p.setDefaultTimeout(9000);p.on('pageerror',e=>errors.push(e.message));return p;
 }
 async function openDrive(p){
   await p.goto(base+'?section=settings');await p.locator('main [data-action=archive]').click();await p.locator('[data-action=drive]').click();
 }
 async function connect(p){
   await p.locator('#drive-auth [name=client]').fill(client);await p.locator('#drive-auth button').click();
   await p.waitForURL(u=>u.pathname.endsWith('index.html')&&!u.hash);await p.locator('#drive-result').waitFor({state:'attached'});
 }
 try{
   let p=await device();
   phase='create synthetic family';await p.goto(base+'?new=family');
   await p.locator('[name=familyName]').fill('Тест Drive');await p.locator('[name=memberName]').fill('Тест Владелец');await p.locator('#family-form button').click();
   await p.getByRole('heading',{name:'Тест Владелец',exact:true}).waitFor();
   const key=await p.evaluate(async()=>{
     await fileBlob(person.id+'/source',new Blob(['sensitive-original'],{type:'text/plain'}));
     current().files.push({id:'source',name:'Тест документ.txt',date:'2026-11-26',category:'Другое'});if(!saveState())throw Error();
     return deviceAuthority(family.id).recovery;
   });
   phase='OAuth decline and resumable upload';await openDrive(p);deny=true;await connect(p);await p.getByText('Вы отменили подключение.').waitFor();
   deny=false;await connect(p);drop=true;
   await p.locator('[data-drive=upload]').click();await p.getByText(/Нет связи с Google Диском/).waitFor();
   await p.locator('[data-drive=upload]').click();await p.getByText(/Копия сохранена на Google Диске/).waitFor();assert.equal(files.size,1);
   quota=true;await p.locator('[data-drive=upload]').click();await p.getByText(/недостаточно места/).waitFor();assert.equal(files.size,1);
   phase='delete only the selected copy';
   files.set('disposable',{...files.get('1'),name:'archive-disposable.health'});
   files.set('protected',{...files.get('1'),name:'archive-protected.health',locked:true});
   await p.locator('[data-drive=list]').click();
   const remove=p.getByRole('button',{name:'Удалить копию archive-disposable.health',exact:true});
   await remove.click();
   await p.getByText(/Переместить «archive-disposable.health»/).waitFor();
   await p.getByRole('button',{name:'Отмена',exact:true}).click();
   assert.deepEqual(trashRequests,[]);
   assert.equal(await p.getByRole('button',{name:'Удалить копию archive-protected.health',exact:true}).count(),0);
   await remove.click();trashDenied=true;
   await p.locator('[data-drive=trash]').click();await p.getByText(/Google не разрешил операцию/).waitFor();
   assert(!files.get('disposable').trashed);
   trashDenied=false;await p.locator('[data-drive=trash]').click();await p.getByText(/Копия перемещена в корзину/).waitFor();
   assert.deepEqual(trashRequests,['disposable','disposable']);
   assert(!files.get('1').trashed&&!files.get('protected').trashed);
   assert.equal(await p.evaluate(async()=>(await fileBlob(person.id+'/source')).text()),'sensitive-original');
   assert(await p.evaluate(()=>![JSON.stringify(localStorage),JSON.stringify(sessionStorage),location.href].join('').includes('synthetic-test-token')));
   await p.locator('[data-drive=disconnect]').click();await p.locator('#drive-auth').waitFor();
   phase='restore from another device';p=await device();await openDrive(p);await connect(p);await p.locator('[data-drive=list]').click();
   assert.equal(await p.locator('#drive-copies').getByText('archive-disposable.health',{exact:false}).count(),0);
   await p.locator('#drive-copies [data-drive=download]').first().click();await p.locator('#backup-import [name=key]').fill(key);
   await p.locator('#backup-import button').click();await p.getByText(/Копия проверена/).waitFor();assert.equal(await p.evaluate(()=>readJson(familyStateKey)),null);
   await p.locator('#backup-import [name=replace]').check();await p.locator('#backup-import button').click();
   await p.getByRole('heading',{name:'Тест Владелец',exact:true}).waitFor();
   assert.equal(await p.evaluate(async()=>(await fileBlob(person.id+'/source')).text()),'sensitive-original');
   assert.deepEqual(errors,[]);console.log('PASS',mobile?'iPhone WebKit':'desktop Chrome','Drive OAuth, upload resume, trash confirmation and retry, other copy and local diary kept, restore (intercepted API)');
 }catch(e){console.error(phase,e.message,await diag?.locator('#drive-result').textContent({timeout:500}).catch(()=>''),errors);process.exitCode=1}finally{await browser.close()}
})();
