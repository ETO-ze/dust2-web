import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {Matrix4} from '../../node_modules/three/build/three.module.js';
const require=createRequire('C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json');
const sharp=require('sharp');
const root=path.resolve(import.meta.dirname,'../..'),out=path.join(root,'public/assets/weapons/cs2-utility');fs.mkdirSync(out,{recursive:true});
const models=[];
for(const id of ['hegrenade','flashbang','smokegrenade','decoy','molotov','incgrenade','defusekit']){
 const raw=path.join(root,'artifacts/weapon-expansion/raw',id,id+'.glb'),b=fs.readFileSync(raw),n=b.readUInt32LE(12),doc=JSON.parse(b.toString('utf8',20,20+n));
 const chunks=[b.subarray(28+n,28+n+b.readUInt32LE(20+n))];let total=chunks[0].length;
 for(const image of doc.images){
  if(!image.uri)continue;const data=await sharp(path.join(path.dirname(raw),image.uri)).resize(1024,1024,{fit:'inside',withoutEnlargement:true}).png().toBuffer();
  const pad=Buffer.alloc(Math.ceil(data.length/4)*4);data.copy(pad);image.bufferView=doc.bufferViews.length;image.mimeType='image/png';delete image.uri;
  doc.bufferViews.push({buffer:0,byteOffset:total,byteLength:data.length});chunks.push(pad);total+=pad.length;
 }
 const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];let triangles=0;
 for(const mesh of doc.meshes)for(const p of mesh.primitives){const a=doc.accessors[p.attributes.POSITION];a.min.forEach((v,i)=>min[i]=Math.min(min[i],v));a.max.forEach((v,i)=>max[i]=Math.max(max[i],v));triangles+=doc.accessors[p.indices].count/3;}
 const center=min.map((v,i)=>(v+max[i])/2),normalization=new Matrix4().set(-1,0,0,center[0],0,1,0,-center[1],0,0,-1,center[2],0,0,0,1);
 const scene=doc.scenes[doc.scene||0],children=scene.nodes;scene.nodes=[doc.nodes.length];doc.nodes.push({name:'normalization',matrix:normalization.toArray(),children,extras:{sourceForward:'+Z',forward:'-Z',units:'metres',sourceCenter:center}});
 doc.asset={version:'2.0',generator:'Source2Viewer 20 original CS2 utility model, embedded textures',copyright:'Valve Corporation. Local personal prototype.'};
 doc.buffers=[{byteLength:total}];
 const text=Buffer.from(JSON.stringify(doc)),json=Buffer.alloc(Math.ceil(text.length/4)*4,32);text.copy(json);const bin=Buffer.concat(chunks),result=Buffer.alloc(28+json.length+bin.length);
 result.writeUInt32LE(0x46546c67);result.writeUInt32LE(2,4);result.writeUInt32LE(result.length,8);result.writeUInt32LE(json.length,12);result.writeUInt32LE(0x4e4f534a,16);json.copy(result,20);result.writeUInt32LE(bin.length,20+json.length);result.writeUInt32LE(0x004e4942,24+json.length);bin.copy(result,28+json.length);
 fs.writeFileSync(path.join(out,id+'.glb'),result);
 models.push({id,file:id+'.glb',bytes:result.length,sha256:crypto.createHash('sha256').update(result).digest('hex'),triangles,sizeMetres:min.map((v,i)=>max[i]-v),source:id==='defusekit'?'weapons/models/defuser/defuser.vmdl_c':id==='incgrenade'?'weapons/models/grenade/incendiary/weapon_incendiarygrenade.vmdl_c':`weapons/models/grenade/${id}/weapon_${id}.vmdl_c`,animations:['draw','idle','inspect','pullpin','throw','throwUnderhand'].map(action=>id+'/'+action)});
}
fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify({source:'Original installed Counter-Strike 2 VPK; Valve retains rights',models},null,2)+'\n');
console.log(JSON.stringify(models.map(({id,bytes,triangles})=>({id,bytes,triangles}))));

fs.writeFileSync(path.join(root,'shared/utility-assets.js'),"import {C4_ASSET} from './c4-asset.js';\n// Original Valve models, fetched on demand.\nexport const UTILITY_ASSETS=Object.freeze({c4:C4_ASSET,..."+JSON.stringify(Object.fromEntries(models.map(m=>[m.id,{...m,model:'assets/weapons/cs2-utility/'+m.file}])),null,2)+"});\n");
