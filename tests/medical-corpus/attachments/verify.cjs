// Run in a new browser context against a local serve_preview.py instance.
const { chromium, webkit, devices } = require('playwright-core');
const assert = require('node:assert/strict');
const { readFile, mkdir } = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { files } = require('./expected.json');
const base = new URL(process.env.HEALTH_PREVIEW_URL || 'http://127.0.0.1:8764/');
const mobile = process.argv.includes('--iphone');
const cross = process.argv.includes('--to-iphone');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const name = item => path.basename(item.file);
const evidence = process.env.HEALTH_EVIDENCE_DIR;
const log = text => console.log('PASS', text);

async function verifyPreview(host, item) {
  if (item.preview === 'image') {
    const img = host.locator('img').last();
    await img.waitFor();
    assert.deepEqual(await img.evaluate(async el => {
      await el.decode();
      return [el.naturalWidth, el.naturalHeight];
    }), item.pixels);
  } else if (item.preview === 'pdf') {
    const picker = host.getByLabel('Страница оригинала');
    assert.equal(await picker.locator('option').count(), item.pages);
    const paper = host.locator('canvas').last();
    await paper.waitFor();
    const first = await paper.elementHandle();
    const one = await paper.evaluate(el => el.toDataURL());
    await picker.selectOption('2');
    await picker.page().waitForFunction(node => !node.isConnected, first);
    const two = await paper.evaluate(el => el.toDataURL());
    assert.notEqual(sha(one), sha(two));
  } else if (item.preview === 'text') {
    await host.getByText(item.contains, { exact: false }).first().waitFor();
  } else {
    await host.getByText(/ZIP доступно скачивание|во внешнем просмотрщике/).waitFor();
  }
}

(async function () {
  const browser = mobile ? await webkit.launch() : await chromium.launch({ channel: 'chrome' });
  const errors = [], external = [];
  let restoreBrowser;
  async function newDevice(engine = browser, mobileViewport = mobile) {
    const ctx = await engine.newContext({
      ...(mobileViewport ? devices['iPhone 13'] : { viewport: { width: 1360, height: 900 } }),
      serviceWorkers: 'block',
    });
    await ctx.route(/^https?:\/\//, route => {
      if (new URL(route.request().url()).origin === base.origin) return route.continue();
      external.push(route.request().url()); return route.abort();
    });
    const page = await ctx.newPage();
    page.setDefaultTimeout(15000);
    page.on('pageerror', e => errors.push(e.message));
    return page;
  }

  let page = await newDevice(), stage = 'create archive';
  const go = query => page.goto(new URL(query || '?', base).toString());
  const dialog = () => page.locator('dialog[open]');
  const field = n => dialog().locator('[name="' + n + '"]');
  const act = n => dialog().locator('[data-action="' + n + '"]').first().click();
  const submit = label => dialog().getByRole('button', { name: label, exact: true }).click();
  async function getDownload(link) {
    const pending = page.waitForEvent('download');
    await link.click();
    const download = await pending;
    return { bytes: await readFile(await download.path()), filename: download.suggestedFilename() };
  }

  try {
    if (evidence) await mkdir(evidence, { recursive: true });
    await go(''); await page.locator('main h1').waitFor();
    await page.locator('header [data-action=family]').click();
    await act('newFamily'); await field('familyName').fill('Учебный архив фантома');
    await field('memberName').fill('Фантом Калибровочный'); await field('birthday').fill('1990-01-01');
    await Promise.all([page.waitForEvent('load'), submit('Создать семейный архив')]);
    await page.getByRole('heading', {name:'Фантом Калибровочный'}).first().waitFor();
    await go('?new=visit');
    await field('episodeName').fill('Контроль качества снимка'); await field('doctorName').fill('Специалист стенда');
    await field('title').fill('Исследование фантома'); await submit('Сохранить визит');
    await page.getByRole('heading', {name:'Исследование фантома', exact:true}).waitFor();
    const visit = await dialog().locator('#visit-files [data-action=upload]').getAttribute('data-id');
    const openVisit = async () => {
      await go('?visit=' + encodeURIComponent(visit));
      await dialog().locator('#visit-files').waitFor();
    };
    stage = 'negative + pending previews';
    await dialog().locator('#visit-files [data-action=upload]').click();
    const upload = dialog().locator('#upload-form');
    await field('file').setInputFiles(files.map(f => path.join(__dirname, f.file)));
    const picker = upload.getByLabel('Файл для предпросмотра');
    for (const [index, item] of files.entries()) {
      await upload.locator('[data-file-index="' + index + '"]').selectOption(item.category);
      await picker.selectOption(String(index));
      if (item.preview === 'pdf') await upload.locator('.upload-preview canvas').waitFor();
      await verifyPreview(upload.locator('.upload-preview'), item);
      log('upload preview ' + name(item));
    }
    await upload.locator('[data-file-index="4"]').selectOption('Лаборатория');
    await submit('Прикрепить к визиту');
    await upload.locator('[data-file-index="4"] + .field-issue').getByText(/Для ZIP выберите/).waitFor();
    await openVisit();
    assert.equal(await dialog().locator('#visit-files [data-action=file]').count(), 0);
    log('ZIP in lab category rejects whole batch without partial files');
    await dialog().locator('#visit-files [data-action=upload]').click();
    await field('file').setInputFiles({name:'empty.txt',mimeType:'text/plain',buffer:Buffer.alloc(0)});
    await submit('Прикрепить к визиту'); await upload.getByText(/Выберите непустой файл/).waitFor();
    log('empty original rejected');
    await field('file').setInputFiles(files.map(f => path.join(__dirname, f.file)));
    for (const [index, item] of files.entries()) await upload.locator('[data-file-index="' + index + '"]').selectOption(item.category);
    await submit('Прикрепить к визиту'); await dialog().getByRole('link',{name:'Скачать оригинал'}).waitFor();

    async function inspect(phase) {
      await openVisit();
      assert.equal(await dialog().locator('#visit-files [data-action=file]').count(), files.length);
      for (const item of files) {
        const fileRow = dialog().locator('#visit-files [data-action=file]').filter({hasText:name(item)});
        assert.match(await fileRow.innerText(), new RegExp(item.category));
        await fileRow.click();
        const link = dialog().getByRole('link',{name:'Скачать оригинал'});
        await link.waitFor();
        if (item.preview === 'pdf') await dialog().locator('#file-paper canvas').waitFor();
        await verifyPreview(dialog(), item);
        if (evidence && item.preview === 'pdf' && phase === 'restored') {
          await page.screenshot({path:path.join(evidence,(mobile || cross?'webkit':'chrome')+'-restored-report.png')});
        }
        const download = await getDownload(link);
        assert.equal(download.filename,name(item));
        assert.equal(sha(download.bytes),item.sha256);
        log(phase + ' preview + download digest ' + name(item));
        await act('visit');
      }
    }
    stage = 'saved files'; await inspect('saved');
    stage = 'backup'; await go('?section=settings'); await page.locator('main [data-action=archive]').click(); await act('exportBackup');
    const key = await field('key').inputValue(); await dialog().locator('[type=checkbox]').check(); await submit('Подготовить файл');
    const encrypted = (await getDownload(dialog().getByText('Скачать зашифрованный файл'))).bytes;
    assert.equal(encrypted.subarray(0,4).toString(),'HS01');
    assert(!encrypted.includes(Buffer.from('QA-XR-07')));
    stage = 'fresh context restore'; const prev=page.context();
    if (cross) restoreBrowser = await webkit.launch();
    page = cross ? await newDevice(restoreBrowser, true) : await newDevice();
    await prev.close();
    await go('?section=settings'); await page.locator('main [data-action=archive]').click(); await act('importBackup');
    await field('archive').setInputFiles({name:'synthetic.health',mimeType:'application/octet-stream',buffer:encrypted});
    await field('key').fill(key); await submit('Проверить копию'); await dialog().getByText(/Копия проверена/).waitFor();
    await field('replace').check(); await Promise.all([page.waitForEvent('load'),submit('Восстановить')]);
    await page.getByRole('heading', {name:'Фантом Калибровочный'}).first().waitFor();
    await inspect('restored');
    assert.deepEqual(errors, []); assert.deepEqual(external, []);
    log((cross?'Chrome → iPhone WebKit':mobile?'iPhone WebKit':'Desktop Chrome') + ' isolated encrypted family restore, zero external requests');
  } catch (e) { console.error(stage,e); process.exitCode=1; }
  finally { if (restoreBrowser) await restoreBrowser.close(); await browser.close(); }
})();
