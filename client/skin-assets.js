import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DEFAULT_SKINS, getSkin } from '../shared/skins.js';
import { fetchCachedAsset } from './loading.js';

const models=new Map(),pending=new Map();
export function registerDefaultSkin(weapon,source){models.set(DEFAULT_SKINS[weapon],source);}
export function loadedSkin(id){return models.get(id);}
export async function loadSkin(id,{onProgress,signal}={}){
  if(models.has(id))return models.get(id);
  if(pending.has(id))return pending.get(id);
  const skin=getSkin(id);if(!skin)throw new Error('未找到这款皮肤。');
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
  if(!getSkin(id)||models.has(id)||pending.has(id)||(retries.get(id)||0)>performance.now())return;
  retries.set(id,performance.now()+30000);loadSkin(id).catch(()=>{});
}
