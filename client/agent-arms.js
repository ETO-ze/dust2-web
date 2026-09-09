import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {AGENT_ARM_ASSETS} from '../shared/agent-arm-assets.js';
import {fetchCachedAsset} from './loading.js';

const models=new Map(),pending=new Map(),references=new Map(),retry=new Map();
export function loadedAgentArms(id){const model=models.get(id);if(model){models.delete(id);models.set(id,model);}return model;}
export function retainAgentArms(id){references.set(id,(references.get(id)||0)+1);}
export function releaseAgentArms(id){references.set(id,Math.max(0,(references.get(id)||0)-1));trim();}
function trim(){
 const idle=[...models.keys()].filter(id=>!references.get(id));
 while(idle.length>2){
  const id=idle.shift(),source=models.get(id);models.delete(id);references.delete(id);
  const geometries=new Set(),materials=new Set(),textures=new Set(),skeletons=new Set();
  source.scene.traverse(o=>{if(o.geometry)geometries.add(o.geometry);if(o.skeleton)skeletons.add(o.skeleton);for(const material of [].concat(o.material||[])){materials.add(material);for(const texture of Object.values(material))if(texture?.isTexture)textures.add(texture);}});
  skeletons.forEach(s=>s.dispose());geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>{t.dispose();t.source?.data?.close?.();});
 }
}
export async function loadAgentArms(id,{onProgress,signal}={}){
 if(models.has(id))return loadedAgentArms(id);if(pending.has(id))return pending.get(id);
 const asset=AGENT_ARM_ASSETS[id];if(!asset)throw Error('未找到探员第一人称模型');
 const task=(async()=>{const url=new URL(asset.model,document.baseURI);const response=await fetchCachedAsset(url.href,{bytes:asset.bytes,sha256:asset.sha256,onProgress,signal});if(!response.ok)throw Error('探员手臂下载失败');const source=await new GLTFLoader().parseAsync(await response.arrayBuffer(),new URL('.',url).href);models.set(id,source);trim();return source;})();
 pending.set(id,task);try{return await task;}finally{pending.delete(id);}
}
export function requestAgentArms(id){if(!AGENT_ARM_ASSETS[id]||models.has(id)||pending.has(id)||(retry.get(id)||0)>performance.now())return;retry.set(id,performance.now()+30000);loadAgentArms(id).catch(()=>{});}
export function agentArmsCacheStatus(){return {loaded:models.size,pending:pending.size,references:Object.fromEntries(references)};}
