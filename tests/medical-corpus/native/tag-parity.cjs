// Compare the web and native tag rules using the same synthetic family records.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const {execFileSync} = require('node:child_process');
const root = path.resolve(__dirname,'../../..');
const tags = [
  {id:'blood', name:'Анализ крови', keywords:['ОАК']},
  {id:'doctor', name:'Терапевт', keywords:['терапевта']},
  {id:'scan', name:'УЗИ', keywords:[]},
  {id:'check', name:'Проверка', keywords:[]},
  {id:'mine', name:'Контроль', keywords:[]},
];
const profile = {
  addedDoctors:[{id:'d',values:['Врач','Терапевт']}],
  addedVisits:[['v','2026-01-01','Первичный приём','d'],['v2','2026-02-01','Консультация физиотерапевта','']],
  files:[{id:'f',name:'Бланк ОАК.pdf',lab:{name:'Анализ крови'},category:'Лаборатория'},
         {id:'x',name:'протокол',checked:false,context:'УЗИ'},
         {id:'z',name:'Cкан ОАК Терапевт УЗИ Проверка Контроль'}],
  exams:[{id:'e',method:'УЗИ',region:'шея'}],
  prevention:[{id:'p',kind:'lab',title:'ОАК'}],
  tagEdits:[{id:'lab:f',values:{blood:false,mine:true}},{id:'file:z',values:{doctor:false}}]
};
const ctx = vm.createContext({ prototypeState:{tags},current:()=>profile,person:{doctors:{d:['Врач','Терапевт']}},
  visitById:id=>profile.addedVisits.find(v=>v[0]===id),allFiles:()=>profile.files,preventionKinds:{lab:'Плановый анализ'},
  norm:s=>s.toLocaleLowerCase('ru').replaceAll('ё','е').trim() });
vm.runInContext(fs.readFileSync(path.join(root,'assets/app/tags.js'),'utf8'),ctx);
const keys=['lab:f','file:x','file:z','exam:e','visit:v','visit:v2','prevent:p'];
const expected=Object.fromEntries(keys.map(k=>[k,Array.from(ctx.recordTags(...k.split(':')),t=>t.name)]));
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'health-story-tags-'));
try{
  fs.writeFileSync(path.join(tmp,'main.swift'),`
import Foundation
let sample = try JSONSerialization.jsonObject(with:FileHandle.standardInput.readDataToEndOfFile()) as! [String:Any]
let index = RecordTags(profile:sample["profile"] as! RecordTags.Row,library:sample["tags"] as! [RecordTags.Row])
let keys = sample["keys"] as! [String]
let explicitLabel = (sample["tags"] as! [RecordTags.Row]).first{$0["id"] as? String=="mine"}!["name"] as! String
precondition(index.matches(explicitLabel,key:"lab:f",fields:["бланк"]))
precondition(!index.matches("анализ крови",key:"lab:f",fields:["бланк"]))
precondition(index.matches("ПРИЕМ",key:"visit:v",fields:["первичный приём"]))
let result = Dictionary(uniqueKeysWithValues:keys.map{($0,index.names($0))})
FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject:result))`);
  const exe=path.join(tmp,'compare');
  execFileSync('xcrun',['swiftc',path.join(root,'ios/HealthStory/RecordTags.swift'),path.join(tmp,'main.swift'),'-o',exe]);
  const native=JSON.parse(execFileSync(exe,{input:JSON.stringify({profile,tags,keys})}));
  assert.deepEqual(native,expected);
  assert.deepEqual(native['visit:v2'],[]);assert.deepEqual(native['file:z'],['Анализ крови','УЗИ']);
  tags.find(t=>t.id==='mine').name='На повторный приём';
  const renamed=JSON.parse(execFileSync(exe,{input:JSON.stringify({profile,tags,keys})}));
  assert.deepEqual(renamed['lab:f'],Array.from(ctx.recordTags('lab','f'),t=>t.name));
  assert.deepEqual(renamed['lab:f'],['На повторный приём']);
  console.log('PASS 7 native/web tag lookups, renamed labels, restricted inference, manual exclusions and search');
}finally{fs.rmSync(tmp,{recursive:true,force:true})}
