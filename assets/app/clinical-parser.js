'use strict';

const visitMonths=['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];

function visitDateFrom(lines){
  const datePattern=/(?:^|[^\d])(?:(\d{4})-(\d{2})-(\d{2})|(\d{1,2})[./](\d{1,2})[./](\d{4})|(\d{1,2})\s+(января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)\s+(\d{4}))(?!\d)/giu;
  const explicit=[],generic=[],alone=[];
  const excluded=/рожд|д\.\s*р\.|печат|дубликат|контрол[ья]|следующ|повторн(?:ый|ого) визит\s+(?:через|запланирован)|назначен на|действител|выдач|выдан|забор|взятия|результат|начал[ао]|окончан/iu;
  for(const [i,line] of lines.entries()){
    if(excluded.test(line)||(/^\d/u.test(line)&&excluded.test(lines[i-1]||'')&&!/\d/u.test(lines[i-1]||'')))continue;
    const label=/^(?:(?:дата\s+(?:визита|при[её]ма|осмотра|консультации|посещения)|на при[её]ме|осмотрен[а]?|визит состоялся)(?=[:\s·–—-]|$)|(?:при[её]м|визит|консультация|осмотр)\s+(?:от\s+)?(?=\d))/iu.test(line);
    const general=/^дата\s*[:·–—-]/iu.test(line);
    const candidate=(label||general)&&/^(?:дата(?: визита| при[её]ма| осмотра| консультации| посещения)?|на при[её]ме)\s*[:·–—-]?$/iu.test(line) ? lines[i+1]||'' : line;
    if(!(label||general||/^\d{1,4}[./\s-]/u.test(line)))continue;
    const target=label?explicit:general?generic:alone;
    if(label||general)target.push(null); // An unreadable explicit value must not fall back to another date.
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
  const lines=raw.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
  function labelled(pattern){
    for(let i=0;i<lines.length;i++){
      const match=lines[i].match(pattern);
      if(match)return (match[1]||(!/^[^:]{1,45}:/.test(lines[i+1]||'')&&lines[i+1])||'').trim();
    }
    return '';
  }
  const episodeName=labelled(/^(?:эпизод(?: болезни)?|(?:основной |предварительный |клинический )?диагноз)(?:\s*[:·–—-]\s*(.*)|\s*)$/iu);
  const specialtyLine=lines.map(line=>line.match(/^((?:[а-яё-]+олог|терапевт|педиатр|хирург|врач общей практики|лор))\s*(?:[·:–—-]\s*|\s+)([\p{L}][\p{L}.'’\s-]+)$/iu)).find(Boolean);
  const doctorName=labelled(/^(?:(?:лечащий )?врач(?:\s+при[её]ма)?|фио врача)\s*(?:[:·–—-]\s*(.*)|\s*)$/iu)||specialtyLine?.[2]||'';
  const specialty=labelled(/^специальность\s*[:·–—-]\s*(.*)$/iu)||specialtyLine?.[1]||'';
  const title=labelled(/^(?:название визита|тип при[её]ма|вид посещения|визит)\s*[:·–—-]\s*(.*)$/iu)||
    lines.find(l=>/^(?:(?:первичный |повторный )?(?:при[её]м|консультация|осмотр)|выписка (?:о|из)|протокол (?:консультации|осмотра))\s+\p{L}/iu.test(l))||'';
  const note=labelled(/^(?:жалобы(?: пациента)?|повод обращения|причина обращения|сведения о визите)(?:\s*[:·–—-]\s*(.*)|\s*)$/iu)||
    labelled(/^заключение(?: врача)?(?:\s*[:·–—-]\s*(.*)|\s*)$/iu);
  const clinic=labelled(/^(?:клиника|учреждение|медицинская организация|место при[её]ма)\s*[:·–—-]\s*(.*)$/iu)||
    lines.find(l=>{
      const institution=l.match(/^(?:(?:медицинский |диагностический )?центр|поликлиника|клиника|кабинет|бюро|больница)\s+(.+)$/iu);
      return institution&&/^[«„"\p{Lu}№]/u.test(institution[1]);
    })||'';
  return {episodeName,doctorName,specialty,title,note,clinic:clinic.replace(/\s+(?:(?:лист|стр\.?)\s*)?\d{1,3}\s*(?:\/|из)\s*\d{1,3}\s*$/iu,''),date:visitDateFrom(lines)};
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

const activeRxHeading=/^(?:(?:лекарственные |врачебные |новые |текущие )?назначения(?: врача)?|лист назначений|(?:медикаментозное |назначенное |рекомендованное )?лечение|(?:новая |текущая )схема(?: лечения)?|назначено|назначен[аы]?|принимать)\s*(?=[:.·–—-]|$)[:.·–—-]*\s*/iu;
const historyRxHeading=/^(?:аллерги[яию]|аллергологический анамнез|аллерг\.\s*анамнез|побочные реакции|нежелательные реакции|лекарственная (?:аллергия|непереносимость)|непереносимость|анамнез|медикаментозный анамнез|история (?:лекарств|лечения|назначений)|отмен(?:а|ить)(?: препаратов)?|предыдущ(?:ая|ее|ие) (?:схема|лечение|назначения)|(?:отмен[её]нные|прежние) (?:лекарства|назначения|препараты)|ранее (?:принимал[аи]?|назначено|применял[аи]?)|принимал[аи]? ранее)(?=[:.\s–—-]|$)/iu;
const inactiveRxText=/(?:аллерги[яиюч]|непереносим|противопоказан|отмен[еёяи]|прекрат(?:ить|ил|ила)|исключить|не\s+(?:приним|назнач|примен|использ)|(?:ранее|в прошлом)\s+(?:приним|назнач|примен|получ))/iu;
const otherRxHeading=/^(?:рекомендации(?: врача)?|рекомендовано|жалобы|заключение|обследование|диагноз|результаты|подпись|осмотр|показатели|лабораторные исследования)(?=[:.\s–—-]|$)/iu;
const rxDose=/\d+(?:[.,]\d+)?(?:\s*\/\s*\d+(?:[.,]\d+)?)?\s*(?:мкг|мг|мл|ме|ед|г|%|mcg|mg|ml|iu)(?![\p{L}])(?:\s*\/\s*(?:доза|дозу|дозы|мл|табл\.?|ml))?/iu;
const rxUnknown=/[?？�]+\s*(?:мкг|мг|мл|г|%|mg|ml)?|неразборчиво(?:\s+(?:мкг|мг|мл|г|%))?/iu;
const rxForm=/(?<!\p{L})(?:назальный спрей|спрей|таблетк[аиуы]?|табл\.?|раствор|сироп|капсул[аы]?|крем|мазь|капли|гель)(?!\p{L})/iu;
const rxRegimen=/^(?:по\s|принимать\s|наносить\s|закапывать\s|внутрь|\d+\s*(?:раз|табл|капс))/iu;
const cleanRxEdge=t=>t.replace(/^[\s©®·,:;–—-]+|[\s·,:;–—-]+$/gu,'').trim();
const ocrLineKey=s=>s.toLowerCase().replace(/[^\p{L}\d?]/gu,'');

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
  const hasActiveSection=lines.some(s=>activeRxHeading.test(s));
  let active=!hasActiveSection;
  for(let i=0;i<lines.length;i++){
    const source=lines[i];
    let line=source.replace(/^\s*(?:[•–—-]|\d+[.)])\s*/u,'');
    if(historyRxHeading.test(line)){active=false;continue}
    if(activeRxHeading.test(line)){active=true;line=line.replace(activeRxHeading,'')}
    else if(otherRxHeading.test(line)){
      if(hasActiveSection||!/^(?:жалобы|диагноз|осмотр)(?=[:.\s–—-]|$)/iu.test(line))active=false;
      continue;
    }
    if(!line||!active||inactiveRxText.test(line)||rxRegimen.test(line))continue;
    if(/^(?:отмен[её]н[аоы]?|отменить|прекратить|не принимать)(?:\s+(?:ранее|врачом|сегодня|на прошлом визите))?\s*[.!]?$/iu.test(lines[i+1]||''))continue;
    const dose=line.match(rxDose),unknown=line.match(rxUnknown);
    // An unclear token wins if it is where the dose should be, before a later quantity.
    const match=unknown&&(!dose||unknown.index<=dose.index)?unknown:dose;
    if(!match)continue;
    const prefix=line.slice(0,match.index),form=line.match(rxForm)?.[0]||'';
    const name=cleanRxEdge(prefix.replace(rxForm,''));
    if(!name||name.length>90||!/[\p{L}]/u.test(name))continue;
    const tail=cleanRxEdge(line.slice(match.index+match[0].length));
    const tailWithoutForm=cleanRxEdge(tail.replace(new RegExp('^(?:'+rxForm.source+')','iu'),''));
    const inline=/[\p{L}\d]/u.test(tailWithoutForm)?tailWithoutForm:'';
    const following=rxRegimen.test(lines[i+1]||'')?lines[i+1]:'';
    const issue=issues.find(x=>ocrLineKey(x.text)===ocrLineKey(source));
    const uncertainDose=issue&&(!issue.words?.length||issue.words.some(w=>w.confidence<65&&(
      /\d|[?？�]/u.test(w.text)||/^(?:мг|мкг|мл|г|ед|ме|mg|ml|mcg|iu|%)\W*$/iu.test(w.text))));
    meds.push({id:uid(),name,strength:uncertainDose?'':match[0],form,instructions:[inline,following].filter(Boolean).join(' ')});
  }
  return meds;
}

// Laboratory rows retain the values printed on the source. Values from this table
// are derived only for plotting and explicitly labelled comparisons.
const labAnalytes = [
  {name:'Гемоглобин',aliases:/^(?:гемоглобин|ha?emoglobin|hb|hgb)(?:\s*\((?:hb|hgb)\))?$/i,
    unit:'г/л',scales:{'г/л':1,'г/дл':10}},
  {name:'Глюкоза',aliases:/^(?:глюкоза|glucose|glu)(?:\s+(?:плазмы|крови|мочи|сыворотки))?$/i,
    unit:'ммоль/л',scales:{'ммоль/л':1,'мкмоль/л':0.001}},
  {name:'С-реактивный белок',aliases:/^(?:[сc][- ]реактивный белок|c[- ]reactive protein|crp|срб)(?:\s*\((?:crp|срб)\))?$/i,
    unit:'мг/л',scales:{'мг/л':1,'мг/дл':10}},
  {name:'Лейкоциты',aliases:/^(?:лейкоциты|leu[ck]ocytes|wbc|white blood cells)$/i},
  {name:'Нитриты',aliases:/^(?:нитриты|nitrites?)$/i}
];
function labAnalyte(name){
  return labAnalytes.find(a=>a.aliases.test(String(name).trim()));
}
function labUnit(raw){
  const unit=String(raw||'').trim().replace(/\s*\/\s*/g,'/').replace(/[μµ]/g,'µ')
    .replace(/[хx×]\s*10(?=[⁰¹²³⁴⁵⁶⁷⁸⁹^])/gu,'×10');
  // SI prefix case is significant. Never case-fold a unit or convert an unlisted one.
  const equivalents={'g/L':'г/л','g/l':'г/л','g/dL':'г/дл','g/dl':'г/дл','mg/L':'мг/л','mg/l':'мг/л',
    'mg/dL':'мг/дл','mg/dl':'мг/дл','mmol/L':'ммоль/л','mmol/l':'ммоль/л','µmol/L':'мкмоль/л','µmol/l':'мкмоль/л'};
  return Object.hasOwn(equivalents,unit)?equivalents[unit]:unit;
}
function labSpecimen(text){
  const patterns=[['Моча',/(?<!\p{L})моч(?:а|и|е|у|ой)(?!\p{L})|\burine\b/iu],['Плазма',/плазм[аыуе]|\bplasma\b/i],
    ['Сыворотка',/сыворотк[аиеу]|\bserum\b/i],['Цельная кровь',/цельн\S* кров|\bwhole blood\b/i],
    ['Капиллярная кровь',/капиллярн\S* кров|\bcapillary blood\b/i],['Венозная кровь',/венозн\S* кров|\bvenous blood\b/i]];
  const matches=patterns.filter(([,regex])=>regex.test(text));
  return matches.length===1?matches[0][0]:'';
}
function labSpecimenFor(row,reportTitle){
  if(Object.hasOwn(row,'specimen')){
    const value=String(row.specimen||'').trim();
    const common=['Цельная кровь','Плазма','Сыворотка','Моча','Капиллярная кровь','Венозная кровь'];
    if(/^(?:[?？]+|не указан[ао]?|неизвестн[ао]?|unknown)$/i.test(value))return '';
    return common.find(s=>s.toLowerCase()===value.toLowerCase())||value;
  }
  const named=labSpecimen(row.name);
  if(named)return named;
  const titled=labSpecimen(reportTitle);
  if(titled)return titled;
  return /^(?:общий|клинический) анализ крови(?:\s*\(оак\))?$/i.test(String(reportTitle).trim())?'Цельная кровь':'';
}
function labSeriesPoint(row,reportTitle,sourceId){
  const rawName=String(row.name||'').trim(),analyte=labAnalyte(rawName);
  const name=analyte?.name||rawName,specimen=labSpecimenFor(row,reportTitle);
  const sourceUnit=labUnit(row.unit),scales=analyte?.scales;
  const factor=scales&&Object.hasOwn(scales,sourceUnit)?scales[sourceUnit]:null;
  const unit=factor?analyte.unit:sourceUnit;
  let value=String(row.value??'');
  const number=value.match(/^([<>≤≥]?\s*)([+-]?\d+(?:[.,]\d+)?)$/);
  if(factor&&factor!==1&&number)value=number[1]+Number((Number(number[2].replace(',','.'))*factor).toPrecision(14));
  // Preserve the existing whole-blood keys. For unconfirmed specimens use the source
  // document only; equal names and units alone cannot establish comparability.
  let key=name.toLowerCase().replace(/ё/g,'е').replace(/\s+/g,' ')+'|'+unit;
  if(specimen!=='Цельная кровь')key+='|'+(specimen?specimen.toLowerCase():'?'+sourceId);
  return {key,name,specimen,unit,value};
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
function labResultLine(line,previous){
  const unitToken='(?:[×хx]\\s*)?[\\p{L}%µμ×^0-9⁰¹²³⁴⁵⁶⁷⁸⁹./]+(?:\\s*/\\s*[\\p{L}]+)?';
  const reading='[<>≤≥]?\\s*[-+]?\\d+(?:[.,]\\d+)?|[?？�]+|неразборчиво';
  const unitAllowed=u=>u&&(/[/%]/.test(u)||/^(?:фл|пг|сек|ммоль|мкмоль)$/i.test(u));
  const forward=line.match(new RegExp('^(?:(.+?)\\s*[:|;]?\\s+)?('+reading+')\\s+('+unitToken+')(?:\\s+(.*))?$','iu'));
  const reversed=line.match(new RegExp('^(.+?)\\s+('+unitToken+')\\s+('+reading+')(?:\\s+(.*))?$','iu'));
  let name,value,unit,range;
  if(forward&&unitAllowed(forward[3]))[,name,value,unit,range]=forward;
  else if(reversed&&unitAllowed(reversed[2]))[,name,unit,value,range]=reversed;
  else {
    const verbal=line.match(/^(.+?)\s*[:|;]?\s+(отрицательно|положительно|не обнаружено|обнаружено|negative|positive|not detected|[?？�]+)\s*$/i);
    if(verbal)[,name,value]=verbal;
    else{
      const missingUnit=line.match(/^(.+?)\s+([<>≤≥]?\s*[-+]?\d+(?:[.,]\d+)?)$/);
      if(!missingUnit||!labAnalyte(missingUnit[1]))return null;
      [,name,value]=missingUnit;
    }
  }
  name=(name||previous||'').replace(/[:;|]$/,'').trim();
  if(!name||name.length>100||!/[\p{L}]/u.test(name)||labRangeLabel.test(name))return null;
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
  const name=lines.find(s=>/^(?:общий |клинический |биохимический )?(?:анализ|гемограмм|биохими|исследование)|^(?:ha?ematology|ha?emogram|clinical chemistry|urinalysis|complete blood count)/i.test(s))||filename.replace(/\.[^.]+$/,'');
  const laboratory=lines.find(s=>/^лаборатори[яи](?:\s|:)|\b(?:laboratory|laboratories|lab)\s*$/i.test(s))||'';
  const rows=[];
  let section={mappings:new Map(),sample:''},previous='',lastResult;
  for(const line of lines){
    const normalized=line.replace(/\s+/g,' ');
    if(normalized===laboratory) section={mappings:new Map(),sample:''};
    const sample=labSpecimenSection(normalized);
    if(sample){section=sample;previous='';lastResult=null;continue}
    if(labRangeLabel.test(normalized)&&lastResult){
      if(!lastResult.range)lastResult.range=labPrintRange(normalized);
      lastResult=null;previous='';continue;
    }
    const row=labResultLine(normalized,previous);
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
  const dates=new Set(),result={parameters:[],questions:[]},lines=text.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  const header=lines.filter(s=>!/^заключение|^рекомендации/iu.test(s)).slice(0,6).join('\n');
  const method=examMethodPatterns.findIndex(re=>re.test(header));
  if(method>=0)result.method=examMethods[method];
  let section='';
  for(const line of lines){
    const pair=line.match(/^([^:]{1,90})\s*:\s*(.*)$/u);
    if(/^(?:страница\s+\d+|\d+\s+из\s+\d+|синтетические данные|дата печати|подпись врача|протокол подписан|приложение к протоколу)/iu.test(line)){section='';continue}
    const label=pair?.[1].trim()||'',value=pair?.[2].trim()||'';
    if(/^дата(?:\s+(?:исследования|проведения|обследования|выполнения))?$/iu.test(label)){
      const iso=value.match(/^(\d{4}-\d{2}-\d{2})(?:\s|$)/u),local=value.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})(?:\s|$)/u);
      const date=iso?.[1]||(local&&[local[3],local[2].padStart(2,'0'),local[1].padStart(2,'0')].join('-'));
      if(date&&Number.isFinite(Date.parse(date))&&new Date(date).toISOString().slice(0,10)===date)dates.add(date);
      section='';continue;
    }
    const metadata=[['region',/^(?:область(?: исследования)?|зона исследования|орган)$/iu],['doctor',/^(?:врач(?:-диагност)?|специалист)$/iu],['clinic',/^(?:клиника|учреждение)$/iu]].find(([,re])=>re.test(label));
    if(metadata){result[metadata[0]]=value;section='';continue}
    if(/^(?:заключение|описание|параметры|измерения)\s*(?::|$)/iu.test(line)){
      const name=line.split(':')[0].trim().toLowerCase();
      section=name==='заключение'?'conclusion':name==='описание'?'description':'parameters';
      if(value&&section!=='parameters')result[section]=[result[section],value].filter(Boolean).join('\n');
      continue;
    }
    if(/^(?:пациент|фио|дата рождения|подпись|рекомендации)\s*:/iu.test(line)){section='';continue}
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
