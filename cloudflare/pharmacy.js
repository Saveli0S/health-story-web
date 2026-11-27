// Parse the public search table. Never infer equivalence or prices from a different region.
const regions=new Set(["1001","41","38","19","0"]);
export async function pharmacySearch(request) {
  const json=(body,status=200)=>Response.json(body,{status,headers:{"Cache-Control":"no-store"}});
  if(request.method!=="POST")return json({},405);
  if(Number(request.headers.get("content-length")||0)>1500)return json({},413);
  const input=await request.text();
  if(input.length>1000)return json({},413);
  let q;try{q=JSON.parse(input)}catch{return json({},400)}
  if(Object.keys(q||{}).some(k=>!['name','region'].includes(k)) || typeof q?.name!=="string" || !q.name.trim() || q.name.length>90 || !/^[\p{L}\p{N}\s.,+()%-]+$/u.test(q.name) || !regions.has(q.region))return json({},400);
  const site=new URL("https://tabletka.by/search/");site.searchParams.set("request",q.name.trim());
  if(q.region!=="0")site.searchParams.set("region",q.region);
  let stage="connection";
  try{
    const upstream=await fetch(site,{redirect:"manual",signal:AbortSignal.timeout(10000)});
    if([301,302,303,307,308].includes(upstream.status)){
      const redirect=new URL(upstream.headers.get("Location")||"",site);
      if(redirect.origin===site.origin&&redirect.pathname==="/search/not-found/"&&redirect.searchParams.get("request")===q.name.trim()){
        return json({packages:[],region:q.region,checked:new Date().toISOString(),search:site.href});
      }
    }
    if(!upstream.ok)return json({status:"catalog-unavailable",upstream:upstream.status},502);
    stage="catalog-format";
    let region="",current,table=false,tableRows=0;
    const results=[];
    const parser=new HTMLRewriter()
      .on("input.region-select-input",{element(e){region=e.getAttribute("regid")||""}})
      .on("table#base-select tbody.tbody-base-tbl",{element(){table=true}})
      .on("tbody.tbody-base-tbl tr",{element(){tableRows++}})
      .on("tbody.tbody-base-tbl tr.tr-border",{element(){current={name:"",substance:"",form:"",manufacturer:"",price:"",stock:"",id:""};results.push(current)}});
    const base="tbody.tbody-base-tbl tr.tr-border ";
    for(const [selector,field] of [["td.name .tooltip-info-header a","name"],["td.name .capture a","substance"],["td.form .tooltip-info-header a","form"],["td.produce .tooltip-info-header a","manufacturer"],["td.price .price-value","price"],["td.price .capture a","stock"]]){
      parser.on(base+selector,{
        element(el){if(current && field==="name")current.id=(el.getAttribute("href")||"").match(/^\/result\/\?ls=(\d+)(?:&|$)/)?.[1]||""},
        text(t){if(current)current[field]+=t.text}
      });
    }
    await parser.transform(upstream).arrayBuffer();
    if(region!==q.region)return json({status:"region-unconfirmed"},502);
    if(!table||tableRows!==results.length)return json({status:"catalog-format"},502);
    const packages=[];
    for(const row of results){
      const prices=row.price.trim().match(/^(\d+(?:[.,]\d{1,2})?)(?:\s*(?:\.{2,3}|…|–|-)\s*(\d+(?:[.,]\d{1,2})?))?\s*(?:р\.|руб\.|BYN)$/u);
      const pharmacyCount=Number(row.stock.trim().match(/^в\s+(\d+)\s+аптек/iu)?.[1]);
      if(!pharmacyCount || !prices || !row.id || !row.form.trim() || !row.name.trim())continue;
      const lo=Number(prices[1].replace(",",".")),hi=Number((prices[2]||prices[1]).replace(",","."));
      if(!(lo>0 && hi>=lo))continue;
      const result=Object.fromEntries(["id","name","substance","form","manufacturer"].map(k=>[k,row[k].replace(/\s+/g," ").trim()]));
      packages.push({...result,min:lo,max:hi,pharmacyCount});
    }
    if(results.length&&!packages.length)return json({status:"offers-unconfirmed"},502);
    return json({packages,region,partial:packages.length<results.length,checked:new Date().toISOString(),search:site.href});
  }catch{return json({status:stage},502)}
}
