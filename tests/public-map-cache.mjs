import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {publicPoolAssetCacheBase} from '../shared/public-map-paths.js';

const sha=value=>createHash('sha256').update(value).digest('hex');
const urlKey=value=>typeof value==='string'?value:value.url||value.href;
class MemoryCache {
 entries=new Map();
 async match(key){return this.entries.get(urlKey(key))?.clone();}
 async put(key,value){this.entries.set(urlKey(key),value.clone());}
 async delete(key){return this.entries.delete(urlKey(key));}
 async keys(){return [...this.entries.keys()].map(key=>new Request(key));}
}
class MemoryStorage {
 entries=new Map();
 async open(name){if(!this.entries.has(name))this.entries.set(name,new MemoryCache());return this.entries.get(name);}
 async delete(name){return this.entries.delete(name);}
 async keys(){return [...this.entries.keys()];}
}
let sequence=0;
async function assetFixture(t){
 const names=['document','caches','navigator','fetch','__DUST2_PORTABLE__','__DUST2_PRIVATE_MAP__'];
 const before=names.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]);
 t.after(()=>{for(const [name,descriptor]of before)if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];});
 const caches=new MemoryStorage(),requests=[],routes=new Map();
 globalThis.document={baseURI:'https://cache.test/'};globalThis.caches=caches;
 delete globalThis.__DUST2_PORTABLE__;delete globalThis.__DUST2_PRIVATE_MAP__;
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{onLine:true}});
 globalThis.fetch=async(value,options={})=>{
  options.signal?.throwIfAborted();const url=new URL(urlKey(value));
  if(url.pathname.endsWith('/download-config.json'))return new Response('',{status:404});
  requests.push(url.href);const body=routes.get(url.pathname);if(body===undefined)throw new TypeError('Network request was not permitted');return new Response(body);
 };
 return {caches,requests,routes,load:()=>import('../client/loading.js?public-cache='+ ++sequence)};
}

test('only the exact public pool paths share the root cache directory',()=>{
 for(const path of ['/','/play/de_dust2/','/play/de_mirage/?room=ABCD'])assert.equal(publicPoolAssetCacheBase('https://cache.test'+path).href,'https://cache.test/');
 for(const path of ['/review/play/de_mirage/','/__installed__/','/portable/','/play/de_inferno/','/other/play/de_mirage/'])assert.equal(publicPoolAssetCacheBase('https://cache.test'+path).pathname,path);
 assert.equal(publicPoolAssetCacheBase('https://cache.test/play/de_mirage/',{installed:true}).pathname,'/play/de_mirage/');
});

test('the old root SHA key remains readable from Dust II and Mirage without a download',async t=>{
 const f=await assetFixture(t),body='previously verified shared weapon',hash=sha(body),key='https://cache.test/__asset_cache__/sha256/'+hash;
 const old=await f.caches.open('dust2-assets-v1:/');
 await old.put(key,new Response(body,{headers:{'x-dust2-sha256':hash,'x-dust2-bytes':String(body.length)}}));
 for(const path of ['/','/play/de_dust2/','/play/de_mirage/']){
  document.baseURI='https://cache.test'+path;const api=await f.load();
  assert.equal(await(await api.fetchCachedAsset('assets/shared.glb',{sha256:hash,bytes:body.length})).text(),body);
  assert.equal(await api.isAssetSaved(hash,body.length),true);
 }
 assert.equal(f.requests.length,0);assert.deepEqual([...old.entries.keys()],[key]);
 assert.deepEqual(await f.caches.keys(),['dust2-assets-v1:/','dust2-meta-v1:/']);
});

test('new root shared assets are saved once and reused from a different map URL',async t=>{
 const f=await assetFixture(t),body='same hands and gunfire',hash=sha(body);f.routes.set('/assets/shared.bin',body);
 const first=await f.load();assert.equal(await(await first.fetchCachedAsset('assets/shared.bin',{sha256:hash,bytes:body.length})).text(),body);
 assert.equal(f.requests.length,1);
 const cache=await f.caches.open('dust2-assets-v1:/');assert(cache.entries.has('https://cache.test/__asset_cache__/sha256/'+hash));
 document.baseURI='https://cache.test/play/de_mirage/';const mirage=await f.load();
 assert.equal(await(await mirage.fetchCachedAsset('assets/shared.bin',{sha256:hash,bytes:body.length})).text(),body);
 assert.equal(f.requests.length,1);assert.equal(cache.entries.size,1);
});

test('private, installed and portable pages do not consume or overwrite the public root SHA cache',async t=>{
 const f=await assetFixture(t),body='same bytes',hash=sha(body),root=await f.caches.open('dust2-assets-v1:/');
 await root.put('https://cache.test/__asset_cache__/sha256/'+hash,new Response(body,{headers:{'x-dust2-sha256':hash,'x-dust2-bytes':String(body.length)}}));
 for(const [path,portable]of [['/review/play/de_mirage/',false],['/__installed__/',true],['/portable/',true],['/play/de_mirage/',true]]){
  document.baseURI='https://cache.test'+path;
  if(portable)globalThis.__DUST2_PORTABLE__={bundledAssets:true};else delete globalThis.__DUST2_PORTABLE__;
  f.routes.set(path+'assets/shared.bin',body);const api=await f.load();
  assert.equal(await api.isAssetSaved(hash,body.length),false);
  assert.equal(await(await api.fetchCachedAsset('assets/shared.bin',{sha256:hash,bytes:body.length})).text(),body);
  const scoped=await f.caches.open('dust2-assets-v1:'+path);
  assert(scoped.entries.has('https://cache.test'+path+'__asset_cache__/sha256/'+hash));
 }
 assert.equal(f.requests.length,4);assert.equal(root.entries.size,1);
});

test('a changed or corrupt shared download cannot replace an older verified SHA',async t=>{
 const f=await assetFixture(t),oldBody='old bytes',oldHash=sha(oldBody),cache=await f.caches.open('dust2-assets-v1:/');
 await cache.put('https://cache.test/__asset_cache__/sha256/'+oldHash,new Response(oldBody,{headers:{'x-dust2-sha256':oldHash,'x-dust2-bytes':String(oldBody.length)}}));
 document.baseURI='https://cache.test/play/de_mirage/';f.routes.set('/play/de_mirage/assets/shared.bin','bad bytes');const api=await f.load();
 await assert.rejects(api.fetchCachedAsset('assets/shared.bin',{sha256:sha('new bytes'),bytes:9}),/校验失败/);
 assert.equal(cache.entries.size,1);assert.equal(await(await cache.match('https://cache.test/__asset_cache__/sha256/'+oldHash)).text(),oldBody);
});

test('public map pages give GLTF and texture readers Blob URLs when their root worker passes /play through',async t=>{
 const f=await assetFixture(t);
 navigator.serviceWorker={controller:{scriptURL:'https://cache.test/sw.js'}};
 const files=['assets/map-cs2/dust2-web.gltf','assets/map-cs2/surface.webp','assets/map-cs2/collision.f32'].map((path,index)=>{
  const body='already verified scene part '+index;
  return {path,bytes:body.length,sha256:sha(body),group:'map',body};
 });
 const root=await f.caches.open('dust2-assets-v1:/');
 for(const file of files)await root.put('https://cache.test/__asset_cache__/sha256/'+file.sha256,new Response(file.body,{headers:{'x-dust2-sha256':file.sha256,'x-dust2-bytes':String(file.bytes)}}));
 for(const path of ['/play/de_dust2/','/play/de_mirage/']){
  document.baseURI='https://cache.test'+path;
  f.routes.set(path+'assets/asset-manifest.json',JSON.stringify({files,totalBytes:files.reduce((sum,file)=>sum+file.bytes,0)}));
  const api=await f.load();await api.downloadAssets();
  let resolveURL;api.useDownloadedAssets({setURLModifier:fn=>resolveURL=fn});
  for(const file of files){const logical=new URL(file.path,document.baseURI).href;assert.match(api.assetURL(logical),/^blob:/);assert.match(resolveURL(logical),/^blob:/);}
  assert.equal(f.requests.filter(url=>!url.endsWith('asset-manifest.json')).length,0,'verified scene bytes must not be fetched again from the game origin');
  api.releaseDownloads();for(const file of files){const logical=new URL(file.path,document.baseURI).href;assert.equal(api.assetURL(logical),logical);}
 }
});

test('same-directory workers retain direct cache loading, while private maps retain Blob URLs',async t=>{
 const f=await assetFixture(t),body='cached shared weapon',file={path:'assets/weapons/shared.bin',bytes:body.length,sha256:sha(body),group:'weapon'};
 for(const [path,privateMap,expectBlob]of [['/',false,false],['/dust2/',false,false],['/review/play/de_mirage/',true,true]]){
  document.baseURI='https://cache.test'+path;
  navigator.serviceWorker={controller:{scriptURL:'https://cache.test'+path+'sw.js'}};
  if(privateMap)globalThis.__DUST2_PRIVATE_MAP__={id:'de_mirage'};else delete globalThis.__DUST2_PRIVATE_MAP__;
  f.routes.set(path+'assets/asset-manifest.json',JSON.stringify({files:[file],totalBytes:file.bytes}));f.routes.set(path+file.path,body);
  const api=await f.load();await api.downloadAssets();const logical=new URL(file.path,document.baseURI).href;
  assert.equal(api.assetURL(logical).startsWith('blob:'),expectBlob,path);api.releaseDownloads();
 }
});

async function workerFixture({html='<title>Root lobby</title>',extraRoutes=[],icons=[]}={}){
 const cache=new MemoryStorage(),handlers={},base='https://cache.test/',requests=[],routes=new Map();
 routes.set(base,new Response(html,{headers:{'content-type':'text/html'}}));
 routes.set(base+'manifest.webmanifest',Response.json({icons}));
 for(const [path,body]of extraRoutes)routes.set(new URL(path,base).href,new Response(body));
 const context=vm.createContext({URL,Request,Response,Headers,console,caches:cache,fetch:async(value)=>{
  const url=urlKey(value);requests.push(url);if(!routes.has(url))throw new TypeError('Offline');return routes.get(url).clone();
 },self:{registration:{scope:base},addEventListener:(name,fn)=>handlers[name]=fn,skipWaiting:async()=>{},clients:{claim:async()=>{}}}});
 vm.runInContext(await readFile(new URL('../public/sw.js',import.meta.url),'utf8'),context);
 const waits=[];handlers.install({waitUntil:promise=>waits.push(promise)});await Promise.all(waits);
 async function dispatch(path,mode='cors'){
  let response;const promises=[];
  handlers.fetch({request:{url:new URL(path,base).href,method:'GET',mode},respondWith:promise=>response=promise,waitUntil:promise=>promises.push(promise)});
  const result=await response;await Promise.all(promises);return result;
 }
 return {cache,base,routes,requests,dispatch};
}

test('worker installation caches normal shell dependencies while leaving deferred attributes and map CSS out',async()=>{
 const f=await workerFixture({html:`<link rel="stylesheet" href="assets/home.css"><script src="assets/home.js"></script>
  <img src="assets/home-thumbnail.webp"><img data-game-src="assets/ui-cs2/deferred.svg">
  <img data-map-src="assets/valve-dust2/de_dust2_radar_psd.png"><a data-href="maps/de_mirage/render/hidden.webp">Deferred</a>`,
  extraRoutes:[['assets/home.css',`@import "layout.css"; .icon{background:url("home-icon.svg")}
   .old-loading{background:url("valve-dust2/de_dust2_1_png.png")}.map{background:url("map-cs2/scene.webp")}
   .phone{background:url("map-mobile/scene.webp")}.private{background:url("/maps/de_mirage/render/map.webp")}`],
   ['assets/layout.css','.layout{display:grid}'],['assets/home.js','import "./layout.js";'],['assets/layout.js','export const ready=true;'],
   ['assets/home-thumbnail.webp','thumbnail'],['assets/home-icon.svg','icon'],['assets/app-icon.png','app icon']],
  icons:[{src:'assets/app-icon.png'},{src:'assets/valve-dust2/map-icon.png'}]});
 const shell=await f.cache.open('dust2-shell-v1:/');
 for(const path of ['assets/home.css','assets/layout.css','assets/home.js','assets/layout.js','assets/home-thumbnail.webp','assets/home-icon.svg','assets/app-icon.png']){
  assert(f.requests.includes(f.base+path),path);assert(await shell.match(f.base+path),path);
 }
 assert.equal(f.requests.some(url=>/valve-dust2|map-cs2|map-mobile|\/maps\/|deferred\.svg/.test(url)),false,'install must not fetch deferred UI or any map resource even when referenced by legacy CSS');
 assert(await shell.match(f.base));
});

test('a controlling root worker passes map pages and bootstrap APIs through without replacing HOME',async()=>{
 const f=await workerFixture(),shell=await f.cache.open('dust2-shell-v1:/'),before=f.requests.length;
 for(const path of ['play/de_dust2/','play/de_mirage/','play/de_mirage/ws','maps/de_mirage/transport/block.gz','private.html','review/play/de_mirage/']){
  f.routes.set(f.base+path,new Response('<title>Another game</title>'));
  assert.equal(await f.dispatch(path,'navigate'),undefined,path);
 }
 for(const path of ['api/rooms','ws','health','config/client','public-map.json','private-map.json','map-pool.json','download-config.json','catalog.json','maps/de_mirage/render-manifest.json'])assert.equal(await f.dispatch(path),undefined,path);
 assert.equal(f.requests.length,before,'pass-through must not invoke the worker fetch/cache path');
 assert.match(await(await shell.match(f.base)).text(),/Root lobby/);
 f.routes.clear();assert.match(await(await f.dispatch('./','navigate')).text(),/Root lobby/);
});

test('root HOME and index navigation still update the complete lobby cache',async()=>{
 const f=await workerFixture(),shell=await f.cache.open('dust2-shell-v1:/');
 for(const path of ['./','index.html']){
  f.routes.set(new URL(path,f.base).href,new Response('<title>Updated '+path+'</title>',{headers:{'content-type':'text/html'}}));
  assert.match(await(await f.dispatch(path,'navigate')).text(),/Updated/);
  assert.match(await(await shell.match(f.base)).text(),/Updated/);
 }
 f.routes.clear();assert.match(await(await f.dispatch('index.html','navigate')).text(),/Updated index.html/);
});
