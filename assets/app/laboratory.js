'use strict';

function reportInfo(file){
  if(file.lab)return file.lab;
  if(!file.file)return null;
  return {name:file.name,date:file.date,laboratory:'Лаборатория «Линия»',category:file.id==='chem'?'Биохимия':'Гематология',
    rows:labRows.filter(r=>Object.hasOwn(r.values,file.id)).map(r=>({name:r.name,value:String(r.values[file.id]),unit:r.unit,range:r.range}))};
}
function reportTitleForAI(report,file){
  const filename=String(file.name||'').normalize('NFC').trim().toLowerCase();
  const title=String(report.name||'').normalize('NFC').trim().toLowerCase();
  if(!title||file.lab&&(title===filename||title===filename.replace(/\.[^.]+$/u,'')))return 'Лабораторное исследование';
  return report.name;
}
function indicatorKey(name,unit){
  // Prefix case can change the magnitude of a unit. Only normalize typography.
  const formatted=String(unit).trim().replace(/\s*\/\s*/g,'/').replace(/\s+/g,' ').replace(/μ/g,'µ')
    .replace(/[хx×]\s*10(?=[⁰¹²³⁴⁵⁶⁷⁸⁹^])/gu,'×10');
  return norm(name).replace(/\s+/g,' ')+'|'+formatted;
}
function indicatorGroups(){
  const groups=new Map();
  for(const file of labs()){
    const info=reportInfo(file);
    const date=info.date||info.documentDate||'';
    const dateSource=info.date?(info.dateEstimated?'Дата подставлена':''):(info.documentDate?'Дата по бланку':'');
    for(const row of info.rows){
      const series=labSeriesPoint(row,info.name);
      if(!groups.has(series.key))groups.set(series.key,{key:series.key,marker:series.marker,name:series.name,specimen:series.specimen,unit:series.unit,points:[]});
      groups.get(series.key).points.push({...series,raw:row,date,dateSource,source:file.id,lab:info.laboratory,report:info.name});
    }
  }
  return [...groups.values()].sort((a,b)=>a.name.localeCompare(b.name,'ru'));
}
function seriesDescription(group){
  return [group.specimen||'Биоматериал не уточнён',group.unit].filter(Boolean).join(' · ');
}
function labDateLabel(date){
  return dateLabel(date,{day:'numeric',month:'long',year:'numeric'});
}
function indicatorCards(){
  const cards=new Map();
  for(const group of indicatorGroups()){
    const id='indicator:'+group.marker;
    if(!cards.has(id))cards.set(id,{id,name:group.name,series:[]});
    cards.get(id).series.push(group);
  }
  return [...cards.values()];
}
function indicatorSearchRows(){
  return indicatorCards().map(card=>{
    const points=card.series.flatMap(group=>group.points);
    const description=card.series.length===1?seriesDescription(card.series[0]):'Разные биоматериалы или единицы';
    return {type:'trend',id:card.id,title:card.name,icon:'trend',meta:description+' · результатов: '+points.length,
      terms:[...new Set(points.flatMap(p=>[p.search,p.raw.name,p.report,p.lab,tagLabels('lab',p.source)]))].filter(Boolean).join(' ')};
  });
}
function labDraftListing(query,category){
  if(readOnly)return '';
  const drafts=current().files.filter(file=>{
    if(file.category!=='Лаборатория'||file.lab&&!file.labDraft)return false;
    const draft=file.labDraft;
    if(category!=='Все'&&(draft?.category||'Другое')!==category)return false;
    const terms=[file.name,draft?.name,draft?.laboratory,...(draft?.rows||[]).map(row=>row.name),tagLabels('lab',file.id)];
    return norm(terms.filter(Boolean).join(' ')).includes(norm(query));
  });
  if(!drafts.length)return '';
  return '<section class="review-queue"><h3>Требуют сверки</h3>'+drafts.map(file=>
    resultRow('verifyLab',file.id,file.name,'Сверить данные','edit')
  ).join('')+'</section>';
}
function labInput(row={}){
  return `<fieldset class="rx-inputs lab-input"><legend>Показатель</legend><label>Название<input name="marker" value="${esc(row.name)}" required></label>
    <div class="intake-pair"><label>Результат<input name="reading" required value="${esc(row.value)}"></label>
    <label>Единица <small>для числового результата</small><input name="unit" value="${esc(row.unit)}"></label></div>
    <label>Биоматериал <small>из бланка</small><input name="specimen" list="specimen-options" value="${esc(row.specimen)}"></label>
    <label>Референсный диапазон из бланка<input name="range" value="${esc(row.range)}"></label>${act('dropLab','Убрать показатель','','inline-action')}</fieldset>`;
}
const labReads=new Map();
function readLabDraft(patient,id,progress=()=>{}){
  const archive=stateKey,generation=prototypeState.generation;
  const findFile=()=>stateKey===archive&&prototypeState.generation===generation?
    prototypeState.profiles[patient]?.files.find(file=>file.id===id&&file.category==='Лаборатория'):null;
  const file=findFile(),key=archive+'/'+patient+'/'+id;
  if(!file||file.labDraft||file.lab)return Promise.resolve(file?.labDraft||file?.lab);
  if(!labReads.has(key))labReads.set(key,(async()=>{
    let raw='';const issues=[];
    try {
      const blob=await fileBlob(patient+'/'+id);
      raw=await recognizeDocument(new File([blob],file.name,{type:file.type}),isPdf(file),progress,issues,{pdfRows:true});
    }catch{/* The original remains available for manual reconciliation. */}
    const target=findFile();
    if(!target||readOnly)return;
    if(target.labDraft||target.lab)return target.labDraft||target.lab;
    const draft=parseLabText(raw,target.name);
    Object.assign(target,{issues,labRaw:raw,labDraft:draft});
    saveState();return draft;
  })().finally(()=>labReads.delete(key)));
  return labReads.get(key);
}
async function verifyLab(id){
  const f=current().files.find(x=>x.id===id&&x.category==='Лаборатория');if(!f)return;
  const patient=person.id, route=routes.at(-1);
  let draft=f.labDraft||f.lab;
  if(!draft){
    openPanel(person.name,'Чтение бланка','<p id="lab-progress" role="status">Распознаём документ на устройстве…</p>');
    draft=await readLabDraft(patient,id,msg=>{if(routes.at(-1)===route){const el=document.querySelector('#lab-progress');if(el)el.textContent=msg}});
    if(!draft||!panel.open||routes.at(-1)!==route||person.id!==patient)return;
  }
  const today=todayLocal(),date=draft.date||today;
  const estimatedDate=!draft.date||draft.dateEstimated===true?date:'';
  openPanel(person.name,'Сверить лабораторный бланк',`<form id="lab-form" data-id="${esc(id)}" data-estimated-date="${esc(estimatedDate)}" class="edit-form">
    ${f.duplicateLab&&current().files.some(other=>other.id===f.duplicateLab&&other.lab)?'<p class="hint">Такие результаты уже сохранены в другом бланке этого профиля.</p>'+act('lab','Открыть существующий анализ',f.duplicateLab,'text-button'):''}
    <label>Название исследования<input name="title" required value="${esc(draft.name)}"></label>
    <div class="intake-pair"><div><label>Дата взятия образца<input type="date" name="date" required max="${today}" value="${esc(date)}" ${estimatedDate?'aria-describedby="lab-date-estimate"':''}></label>
    ${estimatedDate?'<p id="lab-date-estimate" class="hint">Подставлена дата ввода. При необходимости исправьте её по бланку.</p>':''}</div>
    <label>Лаборатория<input name="laboratory" value="${esc(draft.laboratory)}"></label></div>
    <label>Категория<select name="category">${['Другое','Гематология','Биохимия'].map(c=>'<option '+(draft.category===c?'selected':'')+'>'+c+'</option>').join('')}</select></label>
    <details><summary>Распознанный текст</summary><pre>${esc(f.labRaw||'Введите результаты по оригиналу.')}</pre></details>
    <datalist id="specimen-options">${['Цельная кровь','Плазма','Сыворотка','Моча','Капиллярная кровь','Венозная кровь'].map(s=>'<option>'+s+'</option>').join('')}</datalist>
    <p class="hint">Для сравнения между бланками нужен биоматериал. Если он неизвестен, результат останется отдельно.</p>
    <div id="lab-rows">${(draft.rows.length?draft.rows:[{}]).map(row=>labInput({...row,specimen:labSpecimenFor(row,draft.name)})).join('')}</div>${act('appendLab','Добавить показатель','','button secondary','plus')}
    <label class="unknown"><input name="verified" type="checkbox" required>Сверено с оригиналом</label>
    <p class="error" role="alert"></p><div class="actions">${act('deferLab','Уточнить позже',id,'button secondary')}<button class="button primary">Сохранить результаты</button></div></form>`);
  const form=document.querySelector('#lab-form');
  const estimate=form.querySelector('#lab-date-estimate');
  if(estimate)form.elements.date.addEventListener('input',event=>{estimate.hidden=event.target.value!==estimatedDate});
  clarifyFields(form,[['date','Когда взяли образец?'],['marker','Как называется показатель?'],['reading','Какое значение в бланке?'],['unit','В каких единицах указан результат?']],draft.rows.length?'':'Какие показатели, значения и единицы указаны в бланке?');
  previewImportTags(form,form.querySelector('details'),()=>[f.name,form.elements.title.value,form.elements.category.value,f.category].join(' '));
  setupSourceView(f,form,null,draft.position);
  showUncertainText(form,f.issues);
}
registerFieldRules('lab-form',(form,add)=>{
  const rows=form.querySelectorAll('.lab-input');
  if(!rows.length)add(form.querySelector('[data-action=appendLab]'),'Добавьте хотя бы один показатель.');
  for(const row of rows){
    const [marker,reading,unit,range]=['marker','reading','unit','range'].map(name=>row.querySelector('[name="'+name+'"]'));
    for(const field of [marker,reading,unit,range]){
      if(needsClarification(field.value))add(field,'Уточните значение по оригиналу.');
    }
    if(/^[<>≤≥+−-]?\s*\d/.test(reading.value.trim())&&!unit.value.trim())add(unit,'Укажите единицу числового результата.');
  }
});
function saveLab(form,defer=false){
  if(readOnly)return;
  const f=current().files.find(x=>x.id===form.dataset.id);
  if(!f)return;
  const value=(el,name)=>el.querySelector('[name="'+name+'"]').value.trim();
  const data={name:value(form,'title'),date:value(form,'date'),laboratory:value(form,'laboratory'),category:value(form,'category'),
    rows:[...form.querySelectorAll('.lab-input')].map(el=>({name:value(el,'marker'),value:value(el,'reading'),unit:value(el,'unit'),range:value(el,'range'),specimen:value(el,'specimen')}))};
  if(data.date&&data.date===form.dataset.estimatedDate)data.dateEstimated=true;
  if(!defer&&(!f.lab||labIdentity(f.lab)!==labIdentity(data))){
    const key=labIdentity(data),match=latestProfile().files.find(other=>other.id!==f.id&&other.lab&&labIdentity(other.lab)===key);
    if(match)return duplicateCard(form,'lab',match.id,'Открыть существующий анализ');
  }
  const before={...f};
  if(defer)f.labDraft={...data,position:form.sourcePosition()};
  else{f.lab=data;delete f.labDraft;delete f.duplicateLab}
  if(!saveState()){delete f.lab;Object.assign(f,before);form.querySelector('.error').textContent='Не удалось сохранить бланк.';return}
  render();if(defer)panel.close();else replaceRoute('lab',f.id);
}
function labCard(id){
  const f=labs().find(x=>x.id===id);if(!f)return;
  const data=reportInfo(f);
  openPanel('Лабораторный бланк',data.name,'<p class="detail-meta">'+esc([labDateLabel(data.date),data.dateEstimated?'Дата подставлена':'',data.laboratory].filter(Boolean).join(' · '))+'</p>'+
    tagStrip('lab',id)+data.rows.map(r=>{
      const point=labSeriesPoint(r,data.name);
      return '<div class="lab-value"><div><small>'+esc([r.name,point.specimen].filter(Boolean).join(' · '))+'</small><strong>'+esc(r.value)+' '+esc(r.unit)+'</strong><small>'+esc(r.range?'Диапазон по бланку '+r.range:'Диапазон не указан')+'</small></div>'+act('trend','Динамика',point.key,'inline-action','trend')+'</div>';
    }).join('')+
    '<div class="actions">'+(f.visit?act('visit','К визиту',f.visit,'button secondary'):'')+act('file','Исходный бланк',id,'button secondary','clip')+(!readOnly?act('consult','Обсудить с ИИ','lab:'+id,'button primary','spark'):'')+'</div>'+
    (!readOnly&&f.lab?act('verifyLab','Исправить результаты',id,'text-button','edit'):'')+deletionButton('files',id,'Удалить анализ и бланк'));
}
function placePointCaptions(marks,width,height){
  const inset=9,captionHeight=34,gap=6,placed=[],lanes=[];
  const segments=marks.slice(1).map((mark,i)=>[marks[i],mark]);
  function crosses(box,[a,b]){
    const left=Math.max(a.x,box.x),right=Math.min(b.x,box.x+box.w);
    if(left>right)return false;
    const y=x=>a.y+(b.y-a.y)*(x-a.x)/(b.x-a.x);
    const top=a.x===b.x?Math.min(a.y,b.y):Math.min(y(left),y(right));
    const bottom=a.x===b.x?Math.max(a.y,b.y):Math.max(y(left),y(right));
    return top<box.y+captionHeight&&bottom>box.y;
  }
  for(const mark of marks){
    const {x,y,labelWidth:w}=mark;
    const side=y>height/2?1:-1;
    const positions=[[0,side],[0,-side],[-1,0],[1,0],[-1,side],[1,side],[-1,-side],[1,-side]];
    const candidates=[12,24,36].flatMap(distance=>positions.map(([dx,dy])=>({w,
      x:Math.max(inset,Math.min(width-inset-w,x-w/2+dx*(w/2+distance))),
      y:y-captionHeight/2+dy*(captionHeight/2+distance)})))
      .filter(box=>box.y>=inset&&box.y+captionHeight<=height-inset&&
        !marks.some(p=>p.x>box.x-gap&&p.x<box.x+box.w+gap&&p.y>box.y-gap&&p.y<box.y+captionHeight+gap)&&
        !placed.some(p=>box.x<p.x+p.w+gap&&box.x+box.w+gap>p.x&&box.y<p.y+captionHeight+gap&&box.y+captionHeight+gap>p.y));
    const near=candidates.find(box=>!segments.some(segment=>crosses(box,segment)))||candidates[0];
    if(near){mark.caption=near;placed.push(near);continue}
    let lane=lanes.at(-1);
    if(!lane||lane.right+gap+w>width-inset){lane={right:inset-gap};lanes.push(lane)}
    mark.caption={x:Math.min(width-inset-w,Math.max(lane.right+gap,x-w/2)),y:inset-lanes.length*(captionHeight+gap),w};
    lane.right=mark.caption.x+w;
  }
  return lanes.length*(captionHeight+gap);
}

function pointChart(points,action){
  const plotted=points.map(p=>({...p,n:Number(String(p.value).replace(',','.')),t:Date.parse(p.date)}))
    .filter(p=>/^[+-]?\d+(?:[.,]\d+)?$/.test(String(p.value))&&Number.isFinite(p.n)&&Number.isFinite(p.t));
  if(!plotted.length)return '<p class="hint">В списке доступны исходные результаты. Для графика нужны числовые значения.</p>';
  const lo=Math.min(...plotted.map(p=>p.n)),hi=Math.max(...plotted.map(p=>p.n)),start=plotted[0].t,end=plotted.at(-1).t;
  const width=360,left=48,right=331,plotHeight=219,axis=206;
  const marks=plotted.map(p=>{
    const x=start===end?(left+right)/2:left+(right-left)*(p.t-start)/(end-start);
    const y=hi===lo?110:162-107*(p.n-lo)/(hi-lo);
    const date=[p.date.slice(0,10).split('-').reverse().join('.'),p.date.slice(11,16)].filter(Boolean).join(' ');
    const value=String(p.value).replace('.',',');
    const labelWidth=Math.min(width-18,Math.max(72,date.length*7+10,value.length*8+10));
    return {...p,x,y,dateLabel:date,valueLabel:value,labelWidth};
  });
  const extraHeight=placePointCaptions(marks,width,plotHeight);
  const pointLabel=p=>[p.date,p.value+' '+(p.unit||''),p.dateSource,p.raw?['По бланку',p.raw.name,p.raw.value,p.raw.unit,p.raw.range?'(референс '+p.raw.range+')':''].filter(Boolean).join(' '):p.range?'Диапазон '+p.range:'',p.lab,action==='file'?'Открыть оригинал':'Открыть измерение'].filter(Boolean).join(' · ');
  return `<svg class="trend-chart" viewBox="0 ${-extraHeight} ${width} ${plotHeight+extraHeight}" role="group" aria-label="График по датам">
    <path d="${(hi===lo?[110]:[55,108.5,162]).map(y=>`M${left} ${y}H${right}`).join(' ')}" stroke="#d9e6d9"/>
    <path d="M${left} ${axis}H${right}" stroke="#b9cbbc"/>
    ${marks.map(p=>{
      const {x,y,w}=p.caption;
      const anchorX=Math.max(x+5,Math.min(x+w-5,p.x)),anchorY=Math.max(y,Math.min(y+34,p.y));
      return `<path class="point-leader" aria-hidden="true" d="M${anchorX} ${anchorY} L${p.x} ${p.y}"/>`;
    }).join('')}
    <polyline fill="none" stroke="#337256" stroke-width="2.5" points="${marks.map(p=>p.x+','+p.y).join(' ')}"/>
    ${marks.map(p=>'<g role="button" tabindex="0" data-action="'+action+'" data-id="'+esc(p.source)+'" aria-label="'+esc(pointLabel(p))+'"><title>'+esc(pointLabel(p))+'</title><circle cx="'+p.x+'" cy="'+p.y+'" r="12" fill="transparent"/><circle cx="'+p.x+'" cy="'+p.y+'" r="4.5" fill="#246044"/></g>').join('')}
    ${marks.map(p=>{
      const {x,y,w}=p.caption,center=x+w/2;
      return `<rect class="point-caption" aria-hidden="true" x="${x}" y="${y}" width="${w}" height="34" rx="6"/>
        <text class="point-value" aria-hidden="true" text-anchor="middle" x="${center}" y="${y+14}">${esc(p.valueLabel)}</text>
        <text class="point-date" aria-hidden="true" text-anchor="middle" x="${center}" y="${y+28}">${esc(p.dateLabel)}</text>`;
    }).join('')}
    </svg>`;
}
function indicatorView(id){
  const fixture=/^\d+$/.test(id)?labRows[Number(id)]:null;
  const card=indicatorCards().find(c=>c.id===id||c.series.some(g=>fixture?
    g.points.some(p=>p.raw.name===fixture.name&&Object.hasOwn(fixture.values,p.source)):g.key===id));
  if(card)openPanel('Динамика показателя',card.name,card.series.map(indicatorSeriesView).join(''));
}
function indicatorSeriesView(group){
  const points=group.points.sort((a,b)=>a.date.localeCompare(b.date));
  return '<section class="panel-section"><p class="detail-meta">'+esc(group.unit)+'</p><p class="hint">'+esc(group.specimen||'Биоматериал не уточнён')+'</p>'+pointChart(points,'file')+
    '<h3>Результаты за всё время</h3>'+points.map(p=>{
      const comparison=p.unit!==p.raw.unit&&p.value!==p.raw.value?'Для сравнения '+p.value.replace('.',',')+' '+p.unit:'';
      const details=[p.raw.name,comparison,p.dateSource,p.lab,p.raw.range?'Диапазон '+p.raw.range:'Диапазон не указан'];
      return resultRow('file',p.source,labDateLabel(p.date)+' · '+[p.raw.value,p.raw.unit].filter(Boolean).join(' '),details.filter(Boolean).join(' · '),'lab');
    }).join('')+
    (readOnly?'':act('consult','Обсудить с ИИ','indicator:'+group.key,'button primary','spark'))+'</section>';
}
