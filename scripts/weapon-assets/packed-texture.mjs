/** Packed shader maps use A as data, not transparency. Resize RGB and A
 * separately so the image library cannot premultiply valid RGB by a zero mask.
 */
export async function resizePackedRgba(sharp,input,size){
 const metadata=await sharp(input).metadata();
 // Sharp schedules resize before channel removal even when removeAlpha() is
 // chained first. Materialize raw channels before starting the resize pipeline.
 const sourceRgb=await sharp(input).removeAlpha().toColourspace('srgb').raw().toBuffer();
 const rgb=await sharp(sourceRgb,{raw:{width:metadata.width,height:metadata.height,channels:3}}).resize(size,size,{fit:'fill'}).raw().toBuffer();
 let alpha=null;
 if(metadata.hasAlpha){
  const sourceAlpha=await sharp(input).extractChannel('alpha').raw().toBuffer();
  alpha=await sharp(sourceAlpha,{raw:{width:metadata.width,height:metadata.height,channels:1}}).resize(size,size,{fit:'fill'}).toColourspace('b-w').raw().toBuffer();
 }
 const output=Buffer.alloc(size*size*4);
 for(let p=0;p<size*size;p++){output[p*4]=rgb[p*3];output[p*4+1]=rgb[p*3+1];output[p*4+2]=rgb[p*3+2];output[p*4+3]=alpha?alpha[p]:255;}
 return output;
}
