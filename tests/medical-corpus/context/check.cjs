// Run against a local preview. Each check operates in an ephemeral, isolated demo browser.
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium, webkit, devices } = require('playwright-core');
const dataset = require('./дневник-наблюдений.json');
const mobile = process.argv.includes('--iphone');
const platform = mobile ? 'webkit' : 'chrome';
const base = process.env.HEALTH_PREVIEW_URL || 'http://127.0.0.1:8764/';
const results = [];
function check(id, ok, observed) {
  results.push({id, status: ok ? 'PASS' : 'FAIL', observed});
}

async function run() {
  const browser = mobile ? await webkit.launch() : await chromium.launch({channel:'chrome'});
  const context = await browser.newContext({...mobile ? devices['iPhone 13'] : {}, serviceWorkers:'block'});
  const external = [];
  const errors = [];
  await context.route(/^https?:/, route => {
    if (new URL(route.request().url()).origin === new URL(base).origin) return route.continue();
    external.push(new URL(route.request().url()).origin);
    return route.abort();
  });
  const p = await context.newPage();
  p.setDefaultTimeout(10000);
  p.on('pageerror', e => errors.push(e.message));
  const dialog = p.locator('dialog[open]');
  const form = name => dialog.locator('#' + name);
  const input = name => dialog.locator('[name="' + name + '"]').first();
  const action = (name, root = dialog) => root.locator('[data-action="' + name + '"]').first().click();
  const submit = label => dialog.getByRole('button', {name:label,exact:true}).click();
  const go = async route => { await p.goto(base + route); await p.locator('main h1').waitFor(); };
  try {
    await go('?new=visit&mode=photo');
    await dialog.locator('#visit-source').setInputFiles({name:'пустой.txt',mimeType:'text/plain',buffer:Buffer.alloc(0)});
    const message = await dialog.locator('.file-picker + .field-issue').innerText();
    check('empty-upload', message.includes('непустые'), message);
    await dialog.locator('#visit-processing').selectOption('local');
    await dialog.locator('#visit-source').setInputFiles(path.join(__dirname,'история-лечения.txt'));
    await form('visit-form').waitFor();
    const header = await Promise.all(['date','title','doctorName','specialty','episodeName','note'].map(k=>input(k).inputValue()));
    check('visit-header', header[0]==='2026-09-13' && header[1]==='Повторный контроль' &&
      header[2]==='Условный Лист' && header[3]==='Терапевт' && header[4]==='Наблюдение в динамике' && header[5].includes('утомляемость'), header);
    await submit('Создать визит и сверить назначения');
    await form('verify-form').waitFor();
    const drugs = await dialog.locator('[name=drug]').evaluateAll(fields=>fields.map(f=>f.value));
    check('only-current-prescription', drugs.length===1 && drugs[0]==='Листин', drugs);
    check('recommendation', (await input('recommendation').inputValue()).includes('Принести дневник'), await input('recommendation').inputValue());

    // Reconcile the two historical medicines before downstream actions.
    const rows = form('verify-form').locator('.rx-inputs');
    for(let index=await rows.count()-1; index>=0; index--){
      const row=rows.nth(index);
      if(await row.locator('[name=drug]').inputValue()!=='Листин') await action('dropMed',row);
    }
    await input('instructions').fill('По 1 таблетке по ранее согласованной схеме.');
    await input('verified').check();
    await submit('Подтвердить сведения');
    await action('visitHome');
    const visit = await dialog.locator('[data-action=analyze]').getAttribute('data-id');
    const pharmacyCalls = [];
    await context.route('**/pharmacy/search',async route=>{
      const body=route.request().postDataJSON();
      pharmacyCalls.push(body);
      const packages=body.region==='0'?[{name:'Листин',id:'70001',form:'таблетки пероральные обычного высвобождения 5 мг N10',substance:'Листин',manufacturer:'QA',min:3.25,max:4.75,pharmacyCount:2}]:[];
      await route.fulfill({json:{region:body.region,checked:new Date().toISOString(),packages}});
    });
    await action('analogs');
    const citySearch = await dialog.getByRole('link',{name:/Искать на tabletka.by/}).getAttribute('href');
    const parsedSearch = new URL(citySearch);
    check('pharmacy-search-link',parsedSearch.hostname==='tabletka.by' && parsedSearch.searchParams.get('request').includes('Листин 5 мг'),citySearch);
    await dialog.getByText('Уточнить данные для поиска',{exact:true}).click();
    await input('substance').fill('Листин');await input('route').fill('Пероральный');
    await input('release').fill('Обычное');await input('pack').fill('№10');
    await submit('Сохранить данные поиска');
    await submit('Проверить текущие цены');
    await dialog.getByText('В выбранном регионе подтверждённых предложений нет.').waitFor();
    await submit('Искать по всей Беларуси');
    await dialog.getByText('3.25 – 4.75 BYN',{exact:false}).first().waitFor();
    const expectedCalls = [{name:'Листин',region:'1001'},{name:'Листин',region:'0'}];
    check('pharmacy-min-max-fallback',JSON.stringify(pharmacyCalls)===JSON.stringify(expectedCalls),{interceptedRequests:pharmacyCalls});
    await go('');
    const currentCourse=p.locator('.course-card').filter({hasText:'Листин'});
    await action('finish',currentCourse);
    await dialog.locator('.med-overrides summary').click();
    await input('u0').check();
    await submit('Завершить лечение');
    check('completed-removed-from-overview',await currentCourse.count()===0,{visible:await currentCourse.count()});
    await go('?visit='+visit);
    const history=await dialog.locator('#visit-meds').innerText();
    check('unknown-end-history',history.includes('дата неизвестна') && history.includes('Листин') && history.includes('5 мг') && !history.includes('Архивин'),history);

    for (const row of dataset.measurements) {
      await go('');
      await action('measure', p.locator('main'));
      for(const [key,value] of Object.entries(row)) await input(key).fill(value);
      await input('episode').selectOption('ep-a1');
      await submit('Сохранить измерение');
    }
    const points = await dialog.locator('.trend-chart g').count();
    check('home-chart', points===2, {points});
    await go('?visit=a1');
    await action('episode');
    const links = await dialog.locator('[data-action=measureChart]').filter({hasText:'Температура QA'}).count();
    check('episode-links-both-measurements', links===2, {links});

    await go('?section=labs&view=prevention');
    await action('editPrevent',p.locator('main'));
    await input('kind').selectOption(dataset.prevention.kind);
    for (const key of ['title','done','note']) await input(key).fill(dataset.prevention[key]);
    await input('source').selectOption('visit:a2');
    await input('next').fill('2025-04-15');
    await submit('Сохранить запись');
    const dateError = await dialog.locator('.error').innerText();
    check('invalid-prevention-date', dateError.includes('Проверьте даты'), dateError);
    await input('next').fill(dataset.prevention.next);
    await submit('Сохранить запись');
    const tag = await dialog.locator('.record-tag').innerText();
    const linked = await dialog.locator('[data-action=visit][data-id=a2]').count();
    check('vaccine-linked',tag==='Прививка' && linked===1,{tag,linked});
    await action('consult');
    await input('question').fill(dataset.consultation.question);
    await submit('Проверить запрос');
    const prompt = await input('prompt').inputValue();
    const survivors = dataset.consultation.identifiers.filter(word=>prompt.includes(word));
    check('only-selected-prevention',prompt.includes(dataset.prevention.note) && !prompt.includes('"визиты"') && !prompt.includes('"анализы"'), 'selected vaccine was present: '+prompt.includes(dataset.prevention.note));
    check('identifier-redaction',survivors.length===0,{visibleInPreview:survivors});
    await go('?new=visit&mode=photo');
    await dialog.locator('#visit-processing').selectOption('local');
    await dialog.locator('#visit-source').setInputFiles(path.join(__dirname,'смешанный-слой.pdf'));
    await form('visit-form').waitFor({timeout:90000});
    const hybrid = await Promise.all(['date','episodeName','note'].map(k=>input(k).inputValue()));
    check('hybrid-pdf-body',hybrid[0]==='2026-04-04' && hybrid[1]==='Синдром сухого глаза' && hybrid[2].includes('Сухость глаз'),hybrid);
    await go('?new=visit&mode=photo');
    await dialog.locator('#visit-processing').selectOption('local');
    await dialog.locator('#visit-source').setInputFiles({
      name:'обрыв.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>')
    });
    await form('visit-form').waitFor({timeout:45000});
    const corrupt = await Promise.all(['date','episodeName','doctorName','note'].map(k=>input(k).inputValue()));
    const warning = await dialog.locator('.clarifications').allTextContents();
    check('truncated-pdf-manual-recovery',corrupt.every(x=>!x)&&warning.length>0,{fields:corrupt,warning});
    await go('?section=labs');
    await action('upload',p.locator('main'));
    await input('visit').selectOption('a1');
    await input('file').setInputFiles({name:'CASE456_Фамилия.txt',mimeType:'text/plain',
      buffer:Buffer.from('Лаборатория Учебная\nДата взятия образца: 01.04.2026\nГлюкоза плазмы 5,1 ммоль/л')});
    await submit('Прикрепить к визиту');
    await form('lab-form').waitFor();
    const originalTitle=await input('title').inputValue();
    await input('verified').check();
    await submit('Сохранить результаты');
    await action('consult');
    await dialog.locator('.prompt-picker summary').click();
    await dialog.getByRole('button',{name:'Подготовка к приёму',exact:true}).click();
    await submit('Проверить запрос');
    const anonymousLab=await input('prompt').inputValue();
    check('original-filename-stays-local', originalTitle.includes('CASE456') && !anonymousLab.includes('CASE456') &&
      !anonymousLab.includes('Фамилия') && anonymousLab.includes('5,1') && anonymousLab.includes('Лабораторное исследование'),
      {originalTitle, neutralTitle:anonymousLab.includes('Лабораторное исследование'), containsReading:anonymousLab.includes('5,1')});
    check('local-preview-no-external-request',external.length===0,{blockedExternalOrigins:external});
    check('no-page-errors',errors.length===0,errors);
  } catch (e) {
    results.push({id:'runner',status:'ERROR',observed:e.message});
  } finally {
    await browser.close();
    await fs.writeFile(path.join(__dirname,'observed-'+platform+'.json'),JSON.stringify(results,null,2)+'\n');
  }
  console.table(results.map(({id,status})=>({id,status})));
  if(results.some(r=>r.status!=='PASS'))process.exitCode=1;
}
run().catch(e=>{console.error(e.message);process.exitCode=1});
