const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const ctx=vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../assets/app/clinical-parser.js'),'utf8'),ctx);
const parse=input=>JSON.parse(JSON.stringify(ctx.parseExamProtocol(input)));

test('dates, qualitative traits and measurements are separate from the signed conclusion',()=>{
  const record=parse('УЗИ почек\nДата рождения: 14.03.1978\nДата исследования: 14.11.2026\nПравая почка — 92 × 41 мм\nЭхогенность: обычная\nЗаключение:\nНаблюдение: размер 5 мм\nПодпись врача: Имя\nАдрес: Личный');
  assert.equal(record.date,'2026-11-14');
  assert.equal(record.method,'УЗИ');
  assert.deepEqual(record.parameters,[{name:'Правая почка',value:'92 × 41',unit:'мм'},{name:'Эхогенность',value:'обычная',unit:''}]);
  assert.equal(record.conclusion,'Наблюдение: размер 5 мм');
});
test('conflicting labelled study dates require review and an invalid date stays empty',()=>{
  const record=parse('Дата исследования: 15.01.2025\nДата обследования: 12.01.2026');
  assert.equal(record.date,undefined);
  assert.equal(record.questions.length,1);
  assert.equal(parse('Дата исследования: 31.02.2026').date,undefined);
});

test('exam accepts alternate protocol headings and keeps referral and contact details outside results',()=>{
  const record=parse('ГУ «Учебный центр»\nПротокол ультразвукового исследования\nНаправление: ранее КТ\nДата и время выполнения исследования — 14. 11. 2026, 09:00\nОбласть сканирования — Учебная область\nВрач ультразвуковой диагностики — Лесов И.И.\nОписание исследования — Наблюдение в протоколе\nЗаключение врача — Учебная формулировка\nТелефон — 100');
  assert.equal(record.method,'УЗИ');
  assert.equal(record.date,'2026-11-14');
  assert.equal(record.region,'Учебная область');
  assert.equal(record.clinic,'ГУ «Учебный центр»');
  assert.equal(record.doctor,'Лесов И.И.');
  assert.equal(record.description,'Наблюдение в протоколе');
  assert.equal(record.conclusion,'Учебная формулировка');
  assert.equal(parse('Описание:\nПо показаниям выполнить УЗИ').method,undefined);
});
