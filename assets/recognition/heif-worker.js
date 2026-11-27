import initHeif from './libheif-1.23.5.mjs';

self.onmessage=async event=>{
  try{
    const {blob,longSide}=event.data;
    const {HeifDecoder}=await initHeif();
    const images=new HeifDecoder().decode(new Uint8Array(await blob.arrayBuffer()));
    const primary=images.find(image=>image.is_primary())||images[0];
    if(!primary)throw Error();
    const width=primary.get_width(),height=primary.get_height();
    // Allow full-resolution 48 MP camera photos while bounding the RGBA allocation.
    if(width<1||height<1||width*height>50_000_000)throw Error();
    const rgba=new ImageData(width,height);
    await new Promise((resolve,reject)=>primary.display(rgba,pixels=>pixels?resolve():reject(Error())));
    const scale=Math.min(1,longSide/Math.max(width,height));
    const bitmap=await createImageBitmap(rgba,{
      resizeWidth:Math.max(1,Math.round(width*scale)),
      resizeHeight:Math.max(1,Math.round(height*scale)),
      resizeQuality:'high'
    });
    self.postMessage(bitmap,[bitmap]);
  }catch{
    self.postMessage(null);
  }
};
