import test from 'node:test';
import assert from 'node:assert/strict';
import {privateRenderManifest,privateRenderDependencies,readPrivateResource,decodePrivateImage,PrivateMapProgress} from '../client/private-map-loader.js';
const sha='a'.repeat(64),config={id:'de_inferno',sourceSha256:sha};
const manifest=()=>({schemaVersion:1,id:config.id,sourceSha256:sha,files:[{path:'map.gltf',bytes:10,sha256:sha},{path:'map.bin',bytes:12,sha256:sha},{path:'texture.png',bytes:4,sha256:sha}]});
test('original map identity, exact buffer length and dependency paths are validated before fetching',()=>{
 const files=privateRenderManifest(manifest(),config);
 assert.deepEqual(privateRenderDependencies({buffers:[{uri:'map.bin',byteLength:12}],images:[{uri:'texture.png'}]},files),['map.gltf','map.bin','texture.png']);
 for(const mutation of [{sourceSha256:'b'.repeat(64)},{id:'de_mirage'}])assert.throws(()=>privateRenderManifest({...manifest(),...mutation},config));
 assert.throws(()=>privateRenderManifest({...manifest(),files:[{path:'../map.gltf',bytes:1,sha256:sha}]},config));
 for(const uri of ['../map.bin','https://evil.invalid/map.bin','unknown.bin','map.bin?v=bad'])assert.throws(()=>privateRenderDependencies({buffers:[{uri,byteLength:12}]},files));
 assert.throws(()=>privateRenderDependencies({buffers:[{uri:'map.bin',byteLength:11}]},files));
});
function streamed({signal,interval=15,chunks=6,stall=false}){
 let timer,count=0;const stream=new ReadableStream({start(controller){signal.addEventListener('abort',()=>{clearInterval(timer);controller.error(signal.reason);},{once:true});timer=setInterval(()=>{if(stall&&count)return;controller.enqueue(new Uint8Array([++count]));if(count===chunks){clearInterval(timer);controller.close();}},interval);},cancel(){clearInterval(timer);}});
 return new Response(stream,{headers:{'content-length':String(chunks)}});
}
test('slow but progressing download outlives its idle budget and reports incremental bytes',async()=>{
 const events=[],started=performance.now();const data=await readPrivateResource('http://local/file',{bytes:6,idleMs:60,onBytes:n=>events.push(n),fetcher:async(_url,{signal})=>streamed({signal,interval:25})});
 assert(performance.now()-started>120);assert.deepEqual([...new Uint8Array(data)],[1,2,3,4,5,6]);assert.deepEqual(events,[0,1,2,3,4,5,6]);
});
test('stalled download, cancellation and truncated data fail explicitly',async()=>{
 await assert.rejects(readPrivateResource('http://local/file',{bytes:6,idleMs:35,fetcher:async(_url,{signal})=>streamed({signal,stall:true})}),/没有数据/);
 const abort=new AbortController();setTimeout(()=>abort.abort(),25);
 await assert.rejects(readPrivateResource('http://local/file',{signal:abort.signal,bytes:6,fetcher:async(_url,{signal})=>streamed({signal})}),{name:'AbortError'});
 await assert.rejects(readPrivateResource('http://local/file',{bytes:6,fetcher:async()=>new Response(new Uint8Array(3),{headers:{'content-length':'6'}})}),/不完整/);
});
test('image decode has its own deadline and disposes a late decoded bitmap',async()=>{
 let closed=false;await assert.rejects(decodePrivateImage(new Blob(),{timeoutMs:10,decode:()=>new Promise(resolve=>setTimeout(()=>resolve({close(){closed=true;}}),35))}),/解码超时/);
 await new Promise(resolve=>setTimeout(resolve,50));assert(closed);
});
test('last geometry download remains named even after all images decode; unused resources are excluded at finish',()=>{
 let time=0;const events=[],p=new PrivateMapProgress((label,state)=>events.push({label,state}),()=>time);
 p.plan('map.bin',100);p.plan('texture.png',10,'texture');p.plan('unused.png',10,'texture');p.begin('map.bin');p.begin('texture.png');p.bytes('texture.png',10,10);p.done('texture.png');const d=p.decodeStart();time=400;p.decodeEnd(d,true);p.bytes('map.bin',60,100);
 assert.equal(events.at(-1).state.pending[0].name,'map.bin');assert.equal(events.at(-1).state.phase,'map-download');
 p.bytes('map.bin',100,100);p.done('map.bin');assert.equal(events.at(-1).state.phase,'map-decode');assert.equal(events.at(-1).state.pending.length,0);p.finish();assert.equal(p.snapshot().count,2);assert.equal(p.snapshot().total,110);assert.equal(p.snapshot().decoded,1);
});
test('queued texture transfer keeps download phase, only active decoding remains after all requested bytes arrive',()=>{
 let time=0;const events=[],p=new PrivateMapProgress((label,state)=>events.push({label,state}),()=>time);
 p.plan('active.png',10,'texture');p.plan('queued.png',10,'texture');p.plan('unused.png',10,'texture');p.begin('active.png');p.begin('queued.png');p.bytes('active.png',10,10);p.done('active.png');p.decodeStart();assert.equal(events.at(-1).state.phase,'map-download');
 p.bytes('queued.png',10,10);p.done('queued.png');time=100;p.decodeStart();assert.equal(events.at(-1).state.phase,'map-decode');assert.equal(events.at(-1).state.activeDecodes,2);
});
test('missing image decode capability reports a clear browser message',async()=>{
 await assert.rejects(decodePrivateImage(new Blob(),{decode:null}),/浏览器不支持/);
});
