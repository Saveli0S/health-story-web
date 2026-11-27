const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const test=require('node:test');
const script=fs.readFileSync(new URL('../assets/app/record-removal.js','file://'+__filename),'utf8');
const rules=vm.runInNewContext(script+'\nrecordRemoval');
const remove=(p,group,id,extra)=>JSON.parse(JSON.stringify(rules.remove(p,{group,id,...extra})));
const visit=['v','2026-11-27','Учебный визит','d','Эпизод','', 'scope','e',[{id:'rx',name:'Учебное назначение'}]];
const p={
  addedVisits:[visit],addedDoctors:[{id:'d',values:['Врач']}],
  episodes:[{id:'e',name:'Эпизод'}],notes:[{id:'n',visit:'v'}],
  reviews:[{id:'r',visit:'v'}],treatmentQueue:[{id:'v'}],recommendations:[{id:'rec',visit:'v'}],
  prompts:{v:{text:'запрос'}},questions:[{id:'q',episode:'e'}],measurements:[{id:'m',episode:'e'}],
  files:[{id:'lab',visit:'v',lab:{rows:[{name:'Показатель'}]}},{id:'report',visit:'v',examId:'exam'},
    {id:'draft-pdf',examDraft:'draft'},{id:'photo'}],
  exams:[{id:'exam',visit:'v',attachments:[{id:'report'},{id:'photo'}]}],
  examDrafts:[{id:'draft',exam:'exam',fields:{visit:'v'},sources:[{id:'draft-pdf'}]}],
  visitDrafts:[{id:'batch'},{id:'page',parent:'batch'}],docLinks:[{id:'report',other:'photo'},{id:'report',other:'lab'}],
  visitLinks:[{id:'l1',visit:'later',kind:'lab',target:'lab'},{id:'l2',visit:'v',kind:'file',target:'photo'},
    {id:'l3',visit:'later',kind:'med',source:'v',target:'rx'}],
  marketCriteria:[{id:'v/rx',visit:'v'},{id:'later/rx',visit:'later'}],
  marketFindings:[{id:'p1',criteriaId:'v/rx',visit:'v'},{id:'p2',criteriaId:'later/rx',visit:'later'}],
  consultations:[{id:'c',refs:[{kind:'visit',id:'v'},{kind:'lab',id:'lab'}],sources:['visit:v','lab:lab'],answer:'История',
    turns:[{id:'t1',question:'первый'},{id:'t2',question:'второй'}],nextQuestion:'черновик'}],
  prevention:[{id:'p',history:[{id:'done',source:'lab:lab'}]}],
  changes:[{id:'ch',source:'v',visit:'later',medId:'rx',doctor:'d'}],
  tagEdits:[{id:'lab:lab'},{id:'visit:v'}],fields:[{id:'weight',value:'68'}],auto:false
};

test('removing a visit preserves unrelated cards and their original IDs',()=>{
  const result=remove(p,'addedVisits','v');
  for(const key of ['addedVisits','notes','recommendations','reviews','treatmentQueue'])assert.deepEqual(result[key],[]);
  assert.deepEqual(result.prompts,{});
  assert.equal(result.files.find(f=>f.id==='lab').visit,'');
  assert.equal(result.exams[0].visit,'');
  assert.equal(result.examDrafts[0].fields.visit,'');
  assert.deepEqual(result.consultations[0].sources,['lab:lab']);
  assert.equal(result.consultations[0].answer,'История');
  assert.equal(result.changes[0].source,'');
  assert.deepEqual(result.visitLinks.map(r=>r.id),['l1']);
  assert.deepEqual(result.marketFindings.map(r=>r.id),['p2']);
  assert.equal(p.addedVisits.length,1);
});

test('removing an original detaches views and removing a study preserves independently filed originals',()=>{
  const deletedFile=remove(p,'files','report');
  assert.deepEqual(deletedFile.exams[0].attachments,[{id:'photo'}]);
  assert.deepEqual(deletedFile.docLinks,[]);
  const deletedLab=remove(p,'files','lab');
  assert.deepEqual(deletedLab.visitLinks.map(r=>r.id),['l2','l3']);
  assert.equal(deletedLab.prevention[0].history[0].source,'');
  assert.deepEqual(deletedLab.consultations[0].refs,[{kind:'visit',id:'v'}]);
  assert.deepEqual(deletedLab.tagEdits,[{id:'visit:v'}]);
  const deletedExam=remove(p,'exams','exam');
  assert.deepEqual(deletedExam.files.map(f=>f.id),['lab','report','photo']);
  assert.equal(Object.hasOwn(deletedExam.files[1],'examId'),false);
  assert.deepEqual(deletedExam.examDrafts,[]);
});

test('nested, draft and full profile deletion work without changing permissions',()=>{
  assert.deepEqual(remove(p,'visitDrafts','batch').visitDrafts,[]);
  assert.equal(remove(p,'labRows','lab',{index:0}).files[0].lab,undefined);
  const conversation=remove(p,'turns','c',{index:0}).consultations[0];
  assert.deepEqual(conversation.turns,[]);
  assert.equal(conversation.nextQuestion,undefined);
  assert.deepEqual(remove(p,'visitMeds','v',{index:0}).changes,[]);
  assert.deepEqual(remove(p,'visitMeds','v',{index:0}).visitLinks.map(r=>r.id),['l1','l2']);
  assert.deepEqual(remove(p,'visitMeds','v',{index:0}).marketFindings.map(r=>r.id),['p2']);
  assert.deepEqual(remove(p,'marketCriteria','v/rx').marketFindings.map(r=>r.id),['p2']);
  assert.equal(remove(p,'episodes','e').addedVisits[0][7],'');
  assert.equal(remove(p,'addedDoctors','d').addedVisits[0][3],'');
  const cleared=remove(p,'profile','');
  assert(cleared.auto===false);
  for(const value of Object.values(cleared).filter(Array.isArray))assert.deepEqual(value,[]);
  assert.equal(remove(p,'turns','c',{index:10}),null);
});
