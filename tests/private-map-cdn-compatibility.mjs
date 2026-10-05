import test from 'node:test';
import assert from 'node:assert/strict';
import {createPrivateMapScene} from '../client/private-map-scene.js';
import {MAP} from '../shared/map-data.js';

const hash='a'.repeat(64),renderURL='https://game.test:8443/review/maps/de_dust2/render/map.gltf';
const CDN='https://downloads.test/releases/test/maps/';
const manifest={schemaVersion:1,id:'de_dust2',sourceSha256:hash,files:[{path:'map.gltf',bytes:10,sha256:hash}]};
const originalDecompressor=globalThis.DecompressionStream;

function browserFixture(t,{cdn=true,decompressor,fetcher}){
 const globals=['__DUST2_PRIVATE_MAP__','DecompressionStream','fetch'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]);
 const privateFlag=Object.getOwnPropertyDescriptor(MAP,'private');
 t.after(()=>{
  for(const [key,descriptor]of globals)if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];
  if(privateFlag)Object.defineProperty(MAP,'private',privateFlag);else delete MAP.private;
 });
 globalThis.DecompressionStream=decompressor;globalThis.fetch=fetcher;MAP.private=true;
 globalThis.__DUST2_PRIVATE_MAP__={id:'de_dust2',sourceSha256:hash,renderUrl:renderURL,
  socketURL:'wss://game.test:8443/review/play/de_dust2/ws',mapDownloadBaseURL:cdn?CDN:null};
}

test('CDN maps require decompression support before requesting any map resource and report actionable upgrades',async t=>{
 const requests=[];
 browserFixture(t,{decompressor:undefined,fetcher:async url=>{requests.push(String(url));throw Error('Unsupported browsers must not request unpublished originals');}});
 await assert.rejects(createPrivateMapScene({}),error=>{
  assert.match(error.message,/地图分块解压/);assert.match(error.message,/升级 Chrome 或 Edge/);assert.match(error.message,/更新 Android System WebView/);return true;
 });
 assert.deepEqual(requests,[]);
});

test('non-CDN maps without decompression support retain original render downloads',async t=>{
 const requests=[];
 browserFixture(t,{cdn:false,decompressor:undefined,fetcher:async url=>{
  requests.push(String(url));
  if(String(url).endsWith('/render-manifest.json'))return Response.json(manifest);
  throw Error('Original render download reached');
 }});
 await assert.rejects(createPrivateMapScene({}),/Original render download reached/);
 assert.deepEqual(requests,['https://game.test:8443/review/maps/de_dust2/render-manifest.json',renderURL+'?v='+hash]);
});

test('non-CDN maps still fall back to original render when the optional transport manifest is missing',async t=>{
 const requests=[];
 browserFixture(t,{cdn:false,decompressor:originalDecompressor,fetcher:async url=>{
  requests.push(String(url));
  if(String(url).endsWith('/render-manifest.json'))return Response.json(manifest);
  if(String(url).endsWith('/transport-manifest.json'))return new Response(null,{status:404});
  throw Error('Original render download reached');
 }});
 await assert.rejects(createPrivateMapScene({}),/Original render download reached/);
 assert.deepEqual(requests,['https://game.test:8443/review/maps/de_dust2/render-manifest.json','https://game.test:8443/review/maps/de_dust2/transport-manifest.json',renderURL+'?v='+hash]);
});

test('CDN maps with decompression support keep transport requirements and never fall back to unpublished originals',async t=>{
 const requests=[];
 browserFixture(t,{decompressor:originalDecompressor,fetcher:async url=>{
  requests.push(String(url));
  if(String(url).endsWith('/render-manifest.json'))return Response.json(manifest);
  return new Response(null,{status:404});
 }});
 await assert.rejects(createPrivateMapScene({}),/原图下载失败 \(404\)/);
 assert.deepEqual(requests,[CDN+'de_dust2/render-manifest.json',CDN+'de_dust2/transport-manifest.json']);
});

test('an already cancelled CDN map load remains a cancellation before the browser capability check',async t=>{
 const requests=[],controller=new AbortController();controller.abort();
 browserFixture(t,{decompressor:undefined,fetcher:async url=>{requests.push(String(url));throw Error('Cancelled loads must not request map files');}});
 await assert.rejects(createPrivateMapScene({},{signal:controller.signal}),{name:'AbortError'});
 assert.deepEqual(requests,[]);
});
