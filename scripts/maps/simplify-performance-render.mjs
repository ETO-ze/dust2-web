/** Minimise the static world only. Breakable primitives keep their complete geometry. */
import fs from 'node:fs';
import path from 'node:path';
import {MeshoptSimplifier as simplify} from 'three/addons/libs/meshopt_simplifier.module.js';
await simplify.ready;
const directory=process.argv[2];
const file=path.join(directory,'map.gltf');
const doc=JSON.parse(fs.readFileSync(file)), source=fs.readFileSync(path.join(directory,'map.bin'));
const p=doc.meshes[0].primitives[0];
function data(index,Type,width){
  const a=doc.accessors[index],v=doc.bufferViews[a.bufferView];
  return new Type(source.buffer,source.byteOffset+(v.byteOffset||0),a.count*width);
}
const positions=data(p.attributes.POSITION,Float32Array,3),colors=data(p.attributes.COLOR_0,Uint8Array,4);
const indices=data(p.indices,doc.accessors[p.indices].componentType===5123?Uint16Array:Uint32Array,1);
if(indices.length>220000*3){
  const remapped=simplify.generatePositionRemap(positions,3);
  const topology=Uint32Array.from(indices,i=>remapped[i]);
  const [reduced]=simplify.simplify(topology,positions,3,Math.min(topology.length,220000*3),0.035,['ErrorAbsolute','Permissive']);
  const [remap,count]=simplify.compactMesh(reduced);
  const xyz=new Float32Array(count*3),rgba=new Uint8Array(count*4);
  for(let i=0;i<remap.length;i++)if(remap[i]!==0xffffffff){
    xyz.set(positions.subarray(3*i,3*i+3),3*remap[i]);rgba.set(colors.subarray(4*i,4*i+4),4*remap[i]);
  }
  const changed=new Map();
  for(const [accessor,array,length] of [[p.attributes.POSITION,xyz,count],[p.attributes.COLOR_0,rgba,count],[p.indices,count<65535?Uint16Array.from(reduced):reduced,reduced.length]]){
    const a=doc.accessors[accessor];a.count=length;changed.set(a.bufferView,Buffer.from(array.buffer,array.byteOffset,array.byteLength));
  }
  doc.accessors[p.indices].componentType=count<65535?5123:5125;
  const chunks=[];let offset=0;
  for(const [i,v] of doc.bufferViews.entries()){
    const b=changed.get(i)||source.subarray(v.byteOffset,v.byteOffset+v.byteLength);
    v.byteOffset=offset;v.byteLength=b.length;chunks.push(b);offset+=b.length;
    const pad=(4-offset%4)%4;if(pad){chunks.push(Buffer.alloc(pad));offset+=pad;}
  }
  doc.buffers[0].byteLength=offset;
  fs.writeFileSync(path.join(directory,'map.bin'),Buffer.concat(chunks));fs.writeFileSync(file,JSON.stringify(doc));
  console.log(path.basename(path.dirname(directory))+': '+(indices.length/3)+' -> '+(reduced.length/3)+' triangles, '+offset+' bytes');
}
