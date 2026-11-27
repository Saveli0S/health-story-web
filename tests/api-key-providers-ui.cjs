// Synthetic credentials and records. Provider calls are intercepted.
const assert=require('node:assert/strict');
const {chromium,webkit,devices}=require('playwright-core');

(async()=>{
  const mobile=process.argv.includes('--iphone');
  const browser=mobile?await webkit.launch():await chromium.launch({channel:'chrome'});
  const page=await browser.newPage({...(mobile?devices['iPhone 13']:{}),serviceWorkers:'block'});
  const base=process.env.HEALTH_PREVIEW_URL||'http://127.0.0.1:8764/';
  const panel=page.locator('dialog');
  const action=(root,name)=>root.locator('[data-action="'+name+'"]').first().click();
  const settings=async()=>{
    await page.locator('[data-action=section][data-id=settings]').click();
    await action(page.locator('main'),'providers');
  };
  const keys={deepseek:'synthetic-deepseek-key',anthropic:'synthetic-anthropic-key'};
  const models={deepseek:'deepseek-flash',anthropic:'claude-haiku-5-5'};
  const calls=[], checks=[], failures=[];
  page.on('pageerror',error=>failures.push(error.message));
  page.setDefaultTimeout(8000);
  try{
    await page.route('**/chatgpt/status',route=>route.fulfill({json:{available:false,connected:false,planOnly:false}}));
    await page.route(/^https:\/\/api\.(deepseek|anthropic)\.com\//,async route=>{
      const request=route.request(),url=new URL(request.url()),headers=request.headers();
      const id=url.hostname.split('.')[1];
      const credential=id==='anthropic'?headers['x-api-key']:headers.authorization?.split(' ')[1];
      if(url.pathname.endsWith('/models')){
        assert.equal(request.method(),'GET');
        checks.push(id);
        return route.fulfill(credential===keys[id]?{json:{data:[{id:models[id]}]}}:{status:401});
      }
      assert.equal(credential,keys[id]);
      assert.equal(headers.cookie,undefined);
      if(id==='anthropic'){
        assert.equal(headers['anthropic-version'],'2026-10-21');
        assert.equal(headers['anthropic-dangerous-direct-browser-access'],'true');
      }
      const body=request.postDataJSON();
      assert.equal(body.model,models[id]);
      assert.equal(body.max_tokens,4096);
      assert.doesNotMatch(JSON.stringify(body),/synthetic-.*-key|9876543|qa@example.org/);
      calls.push({id,messages:body.messages});
      if(calls.length===2)return route.fulfill({status:429});
      const answer=calls.length===1?'Да':'Учебный ответ '+calls.length;
      return route.fulfill({json:id==='anthropic'
        ?{model:models[id],content:[{type:'thinking',thinking:'Не для истории'},{type:'text',text:answer}]}
        :{model:models[id],choices:[{message:{content:answer}}]}});
    });
    await page.goto(base+'?space=demo&section=settings');
    await action(page.locator('main'),'providers');
    const connect=async(id,key)=>{
      const form=panel.locator('#provider-key-'+id);
      await form.locator('input[type=password]').fill(key);
      await form.getByRole('button').click();
    };
    await connect('anthropic','invalid-fixture-key');
    await panel.getByText(/Ключ не принят/).waitFor();
    await connect('anthropic',keys.anthropic);
    await panel.getByRole('button',{name:'Отключить Claude (Anthropic)'}).waitFor();
    await connect('deepseek',keys.deepseek);
    await panel.getByRole('button',{name:'Отключить DeepSeek'}).waitFor();
    assert.deepEqual(checks,['anthropic','anthropic','deepseek']);
    assert.deepEqual(calls,[]);
    const defaultProvider=panel.getByLabel('Провайдер по умолчанию',{exact:true});
    await defaultProvider.selectOption('anthropic');
    await panel.getByText('Выбор сохранён.',{exact:true}).waitFor();
    await action(panel,'close');

    await page.locator('[data-action=section][data-id=consults]').click();
    await action(page.locator('main'),'consult');
    await panel.locator('[name=question]').fill('Это учебный вопрос.');
    await panel.getByText('Проверить запрос',{exact:true}).click();
    const recipient=panel.getByLabel('Провайдер',{exact:true});
    assert.equal(await recipient.inputValue(),'anthropic');
    await recipient.selectOption('deepseek');
    const prompt=panel.locator('#consult-answer [name=prompt]');
    await prompt.fill('Это учебный вопрос. Почта qa@example.org.');
    await action(panel,'askProvider');
    await panel.getByText(/Личные сведения скрыты/).waitFor();
    assert.deepEqual(calls,[]);
    await action(panel,'askProvider');
    await panel.getByText('Да',{exact:true}).waitFor();
    await panel.getByRole('heading',{name:'Ответ · DeepSeek · deepseek-flash',exact:true}).waitFor();
    const follow=panel.locator('#chatgpt-followup');
    assert.equal(await follow.getByLabel('Провайдер',{exact:true}).inputValue(),'deepseek');
    await follow.getByLabel('Следующий вопрос').fill('Продолжи учебную переписку.');
    await follow.getByLabel('Следующий вопрос').press('Tab');
    await follow.getByLabel('Провайдер',{exact:true}).selectOption('anthropic');
    assert.equal(await page.evaluate(()=>current().consultations.at(-1).nextQuestion),'Продолжи учебную переписку.');
    await follow.locator('button.primary').click();
    await follow.getByText(/Лимит API исчерпан/).waitFor();
    assert.equal(await follow.getByLabel('Следующий вопрос').inputValue(),'Продолжи учебную переписку.');
    await follow.locator('button.primary').click();
    await panel.getByText('Учебный ответ 3',{exact:true}).waitFor();
    assert.deepEqual(calls.map(c=>c.id),['deepseek','anthropic','anthropic']);
    assert.deepEqual(calls[2].messages.map(m=>m.role),['user','assistant','user']);
    assert.deepEqual(calls[2].messages[1],{role:'assistant',content:'Да'});
    assert.doesNotMatch(await panel.innerText(),/Не для истории/);
    await action(panel,'close');

    await settings();
    await action(panel,'close');
    await page.locator('#direct-auto').check();
    await page.locator('[data-action=section][data-id=overview]').click();
    await page.locator('.overview-visits [data-id=a1]').click();
    await action(panel,'analyze');
    await panel.locator('#direct-treatment').waitFor();
    assert.equal(calls.length,3);
    assert.equal(await recipient.inputValue(),'anthropic');
    await panel.getByRole('button',{name:'Подтвердить и отправить',exact:true}).click();
    await panel.getByText('Учебный ответ 4',{exact:true}).waitFor();
    assert.equal(calls[3].id,'anthropic');
    assert.match(calls[3].messages[0].content,/Мометазон/);
    assert.equal(await page.evaluate(()=>current().reviews.at(-1).provider),'Claude (Anthropic) · claude-haiku-5-5');
    const snapshots=await page.evaluate(()=>JSON.stringify([prototypeState,localStorage,sessionStorage]));
    assert.doesNotMatch(snapshots,/synthetic-.*-key/);
    await action(panel,'close');
    await settings();
    await panel.getByRole('button',{name:'Отключить DeepSeek'}).click();
    await panel.getByLabel('API-ключ DeepSeek').waitFor();
    await page.reload();
    await action(page.locator('main'),'providers');
    assert.equal(await defaultProvider.inputValue(),'anthropic');
    await panel.getByLabel('API-ключ Claude (Anthropic)').waitFor();
    assert.deepEqual(failures,[]);
    console.log('PASS '+(mobile?'mobile WebKit':'Chrome')+' API keys, persisted provider default, redaction, assistant message, quota, treatment and tab-only credentials');
  }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
