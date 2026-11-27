// Synthetic responses for both external services. No patient data or provider credentials are used.
const {chromium,webkit,devices}=require('playwright-core');
const assert=require('node:assert/strict');
const mobile=process.argv.includes('--iphone');
const base=new URL(process.env.HEALTH_PREVIEW_URL||'http://127.0.0.1:8764/');
(async()=>{
  const browser=mobile?await webkit.launch():await chromium.launch({channel:'chrome'});
  const ctx=await browser.newContext({...mobile?devices['iPhone 13']:{viewport:{width:1390,height:935}},locale:'ru',serviceWorkers:'block'});
  const page=await ctx.newPage();page.setDefaultTimeout(8000);page.setDefaultNavigationTimeout(60000);
  const d=page.locator('dialog'),click=k=>d.locator('[data-action="'+k+'"]').first().click();
  let stage='init',rejectNext=true,failPersistence=true,unavailable=false,citySearch=0;
  const sent=[],foreign=[],queries=[],errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  const row={название:'Тестин',дозировка:'5 мг',категория:'Рекомендуемое',обоснование:'Пример для теста.',источник:'https://example.org/clinical/3',разделИсточника:'Раздел 3',заболевание:'Синтетический эпизод',возрастнаяГруппа:'взрослые'};
  await ctx.route(/^https?:/,async route=>{
    const u=new URL(route.request().url());
    if(u.origin===base.origin)return route.continue();
    if(u.href==='https://health-story-chatgpt.xzx89s.workers.dev/chatgpt/status' && route.request().method()==='GET' && !route.request().headers().authorization)
      return route.fulfill({json:{available:false,connected:false,planOnly:false}});
    if(u.pathname==='/api/v1/chat/completions'&&u.hostname==='openrouter.ai'){
      const body=route.request().postDataJSON();assert.equal(body.model,'openrouter/free');
      assert.equal(body.provider.data_collection,'deny');sent.push(body.messages[0].content);
      if(rejectNext){rejectNext=false;return route.fulfill({status:429,body:''})}
      if(failPersistence){failPersistence=false;await page.evaluate(()=>{
        window.restoreStorage=Storage.prototype.setItem;
        Storage.prototype.setItem=function(){throw Error('fixture quota')};
      })}
      return route.fulfill({json:{model:'example/free',choices:[{message:{content:JSON.stringify({препараты:[row]})}}]}});
    }
    if(u.pathname==='/pharmacy/search'){
      const q=route.request().postDataJSON();queries.push(q);
      if(unavailable)return route.fulfill({status:503,body:''});
      const offer={id:'1',name:'Тестин',substance:'Тестат',manufacturer:'Учебный А',form:'таблетки пероральные обычного высвобождения 5 мг N20',pharmacyCount:3,min:4,max:6};
      const list=[offer,{...offer,id:'2',name:'Тестин Б',manufacturer:'Учебный Б',min:2,max:3},
        {...offer,id:'3',form:offer.form.replace('5 мг','50 мг'),min:101,max:120},
        {...offer,id:'4',form:offer.form.replace('обычного','пролонгированного'),min:150,max:170},
        {...offer,id:'5',form:'таблетки 5мг N20',min:300,max:301},
        {...offer,id:'6',form:offer.form.replace('N20','N40'),min:9,max:10}];
      const inCity=citySearch===1?[{...offer,min:8,max:10},{...offer,id:'7',name:'Тестин В',min:7,max:8}]:
        citySearch===2?[{...offer,min:11,max:13}]:[];
      return route.fulfill({json:{packages:q.region==='0'?list:inCity,region:q.region,checked:new Date().toISOString()}});
    }
    foreign.push(u.origin);return route.abort();
  });
  try{
    await page.goto(base.href);await page.locator('main h1').waitFor();
    await page.evaluate(()=>{
      const v=['qa-rx','2026-09-10','Учебная запись','orlova','Синтетический эпизод',
        'Клиника «Ясень». Документ Форма[Q].pdf. Карта QA-444. Тестовый контекст.','scope','ep-a1',
        [{id:'qa-med',name:'Тестин',form:'таблетки',strength:'5 мг',instructions:'По схеме',period:emptyPeriod()}]];
      current().addedVisits.push(v);person.visits.push(v);
      current().recommendations.push({id:'qa-rec',visit:'qa-rx',text:'Рекомендации по лечению: Тестин 5 мг N20'});
      current().files.push({id:'qa-meta',name:'Форма[Q].pdf',visit:'a3',category:'Другое'});
      saveState();routerKey='synthetic-not-a-key';go('visit','qa-rx');
    });
    stage='treatment';
    await click('analyze');
    const form=d.locator('#direct-treatment'),prompt=await form.locator('[name=prompt]').inputValue();
    assert.doesNotMatch(prompt,/Ясень|Форма\[Q\]|QA-444/);assert.match(prompt,/Тестовый контекст/);
    await form.locator('button.primary').click();await form.getByText(/Квота исчерпана/).waitFor();
    await form.locator('button.primary').click();await form.getByText(/Освободите место/).waitFor();
    assert.equal(await page.evaluate(()=>current().reviews.filter(r=>r.visit==='qa-rx').length),0);
    await page.evaluate(()=>{Storage.prototype.setItem=window.restoreStorage});
    await form.getByRole('button',{name:'Сохранить полученный ответ'}).click();
    await d.getByText('Недостаточно данных для оценки',{exact:true}).waitFor();
    assert.deepEqual(sent,[prompt,prompt]);
    await d.getByText('Сверить применимость источника',{exact:true}).click();
    await d.locator('.evidence-check [type=checkbox]').check();
    await d.getByRole('button',{name:'Сохранить сверку'}).click();
    await d.locator('.rating').filter({hasText:'Рекомендуемое'}).waitFor();
    const saved=await page.evaluate(()=>current().reviews.filter(r=>r.visit==='qa-rx'));
    assert.equal(saved.length,1);assert.equal(saved[0].prompt,prompt);assert.equal(saved[0].sourceChecks.length,1);
    stage='catalog';
    await page.goto(new URL('?visit=qa-rx',base).href);await click('analogs');
    await d.getByText('Уточнить данные для поиска',{exact:true}).click();
    const criteria=d.locator('#market-criteria');
    assert.equal(await criteria.locator('[name=trade]').inputValue(),'Тестин');
    assert.equal(await criteria.locator('[name=pack]').inputValue(),'№20');
    assert.equal(await criteria.locator('[name=strength]').inputValue(),'5 мг');
    assert.equal(queries.length,0);
    await d.getByRole('button',{name:'Найти аналоги и цены'}).click();
    await d.getByText('В выбранном регионе подтверждённых предложений нет.').waitFor();
    await d.getByRole('button',{name:'Искать по всей Беларуси'}).click();
    await d.getByText(/МНН заполнено по каталогу\. Поиск сохранён/).waitFor();
    assert.equal(await criteria.locator('[name=substance]').inputValue(),'Тестат');
    const market=d.locator('#live-market');
    assert.equal(await d.locator('#market-substance').innerText(),'Действующее вещество · Тестат');
    await market.getByText('Сохранённые результаты · 6').waitFor();
    // Older archives store packages directly in the previous search snapshot.
    await page.evaluate(()=>{
      const data=readJson(stateKey),profile=data.profiles[person.id],settings=profile.marketCriteria[0];
      const search=JSON.parse(settings.lastSearch);
      search.packages=profile.marketFindings.map(row=>JSON.parse(row.observation));
      delete search.packageCount;
      settings.lastSearch=JSON.stringify(search);
      delete profile.marketFindings;
      localStorage.setItem(stateKey,JSON.stringify(data));
    });
    await page.reload();await click('analogs');
    await market.getByText('Сохранённые результаты · 6').waitFor();
    await d.getByText('Уточнить данные для поиска',{exact:true}).click();
    for(const [name,value] of Object.entries({substance:'Тестат',pack:'№20',route:'Пероральный',release:'Обычное',alternative:'Архивин'}))
      await criteria.locator('[name="'+name+'"]').fill(value);
    await criteria.getByRole('button',{name:'Сохранить данные поиска'}).click();
    await d.getByText('Отдельный вариант от врача').waitFor();
    const alternative=new URL(await d.getByRole('link',{name:'Искать вариант врача'}).getAttribute('href'));
    assert.equal(alternative.searchParams.get('request'),'Архивин');
    stage='repeat';
    citySearch=1;await d.getByRole('button',{name:'Повторить поиск'}).click();
    await market.getByText('Сохранённые результаты · 7').waitFor();
    await market.getByText('Назначенная упаковка · 1',{exact:true}).waitFor();
    assert.match(await market.innerText(),/Совпадают состав и характеристики · 2/);
    assert.match(await market.innerText(),/Другие упаковки этого препарата · 1/);
    assert.doesNotMatch(await market.textContent(),/101.00|150.00|300.00/);
    const packageRow=market.locator('[data-package-id="1"]');
    assert.equal(await packageRow.count(),1);
    assert.equal(await packageRow.locator('.market-substance').innerText(),'Действующее вещество · Тестат');
    assert.match(await packageRow.innerText(),/4.00 – 6.00 BYN · Вся Беларусь/);
    assert.match(await packageRow.innerText(),/8.00 – 10.00 BYN · Минск/);
    citySearch=2;await d.getByRole('button',{name:'Повторить поиск'}).click();
    await packageRow.getByText(/11.00 – 13.00 BYN · Минск/).waitFor();
    assert.equal(await packageRow.locator('.market-price').count(),2);
    assert.doesNotMatch(await packageRow.innerText(),/8.00 – 10.00 BYN/);
    assert.equal(await market.locator('[data-package-id="7"]').count(),1);
    citySearch=0;await d.getByRole('button',{name:'Повторить поиск'}).click();
    await market.getByText('В выбранном регионе подтверждённых предложений нет.').waitFor();
    await market.getByText('Сохранённые результаты · 7').waitFor();
    await market.locator('details > summary').filter({hasText:'Требуют сверки'}).click();
    const inspected=market.locator('[data-package-id="5"]');
    const priceBounds=row=>row.locator('.market-prices').evaluate(el=>{
      const {x,width}=el.getBoundingClientRect();
      return {x,width};
    });
    const column=await priceBounds(packageRow);
    assert.deepEqual(await priceBounds(inspected),column);
    await inspected.getByRole('button',{name:'Посмотреть цену этой упаковки'}).click();
    assert.deepEqual(await priceBounds(inspected),column);
    for(const row of [packageRow,inspected]){
      const aligned=await row.locator('.market-price .external').evaluateAll((links,{x,width})=>links.length>0&&links.every(link=>{
        const {left,right}=link.getBoundingClientRect();
        return Math.abs(left-x)<1&&right<=x+width+1;
      }),column);
      assert.ok(aligned,'Availability links should align with the price column');
    }
    assert.match(await market.innerText(),/Выбранная упаковка каталога\s+300.00 – 301.00 BYN/);
    assert(queries.every(q=>Object.keys(q).sort().join(',')==='name,region'&&['Тестин','Тестат'].includes(q.name)));
    stage='reopen';
    const requestCount=queries.length;
    await page.reload();await click('analogs');await d.getByText('Отдельный вариант от врача').waitFor();
    await market.getByText('Назначенная упаковка · 1',{exact:true}).waitFor();
    await packageRow.getByText(/4.00 – 6.00 BYN · Вся Беларусь/).waitFor();
    await packageRow.getByText(/11.00 – 13.00 BYN · Минск/).waitFor();
    await market.getByText('Сохранённые результаты · 7').waitFor();
    assert.equal(queries.length,requestCount);
    unavailable=true;await d.getByRole('button',{name:'Повторить поиск'}).click();
    await d.getByText(/Сейчас получить цены из каталога не удалось/).waitFor();
    await market.getByText('Назначенная упаковка · 1',{exact:true}).waitFor();
    await market.getByText('Сохранённые результаты · 7').waitFor();
    assert.equal(await d.getByRole('link',{name:/Искать на tabletka.by/}).count(),1);
    assert.deepEqual(errors,[]);assert.deepEqual(foreign,[]);
    console.log('PASS',mobile?'iPhone WebKit':'Chrome','source verification, strict analogue and stock, active ingredient, saved results from older archives, cumulative repeat search, unique packages with regional prices, preserved results on empty/error and reload.');
  }catch(e){console.error(stage,e.message,await d.innerText().catch(()=>''));process.exitCode=1}finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
