'use strict';

const preventionKinds={vaccine:'Прививка',lab:'Плановый анализ',procedure:'Процедура'};
function preventionDate(date){return dateLabel(date,{day:'numeric',month:'short',year:'numeric'})}
function scheduleLabel(p){
  if(p.next)return (p.next<todayLocal()?'По плану было · ':'Запланировано · ')+preventionDate(p.next);
  const last=p.history.at(-1);
  return last?'Выполнено · '+preventionDate(last.date):'Дата пока не указана';
}
function preventionRows(query=''){
  const rows=current().prevention.map(p=>({type:'prevent',id:p.id,title:p.title,meta:preventionKinds[p.kind]+' · '+scheduleLabel(p),
    terms:[p.period,p.next,...p.history.map(h=>h.date),tagLabels('prevent',p.id)].join(' '),icon:'calendar'}));
  return filterRows(rows,query);
}
function preventionListing(query=''){
  return preventionRows(query).map(p=>resultRow('prevent',p.id,p.title,p.meta,'calendar')).join('')||
    '<p class="hint">'+(query?'Совпадений нет.':'Здесь можно вести прививки, плановые анализы и процедуры.')+'</p>';
}
function preventionOptions(selected=''){
  const options=[...person.visits.map(v=>['visit:'+v[0],v[2]+' · '+preventionDate(v[1])]),
    ...labs().map(f=>['lab:'+f.id,reportInfo(f).name+' · '+preventionDate(reportInfo(f).date)])];
  return '<option value="">Без привязки</option>'+options.map(([key,label])=>'<option value="'+esc(key)+'" '+(key===selected?'selected':'')+'>'+esc(label)+'</option>').join('');
}
function eventSource(link){
  if(!link)return '';
  const [kind,id]=link.split(':');
  const label=kind==='visit'?visitById(id)?.[2]:kind==='lab'?labs().find(l=>l.id===id):null;
  if(!label)return '';
  return act(kind,kind==='lab'?reportInfo(label).name:label,id,'chip-link','folder');
}
function preventCard(id){
  const p=current().prevention.find(p=>p.id===id);
  if(!p){openPanel(person.name,'Профилактика','<p>Запись удалена из профиля.</p>');return}
  const history=p.history.slice().reverse().map(h=>'<div class="note"><strong>'+esc(preventionDate(h.date))+'</strong>'+
    (h.note?'<p>'+esc(h.note)+'</p>':'')+eventSource(h.source)+(readOnly?'':act('completePrevent','Исправить выполнение',p.id+':'+h.id,'text-button','edit'))+'</div>').join('');
  openPanel(preventionKinds[p.kind],p.title,tagStrip('prevent',p.id)+'<div class="summary-sheet"><strong>'+esc(scheduleLabel(p))+'</strong>'+
    (p.period?'<p>Периодичность · '+esc(p.period)+'</p>':'')+'</div>'+(p.note?'<p>'+esc(p.note)+'</p>':'')+
    '<div class="visit-options">'+(readOnly?'':act('completePrevent','Отметить выполнение',id,'button primary','check')+
      act('editPrevent','Изменить запись',id,'button secondary','edit')+act('consult','Обсудить с ИИ','prevent:'+id,'text-button','spark'))+'</div>'+
    '<h3>История выполнения</h3>'+(history||'<p class="hint">Выполнений пока нет.</p>')+deletionButton('prevention',id,'Удалить запись профилактики'));
}
function preventionForm(id){
  if(readOnly)return;
  const row=current().prevention.find(p=>p.id===id);
  const options=Object.entries(preventionKinds).map(([k,v])=>'<option value="'+k+'" '+(row?.kind===k?'selected':'')+'>'+v+'</option>').join('');
  openPanel(person.name,row?'Изменить запись':'Новая запись профилактики',`<form id="prevention-form" data-id="${esc(id)}" class="edit-form">
    <label>Вид записи<select name="kind">${options}</select></label><label>Название<input required name="title" maxlength="120" value="${esc(row?.title)}" placeholder="Название прививки, анализа или процедуры"></label>
    ${row?'':'<label>Дата выполнения, если уже пройдено<input type="date" name="done" max="'+todayLocal()+'"></label><label>Связанный визит или бланк для выполненной записи<select name="source">'+preventionOptions()+'</select></label>'}
    <div class="intake-pair"><label>Следующая плановая дата<input type="date" name="next" value="${esc(row?.next)}"></label><label>Периодичность по вашему плану<input maxlength="100" name="period" value="${esc(row?.period)}" placeholder="Например, раз в год"></label></div>
    <label>Примечание<textarea maxlength="1200" name="note">${esc(row?.note)}</textarea></label>
    <p class="error" role="alert"></p><button class="button primary">Сохранить запись</button></form>`);
}
function completePrevent(key){
  const [id,eventId]=key.split(':');
  const p=current().prevention.find(p=>p.id===id);if(readOnly||!p)return;
  const event=p.history.find(h=>h.id===eventId);
  if(eventId&&!event)return;
  openPanel(p.title,event?'Исправить выполнение':'Отметить выполнение',`<form id="prevent-event" data-id="${esc(id)}" data-event="${esc(eventId)}" class="edit-form">
    <label>Дата выполнения<input required type="date" name="done" max="${todayLocal()}" value="${esc(event?.date||todayLocal())}"></label>
    <label>Связанный визит или бланк<select name="source">${preventionOptions(event?.source)}</select></label>
    <label>Заметка о выполнении<textarea name="eventNote" maxlength="800">${esc(event?.note)}</textarea></label>
    <label>Следующая плановая дата<input type="date" name="next" value="${event||p.next>todayLocal()?esc(p.next):''}"></label>
    <p class="error" role="alert"></p><button class="button primary">Сохранить выполнение</button></form>`);
}
function savePrevention(form){
  if(readOnly)return;
  const records=current().prevention,old=records.find(p=>p.id===form.dataset.id);
  const data=new FormData(form),value=k=>String(data.get(k)||'').trim();
  const done=value('done'),next=value('next'),isEvent=form.id==='prevent-event';
  if(isEvent&&!old)return;
  const p=isEvent?{...old,next}:{id:old?.id||uid(),kind:value('kind'),title:value('title'),period:value('period'),note:value('note'),next,history:old?.history||[]};
  const error=form.querySelector('.error');
  if(!Object.hasOwn(preventionKinds,p.kind)||!p.title){error.textContent='Укажите название и вид записи.';return}
  if(value('source')&&!done){error.textContent='Для ссылки на выполненное обследование укажите дату выполнения.';return}
  const eventId=form.dataset.event;
  const history=eventId?p.history.filter(h=>h.id!==eventId):p.history;
  if(eventId&&history.length===p.history.length)return;
  if(done>todayLocal()||(next&&(next<done||next<(history.at(-1)?.date||'')))){error.textContent='Проверьте даты выполнения и следующего обследования.';return}
  if(done)p.history=[...history,{id:eventId||uid(),date:done,source:value('source'),note:value('eventNote')}].sort((a,b)=>a.date.localeCompare(b.date));
  current().prevention=old?records.map(row=>row.id===old.id?p:row):[...records,p];
  if(!saveState()){current().prevention=records;error.textContent='Не удалось сохранить запись.';return}
  render();
  if(old&&routes.at(-2)?.name==='prevent')goBack();else replaceRoute('prevent',p.id);
}

