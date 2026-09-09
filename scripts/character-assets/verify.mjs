import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
globalThis.ProgressEvent ??= class ProgressEvent{constructor(type,params){Object.assign(this,{type},params);}};
const root=path.resolve(import.meta.dirname,'../..');
async function load(relative){
 const data=fs.readFileSync(path.join(root,relative)),n=data.readUInt32LE(12),json=JSON.parse(data.toString('utf8',20,20+n));
 assert.equal(data.readUInt32LE(8),data.length);assert.equal(data.toString('ascii',0,4),'glTF');
 // Geometry/pose validation needs no GPU or image decoder. All original image
 // buffer views remain structurally checked; omit textures from this parse.
 for(const image of json.images||[])assert.ok(image.bufferView!==undefined&&image.mimeType);
 for(const skin of json.skins||[])assert.equal(new Set(skin.joints).size,skin.joints.length,'skin joints must be unique');
 json.materials=(json.materials||[]).map(m=>({name:m.name,pbrMetallicRoughness:{baseColorFactor:[1,1,1,1]}}));delete json.images;delete json.textures;
 json.buffers[0].uri='data:application/octet-stream;base64,'+data.subarray(28+n).toString('base64');
 return new GLTFLoader().parseAsync(JSON.stringify(json),'');
}
const world=await load('public/assets/characters-cs2/animations.glb');const first=await load('public/assets/viewmodel/animations.glb');const results=[];
for(const [relative,clips,prefix]of [
 ['public/assets/characters-cs2/ct-sas.glb',world.animations,''],
 ['public/assets/characters-cs2/t-phoenix.glb',world.animations,''],
 ...['ct-ava','t-miami'].filter(id=>fs.existsSync(path.join(root,`public/assets/characters-cs2/optional/${id}.glb`))).map(id=>[`public/assets/characters-cs2/optional/${id}.glb`,world.animations,'']),
 ['public/assets/viewmodel/arms.glb',first.animations,''],
 ...['ct-sas','t-phoenix','ct-ava','t-miami'].map(id=>[`public/assets/characters-cs2/arms/${id}.glb`,first.animations,'']),
]){
 const gltf=await load(relative),names=new Set();gltf.scene.traverse(o=>names.add(o.name));const mixer=new THREE.AnimationMixer(gltf.scene);let tested=0,meshes=0,bones=0,maxMagnitude=0;
 for(const original of clips){
  const clip=original.clone();clip.tracks=clip.tracks.filter(t=>names.has(THREE.PropertyBinding.parseTrackName(t.name).nodeName));if(!clip.tracks.length)continue;clip.duration=Math.max(.1,clip.duration);mixer.stopAllAction();mixer.clipAction(clip).play();mixer.update(clip.duration*.45);gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse(o=>{assert.ok(o.matrixWorld.elements.every(Number.isFinite),relative+' '+clip.name+' '+o.name);if(o.isSkinnedMesh){o.skeleton.update();assert.ok([...o.skeleton.boneMatrices].every(Number.isFinite));o.computeBoundingBox();const box=new THREE.Box3().setFromObject(o);for(const v of [...box.min,...box.max]){assert.ok(Number.isFinite(v));maxMagnitude=Math.max(maxMagnitude,Math.abs(v));}}});tested++;
 }
 gltf.scene.traverse(o=>{if(o.isSkinnedMesh)meshes++;if(o.isBone)bones++;});assert.ok(tested>=30);assert.ok(maxMagnitude<5,'animated model escaped metre-scale bounds');results.push({asset:relative,clips:tested,skinnedMeshes:meshes,bones,maxMagnitude});
 mixer.stopAllAction();mixer.uncacheRoot(gltf.scene);
}
fs.writeFileSync(path.join(root,'artifacts/characters-cs2/verification.json'),JSON.stringify(results,null,2)+'\n');console.log(JSON.stringify(results,null,2));
