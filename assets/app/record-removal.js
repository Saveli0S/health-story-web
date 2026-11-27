'use strict';

const recordRemoval=(()=>{
  const groups={
    addedVisits:'Визиты',episodes:'Эпизоды',addedDoctors:'Врачи',files:'Документы и анализы',
    exams:'Обследования',visitDrafts:'Черновики визитов',examDrafts:'Черновики обследований',
    fields:'Поля медкарты',notes:'Пометки',recommendations:'Рекомендации',measurements:'Измерения',
    reviews:'Разборы лечения',consultations:'Консультации',prevention:'Профилактика',
    changes:'Решения о лечении',questions:'Вопросы врачу',templates:'Личные промпты',
    marketCriteria:'Настройки поиска лекарств',docLinks:'Связи документов',tagEdits:'Назначенные теги',
    treatmentQueue:'Очередь разбора лечения',prompts:'Черновики разбора лечения',
    visitMeds:'Назначения визитов',fileMeds:'Назначения из бланков',
    labRows:'Показатели анализов',labDraftRows:'Показатели черновиков анализов',examRows:'Параметры обследований',
    turns:'Сообщения консультаций',history:'Отметки о профилактике',profile:'Данные профиля'
  };
  const nested={
    visitMeds:['addedVisits',8,'name'],fileMeds:['files','meds','name'],
    labRows:['files',['lab','rows'],'name'],labDraftRows:['files',['labDraft','rows'],'name'],examRows:['exams','parameters','name'],
    turns:['consultations','turns','question'],history:['prevention','history','date']
  };
  const cautions={
    addedVisits:'Вместе с визитом удалятся его пометки, рекомендации и разборы. Анализы, обследования и документы останутся в профиле.',
    episodes:'Визиты и измерения останутся в профиле. Вопросы к этому эпизоду удалятся.',
    addedDoctors:'Связанные визиты останутся в истории. В них будет пустое поле врача.',
    files:'Из профиля удалятся оригинал, распознанные данные и результат анализа из этого файла. Карточки визитов и обследований останутся.',
    exams:'Протоколы и снимки останутся в документах профиля. Черновики этой карточки удалятся.',
    visitDrafts:'Оригиналы из этого черновика удалятся вместе с ним.',
    examDrafts:'Оригиналы, загруженные только в черновик, удалятся вместе с ним.',
    changes:'Удаление решения может изменить текущий статус связанного курса.',
    visitMeds:'Назначение и связанные решения будут удалены.',
    fileMeds:'Назначение и связанные решения будут удалены. Исходный бланк останется.',
    labRows:'Показатель исчезнет из результатов и графика. Исходный бланк останется.',
    turns:'Этот вопрос и все следующие сообщения удалятся. Более поздние ответы могли опираться на этот вопрос.',
    profile:'Очищаются медицинские записи, вложения, история ИИ и личные шаблоны выбранного профиля. Имя, роль и подключение устройства сохраняются.'
  };
  const list=(row,key)=>Array.isArray(row?.[key])?row[key]:[];
  const label=(value,fallback)=>String(value||fallback).slice(0,180);
  const item=(group,id,title,extra={})=>({group,id,title,category:groups[group],detail:cautions[group]||'',...extra});
  function title(group,r){
    if(group==='addedVisits')return [r[2],r[1]].filter(Boolean).join(' · ');
    if(group==='addedDoctors')return r.values?.slice(0,2).filter(Boolean).join(' · ');
    if(group==='exams')return [r.method,r.region,r.date].filter(Boolean).join(' · ');
    if(group==='examDrafts')return r.fields?.method||r.sources?.[0]?.name;
    return r.title||r.label||r.name||r.question||r.text||r.before?.name||r.date||r.key||r.id;
  }
  function entries(p){
    const result=[];
    for(const group of Object.keys(groups)){
      if(group==='profile')continue;
      if(group==='prompts'){
        for(const id of Object.keys(p.prompts||{}))result.push(item(group,id,title('addedVisits',list(p,'addedVisits').find(v=>v[0]===id)||[])||groups[group]));
        continue;
      }
      if(Object.hasOwn(nested,group)){
        const [parent,path,key]=nested[group];
        for(const row of list(p,parent)){
          const id=parent==='addedVisits'?row[0]:row.id;
          const values=Array.isArray(path)?list(row[path[0]],path[1]):list(row,path);
          values.forEach((value,index)=>{
            const name=label(value[key],groups[group]);
            const context=title(parent,row);
            result.push(item(group,id,name,{index,context}));
          });
        }
        continue;
      }
      for(const row of list(p,group)){
        if(group==='visitDrafts'&&row.parent)continue;
        const id=group==='addedVisits'?row[0]:row.id;
        if(typeof id==='string'&&id)result.push(item(group,id,label(title(group,row),groups[group]),
          group==='docLinks'?{other:row.other}:{}));
      }
    }
    return result;
  }
  const references={addedVisits:['visit'],episodes:['episode'],files:['file','lab'],exams:['exam'],prevention:['prevent']};
  function remove(profile,spec){
    const p=JSON.parse(JSON.stringify(profile)),{group,id,index,other}=spec;
    const drop=(key,match)=>{if(Array.isArray(p[key]))p[key]=p[key].filter(r=>!match(r))};
    const forget=(kind,ids)=>{
      const refs=new Set((references[kind]||[]).flatMap(tag=>ids.map(id=>tag+':'+id)));
      if(!refs.size)return;
      drop('tagEdits',r=>refs.has(r.id));
      for(const row of list(p,'consultations')){
        if(Array.isArray(row.sources))row.sources=row.sources.filter(src=>!refs.has(src));
        if(Array.isArray(row.refs))row.refs=row.refs.filter(ref=>!refs.has(ref.kind+':'+ref.id));
      }
      for(const row of list(p,'prevention'))for(const event of list(row,'history'))if(refs.has(event.source))event.source='';
    };
    const files=ids=>{
      const removed=new Set(ids);
      drop('files',f=>removed.has(f.id));
      drop('docLinks',r=>removed.has(r.id)||removed.has(r.other));
      drop('recommendations',r=>removed.has(r.source));
      for(const e of list(p,'exams'))e.attachments=list(e,'attachments').filter(a=>!removed.has(a.id));
      for(const d of list(p,'examDrafts'))d.sources=list(d,'sources').filter(a=>!removed.has(a.id));
      for(const f of list(p,'files'))if(removed.has(f.duplicateLab))delete f.duplicateLab;
      forget('files',ids);
    };
    const examDraft=ids=>{
      drop('examDrafts',r=>ids.includes(r.id));
      files(list(p,'files').filter(f=>ids.includes(f.examDraft)).map(f=>f.id));
    };
    if(group==='profile'){
      for(const key of Object.keys(groups)){
        if(key==='prompts')p[key]={};
        else if(Array.isArray(p[key]))p[key]=[];
      }
      p.periods=[];p.sampleAliases={};
      delete p.savedConflicts;
      return p;
    }
    if(!entries(p).some(r=>r.group===group&&r.id===id&&r.index===index&&r.other===other))return null;
    if(Object.hasOwn(nested,group)){
      const [parent,path]=nested[group],row=list(p,parent).find(r=>(parent==='addedVisits'?r[0]:r.id)===id);
      const values=Array.isArray(path)?row[path[0]][path[1]]:row[path];
      const med=values[index],visit=group==='visitMeds'?id:row.visit;
      if(group==='turns'){
        values.splice(index);delete row.nextQuestion;
      }else values.splice(index,1);
      if(group==='visitMeds'||group==='fileMeds'){
        if(med.id)drop('changes',r=>r.source===visit&&r.medId===med.id);
        if(med.id)drop('marketCriteria',r=>r.id===visit+'/'+med.id);
      }
      if((group==='labRows'||group==='labDraftRows')&&!values.length){
        if(group==='labRows')delete row.lab;else delete row.labDraft;
      }
    }else if(group==='prompts')delete p.prompts[id];
    else if(group==='files')files([id]);
    else if(group==='examDrafts')examDraft([id]);
    else if(group==='visitDrafts')drop(group,r=>r.id===id||r.parent===id);
    else if(group==='addedVisits'){
      drop(group,r=>r[0]===id);
      for(const key of ['notes','recommendations','reviews'])drop(key,r=>r.visit===id);
      drop('treatmentQueue',r=>r.id===id);
      drop('changes',r=>r.visit===id);
      drop('marketCriteria',r=>r.visit===id||r.id?.startsWith(id+'/'));
      if(p.prompts)delete p.prompts[id];
      for(const r of list(p,'changes'))if(r.source===id)r.source='';
      for(const key of ['files','exams'])for(const row of list(p,key))if(row.visit===id)row.visit='';
      for(const d of list(p,'examDrafts'))if(d.fields?.visit===id)d.fields.visit='';
    }else if(group==='episodes'){
      drop(group,r=>r.id===id);
      for(const v of list(p,'addedVisits'))if(v[7]===id){v[7]='';v[4]=''}
      for(const key of ['changes','measurements','visitDrafts'])for(const r of list(p,key))if(r.episode===id)r.episode='';
      for(const r of list(p,'visitDrafts'))if(r.fields?.episode===id)r.fields.episode='new';
      drop('questions',r=>r.episode===id);
    }else if(group==='addedDoctors'){
      drop(group,r=>r.id===id);
      for(const v of list(p,'addedVisits'))if(v[3]===id){v[3]=''}
      for(const r of list(p,'changes'))if(r.doctor===id)r.doctor='';
      for(const r of list(p,'visitDrafts'))if(r.fields?.doctor===id)r.fields.doctor='new';
    }else if(group==='exams'){
      drop(group,r=>r.id===id);
      examDraft(list(p,'examDrafts').filter(r=>r.exam===id).map(r=>r.id));
      for(const f of list(p,'files'))if(f.examId===id)delete f.examId;
    }else drop(group,r=>r.id===id&&(group!=='docLinks'||r.other===other));
    forget(group,[id]);
    return p;
  }
  return {entries,remove};
})();
