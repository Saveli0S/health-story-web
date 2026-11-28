const assert=require('node:assert/strict');
const {chromium,webkit,devices}=require('playwright-core');
const mobile=process.argv.includes('--iphone');
const base=process.env.HEALTH_PREVIEW_URL||'http://127.0.0.1:8764/';

(async()=>{
  const browser=mobile?await webkit.launch():await chromium.launch({channel:'chrome'});
  try{
    const context=await browser.newContext(mobile?{...devices['iPhone 13'],serviceWorkers:'block'}:{serviceWorkers:'block'});
    await context.route('https://**',request=>request.abort());
    const first=await context.newPage(),second=await context.newPage();
    const go=async(page,profile='anna',visit='a1',role='admin')=>{
      const url=base+`?space=demo&profile=${profile}&visit=${visit}&role=${role}`;
      if(page.url()===url)await page.reload();else await page.goto(url);
      await page.locator('dialog[open]').getByRole('heading',{name:'Рекомендации врача',exact:true}).waitFor();
    };
    const grouped=(page,group)=>page.locator('dialog').getByRole('group',{name:group,exact:true});
    const lab=page=>grouped(page,'Анализы').getByRole('checkbox',{name:'Сдать общий анализ крови.'});
    const exercise=page=>grouped(page,'Физическая активность').getByRole('checkbox',{name:'Выполнить упражнения по бланку.'});
    await go(first);
    await first.evaluate(()=>{
      const row={id:'r-file',visit:'a1',name:'Сверенный бланк QA',checked:true,type:'text/plain',date:'2026-11-25',category:'Рекомендации',
        recommendation:'Сдать общий анализ крови. Выполнить упражнения по бланку.\nКонтроль ЭКГ через 6 месяцев.'};
      current().files.push(row);
      current().recommendations.push({id:'r-manual',visit:'a1',text:'Гипохолестериновая диета.\nНаблюдение через 6 месяцев.'});
      prototypeState.profiles.misha.recommendations.push({id:'r-child',visit:'m2',text:'Сдать общий анализ крови.',
        recommendationChecks:{'item:сдать общий анализ крови':true}});
      if(!saveState())throw Error('Could not save the synthetic archive');
    });
    // First edits from two open tabs on an older record without a completion map.
    await go(first);await go(second);
    await lab(first).check();await exercise(second).check();
    await go(first);
    assert(await lab(first).isChecked());assert(await exercise(first).isChecked());
    const exam=grouped(first,'Обследования').getByRole('checkbox',{name:'Контроль ЭКГ через 6 месяцев.'});
    assert.equal(await exam.isChecked(),false);
    assert.equal(await grouped(first,'Питание').getByRole('checkbox').count(),1);
    assert.equal(await grouped(first,'Наблюдение').getByRole('checkbox').count(),1);
    await first.locator('dialog').getByText('Текст из бланка',{exact:true}).click();
    await first.locator('dialog').getByText('Сдать общий анализ крови. Выполнить упражнения по бланку.',{exact:false}).last().waitFor();
    assert.equal(await first.locator('dialog').getByRole('button',{name:'Оригинал',exact:true}).getAttribute('data-id'),'r-file');
    await exercise(first).uncheck();await go(first);
    assert(await lab(first).isChecked());assert.equal(await exercise(first).isChecked(),false);
    const diet=grouped(first,'Питание').getByRole('checkbox',{name:'Гипохолестериновая диета.'});
    await diet.check();
    await grouped(first,'Наблюдение').getByRole('checkbox').check();
    await first.getByRole('button',{name:'Записать вручную'}).click();
    await first.getByLabel('Указания врача').fill('Гипохолестериновая диета.\nНаблюдение через 3 месяца.');
    await first.getByRole('button',{name:'Сохранить рекомендации'}).click();
    assert(await diet.isChecked());
    assert.equal(await grouped(first,'Наблюдение').getByRole('checkbox',{name:'Наблюдение через 3 месяца.'}).isChecked(),false);
    await go(second,'misha','m2','child');
    assert(await lab(second).isChecked());assert(await lab(second).isDisabled());
    console.log('PASS',mobile?'iPhone WebKit':'Chrome','recommendation sections, independent marks, source and child access');
  }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
