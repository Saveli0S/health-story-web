'use strict';

// Capture the OAuth fragment before loading the journal. Only state survives navigation.
const driveSession=(()=>{
  const scope='https://www.googleapis.com/auth/drive.file',stateKey='health-story.drive.oauth';
  const clientKey='health-story.drive.client',redirect=new URL('index.html',location.href).href.split(/[?#]/)[0];
  let token='',expires=0,owner='',returned=false,message='';
  const hash=new URLSearchParams(location.hash.slice(1));
  if(hash.has('access_token')||hash.has('error')){
    returned=true;history.replaceState(null,'',location.pathname+'?section=settings');
    try{
      const pending=JSON.parse(sessionStorage.getItem(stateKey));sessionStorage.removeItem(stateKey);
      if(!pending||!pending.state||hash.get('state')!==pending.state||Date.now()>pending.until)throw Error();
      if(hash.get('error')==='access_denied'){message='Вы отменили подключение.'}
      else{
        const ttl=Number(hash.get('expires_in'));
        if(!hash.get('access_token')||hash.get('token_type')?.toLowerCase()!=='bearer'||
          !hash.get('scope')?.split(' ').includes(scope)||!Number.isFinite(ttl)||ttl<=0)throw Error();
        token=hash.get('access_token');expires=Date.now()+ttl*1000;owner=pending.owner;
      }
    }catch{message='Google Диск не подключён. Повторите вход из настроек.'}
  }
  function connect(client,who){
    if(!/^\d+-[a-zA-Z0-9-]+\.apps\.googleusercontent\.com$/.test(client))throw Error('Проверьте публичный Client ID веб-приложения.');
    const state=Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
    sessionStorage.setItem(stateKey,JSON.stringify({state,owner:who,until:Date.now()+600000}));
    localStorage.setItem(clientKey,client);
    const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.search=new URLSearchParams({client_id:client,redirect_uri:redirect,response_type:'token',scope,state,prompt:'select_account'}).toString();
    location.assign(url.href);
  }
  return {scope,redirect,returned,message,connect,client:()=>localStorage.getItem(clientKey)||document.querySelector('meta[name=google-drive-client-id]')?.content||'',
    access:who=>owner===who&&Date.now()<expires-1000?token:'',clear(){token='';expires=0;owner=''}};
})();
