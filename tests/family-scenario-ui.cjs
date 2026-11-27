// Full synthetic-family journey. All input and readback go through the visible web app.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {chromium,webkit,devices}=require('playwright-core');

const base=new URL(process.env.HEALTH_PREVIEW_URL||'http://127.0.0.1:8764/');
if(!['localhost','127.0.0.1','[::1]'].includes(base.hostname)&&base.href!=='https://saveli0s.github.io/health-story-web/')throw Error('Choose the family app release or a local QA server.');
const mobile=process.argv.includes('--iphone');
const corpus=path.join(__dirname,'medical-corpus');
const adult='Мая Образцова',child='Лада Макетова',administrator='Родитель Макетова';
const observation='Наблюдение по результатам анализов';
const firstTitle='Первичный приём по результатам анализов',followTitle='Сверка анализов в динамике';
const noteText='Семейная пометка: взять оба бланка на контроль.';
const question='Когда взять повторный образец?';
const visitPdf=path.join(corpus,'visits','V01-visit.pdf');
const documents=['01-baseline.pdf','02-followup-en.pdf','04-urine-scan.jpg'].map(f=>path.join(corpus,'labs',f));
const examOriginals=['03-phantom-report.pdf','01-phantom.png'].map(f=>path.join(corpus,'attachments','files',f));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const evidence={browser:mobile?'iPhone 13 WebKit':'desktop Chrome',stages:[],verifiedOriginals:[],externalRequests:[],jsErrors:[]};
let p,stage;
const dialog=()=>p.locator('dialog[open]');
const field=name=>dialog().locator('[name="'+name+'"]').first();
const act=(name,scope=dialog())=>scope.locator('[data-action="'+name+'"]').first().click();
const submit=name=>dialog().getByRole('button',{name,exact:true}).click();
const go=async query=>{await p.goto(new URL(query||'?',base).href,{waitUntil:'domcontentloaded'});await p.locator('main h1').waitFor()};
const gotoVisit=(person,id)=>go('?profile='+person+'&visit='+id);
const goSection=(person,section)=>go('?profile='+person+'&section='+section);
async function fill(fields){for(const [name,value] of Object.entries(fields))await field(name).fill(value)}
async function readyAfter(click){
  await Promise.all([p.waitForEvent('domcontentloaded',{timeout:60000}),click()]);await p.locator('main h1').waitFor();
}
async function download(locator){
  const receiving=p.waitForEvent('download');await locator.click();
  return fs.readFile(await (await receiving).path());
}
async function chooseFamily(name){
  if(!await dialog().locator('.person-row').count())await p.locator('header [data-action=family]').click();
  const person=dialog().locator('.person-row').filter({hasText:name});
  const id=await person.getAttribute('data-id');
  await person.click();await p.getByRole('heading',{name,exact:true}).waitFor();return id;
}
async function addMember(name,role,birthday){
  await p.locator('header [data-action=family]').click();await act('newMember');await field('role').selectOption(role);
  await fill({memberName:name,birthday});await readyAfter(()=>submit('Сохранить профиль'));
  await p.getByRole('heading',{name,exact:true}).waitFor();return new URL(p.url()).searchParams.get('profile');
}
async function pairDevice(adminPage,recipient,member){
  p=recipient;await go();await p.locator('header [data-action=family]').click();await act('joinDevice');
  const req=p.locator('#device-request'),request=await download(req.getByRole('link')),fingerprint=await req.locator('strong').innerText();
  p=adminPage;await go('?section=settings');await act('devices',p.locator('main'));await act('grantDevice');
  const issue=dialog().locator('#device-issue');await field('request').setInputFiles({name:'join.health-request',mimeType:'application/octet-stream',buffer:request});
  await fill({fingerprint,label:'Устройство сценария'});await field('member').selectOption(member);
  await issue.locator('button').click();const packet=await download(issue.getByRole('link')),code=await issue.locator('[role=status] strong').innerText();
  p=recipient;await field('packet').setInputFiles({name:'test.health-device',mimeType:'application/octet-stream',buffer:packet});await field('code').fill(code);
  await readyAfter(()=>dialog().locator('#device-install button').click());
}
async function step(name,fn){stage=name;const details=await fn();evidence.stages.push({name,status:'PASS',details});console.log('PASS',name)}

(async()=>{
  const desktop=await chromium.launch({channel:'chrome'}),iphone=await webkit.launch();
  const primary=mobile?iphone:desktop,secondary=mobile?desktop:iphone;
  const newPage=async engine=>{
    const ctx=await engine.newContext({...engine===iphone?devices['iPhone 13']:{viewport:{width:1360,height:960}},locale:'ru',serviceWorkers:'block'});
    await ctx.route(/^https?:/,route=>{
      const url=new URL(route.request().url());if(url.origin===base.origin)return route.continue();
      evidence.externalRequests.push(url.origin);return route.abort();
    });
    const page=await ctx.newPage();page.setDefaultTimeout(base.protocol==='https:'?45000:12000);page.setDefaultNavigationTimeout(60000);page.on('pageerror',e=>evidence.jsErrors.push(e.message));return page;
  };
  let master,adultId,childId,initial,episode,adultVisit,key,copy;
  try{
    p=master=await newPage(primary);
    await step('Создание отдельной семьи',async()=>{
      await go('?new=family');await fill({familyName:'Семья учебного сценария',memberName:administrator,birthday:'1980-01-12'});
      await readyAfter(()=>submit('Создать семейный архив'));await p.getByRole('heading',{name:administrator,exact:true}).waitFor();
      adultId=await addMember(adult,'Взрослый','1988-09-08');childId=await addMember(child,'Ребёнок','2014-06-21');
      await p.locator('header [data-action=family]').click();assert.equal(await dialog().locator('.person-row').count(),3);await act('close');
      return 'Созданы пустой семейный архив, профиль администратора, взрослый и ребёнок.';
    });
    await step('Визит взрослого по PDF',async()=>{
      await go('?profile='+adultId+'&new=visit&mode=photo');await dialog().locator('#visit-processing').selectOption('local');
      await dialog().locator('#visit-source').setInputFiles(visitPdf);await dialog().locator('#visit-form').waitFor({timeout:90000});
      assert.equal(await field('date').inputValue(),'2026-03-12');assert.equal(await field('clinic').inputValue(),'Клиника «Тестовый клевер»');
      await submit('Создать визит и сверить назначения');await dialog().locator('#verify-form').waitFor();
      assert.equal(await field('drug').inputValue(),'Клеверин');assert.equal(await field('strength').inputValue(),'5 мг');
      await field('verified').check();await submit('Подтвердить сведения');await act('visitHome');
      adultVisit=await dialog().locator('[data-action=analyze]').getAttribute('data-id');assert.match(await dialog().innerText(),/Принести дневник/);
      return 'Прочитаны дата, клиника, Клеверин 5 мг и рекомендации. Оригинал прикреплён к взрослому.';
    });
    await step('Медкарта ребёнка',async()=>{
      await go('?profile='+childId);await act('medical',p.locator('main'));
      for(const [id,value] of [['weight','36 кг'],['height','143 см'],['measured','2025-01-05'],['allergy','Учебная аллергия на Макет-QA']]){
        await dialog().locator('[data-action=field][data-id="'+id+'"]').click();await field('value').fill(value);await submit('Сохранить поле');
      }
      await dialog().locator('[data-action=field][data-id=""]').click();await fill({label:'Поле для проверки',value:'Начальное значение'});await submit('Сохранить поле');
      const row=dialog().locator('.field-line').filter({hasText:'Поле для проверки'});await act('field',row);await fill({value:'Уточнённое значение'});await submit('Сохранить поле');
      assert.match(await row.innerText(),/Уточнённое значение/);await act('field',row);await act('removeField');await act('confirmDelete');
      assert.equal(await dialog().getByText('Поле для проверки',{exact:true}).count(),0);
      return 'Заполнены рост, вес, дата их измерения и аллергия. Дополнительное поле создано, отредактировано и удалено.';
    });
    await step('Первичный визит ребёнка, курс, даты и пометка',async()=>{
      await go('?profile='+childId+'&new=visit');
      await fill({episodeName:observation,title:firstTitle,date:'2025-04-16',specialty:'Педиатр',doctorName:'Доктор Январь',clinic:'Учебная клиника',note:'Учебный план наблюдения.',recommendation:'Принести бланки на повторный приём.'});
      for(const [name,strength] of [['Препарат Альфа QA','5 мг'],['Препарат Бета QA','2 мг']]){
        await act('appendMed');const row=dialog().locator('#rx-rows [data-med]').last();
        for(const [key,val] of Object.entries({drug:name,strength,form:'таблетки',instructions:'По учебному назначению.'}))
          await row.locator('[name="'+key+'"]').fill(val);
      }
      await submit('Сохранить визит');await dialog().getByRole('heading',{name:'Проверить данные'}).waitFor();
      await act('back');initial=await dialog().locator('[data-action=analyze]').getAttribute('data-id');episode=await dialog().locator('[data-action=episode]').first().getAttribute('data-id');
      await act('addNote');assert.match(await dialog().innerText(),/Увидят все/);await field('note').fill(noteText);await submit('Сохранить пометку');await dialog().getByText(noteText,{exact:true}).waitFor();
      await go('?profile='+childId);const medication=p.locator('.course-card .medication').filter({hasText:'Препарат Альфа QA'});
      await act('period',medication);await fill({start:'2025-04-16',planned:'2025-04-22',note:'Время начала уточнили в семье.'});await submit('Сохранить даты');
      await act('period',medication);assert.equal(await field('start').inputValue(),'2025-04-16');assert.equal(await field('planned').inputValue(),'2025-04-22');await act('close');
      return 'У ребёнка создан эпизод, два препарата, уточнённые даты начала и планового окончания и общая пометка.';
    });
    await step('Разные лабораторные бланки и график',async()=>{
      for(const [i,file] of documents.entries()){
        await goSection(childId,'labs');await act('upload',p.locator('main'));await field('visit').selectOption(initial);
        await field('file').setInputFiles(file);await submit('Прикрепить к визиту');await dialog().locator('#lab-form').waitFor({timeout:90000});
        assert.equal(await field('date').inputValue(),['2025-01-08','2025-02-12','2025-04-15'][i]);
        await field('verified').check();await submit('Сохранить результаты');
        if(i===1)await dialog().getByText('13.8 g/dL',{exact:true}).waitFor();
        await act('trend');
      }
      const urine=dialog().locator('.trend-chart [role=button]');assert.equal(await urine.count(),1);assert.match(await urine.first().getAttribute('aria-label'),/0,3/);
      await goSection(childId,'labs');await p.locator('#listing').getByRole('button',{name:/Haematology/}).click();await act('trend');
      const hb=await dialog().locator('.trend-chart [role=button]').evaluateAll(es=>es.map(e=>e.getAttribute('aria-label')));
      assert.equal(hb.length,2);assert.match(hb[0],/132 г\/л/);assert.match(hb[1],/138 г\/л/);
      return 'Русский PDF, английский двухстраничный PDF, JPEG. Ряд Hb 132 → 138 г/л, отдельная точка мочи 0,3 ммоль/л.';
    });
    await step('Обследование и оригиналы',async()=>{
      await goSection(childId,'exams');await act('newExam',p.locator('main'));await field('protocol').setInputFiles(examOriginals[0]);
      await dialog().getByText(/Откройте оригинал и сверьте/).waitFor({timeout:90000});assert.match(await field('conclusion').inputValue(),/семь ступеней/);
      await field('method').selectOption('Рентгенография');await field('date').fill('2025-04-16');await field('visit').selectOption(initial);
      await field('images').setInputFiles(examOriginals[1]);await dialog().getByText('Снимки готовы к сохранению.').waitFor();
      await field('reviewed').check();await submit('Сохранить обследование');await dialog().getByRole('heading',{name:'Заключение врача'}).waitFor();
      await dialog().getByRole('button',{name:/01-phantom.png/}).click();await dialog().locator('img.paper-preview').waitFor();
      return 'Заключение из PDF и снимок-фантом связаны с визитом. Снимок открыт.';
    });
    await step('Состав запроса на разбор лечения',async()=>{
      await gotoVisit(childId,initial);await act('analyze');await act('manual');
      const prompt=await field('prompt').inputValue();assert.match(prompt,/Учебная аллергия на Макет-QA/);
      assert.match(prompt,/36 кг/);assert.match(prompt,/Препарат Альфа QA/);assert.match(prompt,/семь ступеней/);
      assert.match(prompt,/Haemoglobin/);assert.match(prompt,/Моча/);assert.doesNotMatch(prompt,/Клеверин|Лада Макетова|Доктор Январь|01-phantom/);
      await field('answer').fill('Учебный разбор курса, введён вручную.');await submit('Сохранить версию разбора');await dialog().getByText('Учебный разбор курса, введён вручную.',{exact:true}).waitFor();
      return 'В сводку вошли детский профиль, препараты, три связанных бланка и обследование. Визит взрослого и прямые идентификаторы отсутствовали. Сохранена вручную введённая версия.';
    });
    await step('Домашние измерения, прививка и консультация',async()=>{
      for(const [time,reading] of [['2025-04-15T09:15','36,6'],['2025-04-16T20:45','37,1']]){
        await go('?profile='+childId);await act('measure',p.locator('main'));
        await fill({marker:'Температура QA',reading,unit:'°C',time});await field('episode').selectOption(episode);await submit('Сохранить измерение');
      }
      assert.equal(await dialog().locator('.trend-chart [role=button]').count(),2);
      await go('?profile='+childId+'&section=labs&view=prevention');await act('editPrevent',p.locator('main'));
      await field('kind').selectOption('vaccine');await fill({title:'Учебная прививка',done:'2025-04-15',next:'2026-04-15',note:'Серия QA-VAX-01'});
      await field('source').selectOption('visit:'+initial);await submit('Сохранить запись');await dialog().getByText('Прививка',{exact:true}).first().waitFor();
      await act('consult');await field('question').fill('Подготовь краткую историю выбранной прививки.');
      await submit('Проверить запрос');const prompt=await field('prompt').inputValue();
      assert.match(prompt,/QA-VAX-01/);assert.doesNotMatch(prompt,/Лада Макетова|Клеверин|Haematology|Первичный приём по результатам/);
      await field('answer').fill('Учебный ответ для проверки сохранения истории.');await submit('Сохранить ответ');
      await goSection(childId,'consults');await act('consultRecord',p.locator('main'));
      assert.match(await dialog().innerText(),/Учебный ответ для проверки сохранения истории/);
      return 'Две домашние точки связаны с эпизодом. Прививка связана с визитом. Сохранены сводка только по прививке и вручную введённый учебный ответ.';
    });
    await step('Контрольный визит, отмена и сводка',async()=>{
      await gotoVisit(childId,initial);await act('episode');await act('newVisit');
      await fill({title:followTitle,date:'2025-04-17'});await field('doctor').selectOption('new');
      await fill({specialty:'Детский специалист',doctorName:'Доктор Апрель',note:'Обсудили динамику.'});
      const decisions=dialog().locator('.therapy-decision');
      await decisions.filter({hasText:'Препарат Альфа QA'}).locator('[name=decision]').selectOption('stop');
      await decisions.filter({hasText:'Препарат Бета QA'}).locator('[name=decision]').selectOption('continue');
      await submit('Сохранить визит');if(await dialog().getByRole('heading',{name:'Проверить данные'}).count())await act('back');
      await goSection(childId,'visits');const linked=p.locator('#listing [data-action=visit]').filter({hasText:followTitle});await linked.click();
      await act('episode');await act('brief');
      assert.match(await dialog().innerText(),/Отменить · Препарат Альфа QA/);
      const active=dialog().locator('section').filter({has:p.getByRole('heading',{name:'Действующие назначения',exact:true})});
      assert.match(await active.innerText(),/Препарат Бета QA/);assert.doesNotMatch(await active.innerText(),/Альфа/);
      assert.equal(await dialog().locator('[data-action=exam]').count(),1);assert.equal(await dialog().locator('[data-action=lab]').count(),3);
      await field('question').fill(question);await submit('Добавить вопрос');await dialog().getByText(question,{exact:true}).waitFor();
      await gotoVisit(childId,initial);assert.match(await dialog().locator('#visit-meds').innerText(),/Препарат отменён.*Доктор Апрель/);
      await go('?profile='+childId);assert.equal(await p.locator('.course-card .medication').count(),1);
      await act('finish',p.locator('.course-card'));await field('common').fill('2025-04-21');await submit('Завершить лечение');
      assert.equal(await p.locator('.course-card').count(),0);await gotoVisit(childId,initial);
      assert.match(await dialog().locator('#visit-meds').innerText(),/21 апрел/);
      return 'Два врача в одном эпизоде. Альфа отменён на контроле, Бета продолжен и завершён 21 апреля. В сводке три бланка, обследование и вопрос.';
    });
    await step('Экспорт семейной копии',async()=>{
      await goSection(childId,'settings');await act('archive',p.locator('main'));await act('exportBackup');key=await field('key').inputValue();
      await dialog().locator('[type=checkbox]').check();await submit('Подготовить файл');copy=await download(dialog().getByRole('link',{name:'Скачать зашифрованный файл'}));
      assert.equal(copy.subarray(0,4).toString(),'HS01');assert(!copy.includes(Buffer.from(noteText)));
      return 'Скопирован зашифрованный архив, ключ остался в памяти тестового процесса.';
    });
    await step('Детское устройство',async()=>{
      const recipient=await newPage(secondary);await pairDevice(master,recipient,childId);
      await p.locator('header [data-action=family]').click();assert.deepEqual(await dialog().locator('.person-row strong').allTextContents(),[child]);await act('close');
      await gotoVisit(childId,initial);await dialog().getByText(noteText,{exact:true}).waitFor();assert.equal(await dialog().locator('[data-action=addNote],[data-action=period]').count(),0);
      await goSection(adultId,'exams');await p.getByRole('heading',{name:child,exact:true}).waitFor();assert.equal(await p.locator('main [data-action=newExam]').count(),0);
      await recipient.context().close();p=master;
      return 'Чистое устройство получило один профиль и общую пометку; добавление пометки, изменение дат и добавление обследования недоступны.';
    });
    await step('Устройство взрослого',async()=>{
      const recipient=await newPage(secondary);await pairDevice(master,recipient,adultId);
      await p.locator('header [data-action=family]').click();assert.deepEqual((await dialog().locator('.person-row strong').allTextContents()).sort(),[adult,child].sort());
      await dialog().locator('.person-row').filter({hasText:child}).click();
      await gotoVisit(childId,initial);await act('addNote');await field('note').fill('Учебная пометка взрослого.');await submit('Сохранить пометку');
      await dialog().getByText('Учебная пометка взрослого.',{exact:true}).waitFor();
      await recipient.context().close();p=master;
      return 'Взрослый видит себя и ребёнка. Профиль администратора скрыт, в детскую карту можно добавить пометку.';
    });
    await step('Восстановление в чистом браузере другого движка',async()=>{
      p=await newPage(secondary);await go('?section=settings');await act('archive',p.locator('main'));await act('importBackup');
      await field('archive').setInputFiles({name:'family.health',mimeType:'application/octet-stream',buffer:copy});
      await field('key').fill(key);await submit('Проверить копию');const summary=await dialog().getByText(/Копия проверена/).innerText();
      assert.match(summary,/Профилей: 3/);assert.match(summary,/Оригиналов: 6/);await field('replace').check();await readyAfter(()=>submit('Восстановить'));
      for(const [member,files] of [[child,documents.concat(examOriginals)],[adult,[visitPdf]]]){
        const id=await chooseFamily(member);await goSection(id,'files');
        for(const file of files){
          const filename=path.basename(file);const listing=p.locator('#listing [data-action=file]').filter({hasText:filename});assert.equal(await listing.count(),1);await listing.click();
          const bytes=await download(dialog().getByRole('link',{name:'Скачать оригинал'}));assert.equal(hash(bytes),hash(await fs.readFile(file)));
          evidence.verifiedOriginals.push({file:filename,bytes:bytes.length,sha256:hash(bytes)});await act('close');
        }
      }
      await gotoVisit(childId,initial);await dialog().getByText(noteText,{exact:true}).waitFor();await act('episode');await act('brief');await dialog().getByText(question,{exact:true}).waitFor();
      assert.equal(await dialog().locator('[data-action=exam]').count(),1);assert.equal(await dialog().locator('[data-action=lab]').count(),3);
      await go('?profile='+childId);assert.equal(await p.locator('.course-card').count(),0);
      await act('medical',p.locator('main'));await dialog().getByText('Учебная аллергия на Макет-QA',{exact:true}).waitFor();
      await dialog().getByRole('button',{name:/Учебная прививка/}).waitFor();
      await goSection(childId,'consults');await act('consultRecord',p.locator('main'));assert.match(await dialog().innerText(),/Учебный ответ для проверки сохранения истории/);
      await gotoVisit(adultId,adultVisit);assert.match(await dialog().innerText(),/Клеверин/);assert.doesNotMatch(await dialog().innerText(),/Препарат Альфа/);
      return 'Три профиля и шесть оригиналов восстановлены. Бинарное содержимое сверено SHA-256 через штатное скачивание. Сохранены авторская пометка, вопрос и визиты.';
    });
    await step('Подключение устройств после восстановления',async()=>{
      const restoredAdmin=p;
      for(const [member,expected] of [[childId,[child]],[adultId,[adult,child]]]){
        const recipient=await newPage(primary);
        try {
          await pairDevice(restoredAdmin,recipient,member);
          await p.locator('header [data-action=family]').click();
          assert.deepEqual((await dialog().locator('.person-row strong').allTextContents()).sort(),expected.sort());
          await act('close');
          await gotoVisit(childId,initial);
          await dialog().getByText(noteText,{exact:true}).waitFor();
          assert.equal(await dialog().locator('[data-action=addNote]').count(),member===childId?0:1);
          if(member===childId){
            await goSection(childId,'files');
            const original=examOriginals[1],filename=path.basename(original);
            const entry=p.locator('#listing [data-action=file]').filter({hasText:filename});
            await entry.click();
            const bytes=await download(dialog().getByRole('link',{name:'Скачать оригинал'}));
            assert.equal(hash(bytes),hash(await fs.readFile(original)));
          }
        }finally{await recipient.context().close();p=restoredAdmin}
      }
      return 'Новые устройства взрослого и ребёнка подключены из восстановленного архива. Проверены права и SHA-256 снимка на детском устройстве.';
    });
    assert.deepEqual(evidence.jsErrors,[]);assert.deepEqual(evidence.externalRequests,[]);
  }catch(err){
    evidence.stages.push({name:stage,status:'FAIL',details:err.message});
    console.error('FAIL',stage,err.message,await dialog().locator('#panel-title').innerText({timeout:700}).catch(()=>''),await dialog().locator('p.error').allTextContents());process.exitCode=1;
  }finally{
    if(process.argv.includes('--record'))await fs.writeFile(path.join(corpus,'family-scenario',mobile?'webkit.json':'chrome.json'),JSON.stringify(evidence,null,2)+'\n');
    await Promise.all([desktop.close(),iphone.close()]);
  }
})().catch(err=>{console.error(err);process.exitCode=1});
