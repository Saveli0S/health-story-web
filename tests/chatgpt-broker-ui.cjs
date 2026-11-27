const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {chromium,webkit,devices}=require('playwright-core');

(async()=>{
  const mobile=process.argv.includes('--iphone');
  const browser=mobile?await webkit.launch():await chromium.launch({channel:'chrome'});
  try {
    const page=await browser.newPage({...mobile?devices['iPhone 13']:{},serviceWorkers:'block'});
    const origin='https://saveli0s.github.io', root=origin+'/health-story-web/';
    const gateway='https://health-story-chatgpt.xzx89s.workers.dev/chatgpt/';
    const local='http://127.0.0.1:8764/';
    const ticket='t'.repeat(43),session='s'.repeat(43);
    const cors={'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Allow-Methods':'GET, POST, OPTIONS'};
    let enabled=false, challenge, connected=false, sent=0;
    await page.route(root+'**',async route=>{
      const url=new URL(route.request().url());
      await route.fulfill({response:await route.fetch({url:local+url.href.slice(root.length)})});
    });
    await page.route(gateway+'**',async route=>{
      const req=route.request();
      if(req.method()==='OPTIONS')return route.fulfill({status:204,headers:cors});
      assert.equal(req.headers().origin,origin);
      const action=req.url().slice(gateway.length);
      const respond=(json,status=200)=>route.fulfill({json,status,headers:cors});
      if(action==='status')return respond({available:enabled,connected,planOnly:connected,account:'qa'});
      assert(enabled);
      if(action==='connect'){
        challenge=req.postDataJSON().challenge;
        assert.match(challenge,/^[A-Za-z0-9_-]{43}$/);
        return respond({url:'https://auth.openai.com/api/accounts/authorize?synthetic=1'});
      }
      if(action==='redeem'){
        assert.equal(req.postDataJSON().ticket,ticket);
        assert.equal(createHash('sha256').update(req.postDataJSON().verifier).digest('base64url'),challenge);
        connected=true;
        return respond({session,planOnly:true});
      }
      assert.equal(req.headers().authorization,'Bearer '+session);
      if(action==='send'){
        const messages=req.postDataJSON().messages;
        assert.deepEqual(Object.keys(req.postDataJSON()),['messages']);
        assert.equal(messages.length,++sent===1?1:3);
        if(sent===2) assert.deepEqual(messages.slice(1),[{role:'assistant',content:'готово'},{role:'user',content:'Какое слово было в ответе?'}]);
        return respond({answer:sent===1?'готово':'Учебное продолжение',model:'synthetic'});
      }
      if(action==='disconnect'){connected=false;return respond({revoked:true})}
      throw Error('Unexpected gateway action '+action);
    });
    await page.route('https://auth.openai.com/api/accounts/authorize?synthetic=1',route=>
      route.fulfill({contentType:'text/html',body:'<script>location.replace('+JSON.stringify(root+'?section=consults#chatgpt=connected&ticket='+ticket)+')</script>'}));

    const dialog=page.locator('dialog[open]');
    await page.goto(root+'?connect=chatgpt');
    await dialog.getByText(/ожидает допуска OpenAI/).waitFor();
    assert.equal(await dialog.getByRole('button',{name:'Продолжить с ChatGPT'}).count(),0);
    enabled=true;
    await page.reload();
    await dialog.getByRole('button',{name:'Продолжить с ChatGPT'}).click();
    await dialog.getByText('Подключён аккаунт qa',{exact:true}).waitFor();
    assert.equal(new URL(page.url()).hash,'');
    assert.deepEqual(await page.evaluate(()=>[sessionStorage.getItem('health-story.chatgpt.signin'),
      [sessionStorage,localStorage].some(s=>Object.values(s).includes('s'.repeat(43)))]),[null,false]);
    await dialog.locator('[data-action=close]').click();
    await page.getByRole('button',{name:'Новая консультация'}).click();
    await dialog.locator('#consult-form [name=question]').fill('Ответь одним словом: готово');
    await dialog.locator('#consult-form button.primary').last().click();
    await dialog.getByRole('button',{name:'Подтвердить и отправить в ChatGPT'}).click();
    await dialog.getByText('готово',{exact:true}).first().waitFor();
    const followup=dialog.locator('#chatgpt-followup');
    await followup.locator('textarea').fill('Какое слово было в ответе?');
    await followup.getByRole('button',{name:'Подтвердить и отправить в ChatGPT'}).click();
    await dialog.getByText('Учебное продолжение',{exact:true}).first().waitFor();
    await dialog.locator('[data-action=close]').click();
    await page.getByRole('button',{name:'Управлять подключением'}).click();
    await dialog.getByRole('button',{name:'Отключить аккаунт'}).click();
    await dialog.getByRole('button',{name:'Продолжить с ChatGPT'}).waitFor();
    assert.equal(sent,2);
    console.log('PASS',mobile?'mobile WebKit':'desktop Chrome','published origin, consent redirect, one-time return, session only in memory, conversation, disconnect');
  } finally {await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
