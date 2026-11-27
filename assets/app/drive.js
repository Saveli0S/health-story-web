'use strict';

const driveApi='https://www.googleapis.com/drive/v3';
let driveOperation=null,driveUpload=null;
function driveOwner(){return readJson(familyStateKey)?.family.id||'recovery'}
function driveAllowed(){
  const installed=readJson(familyStateKey);
  return Boolean(crypto.subtle&&viewer==='admin'&&!installed?.access&&(workingFamily||!installed));
}
function driveToken(){
  if(!driveAllowed())throw Error('Доступен только администратору.');
  const token=driveSession.access(driveOwner());if(!token)throw Error('Для продолжения подключите Google Диск ещё раз.');
  return token;
}
async function driveFetch(url,options={}){
  const parsed=new URL(url);
  if(parsed.origin!=='https://www.googleapis.com'||!/^\/(?:upload\/)?drive\/v3\//.test(parsed.pathname))throw Error('Неизвестный адрес Google Диска.');
  let response;
  try{response=await fetch(parsed,{...options,cache:'no-store',credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',
    headers:{...options.headers,Authorization:'Bearer '+driveToken()}})}
  catch(e){if(e instanceof TypeError)throw Error('Нет связи с Google Диском. Можно повторить передачу.');throw e}
  if(response.ok||response.status===308)return response;
  if(response.status===401){driveSession.clear();throw Error('Срок доступа истёк. Подключите Google Диск повторно.')}
  const detail=await response.json().catch(()=>({})),reasons=detail.error?.errors?.map(e=>e.reason)||[];
  if(response.status===507||reasons.includes('storageQuotaExceeded'))throw Error('На Google Диске недостаточно места. Предыдущие копии сохранены.');
  if(response.status===403)throw Error('Google не разрешил операцию. Проверьте разрешение для файлов приложения и доступную квоту.');
  if(response.status===404||response.status===410)throw Object.assign(Error('Файл или сеанс передачи больше недоступен.'),{expired:true});
  throw Error('Google Диск временно недоступен. Повторите операцию.');
}
function drivePanel(){
  if(!driveAllowed())return;
  const connected=Boolean(driveSession.access(driveOwner())),last=workingFamily?deviceAuthority(family.id).driveBackupAt:null;
  const form=connected?'':'<form id="drive-auth" class="edit-form"><label>Публичный Client ID Google<input name="client" required spellcheck="false" autocapitalize="none" value="'+esc(driveSession.client())+'" placeholder="…apps.googleusercontent.com"></label>'+
    '<details><summary>Параметры OAuth</summary><p>Тип клиента — веб-приложение. Адрес возврата для этого браузера</p><code>'+esc(driveSession.redirect)+'</code></details><button class="button primary">Подключить Google Диск</button></form>';
  openPanel('Семейный архив','Google Диск','<p>'+ (connected?'Google Диск подключён в этой вкладке.':'Для доступа выберите Google-аккаунт и разрешите работу с файлами приложения.')+'</p>'+
    (last?'<p>Последняя успешная выгрузка этой семьи · '+esc(stamp(last))+'</p>':'')+form+
    (connected&&workingFamily?'<details><summary>Ключ восстановления семьи</summary><p>Сохраните ключ отдельно от Google Диска. Он понадобится на новом устройстве.</p><code>'+esc(deviceAuthority(family.id).recovery)+'</code></details>':'')+
    (connected?'<div class="actions left">'+(workingFamily?'<button class="button primary" data-drive="upload">Сохранить копию на Google Диск</button>':'')+
      '<button class="button secondary" data-drive="list">Управление копиями</button><button class="text-button" data-drive="disconnect">Отключить Google Диск</button></div>':'')+
    '<div id="drive-result" role="status">'+esc(driveSession.returned&&!connected?driveSession.message:'')+'</div><div id="drive-copies"></div>');
  const auth=document.querySelector('#drive-auth');
  if(auth)auth.onsubmit=e=>{e.preventDefault();try{driveSession.connect(auth.elements.client.value.trim(),driveOwner())}catch(err){document.querySelector('#drive-result').textContent=err.message}};
  document.querySelectorAll('[data-drive]').forEach(b=>b.onclick=()=>driveAction(b.dataset.drive));
}
async function listDriveCopies(){
  const files=[];let next='';
  do{
    const query=new URLSearchParams({q:"trashed = false and appProperties has { key='healthArchive' and value='HS01' }",
      spaces:'drive',fields:'nextPageToken,files(id,name,modifiedTime,size,capabilities(canTrash))',orderBy:'modifiedTime desc',pageSize:'100'});
    if(next)query.set('pageToken',next);
    const page=await (await driveFetch(driveApi+'/files?'+query)).json();
    files.push(...page.files);next=page.nextPageToken||'';
  }while(next);
  return files;
}
async function trashDriveCopy(file){
  if(file.capabilities?.canTrash!==true||!/^[A-Za-z0-9_-]+$/.test(file.id))throw Error('Google Диск не разрешает удалить эту копию.');
  const response=await driveFetch(driveApi+'/files/'+file.id+'?fields=id,trashed',{
    method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({trashed:true})
  });
  const receipt=await response.json();
  if(receipt.id!==file.id||receipt.trashed!==true)throw Error('Google Диск не подтвердил перенос копии в корзину. Обновите список.');
}
function driveButton(action,label,handler,className='button secondary'){
  const button=document.createElement('button');
  button.type='button';button.className=className;button.dataset.drive=action;button.textContent=label;button.onclick=handler;
  return button;
}
function renderDriveCopies(list,files){
  list.replaceChildren();
  for(const file of files){
    const row=document.createElement('div');row.className='actions left';
    const label=file.name+' · '+stamp(file.modifiedTime);
    const show=()=>{
      row.replaceChildren(driveButton('download',label,()=>driveAction('download',file)));
      if(file.capabilities?.canTrash!==true)return;
      const remove=driveButton('confirm-trash','Удалить копию',confirm,'button danger');
      remove.setAttribute('aria-label','Удалить копию '+file.name);
      row.append(remove);
      return remove;
    };
    const confirm=()=>{
      const description=document.createElement('p');
      description.textContent='Переместить «'+file.name+'» в корзину Google Диска?';
      if(list.children.length===1)description.append(' Это последняя копия в списке.');
      const cancel=driveButton('cancel-trash','Отмена',()=>show()?.focus());
      row.replaceChildren(description,cancel,driveButton('trash','Переместить в корзину',()=>driveAction('trash',file,row),'button danger'));
      cancel.focus();
    };
    show();list.append(row);
  }
}
async function uploadDriveCopy(status){
  const owner=driveOwner(),data=readJson(familyStateKey);
  if(!workingFamily||!data)throw Error('Для выгрузки нужна рабочая семья.');
  if(!driveUpload?.url||driveUpload.owner!==owner){
    if(data.sync)await deviceSync.synchronize();
    const blob=await encryptedArchive(await archiveKey(deviceAuthority(owner).recovery));
    driveUpload={owner,blob,url:'',sent:false};
  }
  const job=driveUpload,total=job.blob.size;
  if(!job.url){
    const create=await driveFetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,size',{
      method:'POST',headers:{'Content-Type':'application/json; charset=UTF-8','X-Upload-Content-Type':'application/octet-stream','X-Upload-Content-Length':String(total)},
      body:JSON.stringify({name:'archive-'+new Date().toISOString().replace(/[:.]/g,'-')+'.health',mimeType:'application/octet-stream',appProperties:{healthArchive:'HS01'}})});
    job.url=create.headers.get('Location');if(!job.url)throw Error('Google не вернул адрес для загрузки.');
  }
  let offset=0,finished;
  function resumeOffset(response){
    const range=response.headers.get('Range');if(!range)return 0;
    const m=/^bytes=0-(\d+)$/.exec(range);if(!m||Number(m[1])>=total)throw Error('Некорректный ответ о передаче.');
    return Number(m[1])+1;
  }
  try{
    if(job.sent){
      const ack=await driveFetch(job.url,{method:'PUT',headers:{'Content-Range':'bytes */'+total},body:new Blob([])});
      if(ack.status===308)offset=resumeOffset(ack);else finished=ack;
    }
    while(!finished){
      const end=Math.min(offset+8*1024*1024,total);job.sent=true;
      status('Передано '+Math.floor(100*offset/total)+'%');
      const ack=await driveFetch(job.url,{method:'PUT',headers:{'Content-Type':'application/octet-stream','Content-Range':'bytes '+offset+'-'+(end-1)+'/'+total},body:await job.blob.slice(offset,end).arrayBuffer()});
      if(ack.status!==308){finished=ack;break}
      const next=resumeOffset(ack);if(next<=offset)throw Error('Передача приостановлена. Выберите повтор.');offset=next;
    }
    const receipt=await finished.json();
    if(!receipt.id||Number(receipt.size)!==total)throw Error('Google Диск не подтвердил размер файла.');
    const auth=deviceAuthority(owner);auth.driveBackupAt=new Date().toISOString();storeDeviceAuthority(owner,auth);
    driveUpload=null;return auth.driveBackupAt;
  }catch(e){if(e.expired)driveUpload=null;throw e}
}
async function driveAction(action,file,row){
  const out=document.querySelector('#drive-result'),list=document.querySelector('#drive-copies');
  if(!out||driveOperation||!driveAllowed()||(action==='trash'&&row?.parentElement!==list))return;
  const status=text=>{if(out.isConnected)out.textContent=text};driveOperation=action;
  const buttons=[...panelBody.querySelectorAll('[data-drive]')];buttons.forEach(b=>b.disabled=true);
  try{
    if(action==='upload'){
      status('Шифруем записи и оригиналы…');
      const time=await uploadDriveCopy(status);status('Копия сохранена на Google Диске · '+stamp(time));
    }else if(action==='list'){
      status('Загружаем список копий…');const files=await listDriveCopies();
      if(!out.isConnected)return;status(files.length?'Выберите копию для проверки или удаления.':'На этом диске ещё нет копий, созданных приложением.');
      renderDriveCopies(list,files);
    }else if(action==='trash'){
      status('Перемещаем копию в корзину…');await trashDriveCopy(file);
      if(row.isConnected)row.remove();
      status('Копия перемещена в корзину Google Диска.'+(list.childElementCount?'':' Список копий пуст.'));
    }else if(action==='download'){
      status('Загружаем зашифрованную копию…');const blob=await (await driveFetch(driveApi+'/files/'+encodeURIComponent(file.id)+'?alt=media')).blob();
      if(out.isConnected&&panel.open)importForm(blob);
    }else if(action==='disconnect'){
      const token=driveToken();
      const res=await fetch('https://oauth2.googleapis.com/revoke',{method:'POST',body:new URLSearchParams({token}),credentials:'omit',referrerPolicy:'no-referrer'});
      if(!res.ok&&res.status!==400)throw Error('Не удалось подтвердить отзыв доступа в Google.');
      driveSession.clear();driveUpload=null;if(out.isConnected)drivePanel();
    }
  }catch(e){
    status(e.message||'Не удалось завершить запрос.');
    if(!driveSession.access(driveOwner())&&out.isConnected){
      const b=document.createElement('button');b.className='button secondary';b.textContent='Подключить повторно';b.onclick=drivePanel;out.append(b);
    }
  }finally{
    driveOperation=null;buttons.forEach(b=>b.disabled=false);
    if(action==='trash'&&!row.isConnected&&list.isConnected)panelBody.querySelector('[data-drive=list]')?.focus();
  }
}
