const assert=require('node:assert/strict');
const {chromium,webkit,devices}=require('playwright-core');
(async()=>{
  const mobile=process.argv.includes('--iphone');
  const hosted=process.argv.includes('--hosted');
  const browser=mobile?await webkit.launch():await chromium.launch({channel:'chrome'});
  const page=await browser.newPage({...mobile?devices['iPhone 13']:{},serviceWorkers:'block'});
  const loopback='http://127.0.0.1:8764/';
  const base=hosted?'https://health-story.test/journal/':loopback,calls=[];
  let enabled=false,planOnly=false,statusCalls=0;
  let interrupted=true;
  let releaseStatus;
  const pendingStatus=new Promise(resolve=>{releaseStatus=resolve});
  try{
    if(hosted) await page.route(base+'**',async route=>{
      const incoming=new URL(route.request().url()),path=incoming.pathname.slice('/journal/'.length);
      const response=await route.fetch({url:new URL(path+incoming.search,loopback).href});
      if(path) return route.fulfill({response});
      let body=await response.text();
      if(enabled) body=body.replace('<head>','<head><meta name="health-story-chatgpt" content="gateway-v1">');
      return route.fulfill({response,body});
    });
    await page.route(base+'chatgpt/status',async route=>{
      statusCalls++;
      if(!hosted&&statusCalls===1)await pendingStatus;
      return route.fulfill({json:{connected:true,account:'synthetic',planOnly}});
    });
    await page.route('**/chatgpt/send',async route=>{
      const data=route.request().postDataJSON();calls.push(data);
      if(calls.length===2&&interrupted){interrupted=false;return route.fulfill({status:429,json:{error:'Квота ChatGPT исчерпана.'}})}
      await route.fulfill({json:{answer:calls.length===1?(hosted?'Первый ответ example@example.org':'Первый учебный ответ'):'Второй учебный ответ',model:'synthetic'}});
    });
    if(hosted){
      await page.goto(base+'?section=consults');
      await page.locator('main').getByText(/Подключение ChatGPT на сайте пока недоступно/).waitFor();
      assert.equal(statusCalls,0);
      assert.equal(await page.evaluate(()=>chatGPT.connected),false);
      enabled=true;
      await page.goto(base+'?connect=chatgpt');
      await page.getByText(/Отправка ожидает подтверждения/).waitFor();
      assert.equal(statusCalls,1);
      assert.deepEqual(calls,[]);
      planOnly=true;
    }else{
      await page.goto(base+'?section=settings',{waitUntil:'domcontentloaded'});
      const row=page.locator('main [data-action=providers] small');
      try{await row.getByText('Проверяем подключение ChatGPT…',{exact:true}).waitFor({timeout:6000})}
      finally{releaseStatus()}
      await row.getByText('Личный ChatGPT подключён',{exact:true}).waitFor({timeout:6000});
    }
    await page.goto(base+'?new=consultation');
    const d=page.locator('dialog[open]');
    await d.locator('#consult-form [name=question]').fill('Первый учебный вопрос');
    await d.locator('#consult-form button[type=submit],#consult-form button.primary').last().click();
    await d.getByRole('button',{name:'Подтвердить и отправить в ChatGPT'}).click();
    await d.getByText(hosted?'Первый ответ example@example.org':'Первый учебный ответ',{exact:true}).first().waitFor();
    const form=d.locator('#chatgpt-followup');
    await form.locator('textarea').fill('Продолжи учебный пример');
    await form.locator('button.primary').click();await form.getByText(/Квота ChatGPT исчерпана/).waitFor();
    assert.deepEqual(calls[0].messages.map(x=>x.role),['user']);
    assert.deepEqual(calls[1].messages,[...calls[0].messages,{role:'assistant',content:hosted?'Первый ответ [почта скрыта]':'Первый учебный ответ'},{role:'user',content:'Продолжи учебный пример'}]);
    await form.locator('button.primary').click();await d.getByText('Второй учебный ответ',{exact:true}).first().waitFor();
    assert.deepEqual(calls[2],calls[1]);
    await page.goto(base+'?section=consults');
    await page.locator('main [data-action=consultRecord]').first().click();
    await d.getByText('Второй учебный ответ',{exact:true}).first().waitFor();
    const rec=await page.evaluate(()=>current().consultations.at(-1));
    assert.equal(rec.turns.length,1);assert(rec.turns[0].transfers[0].actorId);assert(rec.turns[0].transfers[0].time);
    if(hosted){
      assert.deepEqual(rec.turns[0].sentHistory,calls[2].messages.slice(0,-1));
      assert.equal(rec.answer,'Первый ответ example@example.org');
      planOnly=false;
      await page.goto(base+'?section=consults');
      await page.locator('main [data-action=consultRecord]').first().click();
      const draft=d.locator('#chatgpt-followup');
      await draft.locator('textarea').fill('Вопрос до подключения');
      await draft.getByRole('button',{name:'Сохранить черновик'}).click();
      await draft.getByText('Черновик сохранён.',{exact:true}).waitFor();
      await page.reload();
      await page.locator('main [data-action=consultRecord]').first().click();
      assert.equal(await draft.locator('textarea').inputValue(),'Вопрос до подключения');
      assert.equal(calls.length,3);
    }
    assert.deepEqual(Object.keys(calls[0]),['messages']);
    console.log('PASS',mobile?'mobile WebKit':'desktop Chrome',hosted?'hosted gateway':'local gateway','first send, follow-up with exact history, quota, retry, reload, author');
  }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
