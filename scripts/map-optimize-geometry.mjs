import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';

// Uses the official glTF Transform CLI's cached dependencies. Install once:
// npx --yes @gltf-transform/cli@4.3.0 --version
const cache=path.join(os.homedir(),'AppData','Local','npm-cache','_npx');
const packages=fs.readdirSync(cache).map(d=>path.join(cache,d,'node_modules'));
const modules=packages.find(p=>{
  try{return JSON.parse(fs.readFileSync(path.join(p,'@gltf-transform/cli/package.json'),'utf8')).version==='4.3.0';}catch{return false;}
});
if(!modules)throw new Error('Install @gltf-transform/cli@4.3.0 with npx first.');
const get=relative=>import(pathToFileURL(path.join(modules,relative)).href);
const {NodeIO,getBounds,Logger}=await get('@gltf-transform/core/dist/index.js');
const {ALL_EXTENSIONS}=await get('@gltf-transform/extensions/dist/index.js');
const {dedup,join,prune,meshopt}=await get('@gltf-transform/functions/dist/index.js');
const {MeshoptEncoder,MeshoptDecoder}=await get('meshoptimizer/index.js');
await MeshoptEncoder.ready;
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.encoder':MeshoptEncoder,'meshopt.decoder':MeshoptDecoder});
const input=path.resolve(process.argv[2]||'artifacts/cs2-dust2-web-stage/dust2.gltf');
const output=path.resolve(process.argv[3]||'public/assets/map-cs2/dust2-web.gltf');
const doc=await io.read(input);
doc.setLogger(new Logger(Logger.Verbosity.ERROR));
const root=doc.getRoot();
const before={meshes:root.listMeshes().length,materials:root.listMaterials().length};
let removedCards=0,removedWindColors=0,removedUnusedAttributes=0;
for(const mesh of root.listMeshes())for(const prim of [...mesh.listPrimitives()]){
  const material=prim.getMaterial(),vmat=material?.getExtras()?.vmat;
  if(['antenna_card','satellite_dish_card'].includes(material?.getName())){
    // These two distant billboard exports contain broken atlas UVs in S2V
    // 20.0. Their real 3D rooftop antenna/dish props remain in the scene.
    mesh.removePrimitive(prim);removedCards++;continue;
  }
  if(vmat?.IntParams?.F_VERTEX_ANIMATION&&prim.getAttribute('COLOR_0')){
    prim.setAttribute('COLOR_0',null);removedWindColors++;
  }
  // Source lightmap/animation channels have no corresponding glTF shader.
  // Retain UV0 and authored albedo colors; never recompute surface UVs.
  for(const semantic of prim.listSemantics())if(!['POSITION','NORMAL','TANGENT','TEXCOORD_0','COLOR_0','JOINTS_0','WEIGHTS_0'].includes(semantic)){
    prim.setAttribute(semantic,null);removedUnusedAttributes++;
  }
}
await doc.transform(prune({keepLeaves:false,keepAttributes:false}),dedup());
let regions=0;
for(const scene of root.listScenes()){
  const cells=new Map();
  for(const node of [...scene.listChildren()]){
    if(!node.getMesh())continue;
    const bounds=getBounds(node);
    // Export coordinates are already metric, Y up. 24 m regions retain
    // useful street-sized frustum culling instead of merging the whole map.
    const key=`${Math.floor((bounds.min[0]+bounds.max[0])/48)},${Math.floor((bounds.min[2]+bounds.max[2])/48)}`;
    if(!cells.has(key)){const cell=doc.createNode(`Dust II region ${key}`);scene.addChild(cell);cells.set(key,cell);regions++;}
    scene.removeChild(node);cells.get(key).addChild(node);
  }
}
await doc.transform(join({keepMeshes:false,keepNamed:false}),prune({keepLeaves:false}),dedup());
const joined={meshes:root.listMeshes().length,materials:root.listMaterials().length,primitives:root.listMeshes().reduce((n,m)=>n+m.listPrimitives().length,0)};
await doc.transform(meshopt({encoder:MeshoptEncoder,level:'high',quantizePosition:16,quantizeTexcoord:16,quantizeNormal:10}));
await io.write(output,doc);
const report={input,output,before,joined,regions,removedCards,removedWindColors,removedUnusedAttributes,coordinatePrecision:'16-bit positions, original UVs retained at 16 bits where normalized, 10-bit normals, Meshopt high',meshopt:true};
fs.writeFileSync(path.join(path.dirname(output),'geometry-manifest.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
