'use strict';

// Only packaged application resources are cached here. Originals live in the owner's IndexedDB.
const version='health-story-shell-2026-11-family-release-3-heif-1-layout-1-drive-trash-1-visit-links-1-visit-rx-1-exam-date-1-intake-context-1-header-1-provider-gap-1-lab-date-1-record-layout-1-edit-rx-1-archive-layout-1-recovery-key-1-profile-header-1-market-search-1-prompt-layout-1-section-layout-2-chatgpt-status-1-market-findings-1-market-alignment-1-demo-key-help-1-chatgpt-broker-1-navigation-ux-2-lab-drafts-1';
const shell=['index.html','styles.css','demo-data.js','records.js','journal.js','treatment.js','recognition.js','visit-import.js','intake.js','app.js',
  ...['privacy','record-removal','record-removal-ui','clinical-parser','visit-drafts','source-view','laboratory','exams','episodes','prompt-defaults','consult','consult-sources','tags','prevention','chatgpt','providers','archive','workspace','family'].map(n=>'assets/app/'+n+'.js'),
  'assets/crypto/nacl-fast-1.0.3.min.js','assets/app/vault.js','assets/app/boot.js','assets/app/devices.js','assets/app/sync-merge.js','assets/app/sync.js','assets/app/drive-session.js','assets/app/drive.js','assets/app/visit-links.js','assets/inter.ttf','assets/pt-serif.ttf','assets/ginkgo.png'];
const previewEngines=['pdf.min.mjs','pdf.worker.min.mjs','heif-worker.js','libheif-1.23.5.mjs'].map(n=>'assets/recognition/'+n);
const engines=[...previewEngines,...['rus.traineddata.gz','eng.traineddata.gz','tesseract.min.js','worker.min.js','tesseract-core-lstm.wasm.js'].map(n=>'assets/recognition/'+n)];
const root=new URL('./',self.location.href);
self.addEventListener('install',event=>event.waitUntil((async()=>{
  // Fetch one complete release even when the browser still has fresh HTTP cache
  // entries for the previous release under the same URLs.
  const cache=await caches.open(version);
  // Include the preview engines so local PDF and HEIF files open on the first offline visit.
  const offlineShell=[...shell,...previewEngines];
  await cache.addAll(offlineShell.map(name=>new Request(new URL(name,root),{cache:'reload'})));
  await self.skipWaiting();
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  const current=await caches.open(version);
  for(const key of await caches.keys()){
    if(!key.startsWith('health-story-shell-')||key===version)continue;
    const old=await caches.open(key);
    for(const request of await old.keys()){
      const name=new URL(request.url).pathname.slice(root.pathname.length);
      if((engines.includes(name)||name.startsWith('assets/documents/'))&&!await current.match(request)){
        const response=await old.match(request);if(response)await current.put(request,response);
      }
    }
    await caches.delete(key);
  }
  await self.clients.claim();
})()));
self.addEventListener('message',event=>{
  if(event.data!=='offline-engines')return;
  event.waitUntil((async()=>{try{const cache=await caches.open(version);await cache.addAll(engines);event.ports[0]?.postMessage(true)}catch{event.ports[0]?.postMessage(false)}})());
});
self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url);
  if(request.method!=='GET'||url.origin!==root.origin||!url.pathname.startsWith(root.pathname))return;
  const name=url.pathname.slice(root.pathname.length),navigation=request.mode==='navigate'&&(!name||name==='index.html');
  if(!navigation&&!shell.includes(name)&&!engines.includes(name)&&!name.startsWith('assets/documents/'))return;
  const key=new URL(navigation?'index.html':name,root).href;
  event.respondWith((async()=>{
    const cache=await caches.open(version);
    if(navigation||shell.includes(name)){
      const packaged=await cache.match(key);
      if(packaged)return packaged;
    }
    try{
      const response=await fetch(request);
      if(response.ok)await cache.put(key,response.clone());return response;
    }catch{
      const stored=await cache.match(key);return stored||Response.error();
    }
  })());
});
