import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
import {initPhysics,raycastWorldSurfaces} from '../shared/physics.js';
const file=path.resolve('public/assets/map-cs2/dust2-web.gltf'),json=JSON.parse(fs.readFileSync(file));
for(const b of json.buffers||[])if(b.uri&&!b.uri.startsWith('data:'))b.uri=`data:application/octet-stream;base64,${fs.readFileSync(path.resolve(path.dirname(file),decodeURIComponent(b.uri))).toString('base64')}`;
const hidden=new Set(json.materials.filter(m=>m.extras?.vmat?.IntParams?.F_DEPTH_FEATHER).map(m=>m.name));
json.materials=json.materials.map(m=>({name:m.name,doubleSided:true}));delete json.images;delete json.textures;
globalThis.self=globalThis;globalThis.ProgressEvent??=class{constructor(type,init){Object.assign(this,{type},init);}};
const gltf=await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(JSON.stringify(json),'');
const group=new THREE.Group();group.add(gltf.scene);group.rotation.y=Math.PI/2;group.updateMatrixWorld(true);
const meshes=[];group.traverse(o=>{if(o.isMesh&&!hidden.has(o.material.name))meshes.push(o);});
const bytes=fs.readFileSync('public/assets/map/positions.f32'),positions=new Float32Array(bytes.buffer,bytes.byteOffset,bytes.byteLength/4);
const ray=new THREE.Raycaster(),samples=[];
for(let z=-69.2;z<=-67.1;z+=.1)for(let y=2.8;y<=6.4;y+=.15){
 const origin={x:-31.19,y,z};ray.set(new THREE.Vector3(origin.x,y,z),new THREE.Vector3(-1,0,0));ray.far=4;
 const visible=ray.intersectObjects(meshes,false)[0];
 samples.push({origin,renderDistance:visible?.distance??null,mesh:visible?.object.name??null});
}
const report={region:'B window broken brickwork',samples:samples.length};
for(const mapPatches of [false,true]){
 initPhysics(positions,null,{mapPatches});
 const mismatch=[];
 for(const sample of samples){
  const hit=raycastWorldSurfaces(sample.origin,{x:-1,y:0,z:0},4)[0];
  if(hit&&(sample.renderDistance===null||sample.renderDistance-hit.distance>.04))mismatch.push({...sample,collisionDistance:hit.distance});
 }
 report[mapPatches?'patched':'original']={earlyCollisionCount:mismatch.length,examples:mismatch.slice(0,12)};
}
fs.mkdirSync('artifacts/qa',{recursive:true});fs.writeFileSync('artifacts/qa/b-window-render-comparison.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
