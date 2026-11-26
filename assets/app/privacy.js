'use strict';

// Shared by the web app and the iOS JavaScriptCore bridge. Call on clinical strings,
// leaving the local original and the identifiers used for local navigation intact.
function anonymizeClinicalText(value,knownNames=[]){
  let text=String(value??'');
  const names=new Set();
  for(const name of knownNames){
    const parts=String(name||'').trim().split(/\s+/);
    if(parts[0].length<2)continue;
    names.add(parts.join(' '));
    if(parts.length===2&&parts.every(p=>p.length>1&&!p.includes('.'))){
      names.add(parts.slice().reverse().join(' '));
      if(parts[1].length>=3)names.add(parts[1]);
    }
  }
  if(names.size){
    const alternatives=[...names].sort((a,b)=>b.length-a.length).map(s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'));
    text=text.replace(new RegExp('(?<![\\p{L}\\p{N}])(?:'+alternatives.join('|')+')(?![\\p{L}\\p{N}])','giu'),'[имя скрыто]');
  }
  text=text.replace(/[\p{L}\d_.+%-]+@[\p{L}\d.-]+\.[\p{L}]{2,}/gu,'[почта скрыта]')
    .replace(/(?<!\d)(?:\+\d{1,3}[ (.-]*\d|\(\d{2,3}\))(?=(?:[ ().-]*\d){6,})[\d ()-]{5,}\d/g,'[телефон скрыт]')
    .replace(/(?<!\p{L})((?:телефон|тел\.|моб\.|phone)\s*[:№]?\s*)(?:\d[ ()-]*){6,}\d/giu,'$1[телефон скрыт]');

  // An ID needs a digit. This keeps clinical expressions such as «карта риска» intact.
  const idLabel=String.raw`(?<!\p{L})((?:(?:номер|№)[ \t]+)?(?:медицинская карта|амбулаторная карта|номер (?:карты|полиса|медкарты)|№[ \t]*(?:карты|медкарты)|карта(?: пациента)?|медкарта|полис(?: омс)?|паспорт|passport|личный номер|идентификационный номер|patient id|record id|medical record number|mrn)[ \t]*[:#№]?[ \t]*)`;
  const idToken=String.raw`(?:[A-ZА-ЯЁ]{1,3}[ \t]+(?=\d))?(?=[\p{L}\d/_-]*\d)[\p{L}\d][\p{L}\d/_-]*`;
  text=text.replace(new RegExp(idLabel+idToken,'giu'),'$1[номер скрыт]');
  text=text.replace(/(?<!\p{L})((?:дата рождения|д\.\s*р\.|date of birth|dob)[ \t]*[:=]?[ \t]*)(?:\d{4}-\d{2}-\d{2}|\d{1,2}[./-]\d{1,2}[./-]\d{2,4})(?!\d)/giu,'$1[дата скрыта]');

  // Mark the dots inside address abbreviations as part of the address. Leave
  // the rest of the clinical sentence and structured JSON punctuation intact.
  const addressPart=String.raw`(?=[\p{L}\d])(?:(?<!\p{L})(?:г|ул|просп|пер|наб|д|корп|кв|обл|пос|дер|стр|пл)\.(?=[ \t\d])|(?<!\p{L})\p{L}\.(?=[ \t]*\p{L})|[^.;!?\n\r"{}\[\]\\])+`;
  const addressLabel=String.raw`(?<!\p{L})((?:адрес(?:[ \t]+(?:регистрации|проживания|пациента|клиники))?|address|прописка)[ \t]*[:=–—][ \t]*)`;
  text=text.replace(new RegExp(addressLabel+addressPart,'giu'),'$1[адрес скрыт]');
  const street=String.raw`(?<!\p{L})(?:ул\.|улица|просп\.|проспект|переулок|пер\.|пр-т)[ \t]+`;
  text=text.replace(new RegExp(street+addressPart,'giu'),'[адрес скрыт]');

  // Unknown names are redacted when the document explicitly labels a name.
  text=text.replace(/(?<!\p{L})((?:[Фф][Ии][Оо](?: пациента| врача)?|[Пп]ациент(?:ка)?|[Вв]рач|[Pp]atient name)\s*[:=]\s*)((?:\p{Lu}[\p{Ll}ёЁ'’-]+|\p{Lu}\.)(?:[ \t]+(?:\p{Lu}[\p{Ll}ёЁ'’-]+|\p{Lu}\.)){1,3})/gu,'$1[имя скрыто]');
  return text;
}
