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

test('repeated results with an unspecified specimen share a series across documents',()=>{
  for(const name of ['Глюкоза','Мочевина']){
    const row={...glucose,name};
    assert.equal(point(row,'Биохимия','a').key,point({...row,specimen:''},'Биохимия','b').key);
    assert.notEqual(point(row).key,point({...row,specimen:'Моча'}).key);
  }
  assert.notEqual(point(glucose,'Анализ мочи').key,point({...glucose,specimen:'Плазма'}).key);
  assert.equal(point({...glucose,specimen:''},'Анализ мочи').specimen,'');
  assert.equal(point(glucose,'Общий анализ крови').specimen,'Цельная кровь');
});

test('printed LDL and HDL labels share one card per marker with separate specimen and unit series',()=>{
  for(const [label,alias] of [['ЛПВП-холестерин (HDL)','HDL-C'],['ЛПНП-холестерин (LDL)','LDL-C']]){
    const saved={name:label,value:'1,4',unit:'ммоль/л',specimen:''};
    const aliasPoint=point({...saved,name:alias,value:'54',unit:'mg/dL'},'Липидограмма','different');
    assert.equal(point(saved).key,aliasPoint.key);
    for(const variants of [{specimen:'Сыворотка'},{specimen:'Плазма'},{unit:'неизвестная единица'}]){
      const other=point({...saved,...variants});
      assert.equal(point(saved).marker,other.marker);
      assert.notEqual(point(saved).key,other.key);
    }
  }
  assert.notEqual(point({...glucose,name:'HDL-C'}).marker,point({...glucose,name:'LDL-C'}).marker);
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

test('total cholesterol from three dated reports shares a series while LDL, HDL and unconfirmed samples stay separate',()=>{
  const reports=[
    ['2022-04-20','Сыворотка','Холестерин общий','4,6','ммоль/л'],
    ['2023-05-17','Serum','Total Cholesterol','200','mg/dL'],
    ['2024-02-07','Сыворотка','ОХС','5,4','ммоль/л']
  ];
  const points=reports.map(([date,material,label,value,unit],i)=>{
    const lab=parse(`Биохимический анализ\nДата взятия: ${date}\nМатериал: ${material}\n${label} ${value} ${unit}`);
    assert.equal(lab.date,date);
    assert.equal(lab.rows[0].value,value);
    assert.equal(lab.rows[0].unit,unit);
    return point(lab.rows[0],lab.name,`doc-${i}`);
  });
  assert.equal(new Set(points.map(p=>p.key)).size,1);
  assert.deepEqual(points.map(p=>p.value),['4,6','5.172','5,4']);
  assert.equal(points[1].unit,'ммоль/л');
  assert.match(points[0].search,/холлестирин/);
  const row={value:'200',unit:'mg/dL',specimen:'serum'};
  assert.notEqual(point({...row,name:'LDL-C'}).key,points[0].key);
  assert.notEqual(point({...row,name:'ХС–ЛПВП'}).key,points[0].key);
  assert.notEqual(point({...row,name:'TC',specimen:''}).key,points[0].key);
  assert.notEqual(point({...row,name:'TC',specimen:'plasma'}).key,points[0].key);
  assert.equal(point({...row,name:'GLU'}).value,'11.102');
});

test('ruled blood counts keep the value, wrapped units, abbreviations and reference columns distinct',()=>{
  const report=parse(`Общий анализ крови (ОАК),
автоматизированный
Лейкоциты (WBC)    8.13    10^9    4.5 - 11
клеток\\л
Средний объем эритроцита (MCV)    ?    фл    85.6 - 102
Среднее содержание гемоглобина в    28.1    nr    25.6 - 30.7
эритроците (МСН)
Тромбоциты (PLT)    340    1079    150 - 450
клеток\\л
Тромбокрит (РСТ)    |    0.29    |    %    0.15 - 0.45
Коэффициент больших тромбоцитов    27    19.5 - 43.8
(P-LCR)
Нейтрофильные гранулоциты (NEUT %)    35.7    %    16 - 45
Нейтрофильные гранулоциты (NEUT)    3.25    10^9    15 - 4.5
клеток\\л`);
  assert.equal(report.date,'');
  assert.deepEqual(JSON.parse(JSON.stringify(report.rows.map(({value,unit,range})=>[value,unit,range]))),[
    ['8.13','10^9 клеток/л','4.5–11'],['?','фл','85.6–102'],['28.1','пг','25.6–30.7'],['340','?','150–450'],
    ['0.29','%','0.15–0.45'],['27','?','19.5–43.8'],['35.7','%','16–45'],['3.25','10^9 клеток/л','?']
  ]);
  const series=report.rows.map(row=>point(row,report.name));
  assert.equal(series[0].unit,'×10⁹/л');
  assert.equal(series[2].search,'MCH');
  assert.equal(series[4].search,'PCT');
  assert.equal(series[5].search,'P-LCR');
  assert.notEqual(series[6].key,series[7].key);
  assert.ok(series.every(p=>p.specimen==='Цельная кровь'));
  assert.equal(point({name:'PCT',value:'1',unit:'ng/mL',specimen:'Сыворотка'}).name,'PCT');
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

test('microscopy keeps reported intervals and blank cells distinct from reference ranges',()=>{
  const report=parse(`Учебная лаборатория
Мазок на флору
09.08.2025
Показатели Результат
Эпителий A, в п/зр
Эпителий B, в п/зр 4-7 в п.з.
Лейкоциты B, в п/зр 1–2 в п/зр
Флора отс.
Дрожжевые грибы
Дата выдачи результата: 11.08.2025`);
  assert.equal(report.name,'Мазок на флору');
  assert.equal(report.date,'');
  assert.deepEqual(JSON.parse(JSON.stringify(report.rows)),[
    {name:'Эпителий B',value:'4-7',unit:'в п.з.',range:'',specimen:''},
    {name:'Лейкоциты B',value:'1–2',unit:'в п/зр',range:'',specimen:''},
    {name:'Флора',value:'отс.',unit:'',range:'',specimen:''}
  ]);
});
