// Start serve_preview.py, then run with playwright-core installed. Pass --iphone for mobile WebKit.
const {chromium,webkit,devices}=require('playwright-core');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const mobile=process.argv.includes('--iphone'),base=process.env.HEALTH_PREVIEW_URL||'http://127.0.0.1:8764/';
const assets=path.join(__dirname,'../assets/documents');
const file=(name,mimeType,buffer)=>({name,mimeType,buffer});
const text=(name,body)=>file(name,'text/plain',Buffer.from(body));
(async()=>{
 const browser=mobile?await webkit.launch():await chromium.launch({channel:'chrome'});
 const context=await browser.newContext(mobile?{...devices['iPhone 13'],locale:'ru'}:{viewport:{width:1400,height:930}});
 const page=await context.newPage(),errors=[],remote=[];
 page.on('pageerror',e=>errors.push(e.message));
 await context.route(/^https?:\/\//,route=>{
   if(new URL(route.request().url()).origin!==new URL(base).origin){remote.push(route.request().url());return route.abort()}
   return route.continue();
 });
 const dialog=page.locator('dialog'),form=name=>dialog.locator('#'+name);
 const action=(name,host=dialog)=>host.locator('[data-action="'+name+'"]').first().click();
 const field=name=>dialog.locator('[name="'+name+'"]').first();
 const go=query=>page.goto(base+query);
 const wait=async(selector)=>dialog.locator(selector).first().waitFor({state:'attached',timeout:90000});
 const submit=async label=>dialog.getByRole('button',{name:label,exact:true}).click();
 let stage='Пример оценки риска';
 try{
   await go('?new=consultation&example=risk');
   assert.equal(await field('template').inputValue(),'risk-factors');
   await field('sourceTag').selectOption('therapist');await dialog.locator('[value="visit:a2"]').check();
   await field('sourceTag').selectOption('blood');await dialog.locator('[value="lab:chem"]').check();
   await submit('Проверить запрос');const prompt=await field('prompt').inputValue();
   assert.match(prompt,/диабета/);assert.match(prompt,/4.8/);assert.match(prompt,/Терапевт/);assert.doesNotMatch(prompt,/Гемоглобин|Белова|Волкова/);
   await go('?section=labs&view=prevention');
   for(const [tag,title] of [['Прививка','Прививка от гриппа'],['Флюорография','Флюорография органов грудной клетки'],['Анализ крови','Общий анализ крови']]){
     await page.locator('#section-filter').fill('#'+tag);assert.equal(await page.locator('#listing [data-action=prevent]').count(),1);
     await page.locator('#listing [data-action=prevent]').click();assert.equal(await dialog.locator('#panel-title').innerText(),title);await action('close');
   }
   stage='Очередь и распознавание';
   await go('?new=visit&mode=photo');assert.equal(await dialog.locator('#visit-processing').inputValue(),'queue');
   const visit=text('Осмотр.txt','Дата визита: 14.10.2026\nВизит: Контрольный осмотр\nВрач: Врач Примера\nДиагноз: Контроль\nПрепарат ? мг\nПо назначению\nРекомендации врача:\nПринести дневник на повторный визит.');
   const lab=file('Анализ крови.pdf','application/pdf',fs.readFileSync(path.join(assets,'cbc.pdf')));
   const rec=text('Рекомендации.txt','Рекомендовано: Принести результаты исследования.');
   await dialog.locator('#visit-source').setInputFiles([visit,lab,rec]);
   await dialog.getByRole('heading',{name:'Визит в очереди'}).waitFor();await go('');
   await action('resumeVisit',page.locator('main'));await action('readDraft');await wait('#visit-form');
   assert.equal(await field('title').inputValue(),'Контрольный осмотр');
   assert.deepEqual(await dialog.locator('[data-draft-kind]').evaluateAll(e=>e.map(x=>x.value)),['Назначения','Лаборатория','Рекомендации']);
   if(mobile)await dialog.locator('.source-tabs [data-pane=paper]').click();
   await dialog.getByLabel('Документ для сверки').selectOption({label:'Анализ крови.pdf'});await wait('.source-preview canvas');
   if(mobile)await dialog.locator('.source-tabs [data-pane=fields]').click();
   await submit('Создать визит и сверить назначения');await wait('#verify-form');
   assert.match(await dialog.locator('.clarifications').innerText(),/Какая дозировка/);
   await field('strength').fill('1 мг');assert.match(await field('recommendation').inputValue(),/Принести дневник/);
   await field('verified').check();await submit('Подтвердить сведения');
   await dialog.locator('[data-action=verifyFile]').last().click();await wait('#verify-form');
   assert.match(await field('recommendation').inputValue(),/Принести результаты/);await field('verified').check();await submit('Подтвердить сведения');
   await action('verifyLab');await field('verified').check();await submit('Сохранить результаты');
   await action('visit');assert.match(await dialog.innerText(),/Принести результаты исследования/);
   await dialog.locator('#visit-meds').getByRole('button',{name:'Редактировать',exact:true}).click();
   await field('strength').fill('2 мг');await submit('Сохранить изменения');
   await dialog.locator('#visit-meds').getByText(/Препарат · 2 мг/).waitFor();
   const id=await dialog.locator('[data-action=analyze]').getAttribute('data-id');
   await action('analyze');await action('queueTreatment');await go('');assert.match(await page.locator('.review-queue').innerText(),/Разбор в очереди/);
   stage='Отдельное фото и предпросмотр';
   await go('?visit='+id);await dialog.getByRole('button',{name:'Загрузить рекомендации'}).click();
   const pic=file('Рекомендации врача.png','image/png',fs.readFileSync(path.join(assets,'prescription.png')));
   const scan=file('Страница 2.jpg','image/jpeg',fs.readFileSync(path.join(assets,'eye-note.jpg')));
   await field('file').setInputFiles([pic,scan,rec]);
   await page.waitForFunction(()=>document.querySelector('.upload-preview img')?.naturalWidth>0);
   await dialog.locator('[data-file-index="1"]').selectOption('Снимки');await dialog.locator('[data-file-index="2"]').selectOption('Другое');
   await dialog.getByLabel('Файл для предпросмотра').selectOption('2');assert.match(await dialog.locator('.upload-preview pre').innerText(),/Принести результаты/);
   await submit('Прикрепить к визиту');
   await dialog.locator('.intake-file').filter({hasText:'Рекомендации врача.png'}).getByRole('button',{name:'Сверить'}).click({timeout:90000});
   await wait('#verify-form');assert((await dialog.locator('.source-text').first().textContent()).length>25);
   await field('recommendation').fill('Взять оба листа на приём.');await field('verified').check();await submit('Подтвердить сведения');
   await action('visitHome');assert.match(await dialog.innerText(),/Взять оба листа/);
   await dialog.locator('#visit-files').getByRole('button',{name:/Рекомендации.txt/}).last().click();
   assert.match(await dialog.locator('#file-paper pre').innerText(),/Принести результаты/);
   const manualSource=text('Ручной комплект.txt','Отдельный оригинал для ручного ввода.');
   await go('?new=visit&mode=photo');await dialog.locator('#visit-source').setInputFiles([manualSource,pic]);
   await action('manualDraft');await wait('#visit-form');assert.equal(await field('title').inputValue(),'');
   await field('title').fill('Ручной визит');await field('date').fill('2026-10-14');await field('episodeName').fill('Эпизод');await field('doctor').selectOption('volkova');
   await submit('Создать визит и сверить назначения');await wait('#verify-form');assert.match(await dialog.innerText(),/Текст отсутствует/);
   await go('?role=child&section=labs&view=prevention');assert.doesNotMatch(await page.locator('main').innerText(),/Флюорография органов/);
   assert.deepEqual(errors,[]);assert.deepEqual(remote,[]);
   console.log('PASS',mobile?'iPhone WebKit':'Chrome desktop','risk prompt, demo tags, queued and manual visits, photo batch, all three previews, recommendations and dose clarification');
 }catch(e){console.error(stage,e.message,await dialog.innerText().catch(()=>''));process.exitCode=1}finally{await browser.close()}
})();
