import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {gameGLTFLoader} from '../client/gltf-loader.js';

function model(){
 const vertices=new Float32Array([0,0,0,1,0,0,0,1,0]);
 return {asset:{version:'2.0'},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0}],
   buffers:[{uri:'data:application/octet-stream;base64,'+Buffer.from(vertices.buffer).toString('base64'),byteLength:36}],
   bufferViews:[{buffer:0,byteOffset:0,byteLength:36}],accessors:[{bufferView:0,componentType:5126,count:3,type:'VEC3',min:[0,0,0],max:[1,1,0]}],
   images:Array.from({length:9},(_,i)=>({uri:`image-${i}.png`})),textures:Array.from({length:9},(_,i)=>({source:i})),
   materials:Array.from({length:9},(_,i)=>({pbrMetallicRoughness:{baseColorTexture:{index:i}}})),
   meshes:[{primitives:Array.from({length:9},(_,i)=>({attributes:{POSITION:0},material:i}))}]};
}
test('one shared texture decode budget covers concurrent models and failed parses can retry',async t=>{
 const saved={fetch:globalThis.fetch,createImageBitmap:globalThis.createImageBitmap,self:globalThis.self,ProgressEvent:globalThis.ProgressEvent};
 t.after(()=>Object.assign(globalThis,saved));globalThis.self=globalThis;globalThis.ProgressEvent=class {constructor(type,properties){Object.assign(this,{type,...properties});}};
 let active=0,peak=0,fail=false,closed=0;
 globalThis.fetch=(url,options)=>String(url).includes('image-')?Promise.resolve(new Response('image',{status:fail?404:200})):saved.fetch(url,options);
 globalThis.createImageBitmap=async()=>{peak=Math.max(peak,++active);await delay(8);active--;return {width:64,height:64,close(){closed++;}};};
 const parse=()=>gameGLTFLoader().parseAsync(JSON.stringify(model()),'https://fixture.invalid/');
 await Promise.all([parse(),parse()]);assert.equal(peak,4);assert.equal(active,0);
 fail=true;await assert.rejects(parse(),/404/);fail=false;
 const result=await parse();assert.ok(result.scene.children.length);assert.equal(active,0);
});
