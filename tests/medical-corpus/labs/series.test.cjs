const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ctx=vm.createContext();
vm.runInContext(fs.readFileSync(path.join(__dirname,'../../../assets/app/clinical-parser.js'),'utf8'),ctx);
const point=(row,title='',id='doc-a')=>ctx.labSeriesPoint(row,title,id);
const parse=text=>ctx.parseLabText(text,'QA.pdf');
const glucose={name:'Глюкоза',value:'4,8',unit:'ммоль/л'};

test('a PDF written column by column keeps each value and unit with its own test',()=>{
  const recognition=vm.createContext({URL,document:{baseURI:'https://fixture.invalid/'}});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../../../recognition.js'),'utf8'),recognition);
  const cell=(str,x,y)=>({str,transform:[11,0,0,11,x,y],height:11,hasEOL:true});
  const content=[cell('ммоль/л',200,79),cell('г/л',200,61),cell('Глюкоза',20,80),cell('Гемоглобин',20,62),
    cell('4,8',135,80),cell('136',135,62),cell('3,5–6',240,80),cell('120–150',240,62)];
  const text=recognition.pdfTableText(content,{convertToViewportPoint:(x,y)=>[x,-y]});
  assert.equal(text,'Глюкоза 4,8 ммоль/л 3,5–6\nГемоглобин 136 г/л 120–150');
  assert.equal(parse(text).rows[0].value,'4,8');
  assert.equal(parse(text).rows[1].unit,'г/л');
});

test('older rows lacking a specimen do not combine across documents, including rows named мочевина',()=>{
  for(const name of ['Глюкоза','Мочевина']){
    const row={...glucose,name};
    assert.notEqual(point(row,'Биохимия','a').key,point(row,'Биохимия','b').key);
  }
  assert.notEqual(point(glucose,'Анализ мочи').key,point({...glucose,specimen:'Плазма'}).key);
  assert.equal(point({...glucose,specimen:''},'Анализ мочи').specimen,'');
  assert.equal(point(glucose,'Общий анализ крови').specimen,'Цельная кровь');
});

test('only declared conversions apply, preserving thresholds, raw text, ranges and SI casing',()=>{
  const row={name:'HGB',value:'<13.8',unit:'g/dL',range:'12–15',specimen:'Цельная кровь'};
  assert.equal(point(row).value,'<138');
  assert.equal(point(row).unit,'г/л');
  assert.equal(row.value,'<13.8');assert.equal(row.range,'12–15');
  assert.equal(point({...row,unit:'G/dL'}).unit,'G/dL');
  assert.notEqual(point({...row,name:'HbA1c'}).key,point(row).key);
  assert.notEqual(point({...glucose,specimen:'Плазма'}).key,point({...glucose,specimen:'Сыворотка'}).key);
});

test('clarification for conflicting collection dates, invalid leap day, missing units, and uncertain glyphs',()=>{
  assert.equal(parse('Collected 12 Feb 2025\nCollected 15 Feb 2025').date,'');
  assert.equal(parse('Дата забора: 29.02.2025').date,'');
  assert.equal(parse('Issued 2025-01-01').date,'');
  assert.equal(parse('Дата анализа: 05.03.2025\nДата взятия: 03.03.2025').date,'2025-03-03');
  assert.equal(parse('Материал: моча\nГлюкоза плазмы 5,1 ммоль/л').rows[0].specimen,'');
  assert.equal(parse('Collected 02/03/2025').date,'');
  assert.equal(parse('Глюкоза 5,1').rows[0].unit,'');
  assert.equal(parse('НЬ 14,0 г/дл').rows[0].name,'НЬ');
  assert.equal(parse('Материал: кровь (Hb), плазма (глюкоза)\nНЬ 14,0 г/дл').rows[0].name,'Hb');
  assert.equal(parse('Материал: кровь (Hb), плазма (глюкоза)\nНЬ 14,0 мг/л').rows[0].name,'НЬ');
});
