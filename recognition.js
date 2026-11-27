'use strict';

// Both engines and language data are served with the app. Recognition accepts local Blobs.
const recognitionRoot=new URL('assets/recognition/',document.baseURI);
let engineScript;
function loadTextEngine(){
  if(!engineScript){
    engineScript=new Promise((resolve,reject)=>{
      const script=document.createElement('script');
      script.src=new URL('tesseract.min.js',recognitionRoot);
      script.onload=resolve;
      script.onerror=()=>{script.remove();engineScript=null;reject(Error('Не удалось загрузить распознаватель.'))};
      document.head.append(script);
    });
  }
  return engineScript;
}
async function openLocalPdf(blob){
  const pdfjs=await import(new URL('pdf.min.mjs',recognitionRoot).href);
  pdfjs.GlobalWorkerOptions.workerSrc=new URL('pdf.worker.min.mjs',recognitionRoot).href;
  return pdfjs.getDocument({data:new Uint8Array(await blob.arrayBuffer()),isEvalSupported:false,useSystemFonts:true}).promise;
}
async function drawPaper(page,longSide){
  const initial=page.getViewport({scale:1});
  const viewport=page.getViewport({scale:longSide/Math.max(initial.width,initial.height)});
  const canvas=document.createElement('canvas');
  canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
  await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;
  return canvas;
}
function isTextFile(file){return file.type==='text/plain'||/\.txt$/i.test(file.name||'')}
const photoAccept='image/*,.heic,.heif';
function isHeif(file){return /^image\/hei[cf](?:-sequence)?$/i.test(file.type||'')||/\.hei[cf]$/i.test(file.name||'')}
function isPhoto(file){return /^image\//.test(file.type)||/\.(?:png|jpe?g|webp)$/i.test(file.name||'')||isHeif(file)}
function isPdf(file){return file.type==='application/pdf'||/\.pdf$/i.test(file.name||'')}
async function loadBrowserPhoto(blob){
  const url=URL.createObjectURL(blob),image=new Image();
  try{
    image.src=url;await image.decode();return image;
  }finally{URL.revokeObjectURL(url)}
}
let heifDecodeQueue=Promise.resolve();
function loadHeifPhoto(blob,longSide){
  // A full-resolution decode can use substantial memory. Run one at a time off the UI thread.
  const job=heifDecodeQueue.then(()=>new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('heif-worker.js',recognitionRoot),{type:'module'});
    const failed=()=>finish(null);
    const timeout=setTimeout(failed,30000);
    function finish(bitmap){
      clearTimeout(timeout);worker.terminate();
      if(bitmap)resolve(bitmap);
      else reject(Error('Не удалось преобразовать HEIC или HEIF.'));
    }
    worker.onmessage=event=>finish(event.data);
    worker.onerror=failed;
    worker.onmessageerror=failed;
    worker.postMessage({blob,longSide});
  }));
  heifDecodeQueue=job.then(()=>{},()=>{});
  return job;
}
function drawPhoto(image,width,height,longSide){
  const ratio=Math.min(1,longSide/Math.max(width,height));
  const canvas=document.createElement('canvas');
  canvas.width=Math.max(1,Math.round(width*ratio));
  canvas.height=Math.max(1,Math.round(height*ratio));
  const context=canvas.getContext('2d');
  context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);
  context.drawImage(image,0,0,canvas.width,canvas.height);
  return canvas;
}
async function openPhoto(blob,metadata=blob,longSide=2600){
  try{return await loadBrowserPhoto(blob)}
  catch(error){
    if(!isHeif(metadata)&&!isHeif(blob))throw error;
    const bitmap=await loadHeifPhoto(blob,longSide);
    try{return drawPhoto(bitmap,bitmap.width,bitmap.height,longSide)}
    finally{bitmap.close()}
  }
}
async function photoCanvas(blob,longSide=2600,metadata=blob){
  const photo=await openPhoto(blob,metadata,longSide);
  return photo instanceof HTMLCanvasElement?photo:drawPhoto(photo,photo.naturalWidth,photo.naturalHeight,longSide);
}
// Tesseract TSV gives word confidence for raster pages. Keep questionable lines local for review.
function uncertainLines(tsv,page){
  const lines=new Map();
  for(const row of (tsv||'').split('\n')){
    const [level,,block,paragraph,line,,,,,,confidence,...parts]=row.split('\t');
    const word=parts.join(' ').trim();if(level!=='5'||!word)continue;
    const key=[block,paragraph,line].join('/'),entry=lines.get(key)||{words:[],unclear:false};
    entry.words.push({text:word,confidence:Number(confidence)});
    if(Number(confidence)>=0&&Number(confidence)<65&&/[\p{L}\d]/u.test(word))entry.unclear=true;
    lines.set(key,entry);
  }
  return [...lines.values()].filter(l=>l.unclear).map(l=>({page,text:l.words.map(w=>w.text).join(' '),words:l.words.filter(w=>w.confidence>=0&&w.confidence<65)}));
}
function pdfTableText(items,viewport){
  // A PDF can store one whole column before the next one. Match cells by baseline.
  const cells=items.filter(item=>typeof item.str==='string'&&item.str.trim()).map(item=>{
    const [x,y]=viewport.convertToViewportPoint(item.transform[4],item.transform[5]);
    return {x,y,text:item.str.trim(),height:item.height};
  }).sort((a,b)=>a.y-b.y||a.x-b.x);
  const rows=[];
  for(const cell of cells){
    const row=rows.at(-1);
    if(row&&cell.y-row.y<=Math.max(1,Math.min(row.height,cell.height)*.3))row.cells.push(cell);
    else rows.push({y:cell.y,height:cell.height,cells:[cell]});
  }
  return rows.map(row=>row.cells.sort((a,b)=>a.x-b.x).map(cell=>cell.text).join(' ')).join('\n');
}
function pdfDocumentText(items){
  const lines=[];
  let line='',lastY=null;
  for(const item of items){
    if(typeof item.str!=='string')continue;
    const y=item.transform[5];
    if(line&&lastY!==null&&Math.abs(y-lastY)>Math.max(3,item.height*.5)){lines.push(line.trim());line=''}
    line+=item.str+' ';lastY=y;
    if(item.hasEOL){lines.push(line.trim());line=''}
  }
  if(line.trim())lines.push(line.trim());
  return lines.filter(Boolean).join('\n');
}
async function recognizeDocument(blob,pdf,progress,issues=[],{pdfRows=false}={}){
  if(isTextFile(blob))return (await blob.text()).trim();
  let worker,documentPdf,stage='',pageNumber=1;
  async function readImage(image){
    if(!worker){
      await loadTextEngine();
      worker=await Tesseract.createWorker('rus+eng',1,{
        workerPath:new URL('worker.min.js',recognitionRoot).href,workerBlobURL:false,
        corePath:new URL('tesseract-core-lstm.wasm.js',recognitionRoot).href,
        langPath:recognitionRoot.href,
        logger:msg=>{if(msg.status==='recognizing text')progress(stage+'Распознавание '+Math.round(msg.progress*100)+' %')},
        errorHandler:()=>{}
      });
    }
    const {data}=await worker.recognize(image,{},{text:true,tsv:true});
    issues.push(...uncertainLines(data.tsv,pageNumber));
    return data.text.trim();
  }
  try{
    progress('Чтение документа…');
    if(!pdf){
      const canvas=await photoCanvas(blob);
      try{return await readImage(canvas)}finally{canvas.width=canvas.height=1}
    }
    documentPdf=await openLocalPdf(blob);
    const pages=[];
    for(let n=1;n<=documentPdf.numPages;n++){
      pageNumber=n;stage='Страница '+n+' из '+documentPdf.numPages+' · ';progress(stage+'Чтение текста…');
      const page=await documentPdf.getPage(n), content=await page.getTextContent();
      let result=pdfRows?pdfTableText(content.items,page.getViewport({scale:1})):pdfDocumentText(content.items);
      const hasText=(result.match(/[\p{L}\p{N}]/gu)||[]).length>=10;
      // Some scans have a small selectable header/footer over a full-page raster.
      let scan=!hasText;
      if(hasText && result.length<350){
        const {OPS}=await import(new URL('pdf.min.mjs',recognitionRoot).href);
        const ops=await page.getOperatorList();
        scan=ops.fnArray.some((op,i)=>[OPS.paintImageXObject,OPS.paintInlineImageXObject].includes(op)&&
          ((ops.argsArray[i][1]||ops.argsArray[i][0]?.width||0)>600));
      }
      if(scan){
        const canvas=await drawPaper(page,2100);
        try{const imageText=await readImage(canvas);if(imageText)result=imageText}finally{canvas.width=canvas.height=1}
      }
      pages.push(result);page.cleanup();
    }
    return pages.join('\n\n');
  }finally{if(worker)await worker.terminate();if(documentPdf)await documentPdf.destroy()}
}
