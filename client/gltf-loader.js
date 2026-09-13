import {Texture} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {mobileDevice} from './device-profile.js';

// Share one decode budget across the map, arms, agents and optional weapons.
const pending=[];let active=0;
function schedule(work){return new Promise((resolve,reject)=>{pending.push({work,resolve,reject});pump();});}
function pump(){while(active<4&&pending.length){const job=pending.shift();active++;job.work().then(job.resolve,job.reject).finally(()=>{active--;pump();});}}

export function gameGLTFLoader(manager){
  const loader=new GLTFLoader(manager);
  if(typeof createImageBitmap!=='function')return loader;
  loader.register(parser=>{
    let failure=null;
    parser.textureLoader={
      load(url,onLoad,_progress,onError){
        const manager=parser.options.manager;
        manager.itemStart(url);
        schedule(async()=>{
          if(failure)throw failure;
          const abort=new AbortController();let expired=false,bitmap=null;
          const timeout=setTimeout(()=>{expired=true;abort.abort();},45000);
          const aborted=new Promise((_,reject)=>abort.signal.addEventListener('abort',()=>reject(new Error('贴图准备超时，请重试')),{once:true}));
          aborted.catch(()=>{});
          const decode=(source,options)=>Promise.race([createImageBitmap(source,options).then(image=>{if(expired){image.close();throw new Error('贴图解码超时，请重试');}return image;}),aborted]);
          try{
            const response=await fetch(manager.resolveURL(url),{signal:abort.signal});
            if(!response.ok)throw new Error('贴图读取失败：'+response.status);
            const options={premultiplyAlpha:'none',colorSpaceConversion:'none'};
            // A decoder that never settles must not leave "510/514" forever.
            bitmap=await decode(await response.blob(),options);
            if(mobileDevice()&&Math.max(bitmap.width,bitmap.height)>1024){
              const scale=1024/Math.max(bitmap.width,bitmap.height);
              const resized=await decode(bitmap,{...options,resizeWidth:Math.max(1,Math.round(bitmap.width*scale)),resizeHeight:Math.max(1,Math.round(bitmap.height*scale)),resizeQuality:'high'});
              bitmap.close();bitmap=resized;
            }
            const texture=new Texture(bitmap);texture.needsUpdate=true;return texture;
          }catch(error){bitmap?.close();failure=error;throw error;}finally{clearTimeout(timeout);}
        }).then(onLoad,error=>{manager.itemError(url);onError?.(error);}).finally(()=>manager.itemEnd(url));
      }
    };
    return {name:'DUSTII_DECODE_BUDGET',afterRoot(result){if(!failure)return;const textures=new Set(),materials=new Set(),geometries=new Set();result.scene.traverse(o=>{if(o.geometry)geometries.add(o.geometry);for(const m of [].concat(o.material||[])){materials.add(m);for(const t of Object.values(m))if(t?.isTexture)textures.add(t);}});textures.forEach(t=>{t.dispose();t.image?.close?.();});materials.forEach(m=>m.dispose());geometries.forEach(g=>g.dispose());throw failure;}};
  });
  return loader;
}
