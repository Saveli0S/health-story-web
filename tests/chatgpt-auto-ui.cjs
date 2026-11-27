// Synthetic provider on loopback. No prompt leaves the test browser.
const assert=require('node:assert/strict');
const {chromium,webkit,devices}=require('playwright-core');
const mobile=process.argv.includes('--iphone');
(async()=>{
  const browser=mobile?await webkit.launch():await chromium.launch({channel:'chrome'});
  const base=process.env.HEALTH_PREVIEW_URL||'http://127.0.0.1:8764/';
  try{
    const page=await browser.newPage({...mobile?devices['iPhone 13']:{},serviceWorkers:'block'});
    const sent=[];
    await page.route('**/chatgpt/status',route=>route.fulfill({json:{connected:true,account:'synthetic'}}));
    await page.route('**/chatgpt/send',route=>{
      sent.push(route.request().postDataJSON().messages);
      return route.fulfill({json:{model:'synthetic',answer:'Учебный ответ'}});
    });
    const panel=page.locator('dialog[open]');
    async function visit(){
      await page.goto(base+'?visit=a1');await page.waitForFunction(()=>typeof chatGPT!=='undefined'&&chatGPT.connected);
      await panel.locator('[data-action=analyze]').click();
    }
    async function settings(){
      await page.goto(base+'?section=settings');
      await page.locator('#chatgpt-auto').waitFor();
    }
    await settings();
    await page.locator('#direct-auto').check(); // Existing OpenRouter grant.
    assert.equal(await page.locator('#chatgpt-auto').isChecked(),false);
    await visit();
    await panel.locator('#direct-treatment').waitFor();assert.equal(sent.length,0);
    await settings();await page.locator('#chatgpt-auto').check();
    await visit();await panel.getByText(/Отправлено автоматически/).waitFor();
    assert.equal(sent.length,1);
    const review=await page.evaluate(()=>current().reviews.at(-1));
    assert.equal(sent[0][0].content,review.prompt);
    assert.equal(review.transfers.at(-1).automatic,true);
    assert.equal(review.provider,'ChatGPT · synthetic');
    await settings();
    await page.locator('main [data-action=providers]').click();
    await panel.getByLabel('Провайдер по умолчанию',{exact:true}).selectOption('deepseek');
    await visit();await panel.locator('#direct-treatment').waitFor();assert.equal(sent.length,1);
    await settings();await page.locator('#chatgpt-auto').uncheck();
    await page.locator('main [data-action=providers]').click();
    await panel.getByLabel('Провайдер по умолчанию',{exact:true}).selectOption('');
    await visit();await panel.locator('#direct-treatment').waitFor();assert.equal(sent.length,1);
    console.log('PASS',mobile?'WebKit':'Chrome','legacy opt-in isolated, ChatGPT opt-in persisted, exact prompt sent once, author and automatic transfer recorded, revocation restored preview');
  }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
