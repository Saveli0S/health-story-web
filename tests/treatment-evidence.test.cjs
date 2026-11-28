const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const app=vm.createContext({URL,norm:s=>String(s).toLowerCase().trim()});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../treatment.js'),'utf8'),app);
const med={название:'Средство А',дозировка:'12 мг',форма:'таблетки'};
const payload={пациент:{'Возраст на дату визита':'12 лет'},эпизод:'Тестовое заболевание',назначения:[med]};
const row={название:'Средство А',дозировка:'12 мг',категория:'Рекомендуемое',обоснование:'Синтетическое обоснование',источник:'https://example.org/clinical/section',разделИсточника:'Раздел 3',заболевание:'Тестовое заболевание',возрастнаяГруппа:'6–17 лет'};
const assess=(rows,p=payload,checks=[])=>app.readAnswerItems(JSON.stringify({препараты:rows}),p,checks);
const fallback='Недостаточно данных для оценки';

test('URL alone, wrong drug or age, wrong disease and ambiguity cannot promote a clinical rating',()=>{
  for(const r of [{...row,разделИсточника:''},{...row,источник:'javascript:alert(1)'},{...row,возрастнаяГруппа:'взрослые'},{...row,возрастнаяГруппа:'взрослые',возрастОт:0,возрастДо:100},
      {...row,заболевание:'Другое заболевание'},{...row,дозировка:'13 мг'},{...row,дозировка:''},{...row,категория:'Вылечит'}]){
    const [item]=assess([r]);assert.equal(item.label,fallback);assert(!item.canVerify);
  }
  assert(!assess([row,row])[0].canVerify);
  assert(!assess([row],{...payload,пациент:{}})[0].canVerify);
  assert.equal(app.readAnswerItems('ответ без структуры',payload)[0].label,fallback);
  assert(assess([row])[0].canVerify);
  const check={index:0,source:row.источник,label:row.категория,section:row.разделИсточника,diagnosis:payload.эпизод,age:'12 лет',at:'2026-11-26',by:'Тест'};
  assert.equal(assess([row],payload,[check])[0].label,'Рекомендуемое');
  assert.equal(assess([row],payload,[{...check,age:'13 лет'}])[0].label,fallback);
});

test('strict comparable products need every declared property, and exact price needs package and stock',()=>{
  const med={name:'Тестин',form:'таблетки',strength:'5 мг'},c={trade:'Тестин',substance:'Тестат',route:'Пероральный',release:'Обычное',pack:'№20'};
  const p={name:'Тестин',form:'таблетки пероральные обычного высвобождения 5мг N20',substance:'Тестат',pharmacyCount:5};
  const group=edit=>app.packageAssessment({...p,...edit},med,c).group;
  assert.equal(group({}),'exact');
  assert.equal(group({name:'ДругоеТорговое'}),'analogue');
  assert.equal(group({form:p.form.replace('N20','N10')}),'otherPack');
  for(const tweak of [{form:p.form.replace('5мг','50мг')},{form:p.form.replace('обычного','пролонгированного')},{substance:'Тестат+Другое'},{form:p.form.replace('пероральные','назальные')}])
    assert.equal(group(tweak),'different');
  assert.equal(group({form:'таблетки 5мг N20'}),'unverified');
  assert.equal(group({pharmacyCount:0}),'unverified');
  assert.equal(app.packageAssessment(p,med,{...c,pack:'№10'}).group,'otherPack');
});

test('catalog notation preserves concentration, route, release and container count',()=>{
  assert.notEqual(app.marketDoseKey('50 мг/5 мл'),app.marketDoseKey('10 мг/мл'));
  assert.equal(app.marketDoseKey('0,05 г/1 мл'),app.marketDoseKey('50 мг/мл'));
  const med={name:'Спрей QA',form:'спрей назальный',strength:'0,05 мг/дозу'};
  const c={substance:'Вещество QA',release:'Обычное',pack:'140 доз'};
  const pack={name:med.name,substance:c.substance,pharmacyCount:2,
    form:'спрей назальный обычного высвобождения 50 мкг/доза 140доз N1'};
  const group=form=>app.packageAssessment({...pack,form},med,c).group;
  assert.equal(group(pack.form),'exact');
  assert.equal(group(pack.form.replace('N1','N2')),'otherPack');
  assert.equal(group(pack.form.replace('мкг/доза','мкг/мл')),'different');
  assert.equal(group(pack.form.replace('50 мкг','50 мг')),'different');
  assert.equal(group(pack.form.replace('обычного высвобождения','')),'unverified');
  assert.equal(group(pack.form.replace('назальный','глазной')),'different');
  assert.equal(group(pack.form.replace('обычного','пролонгированного')),'different');
});
