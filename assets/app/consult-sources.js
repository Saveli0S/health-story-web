'use strict';

function consultSourceGroups(){
  const item=(kind,id,label,details,tags=[],date='')=>({key:kind+':'+id,label,details,tags,selection:date?label+' · '+preventionDate(date):label});
  const combined=lists=>[...new Map(lists.flat().map(t=>[t.id,t])).values()];
  const reports=labs(),visits=person.visits;
  return [
    ['Эпизоды целиком',current().episodes.map(e=>{
      const group=episodeVisits(e.id),ids=new Set(group.map(v=>v[0]));
      const tags=combined([...group.map(v=>recordTags('visit',v[0])),...reports.filter(f=>ids.has(f.visit)).map(f=>recordTags('lab',f.id))]);
      return item('episode',e.id,e.name,'Все визиты и связанные бланки',tags);
    })],
    ['Отдельные визиты',visits.map(v=>item('visit',v[0],v[2],preventionDate(v[1])+' · '+doctorLabel(v[3]),recordTags('visit',v[0]),v[1]))],
    ['Лабораторные бланки',reports.map(f=>{
      const r=reportInfo(f);
      return item('lab',f.id,r.name,preventionDate(r.date)+' · '+r.rows.map(row=>row.name).join(', '),recordTags('lab',f.id),r.date);
    })],
    ['Динамика показателей',indicatorGroups().map(g=>item('indicator',g.key,g.name+' · '+g.unit,'Все даты этого показателя',combined(g.points.map(p=>recordTags('lab',p.source)))))],
    ['Заключения',current().files.filter(f=>f.category==='Заключения'&&f.clinicalText).map(f=>item('document',f.id,f.name,preventionDate(f.date)+' · Сверенный текст',recordTags('file',f.id),f.date))],
    ['Прививки и профилактика',current().prevention.map(p=>item('prevent',p.id,p.title,preventionKinds[p.kind]+' · '+scheduleLabel(p),recordTags('prevent',p.id)))]
  ];
}
function consultSourcePicker(groups,seed){
  const profile={key:'profile',label:'Медкарта',details:'Возраст, рост, вес, аллергии, хронические заболевания и текущие препараты',tags:[]};
  const row=s=>'<label class="source-choice picker-source" data-selection="'+esc(s.selection||s.label)+'" data-search="'+esc(tagWords([s.label,s.details,...s.tags.map(t=>t.name)].join(' ')))+'" data-tags="'+esc(s.tags.map(t=>t.id).join(' '))+'">'+
    '<input type="checkbox" name="source" value="'+esc(s.key)+'" '+(seed.has(s.key)?'checked':'')+'><span><strong>'+esc(s.label)+'</strong><small>'+esc(s.details)+'</small>'+
    (s.tags.length?'<small class="source-tags">'+s.tags.map(t=>esc(t.name)).join(' · ')+'</small>':'')+'</span></label>';
  return '<fieldset class="rx-inputs consult-picker"><legend>Какие данные приложить</legend><div class="picker-tools"><label>Поиск по записям<input id="consult-source-search" type="search" placeholder="Название, врач или тег"></label>'+
    '<label>Тег<select name="sourceTag"><option value="">Все теги</option>'+prototypeState.tags.map(t=>'<option value="'+esc(t.id)+'">'+esc(t.name)+'</option>').join('')+'</select></label></div>'+
    '<p class="hint" id="picker-status" role="status"></p><div class="selected-sources" id="selected-sources"></div>'+row(profile)+
    groups.filter(([,items])=>items.length).map(([title,items])=>'<details class="pick-group" '+(items.some(s=>seed.has(s.key))?'open':'')+'><summary>'+esc(title)+' <small>('+items.length+')</small></summary>'+items.map(row).join('')+'</details>').join('')+'</fieldset>';
}
function filterConsultSources(form){
  const words=tagWords(form.querySelector('#consult-source-search').value).split(' ').filter(Boolean);
  const tag=form.elements.sourceTag.value,filtering=Boolean(tag||words.length);
  let matches=0;const selected=[];
  for(const row of form.querySelectorAll('.picker-source')){
    const checkbox=row.querySelector('input');
    row.hidden=!words.every(w=>row.dataset.search.includes(w))||Boolean(tag&&!row.dataset.tags.split(' ').includes(tag));
    if(!row.hidden)matches++;
    if(checkbox.checked)selected.push({key:checkbox.value,title:row.dataset.selection});
  }
  for(const group of form.querySelectorAll('.pick-group')){
    group.hidden=!group.querySelector('.picker-source:not([hidden])');
    if(filtering){
      if(!group.hasAttribute('data-was-open'))group.dataset.wasOpen=String(group.open);
      group.open=!group.hidden;
    }else if(group.hasAttribute('data-was-open')){
      group.open=group.dataset.wasOpen==='true'||Boolean(group.querySelector(':checked'));delete group.dataset.wasOpen;
    }
  }
  form.querySelector('#picker-status').textContent=(filtering?(matches?'Найдено записей: '+matches:'Совпадений нет')+' · ':'')+'Выбрано: '+selected.length;
  form.querySelector('#selected-sources').innerHTML=selected.map(s=>'<button type="button" class="record-tag" data-unselect="'+esc(s.key)+'" aria-label="'+esc('Убрать '+s.title)+'">'+esc(s.title)+' ×</button>').join('');
}

