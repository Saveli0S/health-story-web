'use strict';

const chatGPTGatewayOrigin = 'https://health-story-chatgpt.xzx89s.workers.dev';
const chatGPTKey = 'health-story.chatgpt.signin';
const chatGPTToken = /^[A-Za-z0-9_-]{43}$/;

const chatGPT = {
  checking: true,
  available: false,
  connected: false,
  quotaUnconfirmed: false,
  waitingForApproval: false,
  account: '',
  session: '',
  notice: '',
  get usesBroker() { return this.endpoint?.origin === chatGPTGatewayOrigin; },
  get endpoint() {
    if (location.protocol === 'http:' && location.hostname === '127.0.0.1') return new URL('/chatgpt/', location.origin);
    const config = document.querySelector('meta[name="health-story-chatgpt"]')?.content;
    if (location.protocol !== 'https:') return null;
    if (config === 'gateway-v1') return new URL('./chatgpt/', location.href);
    if (location.origin === 'https://saveli0s.github.io' && config === chatGPTGatewayOrigin) {
      return new URL('/chatgpt/', chatGPTGatewayOrigin);
    }
    return null;
  },
  async request(path, body) {
    const endpoint = this.endpoint;
    if (!endpoint || readOnly) throw Error('Подключение ChatGPT недоступно.');
    const headers = {};
    if (body) headers['Content-Type'] = 'application/json';
    if (this.usesBroker && this.session) headers.Authorization = 'Bearer ' + this.session;
    const response = await fetch(new URL(path, endpoint), {
      method: body ? 'POST' : 'GET', credentials: this.usesBroker ? 'omit' : 'same-origin',
      cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer',
      signal: AbortSignal.timeout(path === 'send' ? 125000 : 25000),
      headers, ...(body ? {body:JSON.stringify(body)} : {})
    });
    const result = await response.json();
    if (!response.ok) {
      if (response.status === 401) { this.connected = false; this.account = ''; this.session = ''; }
      throw Error((result.error || 'ChatGPT недоступен.') + ' Запрос сохранён.');
    }
    return result;
  },
  async refresh() {
    this.checking = true;
    this.available = false;
    this.connected = false;
    this.quotaUnconfirmed = false;
    this.waitingForApproval = false;
    this.account = '';
    try {
      if (!this.endpoint || readOnly) return;
      if (this.usesBroker) {
        try { await this.acceptReturn(); }
        catch { this.notice = 'Не удалось завершить вход. Начните подключение заново.'; }
      }
      const status = await this.request('status');
      // Hosted sessions must explicitly report that requests cannot overflow into credits.
      this.available = typeof status.connected === 'boolean' && status.available !== false;
      this.waitingForApproval = status.available === false;
      this.connected = status.connected === true && (location.protocol === 'http:' || status.planOnly === true);
      this.quotaUnconfirmed = status.connected === true && !this.connected;
      this.account = this.connected ? status.account || '' : '';
    } catch { /* Keep the provider disconnected when the gateway is unreachable. */ }
    finally { this.checking = false; }
  },
  async acceptReturn() {
    const callback = new URLSearchParams(location.hash.slice(1));
    const outcome = callback.get('chatgpt');
    if (!outcome) return;
    history.replaceState(null,'',location.pathname+location.search);
    const verifier = sessionStorage.getItem(chatGPTKey) || '';
    sessionStorage.removeItem(chatGPTKey);
    if (outcome !== 'connected') {
      this.notice = 'Разрешение на использование ChatGPT не получено.';
      return;
    }
    const ticket = callback.get('ticket') || '';
    if (!chatGPTToken.test(ticket) || !chatGPTToken.test(verifier)) throw Error();
    const result = await this.request('redeem',{ticket,verifier});
    if (result.planOnly !== true || !chatGPTToken.test(result.session || '')) throw Error();
    this.session = result.session;
    this.notice = 'Личный ChatGPT подключён для этой вкладки.';
  },
  async connect(button) {
    if (readOnly || !this.available || button.disabled) return;
    button.disabled = true;
    try {
      const body = {};
      if (this.usesBroker) {
        const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
        sessionStorage.setItem(chatGPTKey,verifier);
        body.challenge = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))));
      }
      const result = await this.request('connect',body);
      const dest = new URL(result.url);
      if (dest.origin !== 'https://auth.openai.com' || dest.pathname !== '/api/accounts/authorize') throw Error('Не удалось открыть вход в ChatGPT.');
      location.assign(dest.href);
    } catch (error) { button.disabled = false; button.parentElement.querySelector('[role=status]').textContent = error.message; }
  },
  async disconnect(button) {
    if (readOnly || button.disabled) return;
    button.disabled = true;
    try {
      const result = await this.request('disconnect',{});
      this.session = '';
      this.notice = '';
      await this.refresh(); providers(); render();
      if (!result.revoked) document.querySelector('#chatgpt-status').textContent = 'Вход завершён на устройстве. Отзыв доступа можно проверить в настройках ChatGPT.';
    } catch (error) { button.disabled = false; document.querySelector('#chatgpt-status').textContent = error.message; }
  },
  async send(messages) {
    if (!this.connected || readOnly) throw Error('Подключите личный ChatGPT. Запрос сохранён.');
    if (messages.some(m => cleanClinicalText(m.content) !== m.content)) throw Error('В истории есть личные сведения. Для отправки подготовьте новую консультацию. Запрос сохранён.');
    const reply = await this.request('send',{messages});
    if (typeof reply.answer !== 'string' || !reply.answer.trim() || typeof reply.model !== 'string' || !reply.model.trim()) {
      throw Error('ChatGPT не вернул завершённый ответ. Запрос сохранён.');
    }
    return reply;
  }
};

function chatGPTSettings() {
  let details;
  if (chatGPT.connected) details = 'Подключён аккаунт ' + chatGPT.account;
  else if (!chatGPT.endpoint || chatGPT.waitingForApproval) details = 'Подключение на сайте ожидает допуска OpenAI. Прямой вход доступен в локальном дневнике на Mac.';
  else if (chatGPT.quotaUnconfirmed) details = 'Отправка ожидает подтверждения, что доступны только запросы в пределах включённой квоты.';
  else if (chatGPT.available) details = 'Войдите и разрешите использование включённой квоты.';
  else if (chatGPT.checking) details = 'Проверяем подключение ChatGPT…';
  else details = 'Сервис подключения ChatGPT недоступен. Обновите страницу и повторите.';
  const button = chatGPT.connected ? act('disconnectChatGPT','Отключить аккаунт','','button secondary') : chatGPT.available ? act('connectChatGPT','Продолжить с ChatGPT','','button primary') : '';
  return '<section class="plain-card"><h3>Личный ChatGPT</h3><p>'+esc(details)+'</p><p>Ответы сохраняются в выбранном профиле. Условия квоты и использование кредитов можно проверить в настройках ChatGPT.</p>'+button+external('https://chatgpt.com/settings/usage','Управление квотой ChatGPT')+'<p id="chatgpt-status" role="status">'+esc(chatGPT.notice)+'</p></section>';
}

function conversationMessages(record) {
  const messages = [{role:'user',content:record.prompt},{role:'assistant',content:record.answer}];
  for (const turn of record.turns || []) messages.push({role:'user',content:turn.question},{role:'assistant',content:turn.answer});
  return messages;
}

function contextText(messages) {
  return messages.map(m => (m.role==='user'?'Вы':'Ответ')+'\n'+m.content).join('\n\n');
}

function conversationHistory(record) {
  const history = (record.turns || []).map(turn => '<section class="panel-section"><h3>'+esc(turn.question)+'</h3><p class="detail-meta">'+esc(stamp(turn.time))+' · '+esc(turn.provider)+'</p>'+transferHistory(turn)+'<div class="manual-answer">'+esc(turn.answer)+'</div>'+
    (Array.isArray(turn.sentHistory)?'<details><summary>Отправленный контекст</summary><pre>'+esc(contextText(turn.sentHistory))+'</pre></details>':'')+'</section>').join('');
  if (readOnly) return history;
  const preview = contextText(conversationMessages(record).map(m=>({...m,content:cleanClinicalText(m.content)})));
  const options = connectedProviders();
  const sendLabel = options.length>1?'Подтвердить и отправить':options.length?'Подтвердить и отправить в '+providerNames[options[0]]:'Сохранить черновик';
  return history+'<form id="chatgpt-followup" class="edit-form" data-id="'+esc(record.id)+'"><label>Следующий вопрос<textarea name="question" rows="3" required>'+esc(record.nextQuestion || '')+'</textarea></label><details><summary>Какая переписка уйдёт вместе с вопросом</summary><pre data-chatgpt-context>'+esc(preview)+'</pre></details>'+transferHint()+
    providerChoice((record.turns||[]).at(-1)?.provider||record.provider)+'<button class="button '+(options.length?'primary':'secondary')+'" '+(options.length?'':'formnovalidate')+'>'+esc(sendLabel)+'</button>'+
    (options.length?'':act('providers','Подключить ИИ-провайдера','','button secondary'))+'<p role="status"></p></form>';
}

async function sendFollowup(form) {
  if (readOnly) return;
  const owner = person.id, profile = current(), record = profile.consultations.find(r => r.id===form.dataset.id);
  if (!record?.answer || providerJobs.has(record.id)) return;
  const field = form.elements.question, status = form.querySelector('[role=status]');
  const choice=form.elements.provider,providerID=choice?.value;
  if (!providerID && !form.pendingTurn) {
    const before = record.nextQuestion;
    record.nextQuestion = field.value.trim();
    if (saveState()) status.textContent='Черновик сохранён.';
    else {record.nextQuestion=before;status.textContent='Не удалось сохранить вопрос.'}
    return;
  }
  if(!form.pendingTurn&&!connectedProviders().includes(providerID)){
    status.textContent='Подключите выбранного провайдера. Запрос сохранён.';return;
  }
  if (!reviewOutboundText(field,status) || !field.value.trim()) return;
  const previous = conversationMessages(record);
  const sentHistory = previous.map(m=>({...m,content:cleanClinicalText(m.content)}));
  const context = form.querySelector('[data-chatgpt-context]'), preview = contextText(sentHistory);
  if (!form.pendingTurn && context.textContent !== preview) {
    context.textContent=preview;context.parentElement.open=true;
    status.textContent='Контекст обновился. Проверьте его и подтвердите отправку.';
    return;
  }
  const question = field.value.trim(), messages = [...sentHistory,{role:'user',content:question}];
  const before = record.nextQuestion;
  record.nextQuestion = question;
  if (!form.pendingTurn && !saveState()) { record.nextQuestion=before;status.textContent='Не удалось сохранить вопрос.'; return; }
  providerJobs.add(record.id); form.querySelector('button').disabled=true; field.readOnly=true;
  if(choice)choice.disabled=true;
  try {
    status.textContent=form.pendingTurn?'Сохраняем ответ…':'Ожидаем ответ '+providerNames[providerID]+'…';
    let turn = form.pendingTurn;
    if (!turn) {
      const transfer=transferEvent('provider');
      const {answer,model}=await requestProvider(providerID,messages);
      turn={id:uid(),time:new Date().toISOString(),question,answer,provider:providerNames[providerID]+' · '+model,transfers:[transfer]};
      if (previous.some((message,i)=>message.content!==sentHistory[i].content)) turn.sentHistory=sentHistory;
    }
    if (prototypeState.profiles[owner] !== profile || !profile.consultations.includes(record) ||
        !syncMerge.same(previous,conversationMessages(record)) || record.nextQuestion!==question) {
      status.textContent='Консультация изменилась. Откройте историю перед отправкой.';return;
    }
    const turns=record.turns || [];
    record.turns=[...turns,turn]; record.nextQuestion='';
    if (!saveState()) {
      record.turns=turns;record.nextQuestion=question;form.pendingTurn=turn;
      form.querySelector('button').textContent='Сохранить полученный ответ';
      status.textContent='Освободите место и повторите сохранение.';return;
    }
    delete form.pendingTurn;
    if (profile===current() && form.isConnected) consultRecord(record.id);
  } catch (error) { status.textContent=error.message; }
  finally { providerJobs.delete(record.id);field.readOnly=Boolean(form.pendingTurn);form.querySelector('button').disabled=false;if(choice)choice.disabled=Boolean(form.pendingTurn); }
}
