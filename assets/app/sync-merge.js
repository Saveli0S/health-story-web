'use strict';

// Paths use stable record IDs for collections. Conflicting leaf values remain
// explicit until a writer chooses one; a deletion is a first-class alternative.
const syncMerge=(()=>{
  const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  const record=v=>v&&typeof v==='object'&&!Array.isArray(v);
  const keyOf=(v,k)=>k==='addedVisits'&&Array.isArray(v)?v[0]:v?.id;
  const safe=k=>!['__proto__','prototype','constructor'].includes(k);
  const variant=(value,author,time)=>({...(value===undefined?{removed:true}:{value}),author,time});
  function merge(base,local,remote,authors){
    const conflicts=[];
    function walk(b,l,r,path,field){
      if(same(l,r)||same(b,r))return l;
      if(same(b,l))return r;
      if(record(l)&&record(r)&&(b===undefined||record(b))){
        const out={};
        for(const k of new Set([...Object.keys(b||{}),...Object.keys(l),...Object.keys(r)])){
          if(!safe(k))throw Error('invalid field');
          const value=walk(b?.[k],l[k],r[k],[...path,k],k);
          if(value!==undefined)out[k]=value;
        }
        return out;
      }
      if(Array.isArray(l)&&Array.isArray(r)&&(b===undefined||Array.isArray(b))){
        b=b||[];
        if([...l,...r,...b].every(v=>typeof keyOf(v,field)==='string')){
          const map=a=>new Map(a.map(v=>[keyOf(v,field),v]));
          const [bm,lm,rm]=[b,l,r].map(map),out=[];
          for(const id of new Set([...rm.keys(),...lm.keys(),...bm.keys()])){
            const value=walk(bm.get(id),lm.get(id),rm.get(id),[...path,{id,field}],field==='addedVisits'?'visitRow':'');
            if(value!==undefined)out.push(value);
          }
          return out;
        }
        if(field==='visitRow'&&l.length===b.length&&r.length===b.length)
          return l.map((v,i)=>walk(b[i],v,r[i],[...path,i],String(i)));
      }
      function mark(side){
        for(let i=path.length;i>=0;i--){
          const m=side.stamps?.[JSON.stringify(path.slice(0,i))];if(m)return m;
        }
        return side;
      }
      const left=mark(authors.local),right=mark(authors.remote);
      conflicts.push({path,local:variant(l,left.author,left.time),remote:variant(r,right.author,right.time)});
      return r;
    }
    const value=walk(base,local,remote,[],'');
    return {value,conflicts};
  }
  function choose(root,path,choice){
    if(!path.length)return choice.removed?undefined:structuredClone(choice.value);
    let target=root;
    for(const [i,part] of path.entries()){
      let key=part;
      if(record(part)){
        if(!Array.isArray(target))throw Error('Запись изменилась.');
        key=target.findIndex(v=>keyOf(v,part.field)===part.id);
        if(key<0){
          if(i!==path.length-1)throw Error('Запись изменилась.');
          if(!choice.removed)target.push(structuredClone(choice.value));return root;
        }
      }else if(!safe(part))throw Error('invalid field');
      if(i===path.length-1){
        if(choice.removed){if(Array.isArray(target))target.splice(key,1);else delete target[key]}
        else target[key]=structuredClone(choice.value);
      }else target=target[key];
    }
    return root;
  }
  function read(root,path){
    let current=root;
    for(const part of path){
      if(current==null)return undefined;
      current=record(part)?current.find(v=>keyOf(v,part.field)===part.id):current[part];
    }
    return current;
  }
  function changes(base,next,path=[],field=''){
    if(same(base,next))return [];
    if(record(base)&&record(next))return [...new Set([...Object.keys(base),...Object.keys(next)])].flatMap(k=>changes(base[k],next[k],[...path,k],k));
    if(Array.isArray(base)&&Array.isArray(next)){
      if([...base,...next].every(v=>typeof keyOf(v,field)==='string')){
        const a=new Map(base.map(v=>[keyOf(v,field),v])),b=new Map(next.map(v=>[keyOf(v,field),v]));
        return [...new Set([...a.keys(),...b.keys()])].flatMap(id=>changes(a.get(id),b.get(id),[...path,{id,field}],field==='addedVisits'?'visitRow':''));
      }
      if(field==='visitRow'&&next.length===base.length)return next.flatMap((v,i)=>changes(base[i],v,[...path,i],String(i)));
    }
    return [JSON.stringify(path)];
  }
  return {merge,choose,read,same,changes};
})();
