// Run against a local app server. Browser contexts and in-memory fixture records are disposable.
// --strict-ocr requires literal automated extraction of every source field, including handwriting.
const fs = require('node:fs');
const path = require('node:path');
const {chromium, webkit, devices} = require('playwright-core');
const cases = require('./expected.json').cases;
const mobile = process.argv.includes('--iphone');
const base = new URL(process.env.HEALTH_PREVIEW_URL || 'http://127.0.0.1:8764/');
const clean = v => (v || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru');
const same = (a, b) => clean(a) === clean(b);
async function check(context, spec) {
  const page = await context.newPage();
  await page.goto(new URL('?new=visit&mode=photo', base).href);
  await page.locator('#visit-processing').selectOption('local');
  await page.locator('#visit-source').setInputFiles(spec.files.map(f => path.join(__dirname, f)));
  const form = page.locator('#visit-form');
  await form.waitFor({timeout: 100000});
  const read = n => form.locator('[name="'+n+'"]').inputValue();
  const result = {id:spec.id, header:{}, mismatches:[], manualCorrections:[]};
  for (const [name, expected] of Object.entries(spec.header)) {
    const value = await read(name);
    result.header[name] = value;
    if (!same(value, expected)) result.mismatches.push({field:name, expected, actual:value});
  }
  const clinicInput = form.locator('[name=clinic]');
  const clinic = await clinicInput.count() ? await clinicInput.inputValue() : null;
  result.header.clinic=clinic;
  if (!same(clinic,spec.clinic)) result.mismatches.push({field:'clinic',expected:spec.clinic,actual:clinic});
  const kinds = await page.locator('[data-draft-kind]').evaluateAll(items => items.map(i=>i.value));
  if (kinds.join('|') !== spec.kinds.join('|')) result.mismatches.push({field:'kinds', expected:spec.kinds, actual:kinds});
  if (mobile) await page.locator('[data-pane=paper]').first().click();
  const preview = page.locator('.source-preview').first();
  await preview.locator('canvas,img').first().waitFor({state:'visible'});
  if (spec.id === 'V02') {
    const pages = preview.getByLabel('Страница оригинала');
    const num = await pages.locator('option').count();
    if(num!==2) throw Error('Двухстраничный PDF открылся без второй страницы');
    await pages.selectOption('2');
    await preview.locator('canvas').waitFor({state:'visible'});
  }
  if (spec.files.length > 1) {
    await page.getByLabel('Документ для сверки').selectOption({label:spec.files[1]});
    await preview.locator('img').waitFor({state:'visible'});
  }
  if (mobile) await page.locator('button[data-pane=fields]').first().click();
  result.verifiedPreview = spec.files;
  result.headerPrompts = await form.locator('.clarifications').allTextContents();
  for (const [name, expected] of Object.entries(spec.header)) {
    const corrected = expected || (name==='title' ? 'Рукописный осмотр (введено вручную)' : '');
    if (corrected && !same(await read(name), corrected)) {
      await form.locator('[name="'+name+'"]').fill(corrected);
      result.manualCorrections.push(name);
    }
  }
  await form.getByRole('button',{name:'Создать визит и сверить назначения'}).click();
  const verify = page.locator('#verify-form');
  await verify.waitFor({timeout:30000});
  const rows = await verify.locator('.rx-inputs').evaluateAll(rows=>rows.map(row=>Object.fromEntries(
    [...row.querySelectorAll('input')].map(x=>[x.name==='drug'?'name':x.name,x.value]))));
  result.medicines = rows;
  result.verificationPrompts = await verify.locator('.clarifications').allTextContents();
  for (const [field,expected] of Object.entries(spec.medicine)) {
    const actual=rows[0]?.[field] || '';
    if (expected===null) {
      if (/\d/.test(actual)) result.mismatches.push({field:'medicine.'+field, expected:'не подставлять число',actual});
    } else if (!same(actual, expected)) result.mismatches.push({field:'medicine.'+field,expected,actual});
  }
  if(rows.length!==1) result.mismatches.push({field:'medicine count',expected:1,actual:rows.length});
  let recommendation = await verify.locator('[name=recommendation]').inputValue();
  if(spec.id==='V03') {
    if (!result.verificationPrompts.some(x=>/Есть ли|дозировк/i.test(x)))
      result.mismatches.push({field:'Призыв к сверке назначения',expected:'Проверить дозу или наличие назначений',actual:result.verificationPrompts});
    await verify.locator('[data-action=deferVerify]').click();
    await page.locator('dialog [data-action=visitHome]').waitFor();
    result.deferred = true;
    result.blockedAnalysis = await page.locator('dialog [data-action=intakeAnalyze]').isDisabled();
    if (!result.blockedAnalysis) throw Error('Неуточнённая рукопись открыла анализ');
    const separate=await context.browser().newContext({...mobile?devices['iPhone 13']:{viewport:{width:1450,height:940}},locale:'ru',serviceWorkers:'block'});
    try {
      await separate.route(/^https?:\/\//,route=>new URL(route.request().url()).origin===base.origin?route.continue():route.abort());
      result.transcription = await clarifyHandwriting(await separate.newPage(),spec);
    }finally{await separate.close()}
  } else if (spec.files.length > 1) {
    for(const [field,value] of Object.entries(spec.medicine)) {
      const el=verify.locator('[name="'+(field==='name'?'drug':field)+'"]').first();
      if (!same(await el.inputValue(),value)) {await el.fill(value);result.manualCorrections.push('medicine.'+field);}
    }
    await verify.locator('[name=verified]').check();
    if (!await verify.evaluate(f=>f.checkValidity())) throw Error('Форма не позволила подтвердить ясное печатное назначение');
    await verify.getByRole('button',{name:'Подтвердить сведения'}).click();
    await page.locator('dialog [data-action=verifyFile]').last().click();
    await verify.waitFor();
    recommendation=await verify.locator('[name=recommendation]').inputValue();
    await verify.locator('[name=verified]').check();
    await verify.getByRole('button',{name:'Подтвердить сведения'}).click();
    const home = page.locator('dialog [data-action=visitHome]');
    const id=await home.getAttribute('data-id');
    await page.goto(new URL('?visit='+encodeURIComponent(id),base).href);
    const visit=page.locator('dialog');
    await visit.getByText(spec.recommendation,{exact:false}).first().waitFor();
    for(const name of spec.files) await visit.getByRole('button',{name:new RegExp(name)}).first().waitFor();
    result.reopenedWithBothOriginalsAndRecommendations=true;
    await visit.getByText('Клиника · '+spec.clinic,{exact:false}).waitFor();
    await visit.locator('[data-action=editVisitClinic]').click();
    const changed=spec.clinic+' · филиал 2';
    await visit.locator('[name=clinic]').fill(changed);
    await visit.getByRole('button',{name:'Сохранить',exact:true}).click();
    await page.reload();
    await visit.getByText('Клиника · '+changed,{exact:false}).waitFor();
    result.clinicEditPersisted=true;
  }
  result.recommendation = recommendation;
  if (!same(recommendation, spec.recommendation)) result.mismatches.push({field:'recommendation',expected:spec.recommendation,actual:recommendation});
  await page.close();
  return result;
}
async function clarifyHandwriting(page,spec){
  await page.goto(new URL('?new=visit&mode=photo',base).href);
  await page.locator('#visit-processing').selectOption('local');
  await page.locator('#visit-source').setInputFiles(path.join(__dirname,spec.files[0]));
  const form=page.locator('#visit-form');
  await form.waitFor({timeout:100000});
  // Simulated human transcription of only what is visible. The illegible dose stays unknown.
  const transcription=[spec.clinic,'21.04.2026','Врач: Лаврова М. П.','Жалобы: сухость кожи.',
    'Диагноз: сухость кожи.','Лечение: Дермотест, ? мг.','Рекомендации: повторный осмотр.'].join('\n');
  await page.locator('.document-transcript > summary').click();
  await page.locator('#visit-transcript').fill(transcription);
  await page.locator('[data-action=applyVisitTranscript]').click();
  for(const k of ['date','doctorName','episodeName','note']){
    if (!same(await form.locator('[name="'+k+'"]').inputValue(),spec.header[k]))throw Error('Сверенный текст: '+k);
  }
  if(!same(await form.locator('[name=clinic]').inputValue(),spec.clinic))throw Error('Сверенный текст: клиника');
  await form.locator('[name=title]').fill('Рукописный осмотр (введено вручную)');
  await form.getByRole('button',{name:'Создать визит и сверить назначения'}).click();
  const verify=page.locator('#verify-form');
  const name=verify.locator('[name=drug]'),strength=verify.locator('[name=strength]');
  if(await name.inputValue()!==spec.medicine.name||/\d/.test(await strength.inputValue()))throw Error('Название/доза после транскрипции');
  if(!same(await verify.locator('[name=recommendation]').inputValue(),spec.recommendation))throw Error('Рекомендации после транскрипции');
  // Information subsequently clarified in this test, never inferred from the original.
  await verify.locator('[name=instructions]').fill('Схема уточнена у автора учебного документа');
  await verify.locator('[name=verified]').check();
  await verify.getByRole('button',{name:'Подтвердить сведения'}).click();
  if(!await verify.isVisible())throw Error('Неясная дозировка ошибочно подтверждена');
  await verify.locator('[data-action=deferVerify]').click();
  const analysis=page.locator('[data-action=intakeAnalyze]');
  if(!await analysis.isDisabled())throw Error('Доступен разбор до уточнения');
  await page.locator('dialog [data-action=verifyFile]').click();
  await strength.fill('3 мг');
  await verify.locator('[name=instructions]').fill('.');
  await verify.locator('[name=verified]').check();
  await verify.getByRole('button',{name:'Подтвердить сведения'}).click();
  if(!await verify.isVisible())throw Error('Пустая пунктуация принята за схему');
  await verify.locator('[name=instructions]').fill('Схема уточнена у автора учебного документа');
  await verify.getByRole('button',{name:'Подтвердить сведения'}).click();
  if(!await analysis.isEnabled())throw Error('Анализ недоступен после сверки');
  return {nameAndHeaderFromHumanTranscript:true,unknownDoseBlocked:true,punctuationOnlyRegimenBlocked:true,reviewEnabledAfterExplicitClarification:true};
}
(async()=>{
  const browser = mobile ? await webkit.launch() : await chromium.launch({channel:'chrome'});
  const outcomes=[];
  try {
    for(const spec of cases) {
      const remote=[], errors=[];
      const context=await browser.newContext({...mobile?devices['iPhone 13']:{viewport:{width:1450,height:940}},locale:'ru',serviceWorkers:'block'});
      context.on('page', page=>page.on('pageerror',e=>errors.push(e.message)));
      await context.route(/^https?:\/\//,route=>{
        const request=route.request(), url=new URL(request.url());
        if(url.origin===base.origin) return route.continue();
        if(url.href==='https://health-story-chatgpt.xzx89s.workers.dev/chatgpt/status' && request.method()==='GET' && !request.headers().authorization)
          return route.fulfill({json:{available:false,connected:false,planOnly:false}});
        remote.push(request.url()); return route.abort();
      });
      try {outcomes.push({...await check(context,spec),errors,remote});}
      catch(e) {outcomes.push({id:spec.id,error:e.message,errors,remote});}
      finally {await context.close();}
    }
  } finally {await browser.close();}
  const strict=process.argv.includes('--strict-ocr');
  for(const result of outcomes){
    const unsafe=result.error||result.errors.length||result.remote.length;
    const omissions=result.mismatches?.every(m=>m.actual===''||(m.field==='medicine count'&&m.actual===0));
    const human=result.transcription;
    const clarified=result.id==='V03'&&omissions&&result.deferred&&result.blockedAnalysis&&
      human?.unknownDoseBlocked&&human?.punctuationOnlyRegimenBlocked&&human?.reviewEnabledAfterExplicitClarification;
    result.exactExtraction=!unsafe&&result.mismatches.length===0;
    result.workflowPassed=Boolean(!unsafe&&(result.exactExtraction||clarified));
  }
  console.log(JSON.stringify({engine:mobile?'iPhone WebKit emulation':'Chrome desktop',mode:strict?'strict-ocr':'workflow',outcomes},null,2));
  if(outcomes.some(o=>strict?!o.exactExtraction:!o.workflowPassed))process.exitCode=1;
})().catch(err=>{console.error(err); process.exitCode=2;});
