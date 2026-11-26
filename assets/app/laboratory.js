'use strict';

function reportInfo(file){
  if(file.lab)return file.lab;
  if(!file.file)return null;
  return {name:file.name,date:file.date,laboratory:'Лаборатория «Линия»',category:file.id==='chem'?'Биохимия':'Гематология',
    rows:labRows.filter(r=>Object.hasOwn(r.values,file.id)).map(r=>({name:r.name,value:String(r.values[file.id]),unit:r.unit,range:r.range}))};
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
    for(const row of info.rows){
      const key=indicatorKey(row.name,row.unit);
      if(!groups.has(key))groups.set(key,{key,name:row.name,unit:row.unit,points:[]});
      groups.get(key).points.push({...row,date:info.date,source:file.id,lab:info.laboratory});
    }
  }
  return [...groups.values()].sort((a,b)=>a.name.localeCompare(b.name,'ru'));
}
function parseLabText(raw,filename){
  const lines=raw.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  const title=lines.find(s=>/анализ|гемограмм|биохими|исследование/i.test(s)&&!s.includes(' / '));
  const laboratory=lines.find(s=>/^лаборатор[ия]/i.test(s))||'';
  const dateText=raw.match(/(?:дата\s+(?:взятия|забора|анализа|исследования)(?:\s+(?:образца|крови|материала))?)\s*[:\s]*([\d./-]+)/i)?.[1]||'';
  const parts=dateText.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
  const date=parts?[parts[3],parts[2].padStart(2,'0'),parts[1].padStart(2,'0')].join('-'):/^\d{4}-\d\d-\d\d$/.test(dateText)?dateText:'';
  const rows=[];
  for(let i=0;i<lines.length;i++){
    const line=lines[i].replace(/\s+/g,' ');
    const m=line.match(/^(?:(.+?)\s*[:|;]?\s+)?([<>≤≥]?\s*-?\d+(?:[.,]\d+)?)\s+((?:[×хx]\s*)?[\p{L}%µμ×^0-9⁰¹²³⁴⁵⁶⁷⁸⁹./]+(?:\s*\/\s*[\p{L}]+)?)(?:\s+(.*))?$/iu);
    if(!m){
      const unclear=line.match(/^(.+?)\s+([?？�]+|неразборчиво)\s*([^\s]*\/[^\s]+)?(?:\s+(.+))?$/iu);
      if(unclear)rows.push({name:unclear[1],value:unclear[2],unit:unclear[3]||'',range:unclear[4]||''});
      continue;
    }
    if(!/[/%]|^(?:фл|пг|сек|ммоль|мкмоль)/i.test(m[3]))continue;
    const name=(m[1]||lines[i-1]||'').replace(/[:;|]$/,'').trim();
    if(!name||name.length>100||!/\p{L}/u.test(name))continue;
    const range=(m[4]||'').replace(/^(?:референсный\s+(?:диапазон|интервал)(?:\s+бланка)?|референсные значения|диапазон(?:\s+бланка)?|норма)\s*[:|]?\s*/i,'').trim();
    rows.push({name,value:m[2].trim(),unit:m[3],range});
  }
  return {name:title||filename.replace(/\.[^.]+$/,''),date,laboratory,category:'Другое',rows};
}
function labInput(row={}){
  return `<fieldset class="rx-inputs lab-input"><legend>Показатель</legend><label>Название<input name="marker" value="${esc(row.name)}" required></label>
    <div class="intake-pair"><label>Результат<input name="reading" required value="${esc(row.value)}"></label>
    <label>Единица <small>для числового результата</small><input name="unit" value="${esc(row.unit)}"></label></div>
    <label>Референсный диапазон из бланка<input name="range" value="${esc(row.range)}"></label>${act('dropLab','Убрать показатель','','inline-action')}</fieldset>`;
}
const labReads=new Map();
async function verifyLab(id){
  const f=current().files.find(x=>x.id===id&&x.category==='Лаборатория');if(!f)return;
  const patient=person.id, route=routes.at(-1);
  let draft=f.labDraft||f.lab;
  if(!draft){
    openPanel(person.name,'Чтение бланка','<p id="lab-progress" role="status">Распознаём документ на устройстве…</p>');
    if(!labReads.has(id))labReads.set(id,(async()=>{
      let raw='';const issues=[];try{
        const blob=await fileBlob(patient+'/'+id);
        raw=await recognizeDocument(new File([blob],f.name,{type:f.type}),isPdf(f),msg=>{if(routes.at(-1)===route){const el=document.querySelector('#lab-progress');if(el)el.textContent=msg}},issues);
      }catch{/* Manual reconciliation is available if the original cannot be read. */}
      f.issues=issues;f.labRaw=raw;f.labDraft=parseLabText(raw,f.name);saveState();return f.labDraft;
    })().finally(()=>labReads.delete(id)));
    draft=await labReads.get(id);
    if(!panel.open||routes.at(-1)!==route||person.id!==patient)return;
  }
  openPanel(person.name,'Сверить лабораторный бланк',`<form id="lab-form" data-id="${esc(id)}" class="edit-form">
    <label>Название исследования<input name="title" required value="${esc(draft.name)}"></label>
    <div class="intake-pair"><label>Дата взятия образца<input type="date" name="date" required max="${todayLocal()}" value="${esc(draft.date)}"></label><label>Лаборатория<input name="laboratory" value="${esc(draft.laboratory)}"></label></div>
    <label>Категория<select name="category">${['Другое','Гематология','Биохимия'].map(c=>'<option '+(draft.category===c?'selected':'')+'>'+c+'</option>').join('')}</select></label>
    <details><summary>Распознанный текст</summary><pre>${esc(f.labRaw||'Введите результаты по оригиналу.')}</pre></details>
    <div id="lab-rows">${(draft.rows.length?draft.rows:[{}]).map(labInput).join('')}</div>${act('appendLab','Добавить показатель','','button secondary','plus')}
    <label class="unknown"><input name="verified" type="checkbox" required>Сверено с оригиналом</label>
    <p class="error" role="alert"></p><div class="actions">${act('deferLab','Уточнить позже',id,'button secondary')}<button class="button primary">Сохранить результаты</button></div></form>`);
  const form=document.querySelector('#lab-form');
  clarifyFields(form,[['date','Когда взяли образец?'],['marker','Как называется показатель?'],['reading','Какое значение в бланке?'],['unit','В каких единицах указан результат?']],draft.rows.length?'':'Какие показатели, значения и единицы указаны в бланке?');
  previewImportTags(form,form.querySelector('details'),()=>[f.name,form.elements.title.value,form.elements.category.value,f.category].join(' '));
  setupSourceView(f,form,null,draft.position);
  showUncertainText(form,f.issues);
}
function saveLab(form,defer=false){
  const f=current().files.find(x=>x.id===form.dataset.id);
  const value=(el,name)=>el.querySelector('[name="'+name+'"]').value.trim();
  const data={name:value(form,'title'),date:value(form,'date'),laboratory:value(form,'laboratory'),category:value(form,'category'),
    rows:[...form.querySelectorAll('.lab-input')].map(el=>({name:value(el,'marker'),value:value(el,'reading'),unit:value(el,'unit'),range:value(el,'range')}))};
  const unresolved=data.rows.some(r=>!r.name||!r.value||[r.name,r.value,r.unit].some(needsClarification)||(/^[<>≤≥+−-]?\s*\d/.test(r.value)&&!r.unit));
  if(!defer&&(!data.name||!data.date||!data.rows.length||unresolved||!form.elements.verified.checked)){
    form.querySelector('.error').textContent='Уточните неясные значения по оригиналу. Для числового результата укажите единицу или выберите «Уточнить позже».';return;
  }
  const before={...f};
  if(defer)f.labDraft={...data,position:form.sourcePosition()};
  else{f.lab=data;delete f.labDraft}
  if(!saveState()){delete f.lab;Object.assign(f,before);form.querySelector('.error').textContent='Не удалось сохранить бланк.';return}
  render();if(defer)panel.close();else replaceRoute('lab',f.id);
}
function labCard(id){
  const f=labs().find(x=>x.id===id);if(!f)return;
  const data=reportInfo(f);
  openPanel('Лабораторный бланк',data.name,'<p class="detail-meta">'+esc([dateLabel(data.date),data.laboratory].filter(Boolean).join(' · '))+'</p>'+
    tagStrip('lab',id)+data.rows.map(r=>'<div class="lab-value"><div><small>'+esc(r.name)+'</small><strong>'+esc(r.value)+' '+esc(r.unit)+'</strong><small>'+esc(r.range?'Диапазон по бланку '+r.range:'Диапазон не указан')+'</small></div>'+act('trend','Динамика',indicatorKey(r.name,r.unit),'inline-action','trend')+'</div>').join('')+
    '<div class="actions">'+(f.visit?act('visit','К визиту',f.visit,'button secondary'):'')+act('file','Исходный бланк',id,'button secondary','clip')+(!readOnly?act('consult','Обсудить с ИИ','lab:'+id,'button primary','spark'):'')+'</div>'+
    (!readOnly&&f.lab?act('verifyLab','Исправить результаты',id,'text-button','edit'):''));
}
function pointChart(points,action){
  const plotted=points.map((p,index)=>({...p,index,n:Number(String(p.value).replace(',','.')),t:Date.parse(p.date)}))
    .filter(p=>/^[+-]?\d+(?:[.,]\d+)?$/.test(String(p.value))&&Number.isFinite(p.n)&&Number.isFinite(p.t));
  if(!plotted.length)return '<p class="hint">В списке доступны исходные результаты. Для графика нужны числовые значения.</p>';
  const lo=Math.min(...plotted.map(p=>p.n)),hi=Math.max(...plotted.map(p=>p.n)),start=plotted[0].t,end=plotted.at(-1).t;
  const dates=start===end?'<text text-anchor="middle" x="240" y="151">'+esc(plotted[0].date.slice(0,10))+'</text>':
    '<text x="32" y="151">'+esc(plotted[0].date.slice(0,10))+'</text><text text-anchor="end" x="444" y="151">'+esc(plotted.at(-1).date.slice(0,10))+'</text>';
  const xy=plotted.map(p=>({...p,x:start===end?240:62+368*(p.t-start)/(end-start),y:hi===lo?76:120-88*(p.n-lo)/(hi-lo)}));
  const pointLabel=p=>[p.date,p.value+' '+(p.unit||''),p.range?'Диапазон '+p.range:'',p.lab,action==='file'?'Открыть оригинал':'Открыть измерение'].filter(Boolean).join(' · ');
  return `<svg class="trend-chart" viewBox="0 0 480 158" role="group" aria-label="График по датам"><path d="M62 135H440" stroke="#b9cbbc"/><text class="chart-axis" x="55" y="${xy.find(p=>p.n===hi).y+4}" text-anchor="end">${esc(hi.toLocaleString('ru'))}</text>${hi!==lo?'<text class="chart-axis" x="55" y="124" text-anchor="end">'+esc(lo.toLocaleString('ru'))+'</text>':''}<polyline fill="none" stroke="#337256" stroke-width="3" points="${xy.map(p=>p.x+','+p.y).join(' ')}"/>
    ${xy.map(p=>'<g role="button" tabindex="0" data-action="'+action+'" data-id="'+esc(p.source)+'" aria-label="'+esc(pointLabel(p))+'"><title>'+esc(pointLabel(p))+'</title><circle cx="'+p.x+'" cy="'+p.y+'" r="12" fill="transparent"/><circle cx="'+p.x+'" cy="'+p.y+'" r="5" fill="#246044"/></g>').join('')}
    ${dates}</svg>`;
}
function indicatorView(id){
  const fixture=/^\d+$/.test(id)?labRows[Number(id)]:null;
  const group=indicatorGroups().find(g=>g.key===(fixture?indicatorKey(fixture.name,fixture.unit):id));if(!group)return;
  const points=group.points.sort((a,b)=>a.date.localeCompare(b.date));
  openPanel('Динамика показателя',group.name,'<p class="detail-meta">'+esc(group.unit)+'</p>'+pointChart(points,'file')+
    '<h3>Бланки по датам</h3>'+points.map(p=>resultRow('file',p.source,dateLabel(p.date)+' · '+p.value+' '+p.unit,[p.lab,p.range?'Диапазон '+p.range:'Диапазон не указан'].filter(Boolean).join(' · '),'lab')).join('')+
    (readOnly?'':act('consult','Обсудить с ИИ','indicator:'+group.key,'button primary','spark')));
}
