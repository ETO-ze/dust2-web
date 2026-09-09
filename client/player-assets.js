import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {AGENT_ASSETS} from '../shared/agent-assets.js';
import {fetchCachedAsset} from './loading.js';

export const DEFAULT_AGENTS=Object.freeze({
 CT:Object.freeze({name:'SAS',label:'默认反恐精英 · SAS',path:'assets/characters-cs2/ct-sas.glb'}),
 T:Object.freeze({name:'Phoenix',label:'默认恐怖分子 · 凤凰战士',path:'assets/characters-cs2/t-phoenix.glb'}),
});

const agents=new Map(),pending=new Map(),retry=new Map();let animationSource=null;
function prepare(source){
 if(!animationSource)return source;
 const names=new Set();source.scene.traverse(node=>names.add(node.name));
 source.animations=animationSource.animations.map(original=>{const clip=original.clone();clip.tracks=clip.tracks.filter(track=>names.has(THREE.PropertyBinding.parseTrackName(track.name).nodeName));clip.duration=Math.max(.1,clip.duration);return clip;});
 source.scene.userData.cs2DefaultAgent=true;return source;
}
export function loadedPlayerAsset(id){return agents.get(id);}
export async function loadAgent(id,{onProgress}={}){
 if(agents.has(id))return agents.get(id);if(pending.has(id))return pending.get(id);
 const asset=AGENT_ASSETS[id];if(!asset)throw Error('探员资源尚不可用');
 const task=(async()=>{const response=await fetchCachedAsset(new URL(asset.model,document.baseURI).href,{sha256:asset.sha256,bytes:asset.bytes,onProgress});if(!response.ok)throw Error('探员下载失败');const source=await new GLTFLoader().parseAsync(await response.arrayBuffer(),new URL('.',new URL(asset.model,document.baseURI)).href);prepare(source);agents.set(id,source);return source;})();pending.set(id,task);try{return await task;}finally{pending.delete(id);}
}
export function requestAgent(id){if(!id||agents.has(id)||pending.has(id)||(retry.get(id)||0)>performance.now())return;retry.set(id,performance.now()+30000);loadAgent(id).catch(()=>{});}
export async function loadPlayerAssets(loader){
 animationSource=await loader.loadAsync('assets/characters-cs2/animations.glb');
 const [CT,T]=await Promise.all([loadAgent('ct-sas'),loadAgent('t-phoenix')]);
 for(const source of agents.values())prepare(source);
 return {CT,T};
}

/** Native forward/back/strafe pose in the same yaw frame as shared physics. */
export function choosePlayerAnimation(player,weapon={}){
 if(!player.alive)return 'death';
 const family=player.weapon==='knife'?'knife':weapon.slot===2?'pistol':'rifle';
 const speed=Math.hypot(player.vx||0,player.vz||0);
 if(player.grounded===false && Math.abs(player.vy||0)>.2)return `${family}/jump`;
 if(player.crouch)return `${family}/${speed>.3?'crouchMove':'crouchIdle'}`;
 if(speed<.3)return `${family}/idle`;
 if(player.walk)return `${family}/walk`;
 const c=Math.cos(player.yaw||0),s=Math.sin(player.yaw||0),right=c*(player.vx||0)-s*(player.vz||0),forward=-s*(player.vx||0)-c*(player.vz||0);
 const direction=Math.abs(forward)>=Math.abs(right)?(forward>=0?'n':'s'):(right>=0?'e':'w');
 return `${family}/run_${direction}`;
}
