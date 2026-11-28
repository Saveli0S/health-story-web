// Run with serve_preview.py on HEALTH_PREVIEW_URL and playwright-core installed.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium, webkit, devices } = require('playwright-core');
const oracle = require('./expected.json');
const mobile = process.argv.includes('--iphone');
const base = new URL(process.env.HEALTH_PREVIEW_URL || 'http://127.0.0.1:8764/');
const report = {browser: mobile ? 'iPhone 13 WebKit emulation' : 'Chrome desktop', documents: [], trends: [], externalRequests: [], errors: []};
const browserName = mobile ? 'webkit' : 'chrome';
const rowKeys = {name:'marker', value:'reading', unit:'unit', range:'range',specimen:'specimen'};
const ids = new Map();

async function checkCholesterolHistory(page){
  const dates=['2022-04-20','2023-05-17','2024-02-07'];
  const rows=['Холестерин общий 4,6 ммоль/л','Total Cholesterol 200 mg/dL','ОХС 5,4 ммоль/л'];
  const names=dates.map(date=>'Учебная липидограмма '+date+'.txt');
  await page.goto(new URL('?section=labs',base).href);
  const dialog=page.locator('dialog'),form=dialog.locator('#lab-form');
  await page.locator('main [data-action="upload"]').click();
  await dialog.locator('[name="file"]').setInputFiles(dates.map((date,i)=>({name:names[i],mimeType:'text/plain',
    buffer:Buffer.from(`Биохимический анализ\nДата взятия: ${date}\nМатериал: Сыворотка\n${rows[i]}`)})));
  await dialog.locator('#upload-form button.primary').click();
  await form.waitFor();
  await page.waitForFunction(names=>names.every(name=>current().files.some(file=>file.name===name&&file.labDraft?.rows.length===1)),names);
  for (let i=0;i<dates.length;i++){
    if(i){
      await page.goto(new URL('?section=labs',base).href);
      await page.locator('main [data-action="verifyLab"]').filter({hasText:names[i]}).click();
    }
    assert.equal(await form.locator('[name="date"]').inputValue(),dates[i]);
    await form.locator('[name="verified"]').check();
    await form.getByRole('button',{name:'Сохранить результаты'}).click();
    await dialog.getByRole('button',{name:'Исходный бланк'}).waitFor();
  }
  await page.goto(new URL('?section=labs',base).href);
  await page.locator('#section-filter').fill('холлестирин');
  await page.locator('main [data-action="trend"]').filter({hasText:'Холестерин общий'}).click();
  const points=dialog.locator('.trend-chart g');
  const labels=await points.evaluateAll(nodes=>nodes.map(node=>node.getAttribute('aria-label').split(' · ').slice(0,2)));
  assert.deepEqual(labels,dates.map((date,i)=>[date,['4,6','5.172','5,4'][i]+' ммоль/л']));
  assert.deepEqual(await dialog.locator('.trend-chart .point-value:visible').allTextContents(),['4,6','5,172','5,4']);
  assert.deepEqual(await dialog.locator('.trend-chart .point-date:visible').allTextContents(),['20.04.2022','17.05.2023','07.02.2024']);
  const leaders=await dialog.locator('.trend-chart .point-leader').evaluateAll(paths=>paths.map(path=>path.getTotalLength()));
  assert.equal(leaders.length,dates.length);
  assert.ok(leaders.every(length=>length<=40),'Captions for spaced points should be close to their marks');
  assert.deepEqual(await dialog.locator('button[data-action="file"] strong').allTextContents(),[
    '20 апреля 2022 г. · 4,6 ммоль/л','17 мая 2023 г. · 200 mg/dL','7 февраля 2024 г. · 5,4 ммоль/л'
  ]);
  await points.nth(1).click();
  assert.equal(await dialog.locator('#panel-title').innerText(),names[1]);
  await page.goto(new URL('?section=overview',base).href);
  await page.locator('main [data-action="search"]').click();
  await dialog.locator('#global-search').fill('total cholesterol');
  await dialog.locator('[data-action="trend"]').filter({hasText:'Холестерин общий'}).click();
  assert.equal(await dialog.locator('#panel-title').innerText(),'Холестерин общий');
  assert.equal(await dialog.locator('.trend-chart g').count(),3);
  return {dates,values:labels.map(([,value])=>value),searchedBy:['холлестирин','total cholesterol']};
}

async function checkExistingIndicatorHistory(page){
  const rows=[
    ['hdl-a','2022-01-11','ЛПВП-холестерин (HDL)','1,2','ммоль/л',''],
    ['hdl-b','2023-02-12','HDL-C','54','mg/dL',''],
    ['hdl-c','2024-03-13','Холестерин ЛПВП','1,4','ммоль/л','Сыворотка'],
    ['ldl-a','2022-01-11','ЛПНП-холестерин (LDL)','2,1','ммоль/л',''],
    ['ldl-b','2023-02-12','LDL-C','96','mg/dL',''],
    ['marker-a','2022-01-11','Учебный показатель X','7','ед.',''],
    ['marker-b','2023-02-12','учебный показатель x','8','ед.','']
  ];
  await page.evaluate(rows=>{
    const files=rows.map(([id,date,name,value,unit,specimen])=>({id,name:id+'.txt',type:'text/plain',category:'Лаборатория',date,
      lab:{name:'Учебный бланк',...(id==='hdl-a'?{date:'',documentDate:date}:{date}),rows:[{name,value,unit,specimen}]}}));
    current().files.push(...files);
    if(!saveState())throw Error('Could not seed previous lab data');
  },rows);
  const dialog=page.locator('dialog');
  for(const [title,query,seriesSizes] of [['Холестерин ЛПВП','HDL',[1,2]],['Холестерин ЛПНП','LDL',[2]],['Учебный показатель X','показатель x',[2]]]){
    await page.goto(new URL('?section=labs',base).href);
    await page.locator('#section-filter').fill(query);
    const card=page.locator('main [data-action="trend"]').filter({hasText:title});
    assert.equal(await card.count(),1);
    assert.match(await card.innerText(),new RegExp('результатов: '+seriesSizes.reduce((a,b)=>a+b,0)));
    await card.click();
    const charts=await dialog.locator('.trend-chart').evaluateAll(nodes=>nodes.map(chart=>chart.querySelectorAll('g[data-id]').length));
    assert.deepEqual(charts.sort((a,b)=>a-b),seriesSizes);
    assert.equal(await dialog.locator('button[data-action="file"]').count(),seriesSizes.reduce((a,b)=>a+b,0));
    if(query==='HDL'){
      const fallback=dialog.locator('.trend-chart [data-id="hdl-a"]');
      assert.match(await fallback.getAttribute('aria-label'),/^2022-01-11 · 1,2 ммоль\/л · Дата по бланку/);
      assert.match(await dialog.locator('button[data-action="file"][data-id="hdl-a"]').innerText(),/Дата по бланку/);
    }
  }
  return true;
}

(async () => {
  const browser = mobile ? await webkit.launch() : await chromium.launch({channel:'chrome'});
  try {
    const context = await browser.newContext({serviceWorkers:'block',locale:'ru',...(mobile?devices['iPhone 13']:{viewport:{width:1300,height:950}})});
    await context.route(/^https?:/, route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin === base.origin) return route.continue();
      if (url.href === 'https://health-story-chatgpt.xzx89s.workers.dev/chatgpt/status' && request.method() === 'GET' && !request.headers().authorization)
        return route.fulfill({json:{available:false,connected:false,planOnly:false}});
      report.externalRequests.push(url.origin);
      return route.abort();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.on('pageerror', e=>report.errors.push(e.message));
    const dialog = page.locator('dialog');
    const action = k=>dialog.locator('[data-action="'+k+'"]').first().click();
    const form = dialog.locator('#lab-form');
    const rows = form.locator('.lab-input');
    for (const lab of oracle.reports) {
      await page.goto(new URL('?section=labs',base).href);
      await page.locator('main [data-action="upload"]').first().click();
      await dialog.locator('[name="file"]').setInputFiles(path.join(__dirname,lab.file));
      await dialog.locator('#upload-form button.primary').click();
      await form.waitFor({timeout:120000});
      const actual = await form.evaluate(f => ({
        name: f.elements.title.value, date: f.elements.date.value, laboratory: f.elements.laboratory.value,
        raw: f.querySelector('details pre').textContent,
        rows: [...f.querySelectorAll('.lab-input')].map(r=>Object.fromEntries(
          Object.entries({name:'marker',value:'reading',unit:'unit',range:'range',specimen:'specimen'}).map(([key,input])=>[key,r.querySelector('[name="'+input+'"]').value])))
      }));
      const fields = Object.fromEntries(['name','date','laboratory'].map(k => [k, actual[k] === lab[k]]));
      const match = lab.rows.map(r=>actual.rows.some(a=>Object.keys(rowKeys).every(k=>a[k]===r[k])));
      const result = {file:lab.file, fields, exactRows:match, expectedRowCount:lab.rows.length, actual};
      report.documents.push(result);
      console.error(browserName, 'extracted',lab.file, Object.values(fields), match);
      const id = await form.getAttribute('data-id');
      ids.set(id, lab.file);
      // Save exactly what the form recognised, without substituting values from the oracle.
      if(!Object.values(fields).every(Boolean)||!match.every(Boolean)||actual.rows.length!==lab.rows.length){
        continue;
      }
      await form.locator('[name="verified"]').check();
      await form.getByRole('button',{name:'Сохранить результаты'}).click();
      if (lab.rows.some(r=>r.clarify)) {
        const invalid=form.locator('[name="reading"][aria-invalid="true"]');
        await invalid.waitFor();
        result.blockedUnclear = await invalid.evaluate(input=>{
          const ids=(input.getAttribute('aria-describedby')||'').split(/\s+/);
          return ids.some(id=>document.getElementById(id)?.textContent.includes('Уточните'));
        });
        if (result.blockedUnclear) {
          await action('deferLab');
          await page.goto(new URL('?section=labs',base).href);
          await page.getByRole('heading',{name:'Требуют сверки'}).waitFor();
          await page.locator('main [data-action="verifyLab"][data-id="'+id+'"]').click();
          result.retainedDraft = (await form.locator('[name="reading"]').inputValue()) === '?';
        }
        continue;
      }
      await dialog.getByRole('button',{name:'Исходный бланк'}).waitFor();
      result.savedRows = await dialog.locator('.lab-value').evaluateAll(els=>els.map(r=>[...r.querySelectorAll('small,strong')].map(e=>e.textContent)));
      await action('file');
      const preview = dialog.locator('#file-paper canvas,img.paper-preview');
      await preview.first().waitFor({state:'attached'});
      result.originalPreview = (await preview.first().evaluate(e=>e.tagName));
    }
    // Use the visible Dynamics action of each medical record. Ignore seeded demo points by source ID only.
    for (const [id, file] of ids) {
      const lab = oracle.reports.find(r=>r.file===file);
      if (lab.rows.some(r=>r.clarify)||!report.documents.find(r=>r.file===file).savedRows) continue;
      for (const [index,row] of lab.rows.entries()) {
        await page.goto(new URL('?section=labs',base).href);
        await page.locator('main [data-action="lab"][data-id="'+id+'"]').click();
        await dialog.locator('.lab-value [data-action="trend"]').nth(index).click();
        const series = dialog.locator('.panel-section:has(button[data-action="file"][data-id="'+id+'"])');
        const links = await series.locator('.trend-chart g[data-id]').evaluateAll(els=>els.map(e=>({source:e.getAttribute('data-id'),label:e.getAttribute('aria-label')})));
        const points = links.filter(p=>ids.has(p.source)).map(p=>({source:ids.get(p.source),label:p.label}));
        const expected = oracle.reports.filter(l=>l.rows.some(r=>r.group===row.group&&r.canonicalValue!=null)).map(l=>l.file);
        const sourceSetMatches = JSON.stringify(expected)===JSON.stringify(points.map(p=>p.source));
        const numericPoints = points.map(p=>Number(p.label.split(' · ')[1].split(' ')[0].replace(',','.')));
        const target = oracle.expectedTrends[row.group];
        const valuesMatch = JSON.stringify(numericPoints) === JSON.stringify(target.points);
        const displayedUnit = await series.locator('.detail-meta').innerText();
        const canonicalUnitMatches = !target.unit || displayedUnit === target.unit;
        const listSources = await dialog.locator('button[data-action="file"]').evaluateAll(els=>els.map(e=>e.dataset.id));
        const listShowsSource = listSources.includes(id);
        if (process.argv.includes('--record') && file==='04-urine-scan.jpg' && index===0) {
          await dialog.screenshot({path:path.join(__dirname,'glucose-trend-'+browserName+'.png')});
        }
        const contextCheck=file==='04-urine-scan.jpg'&&index===0||file==='02-followup-en.pdf'&&index===0;
        let promptMatches=null;
        if(contextCheck){
          await series.locator('[data-action="consult"]').click();
          await dialog.locator('[name="question"]').fill('Сравни выбранный показатель');
          await dialog.getByRole('button',{name:'Проверить запрос'}).click();
          const prompt=await dialog.locator('[name="prompt"]').inputValue();
          const labs=JSON.parse(prompt.slice(prompt.indexOf('{'))).анализы;
          const selected=labs.filter(l=>oracle.reports.some(r=>r.date===l.дата));
          const correctSeries=selected.every(l=>l.результаты.length===1&&l.результаты[0].биоматериал===row.specimen);
          const canonical=selected.map(l=>Number(l.результаты[0].дляСравнения.результат.replace(',','.')));
          const sourceRaw=selected.every(l=>{
            const raw=oracle.reports.find(r=>r.date===l.дата).rows.find(r=>r.group===row.group);
            return raw&&l.результаты[0].результат===raw.value&&l.результаты[0].единица===raw.unit&&l.результаты[0].диапазон===raw.range;
          });
          promptMatches=correctSeries&&sourceRaw&&JSON.stringify(canonical)===JSON.stringify(target.points);
          await page.goto(new URL('?section=labs',base).href);
          await page.locator('main [data-action="lab"][data-id="'+id+'"]').click();
          await dialog.locator('.lab-value [data-action="trend"]').nth(index).click();
        }
        let opensOriginal = null;
        const point = dialog.locator('.trend-chart g[data-id="'+id+'"]');
        if (await point.count()) {
          await point.first().click();
          const preview=dialog.locator('#file-paper canvas,img.paper-preview');
          await preview.first().waitFor({state:'attached'});
          opensOriginal=(await dialog.locator('#panel-title').innerText())===file;
        }
        report.trends.push({from:file,name:row.name,group:row.group,sourceSetMatches,valuesMatch,displayedUnit,canonicalUnitMatches,listShowsSource,opensOriginal,promptMatches,points});
      }
    }
    report.cholesterolHistory=await checkCholesterolHistory(page);
    report.existingIndicatorHistory=await checkExistingIndicatorHistory(page);
  } finally {
    await browser.close();
    const out=JSON.stringify(report,null,2)+'\n';
    if(process.argv.includes('--record')) fs.writeFileSync(path.join(__dirname,'observed-'+browserName+'.json'),out);
    console.log(out);
  }
  if (report.documents.length !== oracle.reports.length ||
      report.documents.some(d=>!Object.values(d.fields).every(Boolean)||!d.exactRows.every(Boolean)||d.actual.rows.length!==d.expectedRowCount ||
        (d.blockedUnclear !== undefined && (!d.blockedUnclear || !d.retainedDraft)))) process.exitCode=1;
  if (
      report.trends.some(t=>!t.sourceSetMatches||!t.valuesMatch||!t.canonicalUnitMatches||!t.listShowsSource||t.opensOriginal===false||t.promptMatches===false)||report.errors.length||report.externalRequests.length) process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=2;});
