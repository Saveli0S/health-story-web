// Synthetic records. Run serve_preview.py and then this file with playwright-core.
const {chromium,webkit,devices}=require('playwright-core');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const base=process.env.HEALTH_PREVIEW_URL||'http://127.0.0.1:8764/';
const mobile=process.argv.includes('--iphone');
(async()=>{
  const browser=mobile?await webkit.launch():await chromium.launch({channel:'chrome'});
  const options={...(mobile?devices['iPhone 13']:{viewport:{width:1280,height:900}}),serviceWorkers:'block'};
  let p,phase='',errors=[];
  async function device(){
    const context=await browser.newContext(options),page=await context.newPage();
    page.setDefaultTimeout(8000);page.on('pageerror',e=>errors.push(e.message));return page;
  }
  const action=k=>p.locator('dialog [data-action="'+k+'"]').first().click();
  const field=k=>p.locator('dialog [name="'+k+'"]').first();
  const submit=label=>p.locator('dialog').getByRole('button',{name:label,exact:true}).click();
  async function restore(file,key,interrupt=false){
    await p.goto(base+'?section=settings');await p.locator('main [data-action=archive]').click();await action('importBackup');
    await field('archive').setInputFiles({name:'copy.health',mimeType:'application/octet-stream',buffer:file});
    await field('key').fill(key);await submit('Проверить копию');await p.getByText(/Копия проверена/).waitFor();
    await field('replace').check();
    if(interrupt){
      await p.evaluate(()=>{
        const original=fileBlob;let writes=0;
        fileBlob=async(...args)=>{
          if(args[1]&&++writes===2){fileBlob=original;throw new Error('Test storage full')}
          return original(...args);
        };
      });
      await submit('Восстановить');await p.getByText(/Не удалось восстановить/).waitFor();return;
    }
    await Promise.all([p.waitForEvent('load'),submit('Восстановить')]);
    await p.locator('main h1').waitFor({state:'attached'});
  }
  async function snapshot(page){
    await page.locator('main h1').waitFor({state:'attached'});
    return page.evaluate(async()=>{
      const data=readJson(stateKey),originals={};delete data.generation;
      for(const {owner,item} of archiveItems(data)){
        const blob=await fileBlob(owner+'/'+item.id);
        originals[owner+'/'+item.id]=toBase64(new Uint8Array(await blob.arrayBuffer()));delete item.blobId;
      }
      return {data,originals};
    });
  }
  try{
    phase='create and persist';p=await device();await p.goto(base);
    // Build an authentic previous-format backup and keep an existing custom demo field.
    await p.locator('main h1').waitFor();
    const legacy=await p.evaluate(async()=>{
      const data=readJson(stateKey);delete data.schemaVersion;delete data.family;
      data.profiles.anna.fields.push({id:'legacy',label:'Тестовое поле',value:'до миграции'});
      localStorage.setItem(stateKey,JSON.stringify(data));
      const files=[];
      for(const [owner,items] of Object.entries(sampleFiles))for(const item of items){
        const b=await (await fetch(item.file)).blob();files.push({id:owner+'/'+item.id,type:b.type,bytes:toBase64(new Uint8Array(await b.arrayBuffer()))});
      }
      const secret=crypto.getRandomValues(new Uint8Array(32)),iv=crypto.getRandomValues(new Uint8Array(12));
      const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv},await archiveKey(base64url(secret)),new TextEncoder().encode(JSON.stringify({version:1,data,files})));
      return {key:base64url(secret),content:toBase64(new Uint8Array(await new Blob(['HS01',iv,cipher]).arrayBuffer()))};
    });
    await p.reload();await p.locator('main h1').waitFor();assert(await p.evaluate(()=>field('legacy')==='до миграции'&&readJson(stateKey).schemaVersion===2));
    await p.locator('header [data-action=family]').click();await action('newFamily');
    await field('familyName').fill('Тестовая семья');await field('memberName').fill('Взрослый <А>');await field('birthday').fill('1990-02-02');
    await Promise.all([p.waitForEvent('load'),submit('Создать семейный архив')]);
    assert.equal(await p.locator('h1').textContent(),'Взрослый <А>');
    assert(await p.evaluate(()=>person.visits.length===0&&allFiles().length===0&&current().prevention.length===0&&field('birthday')==='1990-02-02'));
    await p.locator('header [data-action=family]').click();await action('newMember');
    await field('memberName').fill('Ребёнок Б');await field('role').selectOption('Ребёнок');await Promise.all([p.waitForEvent('load'),submit('Сохранить профиль')]);
    await p.locator('main h1').waitFor();
    const child=await p.evaluate(()=>person.id);await p.reload();assert.equal(await p.locator('h1').innerText(),'Ребёнок Б');
    assert.equal(await p.evaluate(()=>field('birthday')),'');
    phase='visits, recommendations, lab and queued original';
    for(const [i,title] of ['Первичный приём','Повторный визит'].entries()){
      await p.goto(base+'?profile='+child+'&new=visit');
      if(i===0){await field('episodeName').fill('Тестовый эпизод');await field('doctorName').fill('Врач примера')}
      else{await field('episode').selectOption({index:1});await field('doctor').selectOption({index:1})}
      await field('title').fill(title);await field('recommendation').fill('Указание '+i);
      if(i===1){await action('appendMed');await field('drug').fill('Тестовый препарат');await field('strength').fill('5 мг');await field('instructions').fill('По назначению')}
      await submit('Сохранить визит');
      if(!i)await p.getByRole('heading',{name:title,exact:true}).waitFor();
      else{await action('manual');await field('answer').fill('Тестовый ответ для проверки переноса');await submit('Сохранить версию разбора')}

    }
    const visit=await p.evaluate(()=>current().addedVisits[0][0]);
    await p.goto(base+'?profile='+child+'&section=labs');await p.locator('main [data-action=upload]').click();
    await field('visit').selectOption(visit);await field('file').setInputFiles(path.join(__dirname,'../assets/documents/cbc.pdf'));
    await p.locator('#upload-manifest canvas').waitFor({state:'visible'});await submit('Прикрепить к визиту');
    await field('verified').waitFor({timeout:60000});await field('verified').check();await submit('Сохранить результаты');
    const earlierVisit=await p.evaluate(()=>current().addedVisits[1][0]);
    await p.goto(base+'?profile='+child+'&visit='+earlierVisit);await action('visitLinksEditor');
    for(const title of ['Анализы','Лекарства','Документы'])
      await p.locator('dialog .pick-group').filter({has:p.locator('summary',{hasText:title})}).getByRole('checkbox').first().check();
    await submit('Сохранить связи');
    await p.goto(base+'?profile='+child+'&new=visit&mode=photo');await p.locator('#visit-source').setInputFiles({name:'черновик.txt',mimeType:'text/plain',buffer:Buffer.from('Тестовое назначение')});
    await p.getByRole('heading',{name:'Визит в очереди'}).waitFor();
    phase='v2 export and repeated restore';
    const expected=await snapshot(p);
    const clinical=expected.data.profiles[child];
    assert.equal(clinical.addedVisits.length,2);assert.equal(clinical.recommendations.length,2);assert.equal(clinical.reviews[0].visit,visit);
    assert.equal(clinical.files[0].visit,visit);assert.equal(clinical.addedVisits[0][8][0].strength,'5 мг');
    assert.deepEqual(clinical.visitLinks.map(r=>r.kind).sort(),['file','lab','med']);
    await p.goto(base+'?section=settings');await p.locator('main [data-action=archive]').click();
    const disclosure=p.locator('#family-recovery-key'),displayedKey=disclosure.locator('code');
    assert.equal(await displayedKey.textContent(),'');
    await disclosure.locator('summary').click();
    await p.waitForFunction(()=>document.querySelector('#family-recovery-key code')?.textContent.length===43);
    const recovery=await displayedKey.textContent();
    await disclosure.locator('summary').click();
    await p.waitForFunction(()=>document.querySelector('#family-recovery-key code')?.textContent==='');
    await action('exportBackup');
    const key=await field('key').inputValue();assert.equal(key,recovery);
    await p.locator('dialog [type=checkbox]').check();await submit('Подготовить файл');
    const download=p.waitForEvent('download');await p.getByText('Скачать зашифрованный файл').click();
    const binary=await fs.readFile(await (await download).path());
    p=await device();
    for(let i=0;i<2;i++){
      if(i===1){
        await restore(binary,key,true);assert.deepEqual(await snapshot(p),expected);
        const count=await p.evaluate(async()=>{
          const db=await storageDB();try{return await new Promise((resolve,reject)=>{
            const request=db.transaction('documents').objectStore('documents').count();request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
          })}finally{db.close()}
        });assert.equal(count,Object.keys(expected.originals).length);
      }
      await restore(binary,key);
      assert.deepEqual(await snapshot(p),expected);
      await p.goto(base+'?profile='+child+'&visit='+visit);await p.locator('dialog[open]').getByText('Указание 1',{exact:true}).waitFor();
      await p.goto(base+'?profile='+child+'&visit='+earlierVisit);await action('linkedVisitMedicine');
      await p.getByRole('heading',{name:'Тестовый препарат',exact:true}).waitFor();
    }
    phase='old-format import preserves working family';
    const demoFile=Buffer.from(legacy.content,'base64');await restore(demoFile,legacy.key);
    assert(await p.evaluate(()=>!workingFamily&&field('legacy')==='до миграции'));
    await p.goto(base);assert.deepEqual(await snapshot(p),expected);
    assert.deepEqual(errors,[]);console.log('PASS',mobile?'iPhone WebKit':'desktop Chrome','family creation, clean profiles, persistence, working archive restores twice, identical originals and archived visits, legacy import isolation');
  }catch(e){console.error(phase,e.message,await p?.locator('body').innerText().catch(()=>''));process.exitCode=1}
  finally{await browser.close()}
})();
