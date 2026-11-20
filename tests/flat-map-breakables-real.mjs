import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {Scene} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {flattenMapDocument} from '../client/flat-map-materials.js';
import {applyFlatMaterials} from '../client/flat-map-renderer.js';
import {PrivateMapBreakables} from '../client/private-map-breakables.js';
import {PRIVATE_BREAKABLES} from '../shared/private-map-breakables-data.js';

const mapDir=path.resolve(process.env.PERF_MAP_ROOT || 'artifacts/performance-maps/maps-v1','de_mirage');
test('compiled Mirage panels hide and restore every visible render part and leave other panels intact', {
  skip: !fs.existsSync(path.join(mapDir,'flat-breakables.json')),
},async()=>{
  const source=fs.readFileSync(path.join(mapDir,'render/map.gltf'),'utf8');
  const mapping=JSON.parse(fs.readFileSync(path.join(mapDir,'flat-breakables.json')));
  assert.equal(createHash('sha256').update(source).digest('hex'),mapping.renderSha256);
  const json=flattenMapDocument(JSON.parse(source),{authoredColors:true});
  for(const buffer of json.buffers) {
    buffer.uri='data:application/octet-stream;base64,'+fs.readFileSync(path.join(mapDir,'render',buffer.uri)).toString('base64');
  }
  const before=globalThis.ProgressEvent;
  globalThis.ProgressEvent ||= class extends Event {constructor(type,options){super(type);Object.assign(this,options);}};
  let gltf;
  try {gltf=await new GLTFLoader().parseAsync(json,'');}
  finally {if(!before)delete globalThis.ProgressEvent;}
  applyFlatMaterials(gltf.scene);
  const scene=new Scene();scene.add(gltf.scene);
  const definitions=PRIVATE_BREAKABLES.objects.map(def=>({...def,nodeNames:[def.id],
    nodeIndices:[mapping.nodesById[def.id]],restoredNodeIndices:[]}));
  const panels=new PrivateMapBreakables({gltf,scene,definitions});
  const count=id=>{
    const result={surface:0,outline:0};
    gltf.scene.getObjectByName(id).traverseVisible(object=>{
      if(object.isMesh)result.surface++;
      if(object.isLineSegments)result.outline++;
    });
    return result;
  };
  const expected=new Map(definitions.map(({id})=>[id,count(id)]));
  const outlined=json.extras?.outlineVersion===1;
  for(const {id} of definitions) {
    const shown=count(id);
    assert.ok(shown.surface>0,id);
    assert.equal(shown.outline>0,outlined,id);
    panels.sync({round:{number:1},mapBreakables:definitions.map(def=>({id:def.id,broken:def.id===id}))});
    assert.deepEqual(count(id),{surface:0,outline:0});
    for(const other of definitions.filter(def=>def.id!==id))assert.deepEqual(count(other.id),expected.get(other.id));
    panels.reset();
    assert.deepEqual(count(id),shown);
  }
  panels.dispose();
});
