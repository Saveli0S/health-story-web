'use strict';

function doctorLabel(id){
  const doctor=person.doctors[id]||[];
  return [doctor[1],doctor[0]].filter(Boolean).join(' · ');
}
function setupSourceView(file,form,original,position={}){
  const shell=document.createElement('div');
  shell.className='source-workspace';
  const switcher=document.createElement('div');
  switcher.className='source-tabs';
  switcher.innerHTML='<button type="button" data-pane="fields" aria-pressed="true">Поля</button><button type="button" data-pane="paper" aria-pressed="false">Оригинал</button>';
  const aside=document.createElement('aside');
  aside.className='source-side';
  aside.innerHTML='<div class="paper-tools"><strong>Оригинал</strong><label>Масштаб <select aria-label="Масштаб оригинала">'+[100,150,200,300].map(n=>'<option value="'+n+'">'+n+' %</option>').join('')+'</select></label></div><div class="paper-scroll"><div class="source-preview"></div></div>';
  const fields=document.createElement('div');fields.className='fields-side';
  const first=form.parentElement.querySelector('.import-source')||form;
  first.before(switcher,shell);shell.append(aside,fields);
  if(first!==form)fields.append(first);
  fields.append(form);shell.dataset.pane='fields';
  const viewport=aside.querySelector('.paper-scroll'),zoom=aside.querySelector('select');
  const preview=aside.querySelector('.source-preview');
  const applyZoom=()=>{viewport.firstElementChild.style.width=zoom.value+'%'};
  zoom.value=String(position.zoom||100);applyZoom();zoom.onchange=applyZoom;
  const fieldMatches=Array.from(form.elements).filter(e=>e.name===position.field&&(!position.med||e.closest('[data-med]')?.dataset.med===position.med));
  let lastFocus=fieldMatches[position.fieldIndex||0]||null;
  let paperTop=position.top||0,paperLeft=position.left||0,fieldTop=position.fieldTop||0;
  form.addEventListener('focusin',e=>{if(e.target.name&&e.target.type!=='submit')lastFocus=e.target});
  const markPane=key=>{
    if(shell.dataset.pane==='paper'){paperTop=viewport.scrollTop;paperLeft=viewport.scrollLeft}
    if(shell.dataset.pane==='fields')fieldTop=fields.scrollTop;
    shell.dataset.pane=key;
    for(const b of switcher.children)b.setAttribute('aria-pressed',String(b.dataset.pane===key));
    if(key==='fields'){fields.scrollTop=fieldTop;lastFocus?.focus({preventScroll:true})}
    else{viewport.scrollTop=paperTop;viewport.scrollLeft=paperLeft}
  };
  switcher.onclick=e=>{if(e.target.dataset.pane)markPane(e.target.dataset.pane)};
  form.sourcePosition=()=>({sourceId:aside.querySelector('.original-choice select')?.value||'',page:Number(viewport.querySelector('select')?.value||1),zoom:Number(zoom.value),
    top:aside.getClientRects().length?viewport.scrollTop:paperTop,left:aside.getClientRects().length?viewport.scrollLeft:paperLeft,
    fieldTop:fields.getClientRects().length?fields.scrollTop:fieldTop,field:lastFocus?.name||'',med:lastFocus?.closest('[data-med]')?.dataset.med||'',
    fieldIndex:Math.max(0,Array.from(form.elements).filter(e=>e.name===lastFocus?.name&&e.closest('[data-med]')===lastFocus?.closest('[data-med]')).indexOf(lastFocus))});
  previewOriginal(file,preview,original).then(async()=>{
    if(!preview.isConnected)return;
    const pages=preview.querySelector('select');
    if(pages&&position.page>1&&position.page<=pages.length){pages.value=String(position.page);await pages.onchange()}
    viewport.scrollLeft=position.left||0;viewport.scrollTop=position.top||0;
  });
  fields.scrollTop=fieldTop;
  if(lastFocus){lastFocus.focus({preventScroll:true});lastFocus.scrollIntoView({block:'nearest'})}
}
function reviewQueue(){
  const pending=current().files.filter(f=>(f.intake&&!f.checked)||(f.category==='Лаборатория'&&(!f.lab||f.labDraft)));
  const drafts=current().visitDrafts.filter(d=>!d.parent),queued=current().treatmentQueue;
  if(readOnly)return '';
  const exams=examDraftListing();
  if(!pending.length&&!drafts.length&&!queued.length&&!exams)return '';
  return '<section class="review-queue"><h2>Требует проверки</h2>'+exams+queued.map(q=>resultRow('consent',q.id,visitById(q.id)?.[2]||'Разбор лечения',(chatGPT.connected||routerKey)?'Провайдер подключён · проверить запрос':'Разбор в очереди · ожидает подключения','spark')).join('')+drafts.map(d=>resultRow('resumeVisit',d.id,d.name,(d.state==='queued'?'В очереди · ':'Проверить данные · ')+draftGroup(d).length+' док.','edit')).join('')+pending.map(f=>{
    const busy=jobs.has(f.id),action=f.category==='Лаборатория'?'verifyLab':busy?'intake':'verifyFile';
    const hint=f.draft?.meds?.find(m=>!m.strength||needsClarification(m.strength))?'Уточнить дозировку':busy?'Распознаётся':'Сверить данные';
    return resultRow(action,busy?f.visit:f.id,f.name,[visitById(f.visit)?.[2],hint].filter(Boolean).join(' · '),'edit');
  }).join('')+'</section>';
}

function setupBatchPreview(form,photo,position={}){
  if(!photo.docs||photo.docs.length<2)return;
  const aside=form.closest('.source-workspace').querySelector('.source-side'),scroll=aside.querySelector('.paper-scroll');
  const pick=document.createElement('label');pick.className='original-choice';pick.textContent='Документ для сверки';
  const select=document.createElement('select');pick.append(select);aside.prepend(pick);
  for(const d of photo.docs)select.add(new Option(d.name,d.id,false,d.id===photo.main));
  select.onchange=async()=>{
    const d=photo.docs.find(d=>d.id===select.value),container=document.createElement('div');
    container.className='source-preview';scroll.replaceChildren(container);
    container.style.width=aside.querySelector('.paper-tools select').value+'%';
    await previewOriginal(d,container);
    if(container.isConnected&&position.sourceId===d.id){
      const pages=container.querySelector('select');
      if(pages&&position.page>1&&position.page<=pages.length){pages.value=String(position.page);await pages.onchange()}
      scroll.scrollLeft=position.left||0;scroll.scrollTop=position.top||0;
    }
  };
  if(position.sourceId&&position.sourceId!==photo.main&&photo.docs.some(d=>d.id===position.sourceId)){select.value=position.sourceId;select.onchange()}
}
function clarifyFields(form,fields,fallback=''){
  const box=document.createElement('div');box.className='clarifications';box.setAttribute('role','status');form.prepend(box);
  function update(){
    const issues=[];
    for(const [name,question] of fields)for(const input of form.querySelectorAll('[name="'+name+'"]')){
      if(input.closest('[hidden]')||input.disabled)continue;
      const reading=input.closest('fieldset')?.querySelector('[name=reading]')?.value||'';
      const unitRequired=name==='unit'&&/^\s*[<>≤≥+-]?\s*\d/.test(reading);
      const missing=!input.value.trim()&&(input.required||unitRequired);
      if(missing||needsClarification(input.value)||(['drug','strength','instructions'].includes(name)&&unclearRxField(input.value))){
        const label=input.closest('fieldset[data-med]')?.querySelector('[name=drug]')?.value;
        issues.push({input,question:question+(label?' ('+label+')':'')});
      }
    }
    box.replaceChildren();
    const needsFallback=fallback&&(form.id==='verify-form'?!form.elements.none.checked&&!form.querySelector('[data-med]'):!form.elements.marker?.value);
    if(!issues.length&&!needsFallback){box.hidden=true;return}
    box.hidden=false;
    const title=document.createElement('strong');title.textContent='Уточните по оригиналу';box.append(title);
    for(const {input,question} of issues){
      const b=document.createElement('button');b.type='button';b.className='text-button';b.textContent=question;
      b.onclick=()=>input.focus();box.append(b);
    }
    if(needsFallback){const p=document.createElement('p');p.textContent=fallback;box.append(p)}
  }
  form.refreshClarifications=update;
  form.addEventListener('input',update);form.addEventListener('change',update);
  const rows=form.querySelector('#rx-rows,#lab-rows');if(rows)new MutationObserver(update).observe(rows,{childList:true});
  update();
}
function showUncertainText(form,issues=[]){
  if(!issues.length)return;
  const box=document.createElement('div');box.className='clarifications';
  box.innerHTML='<strong>Что написано в этих строках?</strong><p>Распознаватель не уверен в отдельных словах. Сравните строки с оригиналом и исправьте нужные поля.</p>'+
    '<ul>'+issues.map(line=>'<li>Стр. '+esc(line.page)+' · '+esc(line.text)+'</li>').join('')+'</ul>';
  form.prepend(box);
}
