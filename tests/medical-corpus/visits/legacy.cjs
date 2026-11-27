// Exercise previously stored drafts, hand edits and signed-off rows through the current web entry points.
const {chromium}=require('playwright-core');
const assert=require('node:assert/strict');
const path=require('node:path');
const base=process.env.HEALTH_PREVIEW_URL||'http://127.0.0.1:8764/';
(async()=>{
 const browser=await chromium.launch({channel:'chrome'});
 try {
  const page=await browser.newPage();
  await page.goto(base+'?new=visit&mode=photo');
  await page.locator('#visit-processing').selectOption('local');
  await page.locator('#visit-source').setInputFiles(path.join(__dirname,'V02-two-page-visit.pdf'));
  const form=page.locator('#visit-form');
  await form.waitFor();
  const visitId=await page.evaluate(()=>{
    const d=current().visitDrafts[0];
    delete d.visitImportRevision;
    d.header.date='2026-03-25'; // obsolete automatic result
    d.proposed[0].instructions='спрей По 1 дозе 2 раза в день, 2 дня.';
    delete d.fields;
    saveState();return d.id;
  });
  const reopen=async()=>{await page.goto(base);await page.locator('main [data-action=resumeVisit][data-id="'+visitId+'"]').click();await form.waitFor()};
  await reopen();
  assert.equal(await form.locator('[name=date]').inputValue(),'2026-03-19');
  assert.match(await page.evaluate(()=>current().visitDrafts[0].proposed[0].instructions),/^По /);
  await form.locator('[name=title]').fill('Оставленное пользователем название');
  await page.evaluate(()=>{delete current().visitDrafts[0].visitImportRevision;saveState()});
  await reopen();
  assert.equal(await form.locator('[name=title]').inputValue(),'Оставленное пользователем название');
  await page.locator('.document-transcript > summary').click();
  await page.locator('[data-action=applyVisitTranscript]').click();
  assert.equal(await form.locator('[name=title]').inputValue(),'Выписка о повторной консультации');
  await form.getByRole('button',{name:'Создать визит и сверить назначения'}).click();
  const verify=page.locator('#verify-form'),id=await verify.getAttribute('data-id');
  const openCheck=async()=>{await page.evaluate(id=>showVerification(id),id);await verify.waitFor()};
  await page.evaluate(id=>{
    const f=current().files.find(f=>f.id===id);delete f.visitImportRevision;delete f.transcription;
    f.proposed=[{id:'old',name:'старый автоматический результат',strength:'4 мг',instructions:'так было'}];saveState();
  },id);
  await openCheck();
  assert.equal(await verify.locator('[name=drug]').inputValue(),'Макетол');
  await verify.locator('[name=drug]').fill('Ручное исправление');
  await verify.locator('[data-action=deferVerify]').click();await openCheck();
  assert.equal(await verify.locator('[name=drug]').inputValue(),'Ручное исправление');
  await verify.locator('[data-action=refreshRxDraft]').click();
  assert.equal(await verify.locator('[name=drug]').inputValue(),'Макетол');
  await verify.locator('[name=drug]').fill('Сверено отдельно');
  await verify.locator('[name=verified]').check();
  await verify.getByRole('button',{name:'Подтвердить сведения'}).click();await openCheck();
  assert.equal(await verify.locator('[name=drug]').inputValue(),'Сверено отдельно');
  assert.equal(await verify.locator('[data-action=refreshRxDraft]').count(),0);
  console.log('PASS legacy drafts automatically refreshed, manual fields and confirmed treatment preserved, explicit refresh works');
 } finally {await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
