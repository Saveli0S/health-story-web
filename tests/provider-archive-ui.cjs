// External provider calls are intercepted. These checks use only synthetic records.
const {chromium,webkit,devices}=require('playwright-core');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
(async()=>{
 const mobile=process.argv.includes('--iphone'),browser=mobile?await webkit.launch():await chromium.launch({channel:'chrome'});
 // Network interception in WebKit requires the test page to own provider requests.
 const options={...(mobile?devices['iPhone 13']:{viewport:{width:1280,height:920}}),serviceWorkers:'block'};
 const base='http://127.0.0.1:8764/',ctx=await browser.newContext(options),page=await ctx.newPage(),errors=[];
 const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'health-review-')),archive=path.join(tmp,'synthetic.health');
 let diagnosticPage=page,phase='',sent=[],blockNext=false,challenge='';
 const click=(p,sel)=>p.locator(sel).first().click();
 const dialog=page.locator('dialog'),a=k=>click(dialog,'[data-action="'+k+'"]'),n=k=>dialog.locator('[name="'+k+'"]').first();
 const settings=async p=>click(p,'[data-action=section][data-id=settings]');
 page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(7000);
 try{
   phase='draft reload';
   await page.goto(base+'?new=visit&mode=photo');await a('sampleVisit');await dialog.locator('#visit-form').waitFor();
   await n('title').fill('Черновик для восстановления');await page.goto(base);await click(page,'.review-queue [data-action=resumeVisit]');
   assert.equal(await n('title').inputValue(),'Черновик для восстановления');await a('close');
   await page.goto(base+'?new=visit&mode=photo');
   await dialog.locator('#visit-source').setInputFiles(['лист.txt','заключение.txt'].map((name,i)=>({name,mimeType:'text/plain',buffer:Buffer.from('Страница '+(i+1))})));
   await dialog.getByRole('heading',{name:'Визит в очереди'}).waitFor();await a('close');
   phase='provider connection';
   await ctx.route('https://openrouter.ai/api/v1/auth/keys',async r=>{
     const data=r.request().postDataJSON();assert.equal(data.code,'integration-test');assert.equal(require('node:crypto').createHash('sha256').update(data.code_verifier).digest('base64url'),challenge);
     await r.fulfill({json:{key:'synthetic-session-only'}});
   });
   await ctx.route('https://openrouter.ai/api/v1/chat/completions',async r=>{
     assert.equal(r.request().headers().authorization,'Bearer synthetic-session-only');
     const data=r.request().postDataJSON();assert.equal(data.model,'openrouter/free');
     sent.push(data.messages[0].content);if(blockNext){blockNext=false;await r.fulfill({status:429,body:''});return}
     await r.fulfill({json:{model:'fixture/free',choices:[{message:{content:'Ответ тестового провайдера.'}}]}});
   });
   await settings(page);await click(page,'main [data-action=providers]');await a('beginAI');
   const url=new URL(await dialog.getByText('Перейти к авторизации').getAttribute('href'));
   assert.equal(url.hostname,'openrouter.ai');challenge=url.searchParams.get('code_challenge');
   await n('code').fill('integration-test');await dialog.getByText('Завершить подключение').click();await dialog.getByText('Отключить в этой вкладке').waitFor();await a('close');
   phase='live transport and quota';
   await click(page,'[data-action=section][data-id=consults]');await click(page,'main [data-action=consult]');
   await dialog.locator('.prompt-picker summary').click();
   await dialog.getByRole('button',{name:'Подготовка к приёму',exact:true}).click();await dialog.getByText('Проверить запрос').click();
   await n('prompt').fill((await n('prompt').inputValue())+'\nКарта Q-777. Адрес: ул. Макетная, дом 12.');
   await a('askProvider');await dialog.getByText(/Личные сведения скрыты/).waitFor();
   assert.equal(sent.length,0);
   const exact=await n('prompt').inputValue();assert.doesNotMatch(exact,/Q-777|Макетная/);blockNext=true;await a('askProvider');await dialog.getByText(/Квота исчерпана/).waitFor();
   await a('askProvider');await dialog.getByText('Ответ тестового провайдера.',{exact:true}).waitFor();assert.deepEqual(sent,[exact,exact]);await a('close');
   phase='visit analysis uses template';
   await click(page,'[data-action=section][data-id=overview]');await click(page,'.overview-visits [data-id=a1]');await a('analyze');await dialog.locator('#direct-treatment').waitFor();
   await n('prompt').fill((await n('prompt').inputValue())+'\nПаспорт MP 9876543.');
   await dialog.getByText('Подтвердить и отправить',{exact:true}).click();
   await dialog.getByText(/Личные сведения скрыты/).waitFor();assert.equal(sent.length,2);
   const rx=await n('prompt').inputValue();assert.doesNotMatch(rx,/9876543/);assert.match(rx,/Мометазон/);await dialog.getByText('Подтвердить и отправить',{exact:true}).click();
   await dialog.getByText('Ответ тестового провайдера.',{exact:true}).waitFor();assert.equal(sent.at(-1),rx);await a('close');
   phase='automatic treatment delivery';
   await page.evaluate(()=>{
     const allergy=current().fields.find(row=>row.id==='allergy');
     allergy.value+=' Карта AUTO-903. Адрес: ул. Примерная, дом 14.';
     saveState();
   });
   await settings(page);await page.locator('#direct-auto').check();
   await click(page,'[data-action=section][data-id=overview]');
   await click(page,'.overview-visits [data-id=a1]');await a('analyze');
   await dialog.getByText('Ответ тестового провайдера.',{exact:true}).waitFor();
   assert.equal(sent.length,4);assert.doesNotMatch(sent.at(-1),/AUTO-903|Примерная/);
   assert.match(sent.at(-1),/номер скрыт/);assert.match(sent.at(-1),/адрес скрыт/);
   assert.equal(await page.evaluate(()=>current().reviews.at(-1).prompt),sent.at(-1));
   assert.match(await page.evaluate(()=>field('allergy')),/AUTO-903/);
   await a('close');
   assert(!await page.evaluate(()=>JSON.stringify(localStorage).includes('synthetic-session-only')));
   phase='encrypted archive';
   await page.evaluate(()=>{
     prototypeState.tags.push({id:'qa-marker',name:'Тестовый тег',keywords:[]});
     current().tagEdits.push({id:'visit:a1',values:{'qa-marker':true}});
     current().prevention.push({id:'qa-plan',kind:'lab',title:'Плановое исследование',next:'2027-01-01',period:'По плану',note:'',
       history:[{id:'qa-result',date:'2026-01-01',note:'',source:'lab:cbc'}]});
     if(!saveState())throw Error('Не удалось сохранить тестовые записи.');
   });
   await settings(page);await click(page,'main [data-action=providers]');assert.match(await dialog.innerText(),/Последний бесплатный запрос выполнен/);await a('close');
   await settings(page);await click(page,'main [data-action=archive]');await a('exportBackup');const key=await n('key').inputValue();
   await dialog.locator('[type=checkbox]').check();await dialog.getByText('Подготовить файл').click();
   const download=page.waitForEvent('download');await dialog.getByText('Скачать зашифрованный файл').click();await (await download).saveAs(archive);
   const bytes=await fs.readFile(archive);assert.equal(bytes.subarray(0,4).toString(),'HS01');assert(!bytes.includes(Buffer.from('Черновик для восстановления')));
   await a('back');await a('exportBackup');await n('key').fill(key);await dialog.locator('[type=checkbox]').check();
   await dialog.getByText('Подготовить файл').click();const nextDownload=page.waitForEvent('download');
   await dialog.getByText('Скачать зашифрованный файл').click();await (await nextDownload).saveAs(archive);
   const nextBytes=await fs.readFile(archive);assert(!bytes.subarray(4,16).equals(nextBytes.subarray(4,16)));
   phase='restore on empty device';
   const fresh=await browser.newContext(options),p=await fresh.newPage(),older=await fresh.newPage();p.setDefaultTimeout(7500);
   await older.goto(base+'?new=visit&mode=photo');await click(older,'dialog [data-action=sampleVisit]');await older.locator('#visit-form').waitFor();
   const oldDocument=await older.evaluate(()=>current().visitDrafts[0].id);
   await p.goto(base+'?section=settings');await click(p,'main [data-action=archive]');await click(p,'dialog [data-action=importBackup]');
   const f=p.locator('#backup-import');await f.locator('[name=archive]').setInputFiles(archive);await f.locator('[name=key]').fill(key.split('').reverse().join(''));
   diagnosticPage=p;phase='backup check with wrong key';
   const stateBefore=await p.evaluate(()=>localStorage.getItem(stateKey));
   const blobKeys=()=>p.evaluate(async()=>{const db=await storageDB();try{
     return await new Promise((resolve,reject)=>{const req=db.transaction('documents').objectStore('documents').getAllKeys();req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)});
   }finally{db.close()}});
   const keysBefore=await blobKeys();
   await f.getByRole('button',{name:'Проверить копию'}).click();await f.getByText(/Проверка не пройдена/).waitFor();
   assert.equal(await f.locator('[name=replace]').isVisible(),false);
   await f.locator('[name=key]').fill(key);
   phase='backup check with damaged file';
   const broken=Buffer.from(nextBytes);broken[broken.length-1]^=1;
   await f.locator('[name=archive]').setInputFiles({name:'damaged.health',mimeType:'application/octet-stream',buffer:broken});
   await f.locator('button').click();await f.getByText(/Проверка не пройдена/).waitFor();
   phase='backup check without applying';
   await f.locator('[name=archive]').setInputFiles(archive);
   await f.locator('button').click();await f.getByText(/Копия проверена.*Профилей: 2/).waitFor();
   assert.equal(await p.evaluate(()=>localStorage.getItem(stateKey)),stateBefore);assert.deepEqual(await blobKeys(),keysBefore);
   const restore=f.getByRole('button',{name:'Восстановить',exact:true});await restore.click();
   assert.equal(await p.evaluate(()=>current().visitDrafts[0].id),oldDocument);
   await f.locator('[type=checkbox]').check();await Promise.all([p.waitForEvent('load'),restore.click()]);
   await p.locator('main h1').waitFor({state:'attached'});
   assert.equal(await p.evaluate(()=>current().prevention.find(r=>r.id==='qa-plan').history[0].source),'lab:cbc');
   const queued=await p.evaluate(async()=>{
     const group=draftGroup(current().visitDrafts.find(d=>d.name==='лист.txt'));
     return Promise.all(group.map(async d=>[d.state,await (await fileBlob(person.id+'/'+d.id)).text()]));
   });
   assert.deepEqual(queued,[['queued','Страница 1'],['queued','Страница 2']]);
   assert.match(await p.evaluate(()=>tagLabels('visit','a1')),/Тестовый тег/);
   assert.equal(await older.evaluate(()=>saveState()),false);
   await click(older,'dialog [data-action=close]');await older.locator('#refresh-notice').waitFor();
   assert.equal(await p.evaluate(id=>fileBlob('anna/'+id),oldDocument),undefined);
   await click(p,'[data-action=section][data-id=overview]');await click(p,'.review-queue [data-action=resumeVisit]');assert.equal(await p.locator('#visit-form [name=title]').inputValue(),'Черновик для восстановления');
   await p.locator('.source-preview canvas').waitFor({state:'attached'});await click(p,'dialog [data-action=close]');
   await p.goto(base+'?visit=a1');await click(p,'dialog [data-action=file][data-id=rx]');await p.locator('#file-paper canvas').waitFor({state:'attached'});
   assert.deepEqual(errors,[]);console.log('PASS',mobile?'iPhone WebKit':'desktop Chrome','persistent draft, PKCE exchange, bounded model, quota/retry, exact request, treatment, encrypted backup and restore of originals');
 }catch(e){console.error(phase,e.message,await diagnosticPage.locator('dialog').innerText().catch(()=>''));process.exitCode=1}
 finally{await browser.close();await fs.rm(tmp,{recursive:true,force:true})}
})();
