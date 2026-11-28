'use strict';

const visitMonths=['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
const fieldSeparator='(?:[:·–—-]|\\.{2,}|[ \\t]{2,}|\\t)';
const visitLabels={
  episodeName:'эпизод(?: болезни)?|(?:(?:основной|предварительный|клинический) )?диагноз(?: при обращении| основной)?',
  doctorName:'фио врача|врач[-\\s]+специалист|(?:лечащий |принимающий )?врач(?:\\s+при[её]ма)?',
  specialty:'специальность|специализация|профиль специалиста',
  title:'название визита|тип при[её]ма|вид посещения|визит',
  note:'жалобы(?: пациента| при обращении| на момент осмотра)?|повод обращения|причина обращения|сведения о визите',
  conclusion:'заключение(?: врача)?',
  clinic:'клиника|учреждение|медицинская организация|организация здравоохранения|место при[её]ма'
};

function clinicalLines(raw){
  return raw.split(/\r?\n/).map(line=>line.replace(/[\u00a0\u202f]/gu,' ').trim()).filter(Boolean);
}

function fieldLine(labels){
  return new RegExp('^(?:'+labels+')\\s*(?:'+fieldSeparator+'\\s*(.*))?$','iu');
}

const clinicalHeading=fieldLine([...Object.values(visitLabels),
  'пациент|фио|дата(?: [^:]{1,35})?|телефон|адрес|подпись(?: врача)?|результат(?:ы)?|анамнез|статус|осмотр|рекомендации(?: врача)?|лечение|назначения|описание|протокол'
].join('|'));

function labelledValue(lines,labels){
  const field=fieldLine(labels),values=new Set();
  for(const [index,line] of lines.entries()){
    const match=line.match(field);
    if(!match)continue;
    const next=lines[index+1]||'';
    const value=match[1]?.trim()||(!clinicalHeading.test(next)&&!/^[^:]{1,45}:|^\d{1,4}[./-]\d|^\d+\s+(?:из|\/)\s+\d+/u.test(next)?next:'');
    if(value)values.add(value);
  }
  return values.size===1?[...values][0]:'';
}

function visitDateFrom(lines){
  const datePattern=/(?:^|[^\d])(?:(\d{4})-(\d{2})-(\d{2})|(\d{1,2})[./]\s*(\d{1,2})[./]\s*(\d{4})|(\d{1,2})\s+(января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)\s+(\d{4}))(?!\d)/giu;
  const explicit=[],generic=[],alone=[];
  const excluded=/рожд|д\.\s*р\.|печат|дубликат|контрол[ья]|следующ|повторн(?:ый|ого) визит\s+(?:через|запланирован)|назначен на|действител|выдач|выдан|забор|взятия|результат|начал[ао]|окончан/iu;
  for(const [i,line] of lines.entries()){
    if(excluded.test(line)||(/^\d/u.test(line)&&excluded.test(lines[i-1]||'')&&!/\d/u.test(lines[i-1]||'')))continue;
    const label=/^(?:(?:дата(?:\s+и\s+время)?\s+(?:визита|при[её]ма|осмотра|консультации|посещения|обращения)|на при[её]ме|осмотрен[а]?|визит состоялся)(?=[:\s·–—-]|$)|(?:при[её]м|визит|консультация|осмотр)\s+(?:от\s+)?(?=\d))/iu.test(line);
    const general=/^дата\s*[:·–—-]/iu.test(line);
    const candidate=(label||general)&&/^(?:дата(?: и время)?(?: визита| при[её]ма| осмотра| консультации| посещения| обращения)?|на при[её]ме)\s*[:·–—-]?$/iu.test(line) ? lines[i+1]||'' : line;
    if(!(label||general||/^\d{1,4}[./\s-]/u.test(line)))continue;
    const target=label?explicit:general?generic:alone;
    if(label||general)target.push(null); // An unreadable explicit value must not fall back to another date.
    if(candidate!==line && excluded.test(candidate))continue;
    for(const m of candidate.matchAll(datePattern)){
      const year=m[1]||m[6]||m[9],month=m[2]||m[5]||String(visitMonths.indexOf(m[8].toLowerCase())+1);
      const iso=[year,month.padStart(2,'0'),(m[3]||m[4]||m[7]).padStart(2,'0')].join('-');
      const date=new Date(iso+'T12:00:00Z');
      if(Number.isFinite(date.valueOf())&&date.toISOString().slice(0,10)===iso&&iso<=todayLocal())target.push(iso);
    }
  }
  const dates=new Set((explicit.length?explicit:generic.length?generic:alone).filter(Boolean));
  return dates.size===1?[...dates][0]:'';
}

function parseVisitHeader(raw){
  const lines=clinicalLines(raw);
  const read=key=>labelledValue(lines,visitLabels[key]);
  const episodeName=read('episodeName');
  const clinician='(?:врач[-\\s]+)?([а-яё-]+олог|терапевт|педиатр|хирург|врач общей практики|лор)';
  const pairPattern=new RegExp('^'+clinician+'(?:\\s*'+fieldSeparator+'\\s*|\\s+)(\\p{L}[\\p{L}.’\'\\s-]+)$','iu');
  const reportedDoctor=read('doctorName');
  const specialtyLine=reportedDoctor.match(pairPattern)||lines.map(line=>line.match(pairPattern)).find(match=>match&&/^\p{Lu}/u.test(match[2]));
  const doctorName=specialtyLine&&(!reportedDoctor||reportedDoctor===specialtyLine[0])?specialtyLine[2].trim():reportedDoctor;
  const specialty=read('specialty')||specialtyLine?.[1]||'';
  const title=read('title')||lines.find(l=>/^(?:(?:первичный |повторный )?(?:при[её]м|консультация|осмотр)|выписка (?:о|из)|протокол (?:консультации|осмотра))\s+\p{L}/iu.test(l))||'';
  const note=read('note')||read('conclusion');
  const clinic=read('clinic')||printedClinic(lines);
  return {episodeName,doctorName,specialty,title,note,clinic:clinic.replace(/\s+(?:(?:лист|стр\.?)\s*)?\d{1,3}\s*(?:\/|из)\s*\d{1,3}\s*$/iu,''),date:visitDateFrom(lines)};
}

function printedClinic(lines){
  return lines.slice(0,8).find(line=>{
    const match=line.match(/^(?:(?:гу|уз|гув|чуп|ооо)\s+|(?:(?:медицинский |диагностический )?центр|поликлиника|клиника|кабинет|бюро|больница)\s+)(.+)$/iu);
    return match&&/^[«„"\p{Lu}№]/u.test(match[1]);
  })||'';
}

function recommendationText(raw){
  const block=[];
  for(const line of raw.split(/\r?\n/)){
    const match=line.match(/^\s*(?:рекомендации(?: врача)?|рекомендовано)(?=\s|[:.—–-]|$)\s*[:.—–-]?\s*(.*)$/iu);
    if(match){block.push(match[1]);continue}
    if(!block.length)continue;
    if(/^\s*(?:назначения|диагноз|жалобы|дата|врач|подпись|обследование|заключение|результаты|анамнез|аллерги[ия])(?=[:\s]|$)/iu.test(line))break;
    block.push(line.trim());
  }
  return block.join('\n').trim();
}

const treatmentRecommendationHeading=/^рекомендации\s+по\s+(?:медикаментозному\s+)?лечению\s*(?=[:.·–—-]|$)/iu;
const activeRxHeading=/^(?:рекомендации по (?:медикаментозному )?лечению|(?:лекарственные |врачебные |новые |текущие )?назначения(?: врача)?|лист назначений|(?:медикаментозное |назначенное |рекомендованное )?лечение|(?:новая |текущая )схема(?: лечения)?|назначено|назначен[аы]?|принимать)\s*(?=[:.·–—-]|$)[:.·–—-]*\s*/iu;
const historyRxHeading=/^(?:аллерги[яию]|аллергологический анамнез|аллерг\.\s*анамнез|побочные реакции|нежелательные реакции|лекарственная (?:аллергия|непереносимость)|непереносимость|анамнез|медикаментозный анамнез|история (?:лекарств|лечения|назначений)|отмен(?:а|ить)(?: препаратов)?|предыдущ(?:ая|ее|ие) (?:схема|лечение|назначения)|(?:отмен[её]нные|прежние) (?:лекарства|назначения|препараты)|ранее (?:принимал[аи]?|назначено|применял[аи]?)|принимал[аи]? ранее)(?=[:.\s–—-]|$)/iu;
const inactiveRxText=/(?:аллерги[яиюч]|непереносим|противопоказан|отмен[еёяи]|прекрат(?:ить|ил|ила)|исключить|не\s+(?:приним|назнач|примен|использ)|(?:ранее|в прошлом)\s+(?:приним|назнач|примен|получ))/iu;
const otherRxHeading=/^(?:рекомендации(?: врача)?|рекомендовано|жалобы|заключение|обследование|диагноз|результаты|подпись|осмотр|показатели|лабораторные исследования)(?=[:.\s–—-]|$)/iu;
const rxDose=/\d+(?:[.,]\d+)?(?:\s*\/\s*\d+(?:[.,]\d+)?)?\s*(?:мкг|мг|мл|ме|ед|г|%|mcg|mg|ml|iu)(?![\p{L}])(?:\s*\/\s*(?:доза|дозу|дозы|мл|табл\.?|ml))?/iu;
const rxUnknown=/[?？�]+\s*(?:мкг|мг|мл|г|%|mg|ml)?|неразборчиво(?:\s+(?:мкг|мг|мл|г|%))?/iu;
const rxForm=/(?<!\p{L})(?:назальный спрей|спрей|таблетк[аиуеы]?|табл\.?|раствор|сироп|капсул[аы]?|крем|мазь|капли|гель)(?!\p{L})/iu;
const rxRegimen=/^(?:по\s|принимать\s|наносить\s|закапывать\s|внутрь|\d+\s*(?:раз|табл|капс))/iu;
const cleanRxEdge=t=>t.replace(/^[\s©®·,:;–—-]+|[\s·,:;–—-]+$/gu,'').trim();
const stripRxBullet=t=>t.trim().replace(/^(?:(?:[•*–—-]|\d+[.)])\s*)+/u,'');
const ocrLineKey=s=>s.toLowerCase().replace(/[^\p{L}\d?]/gu,'');

function hasTreatmentRecommendations(raw){
  return raw.split(/\r?\n/).some(line=>treatmentRecommendationHeading.test(stripRxBullet(line)));
}

function historyMedicationLines(raw){
  const notes=[];
  let section='';
  for(const source of raw.split(/\r?\n/)){
    const line=source.trim();
    if(!line)continue;
    if(historyRxHeading.test(line))section=line;
    else if(activeRxHeading.test(line)||otherRxHeading.test(line))section='';
    if(inactiveRxText.test(line)||(section&&(rxDose.test(line)||rxUnknown.test(line)))){
      if(section&&section!==line&&notes.at(-1)!==section)notes.push(section);
      notes.push(line);
    }
  }
  return notes;
}
function proposedMedicines(raw,issues=[]){
  const lines=raw.split(/\r?\n/).map(s=>s.trim()).filter(Boolean),meds=[];
  const hasActiveSection=lines.some(s=>activeRxHeading.test(stripRxBullet(s)));
  let active=!hasActiveSection, explicit=false;
  for(let i=0;i<lines.length;i++){
    const source=lines[i];
    let line=stripRxBullet(source);
    if(historyRxHeading.test(line)){active=false;continue}
    if(activeRxHeading.test(line)){active=explicit=true;line=stripRxBullet(line.replace(activeRxHeading,''))}
    else if(otherRxHeading.test(line)){
      if(hasActiveSection||!/^(?:жалобы|диагноз|осмотр)(?=[:.\s–—-]|$)/iu.test(line))active=false;
      continue;
    }
    if(!line||!active||inactiveRxText.test(line)||rxRegimen.test(line)||(!explicit&&/^[^:]{1,45}:\s*\p{L}/u.test(line)))continue;
    if(/^(?:уход|диета|контроль|консультация|повторн\S*\s+при[её]м)(?=[:.\s]|$)/iu.test(line)){
      active=false;continue;
    }
    if(/^(?:отмен[её]н[аоы]?|отменить|прекратить|не принимать)(?:\s+(?:ранее|врачом|сегодня|на прошлом визите))?\s*[.!]?$/iu.test(lines[i+1]||''))continue;
    let followingIndex=i+1;
    if(explicit&&/\([^)]*$/u.test(line)&&/^[\p{L}+\s-]+\)(?:\s|$)/u.test(lines[followingIndex]||''))
      line+=' '+lines[followingIndex++];
    if(explicit&&/^(?:мазь|крем|гель)(?=\s|$)/iu.test(lines[followingIndex]||'')&&
        !rxDose.test(line)&&!rxUnknown.test(line))line+=' '+lines[followingIndex++];
    const following=rxRegimen.test(lines[followingIndex]||'')?lines[followingIndex]:'';
    const dose=line.match(rxDose),unknown=line.match(rxUnknown);
    // An unclear token wins if it is where the dose should be, before a later quantity.
    const match=unknown&&(!dose||unknown.index<=dose.index)?unknown:dose;
    if(!match){
      const topical=explicit&&line.match(/^([\p{L}\d][\p{L}\d-]+)\s*(?:\([^)]*\)\s*)?((?:мазь|крем|гель)(?:\s+или\s+(?:мазь|крем|гель))?)(?:\s+\d+(?:[.,]\d+)?)?\s*[–—-]*$/iu);
      if(topical&&/^наносить\s/iu.test(following)){
        meds.push({id:uid(),name:topical[1],strength:'',strengthUnspecified:true,form:topical[2],instructions:cleanRxEdge(following)});
        i=followingIndex;
      }
      continue;
    }
    const prefix=line.slice(0,match.index),form=line.match(rxForm)?.[0]||'';
    const name=cleanRxEdge(prefix.replace(rxForm,''));
    if(!name||name.length>90||!/[\p{L}]/u.test(name))continue;
    const tail=cleanRxEdge(line.slice(match.index+match[0].length));
    const tailWithoutForm=cleanRxEdge(tail.replace(new RegExp('^(?:'+rxForm.source+')','iu'),'')
      .replace(/^[N№]\s*\d+\s*(\([^)]*\))?\s*[–—-]\s*/iu,(_,qualifier)=>qualifier?qualifier+' ':''));
    const inline=/[\p{L}\d]/u.test(tailWithoutForm)?tailWithoutForm:'';
    const continuation=!following&&inline&&/^в\s+(?:день|сутки|неделю)(?=\s|[;–—-]|$)/iu.test(lines[i+1]||'')?lines[i+1]:'';
    const issue=issues.find(x=>ocrLineKey(x.text)===ocrLineKey(source));
    const uncertainDose=issue&&(!issue.words?.length||issue.words.some(w=>w.confidence<65&&(
      /\d|[?？�]/u.test(w.text)||/^(?:мг|мкг|мл|г|ед|ме|mg|ml|mcg|iu|%)\W*$/iu.test(w.text))));
    meds.push({id:uid(),name,strength:uncertainDose?'':match[0],form:form.replace(/^таблетке$/iu,'таблетки'),
      instructions:[inline,following,continuation].filter(Boolean).map(cleanRxEdge).join(' ')});
    if(following||continuation)i=following?followingIndex:i+1;
  }
  return meds;
}

// Laboratory rows retain the values printed on the source. Values from this table
// are derived only for plotting and explicitly labelled comparisons.
const labAnalytes = [
  {name:'Гемоглобин',aliases:/^(?:гемоглобин|ha?emoglobin|hb|hgb)(?:\s*\((?:hb|hgb|нсв)\))?$/i,search:'Hb HGB hemoglobin haemoglobin',
    unit:'г/л',scales:{'г/л':1,'г/дл':10}},
  {name:'Глюкоза',aliases:/^(?:глюкоза|glucose|glu)(?:\s+(?:плазмы|крови|мочи|сыворотки))?$/i,search:'glucose GLU',
    unit:'ммоль/л',scales:{'ммоль/л':1,'мкмоль/л':0.001,'мг/дл':0.05551}},
  {name:'Холестерин общий',aliases:/^(?:(?:(?:общий|суммарный)\s+)?холестер(?:ин|ол)|холестер(?:ин|ол)\s+(?:общий|суммарный)|total\s+cholesterol|cholesterol(?:,?\s+total)?|chol|tc|охс)(?:\s*\((?:общий|охс|chol|tc)\))?$/i,
    search:'общий холестерин холестерол total cholesterol CHOL TC ОХС холлестирин холестирин',unit:'ммоль/л',scales:{'ммоль/л':1,'мкмоль/л':0.001,'мг/дл':0.02586}},
  {name:'Холестерин ЛПВП',aliases:/^(?:(?:(?:холестерин|хс)[\s-]+)?лпвп|(?:холестерин|хс)\s*\(лпвп\)|лпвп[\s-]+холестерин|hdl(?:[-\s]+(?:c|cholesterol))?|cholesterol[,]?\s+hdl)(?:\s*\(hdl(?:-c)?\))?$/i,
    search:'HDL HDL-C ЛПВП холлестирин холестирин',unit:'ммоль/л',scales:{'ммоль/л':1,'мкмоль/л':0.001,'мг/дл':0.02586}},
  {name:'Холестерин ЛПНП',aliases:/^(?:(?:(?:холестерин|хс)[\s-]+)?лпнп|(?:холестерин|хс)\s*\(лпнп\)|лпнп[\s-]+холестерин|ldl(?:[-\s]+(?:c|cholesterol))?|cholesterol[,]?\s+ldl)(?:\s*\(ldl(?:-c)?\))?$/i,
    search:'LDL LDL-C ЛПНП холлестирин холестирин',unit:'ммоль/л',scales:{'ммоль/л':1,'мкмоль/л':0.001,'мг/дл':0.02586}},
  {name:'С-реактивный белок',aliases:/^(?:[сc][- ]реактивный белок|c[- ]reactive protein|crp|срб)(?:\s*\((?:crp|срб)\))?$/i,
    unit:'мг/л',scales:{'мг/л':1,'мг/дл':10}},
  {name:'Лейкоциты',aliases:/^(?:лейкоциты|leu[ck]ocytes|wbc|white blood cells)(?:\s*\(wbc\))?$/i,search:'WBC'},
  {name:'Нитриты',aliases:/^(?:нитриты|nitrites?)$/i}
];
const labBloodCountNames={
  RBC:'Эритроциты',HCT:'Гематокрит',MCV:'Средний объём эритроцита',
  MCH:'Среднее содержание гемоглобина в эритроците',MCHC:'Средняя концентрация гемоглобина в эритроците',
  'RDW-SD':'Ширина распределения эритроцитов (RDW-SD)','RDW-CV':'Ширина распределения эритроцитов (RDW-CV)',
  PLT:'Тромбоциты',PCT:'Тромбокрит',MPV:'Средний объём тромбоцитов',PDW:'Ширина распределения тромбоцитов по объёмам',
  'P-LCR':'Коэффициент больших тромбоцитов',NEUT:'Нейтрофильные гранулоциты','NEUT%':'Нейтрофильные гранулоциты'
};
function labBloodCountAnalyte(label){
  const parts=label.match(/^(.*?)\s*\(([^()]*)\)$/);
  const name=(parts?.[1]||label).toLowerCase().replaceAll('ё','е');
  const confusables={А:'A',В:'B',Е:'E',К:'K',М:'M',Н:'H',О:'O',Р:'P',С:'C',Т:'T',У:'Y',Х:'X'};
  const code=(parts?.[2]||label).toUpperCase().replace(/\s/g,'').replace(/[АВЕКМНОРСТУХ]/g,ch=>confusables[ch]);
  const recognized=Object.entries(labBloodCountNames).find(([,title])=>title.toLowerCase().replaceAll('ё','е')===name)?.[0];
  // PCT alone may refer to procalcitonin. A printed "Тромбокрит" disambiguates it.
  const knownCode=code!=='PCT'&&Object.hasOwn(labBloodCountNames,code);
  const keyedName=knownCode&&labBloodCountNames[code].toLowerCase().replaceAll('ё','е');
  const key=recognized||(keyedName&&(!parts||keyedName.startsWith(name+' ('))?code:'');
  return key?{name:labBloodCountNames[key],search:key}:null;
}
function labAnalyte(name){
  const label=String(name).normalize('NFKC').trim().replace(/[–—‑]/g,'-').replace(/\s+/g,' ');
  return labAnalytes.find(a=>a.aliases.test(label))||labBloodCountAnalyte(label);
}
function labUnit(raw){
  const unit=String(raw||'').trim().replace(/\s*\/\s*/g,'/').replace(/[μµ]/g,'µ')
    .replace(/[хx×]\s*10(?=[⁰¹²³⁴⁵⁶⁷⁸⁹^])/gu,'×10');
  // SI prefix case is significant. Never case-fold a unit or convert an unlisted one.
  const equivalents={'g/L':'г/л','g/l':'г/л','g/dL':'г/дл','g/dl':'г/дл','mg/L':'мг/л','mg/l':'мг/л',
    'mg/dL':'мг/дл','mg/dl':'мг/дл','mmol/L':'ммоль/л','mmol/l':'ммоль/л','µmol/L':'мкмоль/л','µmol/l':'мкмоль/л'};
  const count=unit.match(/^(?:[×хx]\s*)?10(?:\^(9|12)|(⁹|¹²))\s*(?:клеток\s*)?\/[лLl]$/u);
  if(count)return (count[1]==='9'||count[2]==='⁹')?'×10⁹/л':'×10¹²/л';
  return Object.hasOwn(equivalents,unit)?equivalents[unit]:unit;
}
function labSpecimen(text){
  const patterns=[['Моча',/(?<!\p{L})моч(?:а|и|е|у|ой)(?!\p{L})|\burine\b/iu],['Плазма',/плазм[аыуе]|\bplasma\b/i],
    ['Сыворотка',/сыворотк[аиеу]|\bserum\b/i],['Цельная кровь',/цельн\S* кров|кровь[\s,:]+цельн|\bwhole blood\b/i],
    ['Капиллярная кровь',/капиллярн\S* кров|кровь[\s,:]+капиллярн|\bcapillary blood\b/i],['Венозная кровь',/венозн\S* кров|кровь[\s,:]+венозн|\bvenous blood\b/i]];
  const matches=patterns.filter(([,regex])=>regex.test(text));
  return matches.length===1?matches[0][0]:'';
}
function labSpecimenFor(row,reportTitle){
  if(Object.hasOwn(row,'specimen')){
    const value=String(row.specimen||'').trim();
    const common=['Цельная кровь','Плазма','Сыворотка','Моча','Капиллярная кровь','Венозная кровь'];
    if(/^(?:[?？]+|не указан[ао]?|неизвестн[ао]?|unknown)$/i.test(value))return '';
    const known=common.find(s=>s.toLowerCase()===value.toLowerCase());
    return known||(/^(?:whole blood|plasma|serum|urine|capillary blood|venous blood|кровь (?:цельная|капиллярная|венозная))$/i.test(value)?labSpecimen(value):value);
  }
  const named=labSpecimen(row.name);
  if(named)return named;
  const titled=labSpecimen(reportTitle);
  if(titled)return titled;
  return /^(?:(?:общий|клинический) анализ крови(?:\s*\(оак\))?(?:,?\s+автоматизированный)?[,]?|complete blood count(?:\s*\(cbc\))?)$/i.test(String(reportTitle).trim())?'Цельная кровь':'';
}
function labSeriesPoint(row,reportTitle){
  const rawName=String(row.name||'').trim(),analyte=labAnalyte(rawName);
  const name=analyte?.name||rawName,specimen=labSpecimenFor(row,reportTitle);
  const sourceUnit=labUnit(row.unit),scales=analyte?.scales;
  const factor=scales&&Object.hasOwn(scales,sourceUnit)?scales[sourceUnit]:null;
  const unit=factor?analyte.unit:sourceUnit;
  let value=String(row.value??'');
  const number=value.match(/^([<>≤≥]?\s*)([+-]?\d+(?:[.,]\d+)?)$/);
  if(factor&&factor!==1&&number)value=number[1]+Number((Number(number[2].replace(',','.'))*factor).toPrecision(14));
  const marker=name.normalize('NFKC').toLowerCase().replaceAll('ё','е').replace(/[–—‑]/g,'-').replace(/\s+/g,' ');
  // Keep unspecified specimens together in their own series, without assigning a material to the records.
  const key=marker+'|'+unit+(specimen==='Цельная кровь'?'':'|'+(specimen.toLowerCase()||'?'));
  return {key,marker,name,specimen,unit,value,search:analyte?.search||''};
}
function labSampleDate(raw){
  const found=[];
  const pattern=/(?:дата\s+(?:взятия|забора)(?:\s+(?:образца|крови|материала))?|(?:date\s+)?collected|collection\s+date|date\s+of\s+collection)\s*[:\s]*(\d{4}-\d{2}-\d{2}|\d{1,2}[./]\d{1,2}[./]\d{4}|\d{1,2}\s+[a-z]{3,9}\s+\d{4})/gi;
  for(const [full,date] of raw.matchAll(pattern)){
    let iso=date;
    const local=date.match(/^(\d\d?)[./](\d\d?)[./](\d{4})$/);
    const words=date.match(/^(\d\d?)\s+([A-Za-z]{3,9})\s+(\d{4})$/);
    if(local){
      if(full.includes('/')&&/[a-z]/i.test(full))return '';
      iso=[local[3],local[2].padStart(2,'0'),local[1].padStart(2,'0')].join('-');
    }else if(words){
      const m=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(words[2].slice(0,3).toLowerCase())+1;
      iso=[words[3],String(m).padStart(2,'0'),words[1].padStart(2,'0')].join('-');
    }
    const d=new Date(iso+'T00:00:00Z');
    if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==iso)return '';
    found.push(iso);
  }
  return found.length&&found.every(s=>s===found[0])?found[0]:'';
}
const labRangeLabel=/^(?:референс(?:ный\s+(?:диапазон|интервал)(?:\s+бланка)?|ные значения)?|диапазон(?:\s+бланка)?|норма|ref(?:erence)?(?:\s+(?:range|interval))?)\s*[:|]?\s*/i;
function labPrintRange(text){
  return text.replace(labRangeLabel,'').trim().replace(/(\d)\s*[-–—]\s*(?=\d)/g,'$1–');
}
function labWideRow(line,next){
  const cells=line.split(/\t+| {2,}/).map(cell=>cell.trim().replace(/^[|│]+|[|│]+$/g,'').trim()).filter(Boolean);
  if(cells.length<3||!/^\p{L}/u.test(cells[0]))return null;
  let [name,value,unit,...rangeCells]=cells;
  const numeric=/^[<>≤≥]?\s*[-+]?\d+(?:[.,]\d+)?$/;
  // Some reports print the unit before the value.
  if(!numeric.test(value)&&numeric.test(unit)&&/^[\p{L}%µμ/.]+$/u.test(value))[value,unit]=[unit,value];
  const interval=/^([-+]?\d+(?:[.,]\d+)?)\s*[-–—]\s*([-+]?\d+(?:[.,]\d+)?)$/;
  if(!rangeCells.length&&interval.test(unit)){rangeCells=[unit];unit='?'}
  const unitContinuation=/^клеток(?:[\\/]л|іл|\\п)$/iu.test(next);
  const ordinaryUnit=/[/%]/.test(unit)||/^(?:фл|пг|pg|fL|сек|ммоль|мкмоль|\?)$/i.test(unit);
  if(!ordinaryUnit&&!unitContinuation&&!rangeCells.length)return null;
  let range=labPrintRange(rangeCells.join(' '));
  if(!numeric.test(value)){
    if(!interval.test(range)||!/[\p{L}%]/u.test(unit))return null;
    value='?';
  }
  let consumed=false;
  if(/^\([A-ZА-Я% -]+\)$/iu.test(next)||(/(?:^|\s)(?:в|по)$/i.test(name)&&/^\p{L}[\p{L}\s-]*\([A-ZА-Я% -]+\)$/iu.test(next))){
    name+=' '+next;consumed=true;
  }
  if(unitContinuation){
    // An unclear power must be confirmed rather than guessed from the analyte.
    if(/^(?:[×хx]\s*)?10(?:\^(?:9|12)|⁹|¹²)$/u.test(unit))unit+=' клеток/л';
    else unit='?';
    consumed=true;
  }
  if(labAnalyte(name)?.search==='MCH'&&/^(?:nr|пг)$/i.test(unit))unit='пг';
  else if(!ordinaryUnit&&!unitContinuation)unit='?';
  const bounds=range.match(interval);
  if(bounds&&Number(bounds[1].replace(',','.'))>Number(bounds[2].replace(',','.')))range='?';
  return {row:{name,value,unit,range},consumed};
}
function labResultLine(line,previous){
  const fieldOfView='в\\s+п(?:\\s*\\/\\s*зр|\\.\\s*з)\\.?';
  const microscopy=line.match(new RegExp('^(.+?)\\s+(\\d+\\s*[-–—]\\s*\\d+)\\s+('+fieldOfView+')$','iu'));
  if(microscopy){
    const [,label,value,unit]=microscopy;
    const name=label.replace(new RegExp('[,\\s]+'+fieldOfView+'$','iu'),'').trim();
    if(name&&/\p{L}/u.test(name))return {name,value,unit,range:''};
  }
  const unitToken='(?:[×хx]\\s*)?[\\p{L}%µμ×^0-9⁰¹²³⁴⁵⁶⁷⁸⁹./]+(?:\\s*/\\s*[\\p{L}]+)?';
  const reading='[<>≤≥]?\\s*[-+]?\\d+(?:[.,]\\d+)?|[?？�]+|неразборчиво';
  const unitAllowed=u=>u&&(/[/%]/.test(u)||/^(?:фл|пг|сек|ммоль|мкмоль)$/i.test(u));
  const forward=line.match(new RegExp('^(?:(.+?)\\s*[:|;]?\\s+)?('+reading+')\\s+('+unitToken+')(?:\\s+(.*))?$','iu'));
  const reversed=line.match(new RegExp('^(.+?)\\s+('+unitToken+')\\s+('+reading+')(?:\\s+(.*))?$','iu'));
  let name,value,unit,range;
  if(forward&&unitAllowed(forward[3]))[,name,value,unit,range]=forward;
  else if(reversed&&unitAllowed(reversed[2]))[,name,unit,value,range]=reversed;
  else {
    const verbal=line.match(/^(.+?)\s*[:|;]?\s+(отрицательно|положительно|не обнаружено|обнаружено|negative|positive|not detected|[?？�]+)\s*$/i)||
      line.match(/^(флора)\s+(отс\.?)$/iu);
    if(verbal)[,name,value]=verbal;
    else{
      const missingUnit=line.match(/^(.+?)\s+([<>≤≥]?\s*[-+]?\d+(?:[.,]\d+)?)$/);
      if(!missingUnit||!labAnalyte(missingUnit[1]))return null;
      [,name,value]=missingUnit;
    }
  }
  name=(name||previous||'').replace(/[:;|]$/,'').trim();
  if(!name||name.length>100||!/[\p{L}]/u.test(name)||labRangeLabel.test(name)||/[|│]\s*[<>≤≥]?\s*\d+(?:[.,]\d+)?$/.test(name))return null;
  return {name,value:value.trim(),unit:unit||'',range:labPrintRange(range||'')};
}
function labSpecimenSection(line){
  const mappings=new Map();
  for(const m of line.matchAll(/([^(),/]+)\(([^()]*)\)/g)){
    let sample=labSpecimen(m[1]);
    for(const term of m[2].split(/[,;]/)){
      const key=labAnalyte(term)?.name||term.trim().toLowerCase();
      if(sample)mappings.set(key,sample);
      // For haemoglobin, blood as the explicitly labelled specimen permits the
      // standard whole-blood series. Never infer this for glucose or chemistry.
      else if(/^\s*(?:материал\s*:\s*)?кровь\s*$/i.test(m[1])&&key==='Гемоглобин')mappings.set(key,'Цельная кровь');
    }
  }
  if(mappings.size)return {mappings,sample:''};
  if(/^(?:биоматериал|материал|образец|specimen|sample)\s*:/i.test(line)||
    /^(?:плазма|сыворотка|моча|цельная кровь|whole blood|plasma|serum|urine)(?:\s*\/[^()]*)?$/i.test(line))
    return {mappings,sample:labSpecimen(line)};
  return null;
}
function parseLabText(raw,filename){
  const lines=String(raw||'').split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  const name=lines.find(s=>/^(?:общий |клинический |биохимический )?(?:анализ|гемограмм|биохими|исследование)|^(?:мазок\s+на\s|ha?ematology|ha?emogram|clinical chemistry|urinalysis|complete blood count)/i.test(s))||filename.replace(/\.[^.]+$/,'');
  const laboratory=lines.find(s=>/^лаборатори[яи](?:\s|:)|\b(?:laboratory|laboratories|lab)\s*$/i.test(s))||'';
  const rows=[];
  let section={mappings:new Map(),sample:''},previous='',lastResult;
  for(let i=0;i<lines.length;i++){
    const line=lines[i];
    const normalized=line.replace(/\s+/g,' ');
    if(normalized===laboratory) section={mappings:new Map(),sample:''};
    const sample=labSpecimenSection(normalized);
    if(sample){section=sample;previous='';lastResult=null;continue}
    if(labRangeLabel.test(normalized)&&lastResult){
      if(!lastResult.range)lastResult.range=labPrintRange(normalized);
      lastResult=null;previous='';continue;
    }
    const wide=labWideRow(line,lines[i+1]||'');
    if(wide?.consumed)i++;
    const row=wide?.row||labResultLine(normalized,previous);
    if(row){
      // Vision may read both letters in "Hb" as Cyrillic. Resolve the glyphs
      // only when the same section explicitly spells Hb and the unit agrees.
      if(/^[HН][Ььb]$/u.test(row.name)&&section.mappings.get('Гемоглобин')==='Цельная кровь'&&
        ['г/л','г/дл'].includes(labUnit(row.unit)))row.name='Hb';
      const labelled=section.mappings.get(labAnalyte(row.name)?.name||row.name.toLowerCase())||section.sample;
      const fromName=labSpecimen(row.name);
      row.specimen=labelled&&fromName&&labelled!==fromName?'':labelled||labSpecimenFor(row,name);
      rows.push(row);
    }
    lastResult=row;
    previous=normalized;
  }
  const haematology=/общий анализ крови|гемограмм|ha?ematology|complete blood count/i.test(name);
  const chemistry=/биохими|chemistry/i.test(name);
  const category=haematology===chemistry?'Другое':haematology?'Гематология':'Биохимия';
  return {name,date:labSampleDate(String(raw||'')),laboratory,category,rows};
}

const examMethods=['УЗИ','Рентгенография','Флюорография','КТ','МРТ','ЭКГ','Эндоскопия','Другое'];
const examMethodPatterns=[
  /УЗИ|ультразвуков/iu,/рентген/iu,/флюорограф/iu,/(?:^|[^а-яё])КТ(?:$|[^а-яё])|компьютерн[а-яё]* томограф/iu,
  /МРТ|магнитно-резонанс/iu,/ЭКГ|электрокардиогра/iu,/эндоскоп|гастроскоп|колоноскоп/iu
];

function parseExamProtocol(text){
  const dates=new Set(),result={parameters:[],questions:[]},lines=clinicalLines(text);
  const header=[];
  for(const line of lines.slice(0,12)){
    if(/^(?:описание|параметры|заключение|рекомендации)(?=\s|[:.—–-]|$)/iu.test(line))break;
    if(!/^(?:направление|анамнез|показания|пациент|дата|фио|рекомендовано)(?=\s|[:.—–-]|$)/iu.test(line))header.push(line);
  }
  const methods=examMethodPatterns.map((re,i)=>header.some(line=>re.test(line))?i:-1).filter(i=>i>=0);
  const method=methods.length===1?methods[0]:-1;
  if(method>=0)result.method=examMethods[method];
  const dateLabels=fieldLine('дата(?:(?: и время)? (?:исследования|проведения|обследования|выполнения)(?: исследования)?)?');
  const metadata=[['region','область(?: исследования| сканирования)?|зона исследования|орган|локализация исследования'],
    ['doctor','врач(?:-диагност|-рентгенолог| ультразвуковой диагностики|, выполнивший исследование)?|специалист|фио врача'],['clinic',visitLabels.clinic]];
  const headings=metadata.map(([,labels])=>fieldLine(labels));
  const blockHeading=new RegExp('^(заключение(?: врача)?|описание(?: исследования)?|параметры(?: исследования)?|измерения)\\s*(?:'+fieldSeparator+'\\s*(.*))?$','iu');
  for(const [key,labels] of metadata){
    const value=labelledValue(lines,labels);
    if(value)result[key]=value;
  }
  if(!result.clinic){const clinic=printedClinic(header);if(clinic)result.clinic=clinic}
  let section='';
  for(const [index,line] of lines.entries()){
    const pair=line.match(/^([^:]{1,90})\s*:\s*(.*)$/u);
    if(/^(?:страница\s+\d+|\d+\s+из\s+\d+|синтетические данные|дата печати|подпись врача|протокол подписан|приложение к протоколу)/iu.test(line)){section='';continue}
    const label=pair?.[1].trim()||'',value=pair?.[2].trim()||'';
    const day=line.match(dateLabels);
    if(day){
      const source=day[1]||lines[index+1]||'';
      const iso=source.match(/^(\d{4}-\d{2}-\d{2})(?=\s|T|$)/u),local=source.match(/^(\d{1,2})[./]\s*(\d{1,2})[./]\s*(\d{4})(?=\s|[,;]|$)/u);
      const date=iso?.[1]||(local&&[local[3],local[2].padStart(2,'0'),local[1].padStart(2,'0')].join('-'));
      if(date&&Number.isFinite(Date.parse(date))&&new Date(date).toISOString().slice(0,10)===date)dates.add(date);
      section='';continue;
    }
    if(headings.some(pattern=>pattern.test(line))){section='';continue}
    const heading=line.match(blockHeading);
    if(heading){
      const name=heading[1].toLowerCase();
      section=name.startsWith('заключение')?'conclusion':name.startsWith('описание')?'description':'parameters';
      if(heading[2]&&section!=='parameters')result[section]=[result[section],heading[2]].filter(Boolean).join('\n');
      continue;
    }
    if(/^(?:пациент|фио|дата рождения|подпись|рекомендации|адрес|телефон)(?=\s|[:.—–-]|$)/iu.test(line)){section='';continue}
    const measure=line.match(/^(.{2,80}?)(?:\s*:\s*|\s+[–—-]\s+|\s+)([<>≤≥≈]?\s*\d+(?:[,.]\d+)?(?:\s*[×xх–-]\s*\d+(?:[,.]\d+)?)*)(?:\s*)(мм рт\.\s*ст\.?|мм|см|мл|мс|м\/с|см\/с|Гц|%|град(?:усов)?|°)\s*[.;]?$/iu);
    const descriptive=/^(?:контур|структур|эхоструктур|эхогенност|локализаци|положени|форм[аы]|подвижност|проходимост|васкуляризаци|кровоток|плотност|фракция выброса)/iu.test(label);
    if(section!=='conclusion'&&(measure||((section==='parameters'||descriptive)&&label&&value))){
      const [name,reading,unit]=measure?measure.slice(1):[label,value,''];
      result.parameters.push({name:name.trim(),value:reading.trim(),unit:unit.trim()});continue;
    }
    if(section==='description'||section==='conclusion')result[section]=[result[section],line].filter(Boolean).join('\n');
  }
  if(dates.size===1)result.date=[...dates][0];
  if(dates.size>1)result.questions.push('В протоколе несколько дат обследования. Уточните дату: '+[...dates].join(', ')+'.');
  return result;
}
