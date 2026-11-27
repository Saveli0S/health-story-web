const assert=require('node:assert/strict');
const {chromium,webkit,devices}=require('playwright-core');
const mobile=process.argv.includes('--iphone');
const base=process.env.HEALTH_PREVIEW_URL||'http://127.0.0.1:8764/';

(async()=>{
  const browser=mobile?await webkit.launch():await chromium.launch({channel:'chrome'});
  try{
    const context=await browser.newContext(mobile?{...devices['iPhone 13'],serviceWorkers:'block'}:{serviceWorkers:'block'});
    const first=await context.newPage(),second=await context.newPage();
    const go=(page,visit,profile='anna',role='admin')=>page.goto(base+'?space=demo&profile='+profile+'&visit='+visit+'&role='+role);
    const panel=page=>page.locator('dialog');
    const button=(page,name)=>panel(page).getByRole('button',{name,exact:true});
    const editor=page=>button(page,'Связанные записи').click();
    const option=(page,group,name)=>panel(page).locator('.pick-group').filter({has:page.locator('summary',{hasText:group})})
      .getByRole('checkbox',{name});
    const save=page=>button(page,'Сохранить связи').click();
    await go(first,'a2');
    // Both editors start on an archive created before visit links existed.
    await first.evaluate(()=>{
      const old=readJson(stateKey);
      delete old.profiles.anna.visitLinks;
      localStorage.setItem(stateKey,JSON.stringify(old));
    });
    await go(first,'a2');await go(second,'a2');
    await editor(first);await editor(second);
    const search=panel(first).getByRole('searchbox',{name:'Найти запись'});
    await search.fill('мометазон');
    await option(first,'Лекарства',/Мометазон/).check();
    await search.fill('нет такой записи');
    assert.match(await panel(first).getByRole('status').textContent(),/Совпадений нет.*Выбрано: 1/);
    await search.fill('');
    await option(first,'Анализы',/Общий анализ крови/).check();
    await option(second,'Документы',/Копия заключения офтальмолога/).check();
    await save(first);await save(second);
    await go(first,'a2');
    await panel(first).locator('#visit-labs [data-id="cbc"]').click();
    await panel(first).getByRole('heading',{name:'Общий анализ крови',exact:true}).waitFor();
    await go(first,'a2');
    await panel(first).locator('#visit-files [data-id="eye-note"]').click();
    await panel(first).getByRole('heading',{name:'Копия заключения офтальмолога',exact:true}).waitFor();
    await go(first,'a2');
    await panel(first).locator('[data-action="linkedVisitMedicine"]').click();
    await panel(first).getByRole('heading',{name:'Мометазон',exact:true}).waitFor();
    await panel(first).getByText(/50 мкг\/доза/).waitFor();
    assert.equal(await panel(first).locator('[data-action="visit"]').getAttribute('data-id'),'a1');
    await button(first,'Редактировать').click();
    await panel(first).locator('[name=strength]').fill('100 мкг/доза');
    await button(first,'Сохранить изменения').click();
    await go(first,'a2');
    await panel(first).locator('[data-action="linkedVisitMedicine"]').click();
    await panel(first).getByText(/100 мкг\/доза/).waitFor();
    await go(first,'a2');
    await button(first,'Документы и сверка назначений').click();
    const fromVisit=panel(first).locator('#intake-visit-data');
    assert.equal(await fromVisit.locator('[data-action=lab][data-id=cbc]').count(),1);
    assert.equal(await fromVisit.locator('[data-action=linkedVisitMedicine]').count(),1);
    assert.equal(await fromVisit.locator('[data-action=file][data-id=eye-note]').count(),1);
    await button(first,'Выбрать из профиля').click();
    await option(first,'Документы',/Копия заключения офтальмолога/).uncheck();
    await save(first);
    assert.equal(await fromVisit.locator('[data-action=file][data-id=eye-note]').count(),0);
    await go(first,'a2');
    assert.equal(await panel(first).locator('#visit-files [data-id="eye-note"]').count(),0);
    await go(first,'a3');
    assert.equal(await panel(first).locator('#visit-files [data-id="eye-note"]').count(),1);
    await go(first,'m2','misha');
    await editor(first);
    assert.equal(await option(first,'Лекарства',/Мометазон/).count(),0);
    await option(first,'Документы',/Заключение педиатра/).check();
    await save(first);
    await go(first,'m2','misha','child');
    assert.equal(await button(first,'Связанные записи').count(),0);
    await panel(first).locator('#visit-files [data-id="exam"]').click();
    await panel(first).getByRole('heading',{name:'Заключение педиатра',exact:true}).waitFor();
    console.log('PASS',mobile?'WebKit iPhone':'Chrome','visit links, concurrent saves, source records, profile isolation and child access');
  }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
