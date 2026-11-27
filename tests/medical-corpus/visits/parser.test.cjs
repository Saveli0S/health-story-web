const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const engine=vm.createContext({uid:()=>'',todayLocal:()=>'2026-11-26'});
vm.runInContext(readFileSync(path.join(__dirname,'../../../assets/app/clinical-parser.js'),'utf8'),engine);
const header=text=>engine.parseVisitHeader(text);
const rx=(text,issues)=>Array.from(engine.proposedMedicines(text,issues));

test('visit date binds to the visit, future plans and reprint dates cannot become the visit',()=>{
  assert.equal(header('Дата рождения:\n12.03.1988').date,'');
  assert.equal(header('Дата печати дубликата: 01.04.2026').date,'');
  assert.equal(header('На приёме 19 марта 2026 года\nНапечатано: 25.03.2026').date,'2026-03-19');
  assert.equal(header('Дата визита: 11.03.2026\nДата осмотра: 12.03.2026').date,'');
  assert.equal(header('Дата визита: ?\n12.03.2026\nДата выдачи: 14.03.2026').date,'');
  assert.equal(header('Дата приёма:\n29.02.2024').date,'2024-02-29');
  assert.equal(header('Дата консультации: 31.02.2026').date,'');
  assert.equal(header('Дата визита:\nДата рождения: 11.03.2026').date,'');
});

test('visit headers accept alternate form separators and a combined clinician field',()=>{
  const record=header('ООО «Клиника Учебная»\nПротокол осмотра специалистом\nДата и время обращения — 12. 04. 2026 09:15\nВрач-специалист: врач-кардиолог — Лесов И.И.\nЖалобы при обращении  Заметка с бланка\nДиагноз при обращении ... Учебный эпизод');
  assert.equal(record.clinic,'ООО «Клиника Учебная»');
  assert.equal(record.title,'Протокол осмотра специалистом');
  assert.equal(record.date,'2026-04-12');
  assert.equal(record.doctorName,'Лесов И.И.');
  assert.equal(record.specialty,'кардиолог');
  assert.equal(record.note,'Заметка с бланка');
  assert.equal(record.episodeName,'Учебный эпизод');
  assert.equal(header('Жалобы —\nДата рождения — 30.11.1990').note,'');
  assert.equal(header('ФИО: Лесов И.И.\nДокумент потерян').doctorName,'');
});

test('historical, cancelled, allergy and reported doses stay out of active prescriptions',()=>{
  const source=readFileSync(path.join(__dirname,'../context/история-лечения.txt'),'utf8');
  assert.deepEqual(rx(source).map(x=>x.name),['Листин']);
  assert.match(engine.historyMedicationLines(source).join('\n'),/Макетин/);
  assert.match(engine.historyMedicationLines(source).join('\n'),/Архивин/);
  const list=rx('Назначения:\nАрхивин 4 мг — прекратить\nМакетин 8 мг отменён\nОбразец 1 мг капли\nПо 1 капле утром\nАнамнез:\nДругой 25 мг');
  assert.deepEqual(list.map(x=>x.name),['Образец']);
  assert.equal(list[0].instructions,'По 1 капле утром');
});

test('uncertain OCR strength is empty; a low-confidence unrelated token does not discard a clear strength',()=>{
  const source='Образец 12,5 мг таблетки';
  const item=words=>rx(source,[{text:source,words}])[0];
  assert.equal(item([{text:'12,5',confidence:22}]).strength,'');
  assert.equal(item([{text:'мг',confidence:31}]).strength,'');
  assert.equal(item([{text:'Образец',confidence:42}]).strength,'12,5 мг');
  assert.equal(item(undefined).strength,'');
  const m=rx('Лечение: Тестовый препарат, ? мг.')[0];
  assert.equal(m.name,'Тестовый препарат');assert.match(m.strength,/^\?/);assert.equal(m.instructions,'');
});
