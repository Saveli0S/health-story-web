'use strict';

// Browser-bound keys are structured-cloned as non-extractable CryptoKeys.
// The in-memory secretbox key permits synchronous, failure-reporting metadata commits.
const localVault=(()=>{
  const encoder=new TextEncoder(),decoder=new TextDecoder(),prefix='HSJ1.',journal='health-story.family.journal';
  let secret,deviceKey,opening;
  function random(n){return crypto.getRandomValues(new Uint8Array(n))}
  function encode64(bytes){
    const parts=[];
    for(let i=0;i<bytes.length;i+=24576)parts.push(btoa(String.fromCharCode(...bytes.subarray(i,i+24576))));
    return parts.join('');
  }
  function decode64(value){return Uint8Array.from(atob(value),c=>c.charCodeAt(0))}
  function database(name,store){
    return new Promise((resolve,reject)=>{
      const req=indexedDB.open(name,1);
      req.onupgradeneeded=()=>req.result.createObjectStore(store);
      req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
    });
  }
  function transaction(db,store,mode,work){
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(store,mode),req=work(tx.objectStore(store));
      tx.oncomplete=()=>resolve(req?.result);tx.onerror=tx.onabort=()=>reject(tx.error||Error('transaction'));
    });
  }
  async function deviceMaterial(id,generate,create=true){
    const db=await database('health-story-device-keys','keys');
    try{
      const existing=await transaction(db,'keys','readonly',s=>s.get(id));
      if(existing)return existing;
      if(!create)throw Error('missing device key');
      const proposed=await generate();
      let chosen;
      await transaction(db,'keys','readwrite',s=>{
        const req=s.get(id);req.onsuccess=()=>{
          chosen=req.result||proposed;
          if(!req.result)s.add(chosen,id);
        };
      });
      return chosen;
    }finally{db.close()}
  }
  const params=(iv,purpose)=>({name:'AES-GCM',iv,additionalData:encoder.encode('health-story/v1/'+purpose)});
  async function unlock(){
    if(!globalThis.isSecureContext||!crypto.subtle)throw Error('Откройте дневник по HTTPS или на localhost.');
    const material=await deviceMaterial('vault',async()=>{
      const key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']),iv=random(12);
      const wrapped=await crypto.subtle.encrypt(params(iv,'journal-key'),key,random(32));
      return {key,iv,wrapped};
    },!localStorage.getItem(journal)?.startsWith(prefix));
    secret=new Uint8Array(await crypto.subtle.decrypt(params(material.iv,'journal-key'),material.key,material.wrapped));
    deviceKey=material.key;
  }
  function ensure(){return opening||(opening=unlock().catch(e=>{opening=null;throw e}))}
  function seal(text){
    if(!secret)throw Error('locked');
    const nonce=random(24),cipher=nacl.secretbox(encoder.encode(text),nonce,secret);
    return prefix+encode64(nonce)+'.'+encode64(cipher);
  }
  function open(value){
    if(!secret||!value.startsWith(prefix))throw Error('invalid journal');
    const parts=value.slice(prefix.length).split('.');
    if(parts.length!==2)throw Error('invalid journal');
    const plain=nacl.secretbox.open(decode64(parts[1]),decode64(parts[0]),secret);
    if(!plain)throw Error('invalid journal');
    return decoder.decode(plain);
  }
  async function sealFile(id,bytes,type){
    const iv=random(12),mime=encoder.encode(type||'');
    if(mime.length>65535)throw Error('mime');
    const plain=new Uint8Array(2+mime.length+bytes.byteLength);
    new DataView(plain.buffer).setUint16(0,mime.length);
    plain.set(mime,2);plain.set(new Uint8Array(bytes),2+mime.length);
    const cipher=await crypto.subtle.encrypt(params(iv,'original/'+id),deviceKey,plain);
    // Keep large ciphertext outside Chromium's per-record structured-clone message.
    return {version:1,iv,cipher:cipher.byteLength>=126*1024*1024?new Blob([cipher]):cipher};
  }
  async function openFile(id,entry){
    if(!entry)return;
    if(entry.version!==1)throw Error('invalid original');
    const cipher=entry.cipher instanceof Blob?await entry.cipher.arrayBuffer():entry.cipher;
    const bytes=await crypto.subtle.decrypt(params(entry.iv,'original/'+id),deviceKey,cipher);
    const end=2+new DataView(bytes).getUint16(0);
    if(end>bytes.byteLength)throw Error('invalid original');
    return new Blob([bytes.slice(end)],{type:decoder.decode(bytes.slice(2,end))});
  }
  async function prepare(){
    if(localStorage.getItem(journal)===null)return;
    await ensure();
    const raw=localStorage.getItem(journal);
    if(raw.startsWith(prefix)){open(raw);return}
    await navigator.locks.request('health-story-journal-migration',migrate);
  }
  async function migrate(){
    const before=localStorage.getItem(journal);if(before===null)return;
    if(before.startsWith(prefix)){open(before);return}
    const legacy=JSON.parse(before);
    if(legacy?.family?.kind!=='family'||!legacy.profiles||legacy.access)throw Error('invalid legacy journal');
    const db=await database('health-story-family-files','documents');
    try{
      const ids=await transaction(db,'documents','readonly',s=>s.getAllKeys());
      for(const id of ids){
        const old=await transaction(db,'documents','readonly',s=>s.get(id));
        if(!old||old.version===1)continue;
        if(!old.bytes)throw Error('invalid legacy file');
        const sealed=await sealFile(id,old.bytes,old.type);
        await transaction(db,'documents','readwrite',s=>{
          const req=s.get(id);req.onsuccess=()=>{
            const current=req.result;
            if(!current||current.version===1)return;
            const oldBytes=new Uint8Array(old.bytes),currentBytes=new Uint8Array(current.bytes);
            if(current.type!==old.type||currentBytes.length!==oldBytes.length||currentBytes.some((v,i)=>v!==oldBytes[i])){
              req.transaction.abort();return;
            }
            s.put(sealed,id);
          };
        });
      }
    }finally{db.close()}
    if(localStorage.getItem(journal)!==before)throw Error('journal changed during migration');
    localStorage.setItem(journal,seal(before));
  }
  return {ensure,seal,open,sealFile,openFile,prepare,deviceMaterial,encode64,decode64,random};
})();
