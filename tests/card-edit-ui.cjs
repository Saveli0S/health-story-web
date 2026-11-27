const assert=require('node:assert/strict');
const {chromium,webkit,devices}=require('playwright-core');
const mobile=process.argv.includes('--iphone');
const base=process.env.HEALTH_PREVIEW_URL||'http://127.0.0.1:8764/';
const txt=(name,content)=>({name,mimeType:'text/plain',buffer:Buffer.from(content)});

(async()=>{
  const browser=mobile?await webkit.launch():await chromium.launch({channel:'chrome'});
  try{
    const page=await browser.newPage(mobile?{...devices['iPhone 13'],serviceWorkers:'block'}:{serviceWorkers:'block'});
    const dialog=page.locator('dialog'),main=page.locator('main');
    const open=query=>page.goto(base+'?space=demo&profile=anna&'+query);
    const field=(name,scope=dialog)=>scope.locator('[name="'+name+'"]').first();
    const submit=label=>dialog.getByRole('button',{name:label,exact:true}).click();
    await open('new=episode');
    await field('episode').fill('QA Episode');await submit('Создать эпизод');
    const episode=await page.evaluate(()=>current().episodes.at(-1).id);
    await open('new=episode');await field('episode').fill('qa   episode');await submit('Создать эпизод');
    await submit('Открыть существующий эпизод');
    const fillVisit=async name=>{
      await field('episode').selectOption(episode);
      await field('date').fill('2026-11-12');
      await field('title').fill(name);
      await field('doctor').selectOption('volkova');
      await field('clinic').fill('Семейная клиника');
      await field('note').fill('QA visit note');
    };
    await open('new=visit');await fillVisit('QA Visit');await submit('Сохранить визит');
    await dialog.getByRole('heading',{name:'QA Visit',exact:true}).waitFor();
    const id=await page.evaluate(()=>current().addedVisits[0][0]);
    await open('new=visit');await fillVisit('qa   visit');await submit('Сохранить визит');
    await submit('Открыть существующий визит');
    assert.equal(await page.evaluate(()=>current().addedVisits.length),1);
    await submit('Редактировать визит');
    await field('title').fill('QA Visit corrected');await submit('Сохранить изменения');
    await dialog.getByRole('heading',{name:'QA Visit corrected',exact:true}).waitFor();
    await dialog.locator('[data-action=episode]').first().click();await submit('Редактировать эпизод');
    await field('episode').fill('QA Episode corrected');await submit('Сохранить эпизод');
    assert.deepEqual(await page.evaluate(()=>current().addedVisits[0].slice(0,5)),[id,'2026-11-12','QA Visit corrected','volkova','QA Episode corrected']);
    await open('new=visit');await fillVisit('QA Visit corrected');await field('note').fill('Другая запись врача');
    await submit('Сохранить визит');await dialog.getByText('Другая запись врача',{exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>current().addedVisits.length),2);
    for(const [name,repeated] of [['attachment.txt',false],['same-bytes.txt',true]]){
      await open('visit='+encodeURIComponent(id));
      await submit('Прикрепить файл');await field('category').selectOption('Другое');
      await field('file').setInputFiles(txt(name,'Existing visit attachment QA'));
      await submit('Прикрепить к визиту');
      if(repeated)await submit('Открыть существующее вложение');
      await dialog.getByRole('heading',{name:'attachment.txt',exact:true}).waitFor();
    }
    assert.equal(await page.evaluate(()=>current().files.filter(f=>f.name==='attachment.txt'||f.name==='same-bytes.txt').length),1);
    await open('visit='+encodeURIComponent(id));await dialog.locator('[data-action=recommendVisit]').click();
    await field('text').fill('Рекомендации по лечению: Учебный препарат 20 мг — по 1 таблетке утром\n- КРЕМИН мазь 15,0 -\nНаносить тонким слоем 2 раза в день');
    await submit('Сохранить рекомендации');
    await submit('Назначения врача');
    await field('verified').check();await submit('Сохранить назначения');
    await open('visit='+encodeURIComponent(id));
    assert.equal(await dialog.locator('#visit-meds .medication').count(),2);
    assert.equal(await dialog.getByText('Приём не подтверждён',{exact:true}).count(),2);
    assert.equal(await dialog.getByRole('button',{name:'Сделать ИИ-анализ лечения',exact:true}).count(),0);
    const topical=dialog.locator('#visit-meds .medication').filter({hasText:'КРЕМИН'});
    await topical.getByRole('button',{name:'Редактировать',exact:true}).click();
    await field('drug').fill('Кремин уточнённый');
    await field('strength').fill('1 %');
    await field('form').fill('крем');
    await field('instructions').fill('Учебная схема после сверки');
    await submit('Сохранить изменения');
    await open('visit='+encodeURIComponent(id));
    const edited=dialog.locator('#visit-meds .medication').filter({hasText:'Кремин уточнённый'});
    await edited.getByText('Кремин уточнённый · 1 %',{exact:true}).waitFor();
    await edited.getByText('Приём не подтверждён',{exact:true}).waitFor();
    await edited.getByText('Учебная схема после сверки',{exact:true}).waitFor();
    await submit('Документы и сверка назначений');
    const fromVisit=dialog.locator('#intake-visit-data');
    assert.equal(await fromVisit.locator('.medication').count(),2);
    await fromVisit.getByText('Рекомендации врача',{exact:true}).click();
    await fromVisit.getByText(/Рекомендации по лечению:/).waitFor();
    await fromVisit.getByRole('button',{name:/attachment.txt/}).click();
    await dialog.getByText('Existing visit attachment QA',{exact:true}).waitFor();
    await open('visit='+encodeURIComponent(id));
    await submit('Назначения врача');
    assert.equal(await dialog.locator('#visit-rx-form [data-med]').count(),2);
    await open('new=visit&mode=photo');
    const photoBody='Дата визита: 12.11.2026\nНазначения врача\nУчебная запись без лекарств.';
    await dialog.locator('#visit-processing').selectOption('manual');
    await dialog.locator('#visit-source').setInputFiles(txt('Назначение QA.txt',photoBody));
    await fillVisit('QA Visit from original');await submit('Создать визит и сверить назначения');
    await dialog.locator('#verify-form').waitFor();
    await open('new=visit&mode=photo');
    await dialog.locator('#visit-source').setInputFiles(txt('Другой файл.txt',photoBody));await submit('Открыть существующий визит');
    await dialog.getByRole('heading',{name:'QA Visit from original'}).waitFor();
    assert.equal(await page.evaluate(()=>current().visitDrafts.length),0);

    for(const [value,repeated] of [['42',false],['42',true],['44',false]]){
      await open('section=exams');await main.locator('[data-action=newExam]').click();
      await field('method').selectOption('УЗИ');await field('date').fill('2026-11-12');await field('region').fill('QA');
      await submit('Добавить параметр');await field('paramName').fill('QA размер');await field('paramValue').fill(value);
      await submit('Сохранить обследование');
      if(repeated)await submit('Открыть существующее обследование');
      await dialog.getByRole('heading',{name:'УЗИ · QA',exact:true}).waitFor();
    }
    assert.equal(await page.evaluate(()=>current().exams.length),2);

    const importLab=async file=>{
      await open('section=labs');
      await main.locator('[data-action=upload]').click();await field('file').setInputFiles(file);
      await submit('Сохранить в профиле');
    };
    const fillLab=async (value,date)=>{
      const form=dialog.locator('#lab-form');
      await field('title',form).fill('QA анализ');
      if(date)await field('date',form).fill(date);
      await field('laboratory',form).fill('QA лаборатория');await field('marker',form).fill('QA показатель');
      await field('reading',form).fill(value);await field('unit',form).fill('г/л');
      await field('verified',form).check();await submit('Сохранить результаты');
    };
    await importLab(txt('lab-qa.txt','Дата заказа: 12.11.2026\nfixture A'));
    const today=await page.evaluate(()=>todayLocal());
    assert.equal(await field('date',dialog.locator('#lab-form')).inputValue(),today);
    await dialog.locator('#lab-date-estimate').waitFor();
    await fillLab('42');
    await dialog.getByRole('heading',{name:'QA анализ',exact:true}).waitFor();
    assert.match(await dialog.locator('.detail-meta').innerText(),/Дата подставлена/);
    await importLab(txt('renamed.txt','Дата заказа: 12.11.2026\nfixture A'));await submit('Открыть существующий бланк');
    assert.equal(await page.evaluate(()=>current().files.filter(f=>f.lab).length),1);
    await importLab(txt('other-qa.txt','fixture B'));await fillLab('42');
    await submit('Открыть существующий анализ');
    await submit('Исправить результаты');
    assert.equal(await field('date').inputValue(),today);
    await fillLab('43','2026-11-12');
    assert.doesNotMatch(await dialog.locator('.detail-meta').innerText(),/Дата подставлена/);
    assert.deepEqual(await page.evaluate(()=>current().files.filter(f=>f.lab).map(f=>f.lab.rows[0].value)),['43']);
    console.log('PASS',mobile?'mobile WebKit':'Chrome','visit and episode edits, duplicate visits, distinct exams, duplicate lab files and results');
  }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
