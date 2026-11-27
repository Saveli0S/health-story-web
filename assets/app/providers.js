'use strict';

// Keys exist only in this tab's memory and are excluded from the journal and backups.
let routerKey='',pendingLogin=null,routerDelivery='';
const providerJobs=new Set();
const apiKeyProviders={
  deepseek:{name:'DeepSeek',model:'deepseek-flash',base:'https://api.deepseek.com/',path:'chat/completions'},
  anthropic:{name:'Claude (Anthropic)',model:'claude-haiku-5-5',base:'https://api.anthropic.com/v1/',path:'messages'}
};
const paidAPIHint='Запросы по API-ключу могут расходовать баланс провайдера.';
const apiCredentials=new Map();
const providerNames={chatgpt:'ChatGPT',router:'OpenRouter',...Object.fromEntries(Object.entries(apiKeyProviders).map(([id,p])=>[id,p.name]))};
const preferredProviderOptions=['chatgpt','deepseek','anthropic'];
function providerPreferenceKey(){return 'health-story.preferred-provider.'+family.id+'/'+viewerPerson.id}
function savedProviderPreference(){
  try{
    const value=localStorage.getItem(providerPreferenceKey());
    return preferredProviderOptions.includes(value)?value:'';
  }catch{return ''}
}
function saveProviderPreference(input){
  if(readOnly||input.value&&!preferredProviderOptions.includes(input.value))return;
  const status=document.querySelector('#provider-preference-status');
  try{
    if(input.value)localStorage.setItem(providerPreferenceKey(),input.value);
    else localStorage.removeItem(providerPreferenceKey());
    status.textContent='Выбор сохранён.';
  }catch{
    input.value=savedProviderPreference();
    status.textContent='Не удалось сохранить выбор в браузере.';
  }
}
function connectedProviders(){
  if(readOnly)return [];
  return [chatGPT.connected&&'chatgpt',routerKey&&'router',...Object.keys(apiKeyProviders).filter(id=>apiCredentials.has(id))].filter(Boolean);
}
function selectProvider(options,previous=''){
  const preferred=savedProviderPreference();
  return options.find(id=>(previous||'').startsWith(providerNames[id]+' · '))
    ||(options.includes(preferred)?preferred:options[0]);
}
function providerChoice(preferred=''){
  const options=connectedProviders(),selected=selectProvider(options,preferred);
  if(!selected)return '';
  const choice=options.length===1
    ?'<input type="hidden" name="provider" value="'+selected+'">'
    :'<label>Провайдер<select name="provider" aria-label="Провайдер">'+options.map(id=>'<option value="'+id+'" '+(id===selected?'selected':'')+'>'+esc(providerNames[id])+'</option>').join('')+'</select></label>';
  return choice+(options.some(id=>Object.hasOwn(apiKeyProviders,id))?'<p class="hint">'+paidAPIHint+'</p>':'');
}
function providerPreferenceSettings(){
  const selected=savedProviderPreference();
  return '<section class="plain-card"><h3>Провайдер по умолчанию</h3><label>Для новых запросов '+
    '<select id="provider-preference" aria-label="Провайдер по умолчанию"><option value="">Автоматически</option>'+
    preferredProviderOptions.map(id=>'<option value="'+id+'" '+(selected===id?'selected':'')+'>'+esc(providerNames[id])+'</option>').join('')+
    '</select></label><p class="hint">Для новых консультаций и разборов. В переписке подставляется провайдер последнего ответа, если он доступен.</p>'+
    '<p id="provider-preference-status" role="status"></p></section>';
}
function apiKeySettings(id,p){
  const connected=apiCredentials.has(id);
  return '<section class="plain-card"><h3>'+p.name+'</h3><p>Модель '+p.model+'. Ключ действует в этой вкладке до её обновления или закрытия.</p>'+
    (connected?'<p>Ключ проверен.</p>'+act('removeAPIKey','Отключить '+p.name,id,'button secondary'):
      '<form class="edit-form" id="provider-key-'+id+'" data-api-provider="'+id+'"><label>API-ключ '+p.name+
      '<input type="password" name="key" required maxlength="512" autocomplete="off" autocapitalize="none" spellcheck="false"></label>'+
      '<button class="button secondary">Проверить и подключить '+p.name+'</button><p role="status"></p></form>')+'</section>';
}
function apiFailure(status,p){
  if(status===401)return 'Ключ не принят или веб-доступ отключён у провайдера.';
  if(status===403)return 'Провайдер отклонил доступ. Проверьте права ключа и доступность API в вашем регионе.';
  if(status===402)return 'Недостаточно средств на балансе провайдера.';
  if(status===429)return 'Лимит API исчерпан. Повторите позже.';
  if(status===400||status===404)return 'Проверьте доступность модели '+p.model+' для этого API-ключа.';
  return 'API провайдера сейчас недоступен.';
}
async function callKeyAPI(id,key,messages){
  const p=apiKeyProviders[id],isClaude=id==='anthropic';
  const headers=isClaude?{'x-api-key':key,'anthropic-version':'2026-10-21','anthropic-dangerous-direct-browser-access':'true'}:{Authorization:'Bearer '+key};
  const opts={credentials:'omit',referrerPolicy:'no-referrer',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(messages?120000:15000),headers};
  if(messages){
    opts.method='POST';
    headers['Content-Type']='application/json';
    const body={model:p.model,messages,max_tokens:4096};
    if(!isClaude){body.stream=false;body.thinking={type:'disabled'}}
    opts.body=JSON.stringify(body);
  }
  let result;
  try{result=await fetch(new URL(messages?p.path:'models',p.base),opts)}
  catch{throw Error('Нет связи с '+p.name+'. Проверьте доступ к API.')}
  if(!result.ok)throw Error(apiFailure(result.status,p));
  const json=await result.json().catch(()=>null);
  if(!messages){
    if(!Array.isArray(json?.data))throw Error('Не удалось проверить ключ у провайдера.');
    if(!json.data.some(model=>model.id===p.model)&&(!isClaude||json.has_more!==true))throw Error(apiFailure(404,p));
    return;
  }
  const answer=isClaude?json?.content?.filter(b=>b.type==='text').map(b=>b.text).join('\n'):json?.choices?.[0]?.message?.content;
  if(json?.stop_reason==='max_tokens'||json?.choices?.[0]?.finish_reason==='length')throw Error('Достигнут лимит длины ответа. Сократите запрос и повторите.');
  if(typeof answer!=='string'||!answer.trim())throw Error('Провайдер вернул пустой ответ.');
  return {answer,model:typeof json.model==='string'&&json.model.trim()?json.model:p.model};
}
async function connectAPIKey(form){
  const id=form.dataset.apiProvider;
  if(readOnly||!window.isSecureContext||!Object.hasOwn(apiKeyProviders,id)||form.querySelector('button').disabled)return;
  const input=form.elements.key,key=input.value.trim(),button=form.querySelector('button'),status=form.querySelector('[role=status]');
  if(!/^[\x21-\x7e]{8,512}$/.test(key))return rejectFieldValue(input,'Введите API-ключ без пробелов.');
  input.value='';button.disabled=true;input.disabled=true;status.textContent='Проверяем ключ…';
  try{
    await callKeyAPI(id,key);
    if(!form.isConnected)return;
    apiCredentials.set(id,key);providers();render();
  }catch(error){status.textContent=error.message}
  finally{input.disabled=false;button.disabled=false}
}
function providerFacts(account,delivery){
  return '<dl class="provider-status"><dt>Вход</dt><dd>'+esc(account)+'</dd><dt>Отправка запросов</dt><dd>'+esc(delivery)+'</dd></dl>';
}
function providerStatus(){
  if(chatGPT.connected)return 'Личный ChatGPT подключён';
  if(routerKey)return 'OpenRouter подключён на эту сессию';
  if(apiCredentials.size)return [...apiCredentials.keys()].map(id=>providerNames[id]).join(', ')+' · по API-ключу';
  if(!chatGPT.endpoint||chatGPT.waitingForApproval)return 'Подключение ChatGPT на сайте пока недоступно';
  if(chatGPT.checking)return 'Проверяем подключение ChatGPT…';
  if(chatGPT.quotaUnconfirmed)return 'Подключено · доступ к квоте уточняется';
  if(!chatGPT.available)return 'Сервис подключения ChatGPT недоступен';
  return 'Личный ChatGPT не подключён';
}
function providers(){
  const eligible=Boolean(globalThis.crypto?.subtle)&&!readOnly;
  openPanel('Настройки','ИИ-провайдеры',`<div class="provider-cards">
    ${eligible?providerPreferenceSettings():''}
    ${chatGPTSettings()}
    <section class="plain-card"><h3>OpenRouter</h3>${providerFacts(routerKey?'Аккаунт подключён в этой вкладке.':'Аккаунт не подключён.',routerKey?(routerDelivery||'Бесплатная модель. Доступность квоты ещё не проверялась.'):'Для отправки в бесплатную модель подключите аккаунт.')}
    ${routerKey?act('disconnectAI','Отключить в этой вкладке','','button secondary'):eligible?act('beginAI','Авторизоваться в OpenRouter','','button primary'):'<p class="hint">Для подключения на этом устройстве нужен HTTPS или localhost и роль взрослого.</p>'}
    <div id="auth-step"></div></section>
    ${eligible?'<p class="hint">'+paidAPIHint+' Проверка ключа выполняется без запроса к модели.</p>'+Object.entries(apiKeyProviders).map(([id,p])=>apiKeySettings(id,p)).join(''):''}</div>`);
}
function base64url(bytes){return btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'')}
async function beginProvider(){
  const host=document.querySelector('#auth-step');if(!host||readOnly||!crypto.subtle)return;
  const verifier=base64url(crypto.getRandomValues(new Uint8Array(48)));
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier));
  if(!host.isConnected)return;
  const url=new URL('https://openrouter.ai/auth');url.searchParams.set('code_challenge',base64url(new Uint8Array(digest)));url.searchParams.set('code_challenge_method','S256');url.searchParams.set('key_label','Лист здоровья');url.searchParams.set('expiration','1-day');
  pendingLogin={verifier,expires:Date.now()+600000};
  host.innerHTML='<p>Откройте страницу провайдера и скопируйте выданный одноразовый код.</p>'+external(url.href,'Перейти к авторизации','button secondary')+
    '<form class="edit-form" id="provider-code"><label>Одноразовый код<input name="code" required autocomplete="off"></label><button class="button primary">Завершить подключение</button><p role="status"></p></form>';
}
async function finishProvider(f){
  const msg=f.querySelector('[role=status]'),pending=pendingLogin;
  if(!pending||pending.expires<Date.now()){msg.textContent='Срок кода истёк. Начните авторизацию заново.';return}
  const button=f.querySelector('button');button.disabled=true;msg.textContent='Проверяем код…';
  try{
    const response=await fetch('https://openrouter.ai/api/v1/auth/keys',{method:'POST',referrerPolicy:'no-referrer',credentials:'omit',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:f.elements.code.value.trim(),code_verifier:pending.verifier,code_challenge_method:'S256'})});
    if(!response.ok)throw Error();const data=await response.json();
    if(typeof data.key!=='string'||!data.key)throw Error();
    if(!f.isConnected||pending!==pendingLogin)return;
    routerKey=data.key;pendingLogin=null;routerDelivery='';providers();render();
  }catch{msg.textContent='Подключение не удалось. Проверьте код или начните авторизацию заново.'}finally{button.disabled=false}
}
async function askProvider(id){
  const f=document.querySelector('#consult-answer'),r=current().consultations.find(r=>r.id===id);
  if(!r||!f||readOnly||r.answer||providerJobs.has(id))return;
  if(!f.elements.prompt.value.trim())return rejectFieldValue(f.elements.prompt,'Введите текст запроса.');
  if(!reviewOutboundText(f.elements.prompt,f.querySelector('[role=status]')))return;
  r.prompt=f.elements.prompt.value.trim();if(!r.prompt||!f.pendingAnswer&&!saveState())return;
  const providerID=f.elements.provider?.value;
  if(!f.pendingAnswer&&!connectedProviders().includes(providerID)){
    if(!providerID)go('providers');
    else f.querySelector('[role=status]').textContent='Подключение завершено. Подключите выбранного провайдера повторно.';
    return;
  }
  const provider=f.pendingAnswer?.provider||providerNames[providerID];
  const msg=f.querySelector('[role=status]'),profile=current(),prompt=r.prompt;
  r.lastAttemptAt=new Date().toISOString();r.lastError='';
  if(!f.pendingAnswer&&!saveState())return;
  providerJobs.add(id);f.querySelectorAll('button,textarea,select').forEach(el=>el.disabled=true);msg.textContent='Ожидаем ответ '+provider+'…';
  try{
    const transfer=f.pendingTransfer||transferEvent('provider');
    const delivered=f.pendingAnswer||await requestProvider(providerID,[{role:'user',content:prompt}]);
    const {answer,model}=delivered;
    const record=profile.consultations.find(x=>x.id===id);if(!record||record.answer)return;
    const old={...record};
    Object.assign(record,{prompt,answer,transfers:[...(record.transfers||[]),transfer],sentAt:transfer.time,answeredAt:new Date().toISOString(),provider:provider+' · '+model});
    if(!saveState()){
      for(const k of Object.keys(record))if(!Object.hasOwn(old,k))delete record[k];
      Object.assign(record,old);f.pendingAnswer={...delivered,provider};f.pendingTransfer=transfer;f.elements.prompt.readOnly=true;f.elements.answer.value=answer;
      msg.textContent='Ответ получен. Освободите место и повторите сохранение в этой форме.';return;
    }
    delete f.pendingAnswer;delete f.pendingTransfer;
    if(profile===current()){render();if(routes.at(-1)?.name==='consultRecord'&&routes.at(-1).id===id)consultRecord(id)}
  }catch(e){
    r.lastError=e.message.includes('Запрос сохранён')?e.message:'Не удалось получить ответ. Запрос сохранён.';
    msg.textContent=r.lastError;saveState();
  }
  finally{providerJobs.delete(id);f.querySelectorAll('button,textarea,select').forEach(el=>el.disabled=false)}
}
async function copyConsult(f){
  const box=f.elements.prompt,msg=f.querySelector('[role=status]'),r=current().consultations.find(r=>r.id===f.dataset.id);
  if(!r)return;
  if(!box.value.trim())return rejectFieldValue(box,'Введите текст запроса.');
  if(!reviewOutboundText(box,msg))return;
  const recordCopy=()=>{const transfer=transferEvent('copy');r.transfers=[...(r.transfers||[]),transfer];r.prompt=box.value;r.sentAt=transfer.time;r.provider='ChatGPT · ручной перенос';box.readOnly=true;saveState()};

  try{if(!navigator.clipboard?.writeText)throw Error();await navigator.clipboard.writeText(box.value);recordCopy();msg.textContent='Запрос скопирован.'}
  catch{box.focus();box.select();if(document.execCommand('copy')){recordCopy();msg.textContent='Запрос скопирован.'}else msg.textContent='Текст выделен для копирования.'}
}

async function requestProvider(provider,messages){
  if(!connectedProviders().includes(provider))throw Error('Подключите выбранного провайдера. Запрос сохранён.');
  if(messages.some(m=>cleanClinicalText(m.content)!==m.content))throw Error('Требуется повторная сверка текста перед отправкой. Запрос сохранён.');
  if(provider==='chatgpt')return chatGPT.send(messages);
  if(Object.hasOwn(apiKeyProviders,provider)){
    try{return await callKeyAPI(provider,apiCredentials.get(provider),messages)}
    catch(error){throw Error(error.message+' Запрос сохранён.')}
  }
  const result=await fetch('https://openrouter.ai/api/v1/chat/completions',{method:'POST',credentials:'omit',referrerPolicy:'no-referrer',
      headers:{Authorization:'Bearer '+routerKey,'Content-Type':'application/json'},
      body:JSON.stringify({model:'openrouter/free',messages,provider:{data_collection:'deny'}}),signal:AbortSignal.timeout(120000)});
    if(!result.ok){
      routerDelivery=(result.status===429?'Последний запрос отклонён по квоте. ':'Последний запрос не прошёл. ')+stamp(new Date());
      throw Error(result.status===429?'Квота исчерпана. Запрос сохранён, его можно повторить позже.':'Провайдер недоступен. Запрос сохранён.');
    }
    const body=await result.json(),answer=body.choices?.[0]?.message?.content;
    if(typeof answer!=='string'||!answer.trim())throw Error('Провайдер вернул пустой ответ. Запрос сохранён.');
  routerDelivery='Последний бесплатный запрос выполнен '+stamp(new Date())+'.';
  return {answer,model:body.model||'openrouter/free'};
}
function directTreatmentForm(id){
  if(!reviewReady(id)||readOnly)return;
  const options=connectedProviders();
  if(!options.length){providers();return}
  const data=makePayload(id),template=promptLibrary().find(t=>t.id==='treatment')||builtinPrompts[0];
  const snapshot=JSON.stringify(data),old=current().prompts[id];
  const text=old?.snapshot===snapshot&&old.templateVersion===template.version?cleanClinicalText(old.text):buildTreatmentPrompt(template,data);
  current().prompts[id]={snapshot,text,templateVersion:template.version,answer:old?.snapshot===snapshot?old.answer||'':'',transfers:old?.snapshot===snapshot?old.transfers||[]:[]};saveState();
  const destination=options.length===1?' · '+providerNames[options[0]]:'';
  openPanel('Разбор лечения'+destination,'Проверить запрос',`<form class="edit-form" id="direct-treatment" data-id="${esc(id)}"><p class="hint">Данные выбранного визита и профиль. Проверьте свободный текст перед передачей.</p>${transferHint()}<label>Точный текст<textarea required name="prompt" rows="9">${esc(text)}</textarea></label>${providerChoice()}<button class="button primary">Подтвердить и отправить</button><p role="status"></p>${chatGPT.connected?'':act('manual','Перенести в свой ChatGPT',id,'button secondary')}</form>`);
}
function canAutoSendTreatment(providerID=selectProvider(connectedProviders())){
  const preferred=savedProviderPreference();
  if(readOnly||actingForOtherAdult()||(preferred&&preferred!==providerID)||
    !['chatgpt','router'].includes(providerID)||!connectedProviders().includes(providerID))return false;
  const setting=providerID==='chatgpt'?'chatGPTAuto':'directAuto';
  const saved=readJson(stateKey),profile=saved?.profiles?.[person.id];
  if(current()[setting]!==true||profile?.[setting]!==true)return false;
  const conflicts=[...(saved.sync?.profiles?.[person.id]?.base?.consent?.conflicts||[]),
    ...(profile.savedConflicts||[]).filter(c=>c.lane==='consent')];
  return !conflicts.some(c=>!c.path?.length||c.path[0]===setting);
}
async function sendTreatment(f,confirmed=false){
  if(!f||readOnly||!reviewReady(f.dataset.id))return;
  const providerID=f.elements.provider?.value;
  if(!confirmed&&!canAutoSendTreatment(providerID))return;
  if(!f.pendingReview&&!connectedProviders().includes(providerID)){
    f.querySelector('[role=status]').textContent='Подключите выбранного провайдера. Запрос сохранён.';return;
  }
  const id=f.dataset.id,profile=current(),job='visit:'+person.id+':'+id,prompt=f.elements.prompt.value.trim();
  if(!prompt||providerJobs.has(job))return;
  const msg=f.querySelector('[role=status]');
  if(!reviewOutboundText(f.elements.prompt,msg))return;
  const payload=makePayload(id),draft=profile.prompts[id];
  if(!draft||!f.pendingReview&&draft.snapshot!==JSON.stringify(payload)){
    directTreatmentForm(id);document.querySelector('#direct-treatment [role=status]').textContent='Сведения изменились. Проверьте обновлённый запрос.';return;
  }
  const version=draft.templateVersion;
  draft.text=prompt;if(!f.pendingReview&&!saveState()){msg.textContent='Не удалось сохранить запрос. Отправка не выполнена.';return}
  providerJobs.add(job);f.querySelectorAll('button,textarea,select').forEach(el=>el.disabled=true);msg.textContent='Ожидаем разбор…';
  try{
    let review=f.pendingReview;
    if(!review){
      const transfer=transferEvent('provider');
      if(!confirmed)transfer.automatic=true;
      const provider=providerNames[providerID];
      const {answer,model}=await requestProvider(providerID,[{role:'user',content:prompt}]);
      review={id:uid(),transfers:[...(draft.transfers||[]),transfer],kind:'provider',provider:provider+' · '+model,time:new Date().toISOString(),visit:id,prompt,answer,payload,templateVersion:version,items:readAnswerItems(answer,payload)};
    }
    const previousQueue=profile.treatmentQueue,previousTransfers=draft.transfers;
    draft.transfers=[];
    profile.reviews.push(review);profile.treatmentQueue=previousQueue.filter(q=>q.id!==id);
    if(!saveState()){
      profile.reviews=profile.reviews.filter(r=>r.id!==review.id);profile.treatmentQueue=previousQueue;draft.transfers=previousTransfers;
      f.pendingReview=review;f.elements.prompt.readOnly=true;f.querySelector('button.primary').textContent='Сохранить полученный ответ';
      msg.textContent='Ответ получен. Освободите место и повторите сохранение в этой форме.';return;
    }
    delete f.pendingReview;
    if(current()===profile){render();if(f.isConnected&&panel.open)replaceRoute('review',review.id)}
  }catch(e){msg.textContent=e.message.includes('Запрос сохранён')?e.message:'Провайдер недоступен. Запрос сохранён.'}
  finally{providerJobs.delete(job);f.querySelectorAll('button,textarea,select').forEach(el=>el.disabled=false)}
}
