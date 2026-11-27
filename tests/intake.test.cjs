const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

function browserTab(store=new Map(),profile=0){
  const ctx=vm.createContext({URL,console,crypto:require('node:crypto').webcrypto,
    document:{baseURI:'http://localhost/',querySelector:()=>({}),addEventListener:()=>{}},
    localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v)}});
  for(const name of ['demo-data','assets/app/validation','assets/app/privacy','records','journal','assets/app/clinical-parser','recognition','visit-import','intake','treatment','assets/app/workspace','assets/app/laboratory','assets/app/prompt-defaults','assets/app/consult']){
    vm.runInContext(readFileSync(path.join(__dirname,'..',name+'.js'),'utf8'),ctx,{filename:name+'.js'});
  }
  vm.runInContext('let person=people['+profile+'];const visitById=id=>person.visits.find(v=>v[0]===id)',ctx);
  return script=>vm.runInContext(script,ctx);
}

test('a new document uses its own dose and keeps a missing regimen unresolved',()=>{
  const run=browserTab();
  const meds=run("proposedMedicines('Лист назначений\\nУчебный препарат · таблетки 12,5 мг\\nПо 1 таблетке утром\\nВторой препарат 27 мг')");
  assert.equal(meds.length,2);
  assert.equal(meds[0].name,'Учебный препарат');
  assert.equal(meds[0].strength,'12,5 мг');
  assert.equal(meds[0].instructions,'По 1 таблетке утром');
  assert.equal(meds[1].instructions,'');
});

test('treatment recommendations wrap prescriptions across lines and do not treat a package size as a strength',()=>{
  const run=browserTab();
  const source='Рекомендации по обследованию: записаться на осмотр\n'+
    'Рекомендации по лечению: - ТАБЛЕТИН 20 мг N10 (с 12 лет) - по 1 таблетке 1 раз\n'+
    'в день - 10 дней;\n- КРЕМИН (межд. назв. ВЕЩЕСТВО +\nКОМПОНЕНТ)\nмазь или крем 15,0 -\n'+
    'Наносить на кожу тонким слоем - 2 раза в день - 15 дней.\n* - УХОД: без спирта 70 %';
  const raw=JSON.stringify(source),meds=run('proposedMedicines('+raw+')');
  assert.equal(run('suggestImportKind("Консультация.jpg",'+raw+')'),'Назначения');
  assert.deepEqual(Array.from(meds,m=>m.name),['ТАБЛЕТИН','КРЕМИН']);
  assert.equal(meds[0].strength,'20 мг');
  assert.match(meds[0].instructions,/\(с 12 лет\).*1 раз в день - 10 дней/);
  assert.equal(meds[1].strength,'');
  assert.equal(meds[1].strengthUnspecified,true);
  assert.equal(meds[1].form,'мазь или крем');
  assert.match(meds[1].instructions,/2 раза в день - 15 дней/);
});

test('photo-first creation extracts the labelled visit date and leaves ambiguous dates blank',()=>{
  const run=browserTab();
  const draft=run("parseVisitHeader('Врач: Иванов И. И.\\nДата рождения: 01.01.2001\\nДата визита: 13.08.2024\\nДиагноз: Учебный эпизод\\nВизит: Повторный осмотр')");
  assert.equal(draft.doctorName,'Иванов И. И.');
  assert.equal(draft.date,'2024-08-13');
  assert.equal(draft.episodeName,'Учебный эпизод');
  assert.equal(run("parseVisitHeader('11.07.2024 или 12.07.2024').date"),'');
  assert.equal(run("parseVisitHeader('Назначения\\nТаблетки 5 мг').date"),'');
});

test('unverified attachments block the whole visit and OCR originals stay out of the request',()=>{
  const run=browserTab();
  run(`const visit=['v','2026-11-25','Тест','volkova','Эпизод','Анна Белова contact@example.com','scope','ep-new'];
    person.visits.unshift(visit);
    const rx={id:'rx-new',visit:'v',intake:true,checked:true,raw:'Личные данные на странице',meds:[
      {name:'Учебный препарат',strength:'8 мг',form:'Таблетки',instructions:'По назначению',period:{closed:false}}]};
    current().files.push(rx,{id:'second',visit:'v',intake:true,checked:false,raw:'Второй оригинал'});`);
  assert.equal(run("reviewReady('v')"),false);
  run("current().files[1].checked=true;current().files[1].context='Сверенное заключение'");
  assert.equal(run("reviewReady('v')"),true);
  assert.equal(run("demoReviewAvailable('v')"),false);
  const payload=run("makePayload('v')");
  assert.equal(payload.назначения[0].дозировка,'8 мг');
  assert.deepEqual(Array.from(payload.сведенияИзДокументов),['Сверенное заключение']);
  assert.doesNotMatch(JSON.stringify(payload),/Анна Белова|@|оригинал|на странице|Флутиказон/);
});

test('independent creations survive saves from two tabs and stay in the owning profile',()=>{
  const store=new Map(),a=browserTab(store);a('saveState()');
  const b=browserTab(store);
  a("current().episodes.push({id:'one',name:'Первый эпизод'});saveState()");
  b("current().episodes.push({id:'two',name:'Второй эпизод'});saveState()");
  a("current().notes.push({id:'note',visit:'a1',text:'Пометка'});saveState()");
  const read=browserTab(store);
  assert.equal(read("current().episodes.filter(e=>['one','two'].includes(e.id)).length"),2);
  assert.equal(read("current().notes.at(-1).text"),'Пометка');
  assert.equal(browserTab(store,1)("current().episodes.some(e=>e.id==='one'||e.id==='two')"),false);
});

test('a structured reply without a clinical source yields insufficient data for that medicine',()=>{
  const run=browserTab();
  const items=run(`readAnswerItems(JSON.stringify({препараты:[{название:'А',категория:'Необходимое',обоснование:'Без ссылки'}]}),{назначения:[{название:'А'}]})`);
  assert.equal(items[0].label,'Недостаточно данных для оценки');
});


test('uncertain OCR stays attached to its source page and a questionable strength remains unresolved',()=>{
  const run=browserTab();
  const lines=run(String.raw`uncertainLines('5\t1\t1\t1\t1\t1\t5\t5\t10\t10\t99\tПрепарат\n5\t1\t1\t1\t1\t2\t15\t5\t10\t10\t32\t5мг',2)`);
  assert.equal(lines.length,1);assert.equal(lines[0].page,2);assert.equal(lines[0].text,'Препарат 5мг');
  const drug=run(String.raw`proposedMedicines('Средство ? мг\nПо 1 таблетке')[0]`);
  assert.equal(drug.name,'Средство');assert.equal(drug.strength,'? мг');
});

test('v1 backup requires exactly one original for each profile document and draft',()=>{
  const context=vm.createContext({localStorage:{getItem:()=>null}});
  for(const name of ['demo-data','assets/app/privacy','records','assets/app/archive']){
    vm.runInContext(readFileSync(path.join(__dirname,'..',name+'.js'),'utf8'),context);
  }
  vm.runInContext(`const backup={version:1,data:{profiles:{}},files:[]};
    for(const p of people){
      backup.data.profiles[p.id]={files:[{id:'own'}]};
      for(const f of [...sampleFiles[p.id],{id:'own'}])backup.files.push({id:p.id+'/'+f.id,type:'',bytes:'YQ=='});
    }
    backup.data.profiles.anna.visitDrafts=[{id:'pending'}];
    backup.files.push({id:'anna/pending',type:'text/plain',bytes:'Yg=='});
  `,context);
  const run=script=>vm.runInContext(script,context);
  assert.equal(run('archiveOriginals(backup).length'),run('backup.files.length'));
  for(const change of ['b.files.pop()','b.files.push(b.files[0])','b.files.at(-1).id="misha/pending"',
    'b.files.push({id:"anna/extra",type:"",bytes:"YQ=="})','b.version=2','b.data.profiles.other={files:[]}']){
    assert.throws(()=>run('(()=>{const b=JSON.parse(JSON.stringify(backup));'+change+';archiveOriginals(b)})()'));
  }
});

test('an original filename used as a missing study title stays out of both provider payloads',()=>{
  const run=browserTab();
  run(`const dateLabel=date=>date;
    current().files.push({id:'qa-lab',visit:'a1',category:'Лаборатория',name:'id456_Петрова_Н.pdf',
      lab:{name:'id456_Петрова_Н',date:'2026-05-12',rows:[{name:'Глюкоза',value:'5,1',unit:'ммоль/л',specimen:'Плазма',range:'3,9–5,5'}]}});`);
  for(const expression of ["makePayload('a1').анализы","consultContext(['lab:qa-lab']).data.анализы"]){
    const payload=JSON.stringify(run(expression));
    assert.doesNotMatch(payload,/id456|Петрова/);
    assert.match(payload,/5,1/);assert.match(payload,/Плазма/);
  }
  assert.match(run("current().files.at(-1).name"),/id456/);
});
