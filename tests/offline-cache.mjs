import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const sha=value=>createHash('sha256').update(value).digest('hex');
const key=value=>typeof value==='string'?value:value.url||value.href;
class MemoryCache {
  entries=new Map(); fail=false;
  async match(value){return this.entries.get(key(value))?.clone();}
  async put(value,response){if(this.fail)throw new DOMException('Full','QuotaExceededError');this.entries.set(key(value),response.clone());}
  async keys(){return [...this.entries.keys()].map(url=>new Request(url));}
}
class MemoryStorage {
  entries=new Map();
  async open(name){if(!this.entries.has(name))this.entries.set(name,new MemoryCache());return this.entries.get(name);}
  async delete(name){return this.entries.delete(name);}
  async keys(){return [...this.entries.keys()];}
}
let sequence=0;
async function fixture(){
  const cache=new MemoryStorage(),routes=new Map(),requests=[],base='https://example.test/dust2/';
  globalThis.document={baseURI:base};globalThis.caches=cache;
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{onLine:true,storage:{persisted:async()=>true,estimate:async()=>({usage:4096,quota:1e9})}}});
  globalThis.fetch=async(value,options={})=>{
    const url=new URL(key(value));requests.push(url.href);
    if(options.signal?.aborted)throw options.signal.reason;
    const valueOrHandler=routes.get(url.pathname);
    if(typeof valueOrHandler==='function')return valueOrHandler(url,options);
    if(valueOrHandler instanceof Response)return valueOrHandler.clone();
    if(valueOrHandler===undefined)throw new TypeError('Offline');
    return new Response(valueOrHandler,{headers:{'content-type':'application/octet-stream'}});
  };
  const files=(contents)=>{
    const files=Object.entries(contents).map(([path,data])=>({path,bytes:Buffer.byteLength(data),sha256:sha(data),group:'test'}));
    routes.set('/dust2/assets/asset-manifest.json',new Response(JSON.stringify({files}),{headers:{'content-type':'application/json'}}));
    for(const [path,data] of Object.entries(contents))routes.set(new URL(path,base).pathname,data);
    return files;
  };
  const load=()=>import(`../client/loading.js?test=${++sequence}`);
  return{cache,routes,requests,base,files,load,api:await load()};
}

test('SHA assets survive module reload, report decoded bytes and serve without network',async()=>{
  const f=await fixture(),[file]=f.files({'assets/map.bin':'map-one'}),progress=[];
  let r=await f.api.fetchCachedAsset(file.path,{sha256:file.sha256,bytes:file.bytes,onProgress:p=>progress.push(p)});
  assert.equal(await r.text(),'map-one');assert.equal(progress.at(-1).cached,true);
  f.routes.clear();const count=f.requests.length,second=await f.load();
  r=await second.fetchCachedAsset(file.path,{sha256:file.sha256,bytes:file.bytes});
  assert.equal(await r.text(),'map-one');assert.equal(f.requests.length,count);
  assert.equal(r.headers.get('content-length'),'7');assert.equal(r.headers.get('x-dust2-sha256'),file.sha256);
});

test('save/update only downloads changed SHA, retains earlier versions and counts optional assets',async()=>{
  const f=await fixture();f.files({'assets/map.bin':'map-v1','assets/arms.bin':'arms'});let last;
  let stats=await f.api.saveBaseAssets({onProgress:p=>last=p});
  assert.equal(stats.complete,true);assert.equal(last.bytes,last.total);assert.equal(last.complete,2);
  const counts=()=>f.requests.filter(u=>!u.endsWith('asset-manifest.json')).length;
  assert.equal(counts(),2);await f.api.saveBaseAssets();assert.equal(counts(),2);
  f.files({'assets/map.bin':'map-v2','assets/arms.bin':'arms'});
  stats=await f.api.saveBaseAssets();assert.equal(counts(),3);assert.equal(stats.count,3);assert.equal(stats.baseCount,2);
  f.routes.set('/dust2/assets/weapons/optional.glb','skin');
  await f.api.fetchCachedAsset('assets/weapons/optional.glb',{sha256:sha('skin'),bytes:4});
  stats=await f.api.getAssetCacheStats();assert.equal(stats.count,4);assert.equal(stats.baseCount,2);assert.equal(stats.bytes,20);assert.equal(stats.baseBytes,10);
  assert.equal(stats.persisted,true);assert.equal(stats.quota,1e9);
});

test('unversioned early audio resolves current manifest and joins base prefetch once',async()=>{
  const f=await fixture();f.files({'assets/audio/shot.ogg':'old-shot'});await f.api.saveBaseAssets();
  f.files({'assets/audio/shot.ogg':'new-shot'});const api=await f.load();let downloads=0;
  await api.getAssetCacheStats(); // Opening the local-files menu reads old metadata first.
  f.routes.set('/dust2/assets/audio/shot.ogg',async()=>{downloads++;await new Promise(r=>setTimeout(r,20));return new Response('new-shot');});
  const [audio,stats]=await Promise.all([api.fetchCachedAsset('assets/audio/shot.ogg'),api.saveBaseAssets()]);
  assert.equal(await audio.text(),'new-shot');assert.equal(downloads,1);assert.equal(stats.complete,true);
});

test('corrupt, truncated, and SPA fallback responses never enter the asset cache',async()=>{
  const f=await fixture();f.files({});
  f.routes.set('/dust2/assets/a.bin','bad');
  await assert.rejects(f.api.fetchCachedAsset('assets/a.bin',{sha256:sha('new'),bytes:3}),/校验失败/);
  await assert.rejects(f.api.fetchCachedAsset('assets/a.bin',{sha256:sha('new'),bytes:8}),/不完整/);
  f.routes.set('/dust2/assets/a.bin',new Response('<html>fallback</html>',{headers:{'content-type':'text/html'}}));
  await assert.rejects(f.api.fetchCachedAsset('assets/a.bin',{sha256:sha('new')}),/返回了网页/);
  assert.equal((await f.api.getAssetCacheStats()).count,0);
});

test('supplied SHA replaces stale HTTP-cache version in the download URL',async()=>{
  const f=await fixture(),hash=sha('latest-skin');f.files({});
  f.routes.set('/dust2/assets/optional.glb',url=>new Response(url.searchParams.get('v')===hash.slice(0,12)?'latest-skin':'outdated'));
  const response=await f.api.fetchCachedAsset('assets/optional.glb?v=old',{sha256:hash,bytes:11});
  assert.equal(await response.text(),'latest-skin');assert.equal(new URL(f.requests.at(-1)).searchParams.get('v'),hash.slice(0,12));
  const meta=await f.cache.open('dust2-meta-v1:/dust2/'),canonical=f.base+'assets/optional.glb?v='+hash.slice(0,12);
  assert.ok(await meta.match(f.base+'__asset_cache__/url/'+encodeURIComponent(canonical)));
});

test('aborted transfer leaves no partial cache; a surviving concurrent caller retries',async()=>{
  const f=await fixture(),[file]=f.files({'assets/map.bin':'whole'}),aborter=new AbortController();let attempts=0;
  f.routes.set('/dust2/assets/map.bin',async(_,{signal})=>{
    if(++attempts>1)return new Response('whole');
    return new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('wh'));signal.addEventListener('abort',()=>controller.error(signal.reason),{once:true});}}));
  });
  const options={sha256:file.sha256,bytes:5},first=f.api.fetchCachedAsset(file.path,{...options,signal:aborter.signal});
  const second=f.api.fetchCachedAsset(file.path,options);setTimeout(()=>aborter.abort(),10);
  await assert.rejects(first,{name:'AbortError'});assert.equal(await(await second).text(),'whole');assert.equal(attempts,2);
  assert.equal((await f.api.getAssetCacheStats()).count,1);
});

test('quota rejection still allows gameplay but cannot claim a successful offline save',async()=>{
  const f=await fixture(),[file]=f.files({'assets/map.bin':'data'});
  (await f.cache.open('dust2-assets-v1:/dust2/')).fail=true;
  assert.equal(await(await f.api.fetchCachedAsset(file.path,{sha256:file.sha256,bytes:4})).text(),'data');
  await assert.rejects(f.api.saveBaseAssets(),/存储空间不足/);
});

test('clear keeps the offline shell and other installation caches',async()=>{
  const f=await fixture();f.files({'assets/map.bin':'data'});await f.api.saveBaseAssets();
  await f.cache.open('dust2-shell-v1:/dust2/');await f.cache.open('dust2-assets-v1:/another/');
  const stats=await f.api.clearAssetCache();assert.equal(stats.count,0);assert.equal(stats.complete,false);
  assert.ok((await f.cache.keys()).includes('dust2-shell-v1:/dust2/'));
  assert.ok((await f.cache.keys()).includes('dust2-assets-v1:/another/'));
});

async function workerFixture(prefix='/dust2/'){
  const handlers={},cache=new MemoryStorage(),origin='https://example.test',base=origin+prefix,routes=new Map(),requests=[];
  const put=(path,value,type='text/plain')=>routes.set(base+path,new Response(value,{headers:{'content-type':type}}));
  put('',`<!doctype html><title>Offline lobby v1</title><script type="module" src="./assets/main-hash.js"></script><link href="./assets/main-hash.css" rel="stylesheet">`,'text/html');
  put('assets/main-hash.js','import{a}from"./vendor-hash.js";export{b}from"./ui-hash.js";import("./lazy-hash.js");');
  put('assets/vendor-hash.js','export const a=1;');put('assets/ui-hash.js','export const b=2;');put('assets/lazy-hash.js','export const c=3;');
  put('assets/main-hash.css','@import "./fonts.css";.menu{background:url("./hero.webp")}');put('assets/fonts.css','@font-face{src:url("./text.woff2")}');
  put('assets/hero.webp','image');put('assets/text.woff2','font');
  put('manifest.webmanifest',JSON.stringify({icons:[{src:'icons/icon-192.png'}]}),'application/manifest+json');put('icons/icon-192.png','icon');
  const context=vm.createContext({URL,Request,Response,Headers,console,caches:cache,fetch:async value=>{const url=key(value);requests.push(url);if(!routes.has(url))throw new TypeError('Offline');return routes.get(url).clone();},self:{registration:{scope:base},addEventListener:(name,fn)=>handlers[name]=fn,skipWaiting:async()=>{},clients:{claim:async()=>{}}}});
  vm.runInContext(await readFile(new URL('../public/sw.js',import.meta.url),'utf8'),context);
  async function install(){const promises=[];handlers.install({waitUntil:p=>promises.push(p)});await Promise.all(promises);}
  async function dispatch(path,mode='cors',method='GET'){
    let response;const promises=[];handlers.fetch({request:{url:new URL(path,base).href,method,mode},respondWith:p=>response=p,waitUntil:p=>promises.push(p)});
    const result=await response;await Promise.all(promises);return result;
  }
  return{base,cache,routes,requests,put,install,dispatch,handlers};
}

for(const prefix of ['/dust2/','/'])test(`offline shell follows minified imports, CSS and icons under ${prefix}`,async()=>{
  const f=await workerFixture(prefix);await f.install();const shell=await f.cache.open(`dust2-shell-v1:${prefix}`);
  for(const path of ['','assets/main-hash.js','assets/vendor-hash.js','assets/ui-hash.js','assets/lazy-hash.js','assets/fonts.css','assets/hero.webp','assets/text.woff2','manifest.webmanifest','icons/icon-192.png'])assert.ok(await shell.match(f.base+path),path);
  f.routes.clear();assert.match(await(await f.dispatch('./','navigate')).text(),/Offline lobby v1/);
  assert.match(await(await f.dispatch('assets/vendor-hash.js')).text(),/const a/);
  assert.equal(await f.dispatch('api/rooms'),undefined);assert.equal(await f.dispatch('ws'),undefined);assert.equal(await f.dispatch('health'),undefined);assert.equal(await f.dispatch('assets/asset-manifest.json'),undefined);
  assert.equal(await f.dispatch('api/rooms','cors','POST'),undefined);
  if(prefix!=='/')assert.equal(await f.dispatch('https://example.test/'),undefined);
});

test('interrupted shell update retains the previous complete offline lobby',async()=>{
  const f=await workerFixture();await f.install();
  f.put('','<title>v2 incomplete</title><script src="assets/missing.js"></script>','text/html');
  assert.match(await(await f.dispatch('./','navigate')).text(),/v2 incomplete/);
  f.routes.clear();assert.match(await(await f.dispatch('./','navigate')).text(),/Offline lobby v1/);
});

test('worker serves exact manifest SHA and optional index from the same persistent store',async()=>{
  const f=await workerFixture(),meta=await f.cache.open('dust2-meta-v1:/dust2/'),assets=await f.cache.open('dust2-assets-v1:/dust2/'),hash=sha('real asset');
  await meta.put(f.base+'assets/asset-manifest.json',new Response(JSON.stringify({files:[{path:'assets/map.bin',sha256:hash}]})));
  await assets.put(f.base+'__asset_cache__/sha256/'+hash,new Response('real asset'));
  assert.equal(await(await f.dispatch('assets/map.bin?v='+hash.slice(0,12))).text(),'real asset');
  const optional=new URL('assets/optional.glb?v=1',f.base);await meta.put(f.base+'__asset_cache__/url/'+encodeURIComponent(optional.href),new Response(JSON.stringify({sha256:hash})));
  assert.equal(await(await f.dispatch(optional.href)).text(),'real asset');
  await assert.rejects(f.dispatch('assets/map.bin?v=unknown'),/Offline/);
});

test('offline registration is scope-relative; persistence and install prompts require explicit API calls',async()=>{
  const handlers={},calls=[],updates=[];let persistCalls=0,promptCalls=0;
  globalThis.document={baseURI:'https://example.test/dust2/?room=abc'};
  globalThis.window={addEventListener:(name,fn)=>handlers[name]=fn};globalThis.isSecureContext=true;globalThis.matchMedia=()=>({matches:false});
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{onLine:true,storage:{persist:async()=>{persistCalls++;return true;}},serviceWorker:{register:async(url,options)=>{calls.push({url:String(url),options});return{};},ready:Promise.resolve({})}}});
  const api=await import(`../client/offline.js?test=${++sequence}`);
  const state=await api.initOffline({onStatus:s=>updates.push(s)});assert.equal(state.ready,true);assert.equal(persistCalls,0);
  assert.equal(calls[0].url,'https://example.test/dust2/sw.js');assert.equal(calls[0].options.scope,'/dust2/');
  handlers.beforeinstallprompt({preventDefault(){},prompt:async()=>{promptCalls++;},userChoice:Promise.resolve({outcome:'accepted'})});
  assert.equal(updates.at(-1).canInstall,true);assert.equal(promptCalls,0);
  assert.equal((await api.installApp()).outcome,'accepted');assert.equal(promptCalls,1);
  assert.equal(await api.requestPersistentStorage(),true);assert.equal(persistCalls,1);
  handlers.offline();assert.equal(updates.at(-1).online,false);handlers.appinstalled();assert.equal(updates.at(-1).installed,true);
});
