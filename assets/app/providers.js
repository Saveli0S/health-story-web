'use strict';

// Keys exist only in this tab's memory and are excluded from the journal and backups.
let routerKey='',pendingLogin=null,routerDelivery='';
const providerJobs=new Set();
function providerFacts(account,delivery){
  return '<dl class="provider-status"><dt>Вход</dt><dd>'+esc(account)+'</dd><dt>Отправка запросов</dt><dd>'+esc(delivery)+'</dd></dl>';
}
function providerStatus(){
  if(chatGPT.connected)return 'Личный ChatGPT подключён';
  if(routerKey)return 'OpenRouter подключён на эту сессию';
  if(!chatGPT.endpoint)return 'Подключение ChatGPT на сайте пока недоступно';
  if(chatGPT.checking)return 'Проверяем подключение ChatGPT…';
  if(chatGPT.quotaUnconfirmed)return 'Подключено · доступ к квоте уточняется';
  if(!chatGPT.available)return 'Сервис подключения ChatGPT недоступен';
  return 'Личный ChatGPT не подключён';
}
function providers(){
  const eligible=Boolean(globalThis.crypto?.subtle)&&!readOnly;
  openPanel('Настройки','ИИ-провайдеры',`${chatGPTSettings()}
    <section class="plain-card"><h3>OpenRouter</h3>${providerFacts(routerKey?'Аккаунт подключён в этой вкладке.':'Аккаунт не подключён.',routerKey?(routerDelivery||'Бесплатная модель. Доступность квоты ещё не проверялась.'):'Для отправки в бесплатную модель подключите аккаунт.')}
    ${routerKey?act('disconnectAI','Отключить в этой вкладке','','button secondary'):eligible?act('beginAI','Авторизоваться в OpenRouter','','button primary'):'<p class="hint">Для подключения на этом устройстве нужен HTTPS или localhost и роль взрослого.</p>'}
    <div id="auth-step"></div></section>`);
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
  if(!reviewOutboundText(f.elements.prompt,f.querySelector('[role=status]')))return;
  r.prompt=f.elements.prompt.value.trim();if(!r.prompt||!f.pendingAnswer&&!saveState())return;
  if(!chatGPT.connected&&!routerKey){go('providers');return}
  const msg=f.querySelector('[role=status]'),profile=current(),prompt=r.prompt;
  r.lastAttemptAt=new Date().toISOString();r.lastError='';
  if(!f.pendingAnswer&&!saveState())return;
  providerJobs.add(id);f.querySelectorAll('button,textarea').forEach(el=>el.disabled=true);const provider=chatGPT.connected?'ChatGPT':'OpenRouter';msg.textContent='Ожидаем ответ '+provider+'…';
  try{
    const transfer=f.pendingTransfer||transferEvent('provider');
    const delivered=f.pendingAnswer||await requestFreeModel(prompt);
    const {answer,model}=delivered;
    const record=profile.consultations.find(x=>x.id===id);if(!record||record.answer)return;
    const old={...record};
    Object.assign(record,{prompt,answer,transfers:[...(record.transfers||[]),transfer],sentAt:transfer.time,answeredAt:new Date().toISOString(),provider:provider+' · '+model});
    if(!saveState()){
      for(const k of Object.keys(record))if(!Object.hasOwn(old,k))delete record[k];
      Object.assign(record,old);f.pendingAnswer=delivered;f.pendingTransfer=transfer;f.elements.prompt.readOnly=true;f.elements.answer.value=answer;
      msg.textContent='Ответ получен. Освободите место и повторите сохранение в этой форме.';return;
    }
    delete f.pendingAnswer;delete f.pendingTransfer;
    if(profile===current()){render();if(routes.at(-1)?.name==='consultRecord'&&routes.at(-1).id===id)consultRecord(id)}
  }catch(e){
    r.lastError=e.message.includes('Запрос сохранён')?e.message:'Не удалось получить ответ. Запрос сохранён.';
    msg.textContent=r.lastError;saveState();
  }
  finally{providerJobs.delete(id);f.querySelectorAll('button,textarea').forEach(el=>el.disabled=false)}
}
async function copyConsult(f){
  const box=f.elements.prompt,msg=f.querySelector('[role=status]'),r=current().consultations.find(r=>r.id===f.dataset.id);
  if(!r||!box.value.trim()||!reviewOutboundText(box,msg))return;
  const recordCopy=()=>{const transfer=transferEvent('copy');r.transfers=[...(r.transfers||[]),transfer];r.prompt=box.value;r.sentAt=transfer.time;r.provider='ChatGPT · ручной перенос';box.readOnly=true;saveState()};

  try{if(!navigator.clipboard?.writeText)throw Error();await navigator.clipboard.writeText(box.value);recordCopy();msg.textContent='Запрос скопирован.'}
  catch{box.focus();box.select();if(document.execCommand('copy')){recordCopy();msg.textContent='Запрос скопирован.'}else msg.textContent='Текст выделен для копирования.'}
}

async function requestFreeModel(prompt){
  if(chatGPT.connected)return chatGPT.send([{role:'user',content:prompt}]);
  if(cleanClinicalText(prompt)!==prompt)throw Error('Требуется повторная сверка текста перед отправкой.');
  const result=await fetch('https://openrouter.ai/api/v1/chat/completions',{method:'POST',credentials:'omit',referrerPolicy:'no-referrer',
      headers:{Authorization:'Bearer '+routerKey,'Content-Type':'application/json'},
      body:JSON.stringify({model:'openrouter/free',messages:[{role:'user',content:prompt}],provider:{data_collection:'deny'}}),signal:AbortSignal.timeout(120000)});
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
  const data=makePayload(id),template=promptLibrary().find(t=>t.id==='treatment')||builtinPrompts[0];
  const snapshot=JSON.stringify(data),old=current().prompts[id];
  const text=old?.snapshot===snapshot&&old.templateVersion===template.version?cleanClinicalText(old.text):buildTreatmentPrompt(template,data);
  current().prompts[id]={snapshot,text,templateVersion:template.version,answer:old?.snapshot===snapshot?old.answer||'':'',transfers:old?.snapshot===snapshot?old.transfers||[]:[]};saveState();
  openPanel('Разбор лечения · '+(chatGPT.connected?'ChatGPT':'OpenRouter'),'Проверить запрос',`<form class="edit-form" id="direct-treatment" data-id="${esc(id)}"><p class="hint">Данные выбранного визита и профиль. Проверьте свободный текст перед передачей.</p>${transferHint()}<label>Точный текст<textarea required name="prompt" rows="9">${esc(text)}</textarea></label><button class="button primary">Подтвердить и отправить</button><p role="status"></p>${chatGPT.connected?'':act('manual','Перенести в свой ChatGPT',id,'button secondary')}</form>`);
}
function canAutoSendTreatment(){
  if(readOnly||actingForOtherAdult()||(!chatGPT.connected&&!routerKey))return false;
  const setting=chatGPT.connected?'chatGPTAuto':'directAuto';
  const saved=readJson(stateKey),profile=saved?.profiles?.[person.id];
  if(current()[setting]!==true||profile?.[setting]!==true)return false;
  const conflicts=[...(saved.sync?.profiles?.[person.id]?.base?.consent?.conflicts||[]),
    ...(profile.savedConflicts||[]).filter(c=>c.lane==='consent')];
  return !conflicts.some(c=>!c.path?.length||c.path[0]===setting);
}
async function sendTreatment(f,confirmed=false){
  if(!confirmed&&!canAutoSendTreatment())return;
  if(!f||readOnly||(!chatGPT.connected&&!routerKey)||!reviewReady(f.dataset.id))return;
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
  providerJobs.add(job);f.querySelectorAll('button,textarea').forEach(el=>el.disabled=true);msg.textContent='Ожидаем разбор…';
  try{
    let review=f.pendingReview;
    if(!review){
      const transfer=transferEvent('provider');
      if(!confirmed)transfer.automatic=true;
      const provider=chatGPT.connected?'ChatGPT':'OpenRouter';
      const {answer,model}=await requestFreeModel(prompt);
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
  finally{providerJobs.delete(job);f.querySelectorAll('button,textarea').forEach(el=>el.disabled=false)}
}
