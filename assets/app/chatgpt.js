'use strict';

const chatGPT = {
  available: false,
  connected: false,
  account: '',
  async request(path, body) {
    const response = await fetch('/chatgpt/' + path, {
      method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store',
      ...(body ? {headers:{'Content-Type':'application/json'},body:JSON.stringify(body)} : {})
    });
    const result = await response.json();
    if (!response.ok) throw Error((result.error || 'ChatGPT недоступен.') + ' Запрос сохранён.');
    return result;
  },
  async refresh() {
    if (location.hostname !== '127.0.0.1' || readOnly) return;
    try {
      const status = await this.request('status');
      this.available = typeof status.connected === 'boolean';
      this.connected = status.connected === true;
      this.account = status.account || '';
    } catch { this.connected = false; this.available = false; }
  },
  async connect(button) {
    if (readOnly || !this.available || button.disabled) return;
    button.disabled = true;
    try {
      const result = await this.request('connect',{});
      const dest = new URL(result.url);
      if (dest.origin !== 'https://auth.openai.com') throw Error('Не удалось открыть вход в ChatGPT.');
      location.assign(dest.href);
    } catch (error) { button.disabled = false; button.parentElement.querySelector('[role=status]').textContent = error.message; }
  },
  async disconnect(button) {
    if (readOnly || button.disabled) return;
    button.disabled = true;
    try {
      const result = await this.request('disconnect',{});
      await this.refresh(); providers(); render();
      if (!result.revoked) document.querySelector('#chatgpt-status').textContent = 'Вход завершён на устройстве. Отзыв доступа можно проверить в настройках ChatGPT.';
    } catch (error) { button.disabled = false; document.querySelector('#chatgpt-status').textContent = error.message; }
  },
  async send(messages) {
    if (!this.connected || readOnly) throw Error('Подключите личный ChatGPT. Запрос сохранён.');
    if (messages.some(m => cleanClinicalText(m.content) !== m.content)) throw Error('В истории есть личные сведения. Для отправки подготовьте новую консультацию. Запрос сохранён.');
    return this.request('send',{messages});
  }
};

function chatGPTSettings() {
  const details = chatGPT.connected ? 'Подключён аккаунт ' + chatGPT.account : chatGPT.available ? 'Войдите один раз на этом устройстве.' : 'Прямой вход доступен в локальной версии на Mac. Для опубликованного сайта подключение пока недоступно.';
  const button = chatGPT.connected ? act('disconnectChatGPT','Отключить аккаунт','','button secondary') : chatGPT.available ? act('connectChatGPT','Продолжить с ChatGPT','','button primary') : '';
  return '<section class="plain-card"><h3>Личный ChatGPT</h3><p>'+esc(details)+'</p><p>Ответы и продолжение переписки сохраняются в выбранном профиле. Условия квоты и разрешения на использование кредитов задаются в вашем аккаунте ChatGPT.</p>'+button+'<p id="chatgpt-status" role="status"></p></section>';
}

function conversationMessages(record) {
  const messages = [{role:'user',content:record.prompt},{role:'assistant',content:record.answer}];
  for (const turn of record.turns || []) messages.push({role:'user',content:turn.question},{role:'assistant',content:turn.answer});
  return messages;
}

function conversationHistory(record) {
  const history = (record.turns || []).map(turn => '<section class="panel-section"><h3>'+esc(turn.question)+'</h3><p class="detail-meta">'+esc(stamp(turn.time))+' · '+esc(turn.provider)+'</p>'+transferHistory(turn)+'<div class="manual-answer">'+esc(turn.answer)+'</div></section>').join('');
  if (readOnly) return history;
  const preview = conversationMessages(record).map(m => (m.role==='user'?'Вы':'Ответ')+'\n'+m.content).join('\n\n');
  return history+'<form id="chatgpt-followup" class="edit-form" data-id="'+esc(record.id)+'"><label>Следующий вопрос<textarea name="question" rows="3" required>'+esc(record.nextQuestion || '')+'</textarea></label><details><summary>Какая переписка уйдёт вместе с вопросом</summary><pre>'+esc(preview)+'</pre></details>'+transferHint()+
    (chatGPT.connected?'<button class="button primary">Подтвердить и отправить в ChatGPT</button>':act('providers','Подключить личный ChatGPT','','button secondary'))+'<p role="status"></p></form>';
}

async function sendFollowup(form) {
  if (readOnly || !chatGPT.connected) return;
  const profile = current(), record = profile.consultations.find(r => r.id===form.dataset.id);
  if (!record?.answer || providerJobs.has(record.id)) return;
  const field = form.elements.question, status = form.querySelector('[role=status]');
  if (!reviewOutboundText(field,status) || !field.value.trim()) return;
  const question = field.value.trim(), messages = [...conversationMessages(record),{role:'user',content:question}];
  record.nextQuestion = question;
  if (!form.pendingTurn && !saveState()) { status.textContent='Не удалось сохранить вопрос.'; return; }
  providerJobs.add(record.id); form.querySelector('button').disabled=true; field.readOnly=true;
  try {
    status.textContent='Ожидаем ответ ChatGPT…';
    let turn = form.pendingTurn;
    if (!turn) {
      const transfer=transferEvent('provider');
      const {answer,model}=await chatGPT.send(messages);
      turn={id:uid(),time:new Date().toISOString(),question,answer,provider:'ChatGPT · '+model,transfers:[transfer]};
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
  finally { providerJobs.delete(record.id);field.readOnly=Boolean(form.pendingTurn);form.querySelector('button').disabled=false; }
}
