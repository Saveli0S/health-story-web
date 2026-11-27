const {chromium}=require('playwright-core'),fs=require('fs');
(async()=>{
 const br=await chromium.launch({channel:'chrome'});
 try {
 const page=await br.newPage();
 await page.goto(process.env.HEALTH_PREVIEW_URL||'http://127.0.0.1:8764/');
 const b64=fs.readFileSync(require('node:path').join(__dirname,'V03-handwriting.png')).toString('base64');
 const out=await page.evaluate(async b64=>{
  await loadTextEngine();
  const src=await photoCanvas(new Blob([Uint8Array.from(atob(b64),c=>c.charCodeAt(0))],{type:'image/png'}));
  const ink=document.createElement('canvas');ink.width=src.width;ink.height=src.height;
  const ctx=ink.getContext('2d',{willReadFrequently:true});ctx.drawImage(src,0,0);
  const im=ctx.getImageData(0,0,ink.width,ink.height);
  for(let i=0;i<im.data.length;i+=4){const [r,g,b]=[im.data[i],im.data[i+1],im.data[i+2]];
    const tone=(b-r>20&&b-g>12)||(.3*r+.59*g+.11*b<85)?0:255;
    im.data[i]=im.data[i+1]=im.data[i+2]=tone;
  }
  ctx.putImageData(im,0,0);
  const worker=await Tesseract.createWorker('rus+eng',1,{workerPath:new URL('worker.min.js',recognitionRoot).href,workerBlobURL:false,corePath:new URL('tesseract-core-lstm.wasm.js',recognitionRoot).href,langPath:recognitionRoot.href});
  const result=[];
  for(const [label,canvas,mode] of [['default',src,null],['block',src,'6'],['sparse',src,'11'],['blue-ink-block',ink,'6'],['blue-ink-sparse',ink,'11']]){
    if(mode)await worker.setParameters({tessedit_pageseg_mode:mode});
    const {data}=await worker.recognize(canvas,{},{text:true,tsv:true});
    const issues=uncertainLines(data.tsv,1);
    result.push({label,confidence:data.confidence,raw:data.text,header:parseVisitHeader(data.text),meds:proposedMedicines(data.text,issues),recommendation:recommendationText(data.text)});
  }
  await worker.terminate();return result;
 },b64);
 console.log(JSON.stringify(out,null,2));
 }finally{await br.close()}
})();
