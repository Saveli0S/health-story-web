'use strict';
(async()=>{
  try{
    await localVault.prepare();
    await Promise.all(Array.from(document.querySelectorAll('script[data-app-src]'),entry=>
      new Promise((resolve,reject)=>{
        const script=document.createElement('script');
        script.async=false;script.src=entry.dataset.appSrc;script.onload=resolve;script.onerror=reject;
        document.head.append(script);
      })
    ));
  }catch{
    const main=document.querySelector('#main');
    main.textContent='Не удалось открыть дневник. Проверьте защищённое соединение и доступ этого браузера к хранилищу. Действующая копия сохранена.';
    document.querySelector('.bar-actions').hidden=true;
  }
})();
