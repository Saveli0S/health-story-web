const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const context=vm.createContext({structuredClone});
const src=fs.readFileSync(require('node:path').join(__dirname,'../assets/app/sync-merge.js'),'utf8');
const merge=vm.runInContext(src+'\nsyncMerge',context);
const authors={local:{author:'Взрослый',time:'2026-11-25T10:00:00Z'},remote:{author:'Администратор',time:'2026-11-25T11:00:00Z'}};
const plain=v=>JSON.parse(JSON.stringify(v));
test('independent profile and visit fields merge by stable identity',()=>{
 const base={fields:[{id:'x',value:'one',label:'X'}],addedVisits:[['v1','2026-11-24','Первый']]};
 const a=structuredClone(base),b=structuredClone(base);
 a.fields[0].label='Рост';b.fields[0].value='170';a.addedVisits[0][2]='Повторный';b.addedVisits[0][1]='2026-11-25';
 assert.deepEqual(plain(merge.merge(base,a,b,authors)),{value:{fields:[{id:'x',value:'170',label:'Рост'}],addedVisits:[['v1','2026-11-25','Повторный']]},conflicts:[]});
});
test('deleted versus modified note keeps both options and restores the selected note',()=>{
 const b={notes:[{id:'n',text:'one'}]},a={notes:[]},r={notes:[{id:'n',text:'two'}]};
 const m=merge.merge(b,a,r,authors),c=m.conflicts[0];
 assert(c.local.removed);assert.equal(c.remote.value.text,'two');
 assert.deepEqual(plain(merge.choose(m.value,c.path,c.local)),{notes:[]});
 assert.deepEqual(plain(merge.choose(m.value,c.path,c.remote)),r);
});
test('field conflict reports the author who modified that field',()=>{
 const b={fields:[{id:'weight',value:'60'}]},a={fields:[{id:'weight',value:'61'}]},r={fields:[{id:'weight',value:'62'}]};
 const [path]=merge.changes(b,r);
 const m=merge.merge(b,a,r,{...authors,remote:{...authors.remote,stamps:{[path]:{author:'Мария',time:'2026-11-24T14:00:00Z'}}}});
 assert.equal(m.conflicts[0].remote.author,'Мария');assert.equal(m.conflicts[0].remote.time,'2026-11-24T14:00:00Z');
});
test('a legacy visit edited offline keeps both a new clinic and a new prescription',()=>{
 const visit=['v','2026-06-01','Осмотр','doc','Эпизод','Запись','scope','ep'];
 const base={addedVisits:[visit]};
 const local={addedVisits:[[...visit,[],'Клиника А']]};
 const medication=[{id:'rx',name:'Пример'}];
 const remote={addedVisits:[[...visit,medication]]};
 const result=merge.merge(base,local,remote,authors);
 assert.deepEqual(plain(result),{value:{addedVisits:[[...visit,medication,'Клиника А']]},conflicts:[]});
 assert.deepEqual(plain(merge.changes(base,local)).map(p=>JSON.parse(p).at(-1)),[9]);
});
