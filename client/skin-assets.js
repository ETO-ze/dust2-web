import { UTILITY_ASSETS } from '../shared/utility-assets.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DEFAULT_SKINS, getSkin } from '../shared/skins.js';
import { fetchCachedAsset } from './loading.js';

const models=new Map(),pending=new Map(),references=new Map();
export function registerDefaultSkin(weapon,source){models.set(DEFAULT_SKINS[weapon],source);}
export function loadedSkin(id){const model=models.get(id);if(model){models.delete(id);models.set(id,model);}return model;}
export function retainSkin(id){if(id)references.set(id,(references.get(id)||0)+1);}
export function releaseSkin(id){if(id)references.set(id,Math.max(0,(references.get(id)||0)-1));trimSkins();}
function trimSkins(){
  const idle=[...models.keys()].filter(id=>!references.get(id));
  while(idle.length>6){const id=idle.shift(),model=models.get(id);models.delete(id);references.delete(id);
    const geometries=new Set(),materials=new Set(),textures=new Set(),skeletons=new Set();
    model?.scene.traverse(o=>{if(o.geometry)geometries.add(o.geometry);if(o.skeleton)skeletons.add(o.skeleton);for(const m of [].concat(o.material||[])){materials.add(m);for(const t of Object.values(m))if(t?.isTexture)textures.add(t);}});
    skeletons.forEach(s=>s.dispose());geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>{t.dispose();t.source?.data?.close?.();});
  }
}
export async function loadSkin(id,{onProgress,signal}={}){
  if(models.has(id))return models.get(id);
  if(pending.has(id))return pending.get(id);
  const skin=getSkin(id)||UTILITY_ASSETS[id];if(!skin)throw new Error('未找到这款皮肤。');
  const task=(async()=>{
    const response=await fetchCachedAsset(new URL(skin.model,document.baseURI).href,{sha256:skin.sha256,bytes:skin.bytes,signal,onProgress});
    if(!response.ok)throw new Error(`皮肤下载失败 (${response.status})`);
    const buffer=await response.arrayBuffer();
    const model=await new GLTFLoader().parseAsync(buffer,new URL('.',new URL(skin.model,document.baseURI)).href);
    models.set(id,model);return model;
  })();
  pending.set(id,task);
  try{return await task;}finally{pending.delete(id);}
}

// Remote players fetch only the cosmetic on their currently equipped weapon.
// Failures keep the already loaded default and retry after a bounded delay.
const retries=new Map();
export function requestSkin(id){
  if(!(getSkin(id)||UTILITY_ASSETS[id])||models.has(id)||pending.has(id)||(retries.get(id)||0)>performance.now())return;
  retries.set(id,performance.now()+30000);loadSkin(id).catch(()=>{});
}
