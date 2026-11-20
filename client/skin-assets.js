import { UTILITY_ASSETS } from '../shared/utility-assets.js';
import {gameGLTFLoader} from './gltf-loader.js';
import { DEFAULT_SKINS, getSkin } from '../shared/skins.js';
import { fetchCachedAsset,isAssetSaved } from './loading.js';
import { takePreloadedSkin } from './room-skin-preload.js';

const models=new Map(),pending=new Map(),references=new Map(),pinned=new Set();
const animations=new Map(),roomHands=new Set();
async function skinAnimations(asset,signal){
  let task=animations.get(asset.sha256);
  if(!task){
    task=(async()=>{
      const response=takePreloadedSkin(asset)||await fetchCachedAsset(new URL(asset.model,document.baseURI),{sha256:asset.sha256,bytes:asset.bytes,signal});
      if(!response.ok)throw new Error(`武器动作下载失败 (${response.status})`);
      return (await gameGLTFLoader(undefined,{signal}).parseAsync(await response.arrayBuffer(),'')).animations;
    })();
    animations.set(asset.sha256,task);
    if(animations.size>6)animations.delete(animations.keys().next().value);
  }
  try{return await task;}catch(error){if(animations.get(asset.sha256)===task)animations.delete(asset.sha256);throw error;}
}
export function registerDefaultSkin(weapon,source){models.set(DEFAULT_SKINS[weapon],source);pinned.add(DEFAULT_SKINS[weapon]);}
export function loadedSkin(id){id=getSkin(id)?.id??id;const model=models.get(id);if(model){models.delete(id);models.set(id,model);}return model;}
export function retainSkin(id){id=getSkin(id)?.id??id;if(id)references.set(id,(references.get(id)||0)+1);}
export function releaseSkin(id){id=getSkin(id)?.id??id;if(id)references.set(id,Math.max(0,(references.get(id)||0)-1));trimSkins();}
function trimSkins(protect){
  const idle=[...models.keys()].filter(id=>id!==protect&&!pinned.has(id)&&!references.get(id));
  while(idle.length>6){const id=idle.shift(),model=models.get(id);models.delete(id);references.delete(id);
    const geometries=new Set(),materials=new Set(),textures=new Set(),skeletons=new Set();
    model?.scene.traverse(o=>{if(o.geometry)geometries.add(o.geometry);if(o.skeleton)skeletons.add(o.skeleton);for(const m of [].concat(o.material||[])){materials.add(m);for(const t of Object.values(m))if(t?.isTexture)textures.add(t);}});
    skeletons.forEach(s=>s.dispose());geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>{t.dispose();t.source?.data?.close?.();});
  }
}
export async function loadSkin(id,{onProgress,signal}={}){id=getSkin(id)?.id??id;
  if(models.has(id))return models.get(id);
  if(pending.has(id))return pending.get(id);
  const skin=getSkin(id)||UTILITY_ASSETS[id];if(!skin)throw new Error('未找到这款皮肤。');
  const task=(async()=>{
    const response=takePreloadedSkin(skin)||await fetchCachedAsset(new URL(skin.model,document.baseURI).href,{sha256:skin.sha256,bytes:skin.bytes,signal,onProgress});
    if(!response.ok)throw new Error(`皮肤下载失败 (${response.status})`);
    const buffer=await response.arrayBuffer();
    signal?.throwIfAborted();
    const clips=skin.animation?await skinAnimations(skin.animation,signal):null;
    const model=await gameGLTFLoader(undefined,{signal}).parseAsync(buffer,new URL('.',new URL(skin.model,document.baseURI)).href);
    if(clips)model.animations=clips;
    models.set(id,model);trimSkins(id);return model;
  })();
  pending.set(id,task);
  try{return await task;}catch(error){signal?.throwIfAborted();throw error;}finally{pending.delete(id);}
}

// Keep the visible sources alive until the first rendered snapshot has created
// its own actor/viewmodel references. Room changes and failures also release them.
export async function warmRoomSkin(id,signal,renderer){
  const source=await loadSkin(id,{signal});
  signal.throwIfAborted();
  if(roomHands.has(id))return;
  retainSkin(id);roomHands.add(id);
  const textures=new Set();
  source.scene.traverse(node=>{
    for(const material of [].concat(node.material||[])){
      for(const value of Object.values(material))if(value?.isTexture)textures.add(value);
    }
  });
  for(const texture of textures)renderer.initTexture(texture);
}
export function releaseRoomHands(){
  for(const id of roomHands)releaseSkin(id);
  roomHands.clear();
}
export async function skinSaved(skin){return await isAssetSaved(skin.sha256,skin.bytes)&&(!skin.animation||await isAssetSaved(skin.animation.sha256,skin.animation.bytes));}
export async function downloadSkin(skin,options={}){
  for(const item of [skin,...(skin.animation?[skin.animation]:[])])await fetchCachedAsset(new URL(item.model,document.baseURI),{...options,sha256:item.sha256,bytes:item.bytes});
  return skinSaved(skin);
}

// Remote players fetch only the cosmetic on their currently equipped weapon.
// Failures keep the already loaded default and retry after a bounded delay.
const retries=new Map();
let backgroundLoad=false;
export function requestSkin(id){id=getSkin(id)?.id??id;
  if(backgroundLoad||!(getSkin(id)||UTILITY_ASSETS[id])||models.has(id)||pending.has(id)||(retries.get(id)||0)>performance.now())return;
  backgroundLoad=true;
  loadSkin(id).catch(()=>retries.set(id,performance.now()+30000)).finally(()=>{backgroundLoad=false;});
}
