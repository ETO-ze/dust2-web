import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {Matrix4,Vector3,Quaternion,BufferGeometry,Float32BufferAttribute} from 'three';
import {MeshBVH,CENTER} from 'three-mesh-bvh';
const root=path.resolve(import.meta.dirname,'..'),file=path.join(root,'artifacts/cs2-dust2-web-stage/dust2.gltf');
const gltf=JSON.parse(fs.readFileSync(file));
const buffers=gltf.buffers.map(b=>fs.readFileSync(path.resolve(path.dirname(file),b.uri))),cache=new Map();
function accessor(id){
 if(cache.has(id))return cache.get(id);
 const a=gltf.accessors[id],v=gltf.bufferViews[a.bufferView],b=buffers[v.buffer],d=new DataView(b.buffer,b.byteOffset,b.byteLength),n={SCALAR:1,VEC3:3}[a.type];
 const bytes={5123:2,5125:4,5126:4}[a.componentType],read={5123:'getUint16',5125:'getUint32',5126:'getFloat32'}[a.componentType];
 if(!n||!bytes)throw Error('Unsupported geometry accessor');
 const values=new Float64Array(a.count*n),stride=v.byteStride||bytes*n,offset=(v.byteOffset||0)+(a.byteOffset||0);
 for(let i=0;i<a.count;i++)for(let j=0;j<n;j++)values[i*n+j]=d[read](offset+i*stride+j*bytes,true);
 cache.set(id,values);return values;
}
function classify(m){
 const name=m?.extras?.vmat?.Name||m?.name||'';
 if(/decal|overlay|frame|alpha|dishes|glass_opaque|door_arch/i.test(name))return 0;
 if(/metal|rollupdoor|_bars/i.test(name))return 2;
 if(/wood|shipping_crate|trap_door|dust_door_\d/i.test(name))return 1;
 if(/glass/i.test(name))return 3;
 return 0;
}
const positions=[],classes=[],sourceNames=new Set(),rotation=new Matrix4().makeRotationY(Math.PI/2),v=new Vector3();
function visit(id,parent){
 const n=gltf.nodes[id],local=n.matrix?new Matrix4().fromArray(n.matrix):new Matrix4().compose(new Vector3(...(n.translation||[0,0,0])),new Quaternion(...(n.rotation||[0,0,0,1])),new Vector3(...(n.scale||[1,1,1]))),world=parent.clone().multiply(local);
 for(const p of gltf.meshes[n.mesh]?.primitives||[]){
  const material=gltf.materials[p.material],type=classify(material);if(!type)continue;
  const a=accessor(p.attributes.POSITION),indices=p.indices===undefined?Array.from({length:a.length/3},(_,i)=>i):accessor(p.indices);sourceNames.add(material.name);
  for(let i=0;i<indices.length;i++){const k=indices[i]*3;v.set(a[k],a[k+1],a[k+2]).applyMatrix4(world);positions.push(v.x,v.y,v.z);if(i%3===0)classes.push(type);}
 }
 for(const child of n.children||[])visit(child,world);
}
for(const n of gltf.scenes[gltf.scene||0].nodes)visit(n,rotation);
const geometry=new BufferGeometry().setAttribute('position',new Float32BufferAttribute(positions,3)),bvh=new MeshBVH(geometry,{strategy:CENTER,targetLeafSize:12});
const bytes=fs.readFileSync(path.join(root,'public/assets/map/positions.f32')),collision=new Float32Array(bytes.buffer,bytes.byteOffset,bytes.length/4),output=new Uint8Array(collision.length/9),nearest={},counts={0:0,1:0,2:0,3:0};
for(let i=0;i<output.length;i++){
 const k=i*9;v.set((collision[k]+collision[k+3]+collision[k+6])/3,(collision[k+1]+collision[k+4]+collision[k+7])/3,(collision[k+2]+collision[k+5]+collision[k+8])/3);
 const hit=bvh.closestPointToPoint(v,nearest,0,.16);
 if(hit)output[i]=classes[Math.floor(geometry.index.getX(hit.faceIndex*3)/3)]||0;
 counts[output[i]]++;
}
const out=path.join(root,'public/assets/map/penetration-materials.u8');fs.writeFileSync(out,output);
const report={source:'Original CS2 render VMAT names mapped onto reduced collision triangles',method:'Nearest original wood/metal/glass surface within 0.16 m; unmatched defaults to concrete. Not original Source 2 surface-property data.',ids:{0:'concrete/unknown',1:'wood',2:'metal',3:'glass'},counts,sourceMaterials:[...sourceNames].sort(),bytes:output.length,sha256:createHash('sha256').update(output).digest('hex'),sourceGeometrySha256:createHash('sha256').update(fs.readFileSync(file)).digest('hex')};
fs.writeFileSync(out.replace('.u8','.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({counts,bytes:output.length,sha256:report.sha256,renderTriangles:classes.length}));geometry.dispose();
