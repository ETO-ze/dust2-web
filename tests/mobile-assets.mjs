import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {viewportSize} from '../shared/video-settings.js';
const json=async path=>JSON.parse(await readFile(new URL(path,import.meta.url),'utf8'));
test('phone viewport fills portrait, wide landscape and browser chrome sizes without stretching a fixed 16:9 frame',()=>{
 for(const [width,height] of [[390,844],[844,390],[667,320],[960,432]]){
   const v=viewportSize(width,height,{mobile:true,aspect:'4:3'});
   assert.deepEqual(v,{aspect:width/height,width,height,displayWidth:width,displayHeight:height});
 }
});
test('mobile map preserves every mesh, material and texture association; manifest excludes desktop images',async()=>{
 const desktop=await json('../public/assets/map-cs2/dust2-web.gltf'),mobile=await json('../public/assets/map-mobile/dust2-mobile.gltf');
 for(const key of ['meshes','accessors','bufferViews','materials','textures','nodes'])assert.deepEqual(mobile[key],desktop[key]);
 assert.equal(mobile.images.length,desktop.images.length);assert.ok(mobile.images.every(i=>i.uri.startsWith('textures/')));
 const manifest=await json('../public/assets/asset-manifest-mobile.json'),full=await json('../public/assets/asset-manifest.json');
 assert.ok(!manifest.files.some(f=>f.path.startsWith('assets/map-cs2/textures/')));
 assert.ok(manifest.files.some(f=>f.path==='assets/map-mobile/dust2-mobile.gltf'));
 assert.ok(manifest.totalBytes<full.totalBytes*.7);
});
