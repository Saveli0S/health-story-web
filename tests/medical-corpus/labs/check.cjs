// Run with serve_preview.py on HEALTH_PREVIEW_URL and playwright-core installed.
const fs = require('node:fs');
const path = require('node:path');
const { chromium, webkit, devices } = require('playwright-core');
const oracle = require('./expected.json');
const mobile = process.argv.includes('--iphone');
const base = new URL(process.env.HEALTH_PREVIEW_URL || 'http://127.0.0.1:8764/');
const report = {browser: mobile ? 'iPhone 13 WebKit emulation' : 'Chrome desktop', documents: [], trends: [], externalRequests: [], errors: []};
const browserName = mobile ? 'webkit' : 'chrome';
const rowKeys = {name:'marker', value:'reading', unit:'unit', range:'range',specimen:'specimen'};
const ids = new Map();

(async () => {
  const browser = mobile ? await webkit.launch() : await chromium.launch({channel:'chrome'});
  try {
    const context = await browser.newContext(mobile ? {...devices['iPhone 13'],locale:'ru'} : {viewport:{width:1300,height:950},locale:'ru'});
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
        await form.locator('[name="reading"][aria-invalid="true"]').waitFor();
        result.blockedUnclear = await form.locator('[name="reading"][aria-invalid="true"]').evaluate(input=>{
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
        const links = await dialog.locator('.trend-chart g[data-id]').evaluateAll(els=>els.map(e=>({source:e.getAttribute('data-id'),label:e.getAttribute('aria-label')})));
        const points = links.filter(p=>ids.has(p.source)).map(p=>({source:ids.get(p.source),label:p.label}));
        const expected = oracle.reports.filter(l=>l.rows.some(r=>r.group===row.group&&r.canonicalValue!=null)).map(l=>l.file);
        const sourceSetMatches = JSON.stringify(expected)===JSON.stringify(points.map(p=>p.source));
        const numericPoints = points.map(p=>Number(p.label.split(' · ')[1].split(' ')[0].replace(',','.')));
        const target = oracle.expectedTrends[row.group];
        const valuesMatch = JSON.stringify(numericPoints) === JSON.stringify(target.points);
        const displayedUnit = await dialog.locator('.detail-meta').innerText();
        const canonicalUnitMatches = !target.unit || displayedUnit === target.unit;
        const listSources = await dialog.locator('button[data-action="file"]').evaluateAll(els=>els.map(e=>e.dataset.id));
        const listShowsSource = listSources.includes(id);
        if (process.argv.includes('--record') && file==='04-urine-scan.jpg' && index===0) {
          await dialog.screenshot({path:path.join(__dirname,'glucose-trend-'+browserName+'.png')});
        }
        const contextCheck=file==='04-urine-scan.jpg'&&index===0||file==='02-followup-en.pdf'&&index===0;
        let promptMatches=null;
        if(contextCheck){
          await action('consult');
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
