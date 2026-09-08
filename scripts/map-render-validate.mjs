import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { MAP } from '../shared/map-data.js';
import { initPhysics, floorHeight } from '../shared/physics.js';

// Geometry-only independent audit: texture decoding is checked in the browser.
const file=path.resolve(process.argv[2]||'public/assets/map-cs2/dust2.gltf');
const json=JSON.parse(fs.readFileSync(file,'utf8'));
const sourceStats={materials:json.materials?.length||0,images:json.images?.length||0,meshes:json.meshes?.length||0,nodes:json.nodes?.length||0};
const hiddenMaterialNames=new Set((json.materials||[]).filter(m=>m.extras?.vmat?.IntParams?.F_DEPTH_FEATHER).map(m=>m.name));
for(const b of json.buffers||[])if(b.uri&&!b.uri.startsWith('data:'))b.uri=`data:application/octet-stream;base64,${fs.readFileSync(path.resolve(path.dirname(file),decodeURIComponent(b.uri))).toString('base64')}`;
json.materials=(json.materials||[]).map(m=>({name:m.name,doubleSided:true}));
delete json.textures;delete json.images;
json.extensionsRequired=(json.extensionsRequired||[]).filter(e=>!e.includes('texture'));
json.extensionsUsed=(json.extensionsUsed||[]).filter(e=>!e.includes('texture'));
globalThis.self=globalThis;
globalThis.ProgressEvent??=class ProgressEvent{constructor(type,init){Object.assign(this,{type},init);}};
const gltf=await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(JSON.stringify(json),'');
const group=new THREE.Group();group.add(gltf.scene);group.rotation.y=Math.PI/2;group.updateMatrixWorld(true);
const box=new THREE.Box3().setFromObject(group);
let meshInstances=0,triangleInstances=0,uvMeshes=0;
const visibleMeshes=[];
group.traverse(o=>{if(o.isMesh){meshInstances++;triangleInstances+=(o.geometry.index?.count||o.geometry.attributes.position.count)/3;uvMeshes+=Boolean(o.geometry.attributes.uv);if(!hiddenMaterialNames.has(o.material.name))visibleMeshes.push(o);}});
const physicsBytes=fs.readFileSync(new URL('../public/assets/map/positions.f32',import.meta.url));
initPhysics(new Float32Array(physicsBytes.buffer,physicsBytes.byteOffset,physicsBytes.byteLength/4));
const ray=new THREE.Raycaster(),direction=new THREE.Vector3(0,-1,0);
const locations=[...MAP.spawns.T.map((p,i)=>({name:`T${i}`,p})),...MAP.spawns.CT.map((p,i)=>({name:`CT${i}`,p})),...Object.entries(MAP.sites).map(([name,p])=>({name,p}))];
const checks=locations.map(({name,p})=>{
  const fromY=p.y+.7;
  ray.set(new THREE.Vector3(p.x,fromY,p.z),direction);ray.far=3;
  const hit=ray.intersectObjects(visibleMeshes,false)[0];
  const physicsY=floorHeight(p.x,p.z,fromY,3);
  return{name,x:p.x,z:p.z,physicsY,renderY:hit?.point.y??null,difference:hit&&physicsY!==null?hit.point.y-physicsY:null,mesh:hit?.object.name??null};
});
const report={file,...sourceStats,meshInstances,triangleInstances,uvMeshes,bounds:{min:box.min.toArray(),max:box.max.toArray()},rotationY:Math.PI/2,checks};
if(process.env.MAP_PROBE){
  const camera=new THREE.PerspectiveCamera(74,1310/854,.05,400);camera.position.set(30,4.3,-66.7);camera.lookAt(8,2,-53);camera.updateMatrixWorld(true);
  ray.setFromCamera(new THREE.Vector2(.28,-.01),camera);ray.far=100;
  report.visualProbe=ray.intersectObjects(visibleMeshes,false).slice(0,5).map(hit=>({mesh:hit.object.name,material:hit.object.material.name,p:hit.point.toArray()}));
  camera.position.set(-18.7,4.7,23.2);camera.lookAt(0,4.7,23.2);camera.updateMatrixWorld(true);
  ray.setFromCamera(new THREE.Vector2(-.334,-.054),camera);
  report.canopyProbe=ray.intersectObjects(visibleMeshes,false).slice(0,3).map(hit=>({mesh:hit.object.name,material:hit.object.material.name,p:hit.point.toArray()}));
}
fs.writeFileSync(new URL('../public/assets/map/render-validation.json',import.meta.url),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
