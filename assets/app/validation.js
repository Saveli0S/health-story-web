'use strict';

const fieldRules=new Map(),fieldNotices=new WeakMap(),rejectedValues=new WeakMap();
const validationFocus=new WeakSet(),validationRefresh=new WeakSet();
let fieldNoticeId=0;
const fieldValue=field=>field.type==='file'?field.files:field.value;

function registerFieldRules(id,validate){
  const rules=fieldRules.get(id)||[];
  rules.push(validate);fieldRules.set(id,rules);
}

function nativeFieldIssue(field){
  if(!field.willValidate)return '';
  const {validity,type,value}=field;
  if(validity.badInput)return ['date','datetime-local'].includes(type)?'Введите корректную дату.':'Введите корректное значение.';
  if(validity.valueMissing||(field.required&&typeof value==='string'&&type!=='radio'&&!value.trim())){
    if(type==='checkbox')return 'Подтвердите этот пункт.';
    if(type==='file')return 'Выберите файл.';
    if(type==='radio'||field.matches('select'))return 'Выберите значение.';
    if(type==='date'||type==='datetime-local')return 'Укажите дату.';
    return 'Заполните это поле.';
  }
  const isDate=type==='date'||type==='datetime-local';
  if(validity.rangeUnderflow)return (isDate?'Укажите дату не раньше ':'Укажите значение не меньше ')+field.min+'.';
  if(validity.rangeOverflow)return (isDate?'Укажите дату не позже ':'Укажите значение не больше ')+field.max+'.';
  if(validity.tooLong)return 'Допустимо не более '+field.maxLength+' символов.';
  if(validity.tooShort)return 'Введите не менее '+field.minLength+' символов.';
  return validity.valid?'':'Проверьте формат значения.';
}

function rejectedFieldIssue(field,includeNonBlocking){
  const rejection=rejectedValues.get(field);
  if(!rejection)return '';
  if(rejection.value===fieldValue(field)&&(!rejection.related||rejection.relatedValue===fieldValue(rejection.related)))
    return rejection.blocking||includeNonBlocking?rejection.message:'';
  rejectedValues.delete(field);return '';
}

function collectFieldIssues(form,includeNonBlocking=false){
  const issues=new Map();
  const add=(control,message)=>{
    const field=typeof control==='string'?form.elements.namedItem(control):control;
    if(message&&field?.form===form&&!field.disabled&&!field.closest('[hidden]')&&!issues.has(field))issues.set(field,message);
  };
  for(const field of form.elements){
    add(field,nativeFieldIssue(field));
    add(field,rejectedFieldIssue(field,includeNonBlocking));
  }
  for(const validate of fieldRules.get(form.id)||[])validate(form,add);
  for(const validate of form.localFieldRules||[])validate(form,add);
  return issues;
}

function paintFieldIssue(field,message){
  let notice=fieldNotices.get(field);
  if(!message){
    if(!notice)return;
    const describedBy=(field.getAttribute('aria-describedby')||'').split(/\s+/).filter(id=>id&&id!==notice.id);
    if(describedBy.length)field.setAttribute('aria-describedby',describedBy.join(' '));else field.removeAttribute('aria-describedby');
    field.removeAttribute('aria-invalid');notice.remove();fieldNotices.delete(field);return;
  }
  if(!notice){
    notice=document.createElement('span');notice.className='field-issue';notice.id='field-issue-'+(++fieldNoticeId);
    const label=field.closest('label');
    if(field.type==='checkbox'||field.type==='radio'||label?.classList.contains('file-picker'))(label||field).after(notice);
    else{if(label)notice.setAttribute('aria-hidden','true');field.after(notice)}
    field.setAttribute('aria-describedby',[field.getAttribute('aria-describedby'),notice.id].filter(Boolean).join(' '));
    field.setAttribute('aria-invalid','true');fieldNotices.set(field,notice);
  }
  if(notice.textContent!==message)notice.textContent=message;
}

function focusInvalidField(form){
  if(validationFocus.has(form))return;
  validationFocus.add(form);
  requestAnimationFrame(()=>{
    validationFocus.delete(form);
    if(!form.isConnected)return;
    const field=[...form.elements].find(el=>fieldNotices.has(el)&&!el.disabled&&!el.closest('[hidden]'));
    if(!field)return;
    for(let detail=field.closest('details');detail;detail=detail.parentElement?.closest('details'))detail.open=true;
    field.focus({preventScroll:true});(field.closest('label')||field).scrollIntoView({block:'nearest',inline:'nearest'});
  });
}

function validateInlineFields(form){
  const issues=collectFieldIssues(form);
  for(const field of form.elements)paintFieldIssue(field,issues.get(field));
  if(issues.size)focusInvalidField(form);
  return !issues.size;
}

function refreshInlineFields(form){
  if(!form?.isConnected||!form.querySelector('.field-issue'))return;
  const issues=collectFieldIssues(form,true);
  for(const field of form.elements)if(fieldNotices.has(field))paintFieldIssue(field,issues.get(field));
}

function rejectFieldValue(field,message,{related,blocking=true}={}){
  rejectedValues.set(field,{value:fieldValue(field),message,related,relatedValue:related&&fieldValue(related),blocking});
  paintFieldIssue(field,message);
  if(field.form)focusInvalidField(field.form);else field.focus();
}

document.addEventListener('invalid',event=>{
  const form=event.target.form;if(!form)return;
  event.preventDefault();
  if(!validationFocus.has(form))validateInlineFields(form);
},true);

document.addEventListener('submit',event=>{
  const form=event.target;
  if(form.noValidate||event.submitter?.formNoValidate||validateInlineFields(form))return;
  event.preventDefault();event.stopImmediatePropagation();
},true);

for(const type of ['input','change','click'])document.addEventListener(type,event=>{
  const field=event.target,form=field.form||field.closest?.('form');
  if(!form){
    if(rejectedValues.has(field))paintFieldIssue(field,rejectedFieldIssue(field,true));
    return;
  }
  if(!form?.querySelector('.field-issue')||validationRefresh.has(form))return;
  validationRefresh.add(form);
  requestAnimationFrame(()=>{validationRefresh.delete(form);refreshInlineFields(form)});
},true);
