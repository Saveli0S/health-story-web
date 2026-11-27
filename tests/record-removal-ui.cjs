const {chromium,webkit,devices}=require('playwright-core');
const assert=require('node:assert/strict');
const mobile=process.argv.includes('--iphone');
const base=process.env.HEALTH_PREVIEW_URL||'http://127.0.0.1:8764/';
(async()=>{
  const browser=mobile?await webkit.launch():await chromium.launch({channel:'chrome'});
  try{
    const page=await browser.newPage({...mobile?devices['iPhone 13']:{},serviceWorkers:'block'});
    page.setDefaultTimeout(12000);
    page.on('pageerror',error=>console.error('Page:',error.message));
    const d=page.locator('dialog'),main=page.locator('main');
    const button=name=>d.getByRole('button',{name,exact:true});
    const confirm=async name=>{
      await d.locator('#remove-record-form input').check();
      await button(name).click();
    };
    await page.goto(base+'?new=family');
    await d.locator('[name=familyName]').fill('Учебная семья');
    await d.locator('[name=memberName]').fill('Учебный профиль');
    await Promise.all([page.waitForURL(/space=family/),button('Создать семейный архив').click()]);
    await main.getByRole('heading',{name:'Учебный профиль',exact:true}).waitFor();
    const owner=await page.evaluate(async()=>{
      const p=current(),id=person.id;
      p.episodes.push({id:'ep',name:'Учебный эпизод'});
      p.addedDoctors.push({id:'doctor',values:['Учебный врач','Терапевт','']});
      p.addedVisits.push(['visit','2026-11-26','Учебный приём','doctor','Учебный эпизод','',
        'scope','ep',[]]);
      p.notes.push({id:'note',visit:'visit',text:'Учебная заметка'});
      p.files.push({id:'lab',visit:'visit',date:'2026-11-26',type:'text/plain',name:'Учебный бланк.txt',category:'Лаборатория',
        lab:{name:'Учебный анализ',date:'2026-11-26',rows:[{name:'Показатель',value:'1',unit:'г/л'}]}});
      p.exams.push({id:'exam',visit:'visit',method:'УЗИ',region:'Учебная область',date:'2026-11-26',
        attachments:[{id:'lab'}],parameters:[]});
      await fileBlob(id+'/lab',new Blob(['QA original'],{type:'text/plain'}));
      if(!saveState())throw Error('fixture');
      return id;
    });
    await page.goto(base+'?visit=visit');
    await button('Удалить визит').click();
    await button('Отмена').click();
    assert.equal(await page.evaluate(()=>current().addedVisits.length),1);
    await button('Удалить визит').click();await confirm('Удалить запись');await d.waitFor({state:'hidden'});
    assert.deepEqual(await page.evaluate(()=>[current().addedVisits.length,current().notes.length,current().exams[0].visit,current().files[0].visit]),[0,0,'','']);
    await page.goto(base+'?section=settings');
    await main.locator('[data-action=manageRecords]').click();
    await d.locator('#remove-search').fill('Учебный бланк');
    await d.locator('#remove-category').selectOption('Документы и анализы');
    await button('Удалить').click();await confirm('Удалить запись');
    await page.waitForFunction(()=>current().files.length===0);
    await page.waitForFunction(async id=>!await fileBlob(id+'/lab'),owner);
    assert.equal(await page.evaluate(()=>current().exams[0].attachments.length),0);
    await page.reload();await main.locator('[data-action=manageRecords]').click();
    await button('Очистить медицинские данные профиля').click();await confirm('Очистить данные');
    assert.equal(await page.evaluate(()=>current().exams.length+current().fields.length+current().episodes.length),0);
    assert.equal(await page.evaluate(()=>family.members[0].id),owner);
    await page.goto(base+'?space=demo&role=child&section=settings');
    await main.getByRole('heading',{name:'Настройки',exact:true}).waitFor();
    assert.equal(await main.locator('[data-action=manageRecords]').count(),0);
    console.log('PASS',mobile?'mobile WebKit':'Chrome','confirmation, scoped deletion, original cleanup, full profile and child controls');
  }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
