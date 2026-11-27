// Exercise the production Worker parser and its real HTMLRewriter without contacting tabletka.by.
const {Miniflare,convertV4MiniflareOptions}=require('miniflare');
const {readFileSync}=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 let html='',status=200,headers={},received;
 const config={modules:true,compatibilityDate:'2025-09-03',
   script:readFileSync(path.join(__dirname,'../cloudflare/pharmacy.js'),'utf8')+'\nexport default {fetch:pharmacySearch}',
   outboundService:async request=>{received=new URL(request.url);return new Response(html,{status,headers})}};
 const mf=new Miniflare(convertV4MiniflareOptions?convertV4MiniflareOptions(config):config);
 const query=async(params={})=>mf.dispatchFetch('http://family.local/pharmacy/search',{method:'POST',body:JSON.stringify({name:'Тестин',region:'1001',...params})});
 const base='<input class="region-select-input" regid="1001"><table id="base-select"><tbody class="tbody-base-tbl">';
 const row='<tr class="tr-border"><td class="name"><div class="tooltip-info-header"><a href="/result/?ls=111&region=1001">Тестин</a></div><span class="capture"><a>Тестат</a></span></td>'+
   '<td class="form"><div class="tooltip-info-header"><a>таблетки 5мг N20</a></div></td><td class="produce"><div class="tooltip-info-header"><a>Тестовая компания</a></div></td>'+
   '<td class="price"><span class="price-value">3,25 ... 4,75 р.</span><span class="capture"><a>в 2 аптеках</a></span></td></tr>';
 try{
  html=base+row+'</tbody></table>';
  const result=await(await query()).json();assert.equal(result.packages.length,1);assert.equal(result.packages[0].min,3.25);
  assert.equal(result.packages[0].pharmacyCount,2);assert.equal(received.searchParams.size,2);assert.equal(received.searchParams.get('region'),'1001');
  assert.equal((await query({diagnosis:'x'})).status,400);
  html=base.replace('1001','19')+row+'</tbody></table>';assert.equal((await query()).status,502);
  html=base+row.replace('в 2 аптеках','')+'</tbody></table>';assert.equal((await query()).status,502);
  html='<input class="region-select-input" regid="1001">другая страница';assert.equal((await query()).status,502);
  status=301;html='';headers={Location:'not-found/?request='+encodeURIComponent('Тестин')};assert.deepEqual((await(await query()).json()).packages,[]);
  headers={Location:'https://other.example/not-found/'};assert.equal((await query()).status,502);
  if(process.argv[2]){
    status=200;headers={};html=readFileSync(process.argv[2],'utf8');
    const replay=await query({name:process.argv[3]||'Мометазон'});
    assert.equal(replay.status,200);const data=await replay.json();assert(data.packages.every(p=>p.pharmacyCount>0));
    console.log('Verified captured catalog response:',JSON.stringify({region:data.region,packages:data.packages.length,first:data.packages[0]}));
  }
  console.log('PASS local Worker, strict region, stock and price parsing, no-result redirect, unconfirmed format, permitted query fields');
 }finally{await mf.dispose()}
})().catch(e=>{console.error(e);process.exitCode=1});
