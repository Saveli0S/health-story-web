const assert=require('node:assert/strict');
const {chromium,webkit,devices}=require('playwright-core');
const personal=process.argv.includes('--chatgpt');
const mobile=process.argv.includes('--iphone');
const base=process.env.HEALTH_PREVIEW_URL||'http://127.0.0.1:8764/';
(async()=>{
  const browser=mobile?await webkit.launch():await chromium.launch({channel:'chrome'});
  try{
    const p=await browser.newPage({...mobile?devices['iPhone 13']:{},serviceWorkers:'block'});
    const d=p.locator('dialog[open]');
    const calls=[];
    await p.route('https://openrouter.ai/api/v1/chat/completions',async route=>{
      calls.push(route.request().postDataJSON());
      await route.fulfill({json:{model:'synthetic',choices:[{message:{content:'Синтетический ответ'}}]}});
    });
    if(personal){
      await p.route('**/chatgpt/status',route=>route.fulfill({json:{connected:true,account:'synthetic'}}));
      await p.route('**/chatgpt/send',route=>{
        calls.push(route.request().postDataJSON());
        return route.fulfill({json:{model:'synthetic',answer:'Синтетический ответ'}});
      });
    }
    async function connect(){
      if(personal)await p.waitForFunction(()=>chatGPT.connected);
      else await p.evaluate(()=>routerKey='synthetic-free-test');
    }
    await p.goto(base+'?new=family');await d.locator('[name=familyName]').fill('Учебная семья');await d.locator('[name=memberName]').fill('Первый взрослый');
    await Promise.all([p.waitForEvent('load'),d.locator('#family-form button.primary').click()]);
    await p.locator('header [data-action=family]').click();await d.locator('[data-action=newMember]').click();
    await d.locator('[name=memberName]').fill('Второй взрослый');await d.locator('[name=role]').selectOption('Взрослый');
    await Promise.all([p.waitForEvent('load'),d.locator('#family-form button.primary').click()]);
    await p.locator('main h1').waitFor();
    const member=await p.evaluate(()=>{
      const profile=current();
      profile.directAuto=true;profile.chatGPTAuto=true;
      const ep={id:'ep-test',name:'Учебный эпизод'},visit=['vt','2026-11-12','Визит','dr',ep.name,'Тест','scope',ep.id,[{id:'m',name:'Учебное лекарство',strength:'2 мг',instructions:'Тест',period:{start:'2026-11-12',closed:false}}]];
      profile.episodes.push(ep);profile.addedDoctors.push({id:'dr',values:['Тест','Терапевт','']});
      profile.addedVisits.push(visit);saveState();return person.id;
    });
    await p.goto(base+'?profile='+member+'&visit=vt');await d.locator('[data-action=analyze]').waitFor();
    await connect();
    await d.locator('[data-action=analyze]').click();await d.getByText(/Разовая передача из профиля/).waitFor();
    assert.equal(calls.length,0);
    await d.locator('#direct-treatment button.primary').click();await d.getByText('Синтетический ответ',{exact:true}).waitFor();
    assert.equal(calls.length,1);assert(!JSON.stringify(calls[0]).includes('Первый взрослый'));
    await d.getByText(/Отправлено провайдеру · Первый взрослый \(администратор\)/).waitFor();
    const record=await p.evaluate(()=>current().reviews.at(-1).transfers[0]);
    assert(!record.automatic);assert.equal(record.role,'admin');assert(record.actorId!==member);assert(Number.isFinite(Date.parse(record.time)));
    await p.reload();await d.locator('[data-action=analyze]').waitFor();await connect();
    await d.locator('[data-action=analyze]').click();await d.getByText(/Разовая передача/).waitFor();
    assert.equal(calls.length,1);assert.equal(await p.evaluate(()=>current().directAuto),true);
    console.log('PASS '+(mobile?'WebKit':'Chrome')+' '+(personal?'ChatGPT':'OpenRouter')+' one explicit admin send for another adult with identity, timestamp and exact outbound payload');
  }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
