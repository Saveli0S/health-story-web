const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const anonymize=vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../assets/app/privacy.js'),'utf8')+';anonymizeClinicalText');

test('addresses, medical IDs, birth dates and contacts are hidden without removing the next clinical observation',()=>{
  const rows=[
    ['Адрес: г. Гродно, ул. Первая, д. 8, кв. 2. Температура 37,1 °C.','Адрес: [адрес скрыт]. Температура 37,1 °C.'],
    ['ул. Новая. Вес 62 кг.','[адрес скрыт]. Вес 62 кг.'],
    ['Карта QA-CARD-0041. Паспорт MP 1234567.','Карта [номер скрыт]. Паспорт [номер скрыт].'],
    ['Дата рождения 08.10.1990. Дата визита 04.09.2026.','Дата рождения [дата скрыта]. Дата визита 04.09.2026.'],
    ['Контакт +375 (29) 111-22-33, test@example.invalid.','Контакт [телефон скрыт], [почта скрыта].'],
    ['Пациент: Тестова Марина Ивановна. Белова приняла 5 мг.','Пациент: [имя скрыто]. [имя скрыто] приняла 5 мг.'],
    ['Карта риска, давление 120/80. Глюкоза 4,8 ммоль/л.','Карта риска, давление 120/80. Глюкоза 4,8 ммоль/л.']
  ];
  for(const [raw,safe] of rows){
    assert.equal(anonymize(raw,['Анна Белова']),safe);
    assert.equal(anonymize(safe,['Анна Белова']),safe);
  }
});
