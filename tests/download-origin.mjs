import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {spawnSync} from 'node:child_process';
import {validateDownloadConfig} from '../shared/download-config.js';
import {assetDownloadURL,fetchAssetDownload,getDownloadOrigin,initDownloadOrigin} from '../client/download-origin.js';

const page='https://game.test/review/play/de_mirage/';
const config={schemaVersion:1,assetBaseURL:'https://static.test/release/assets/',mapBaseURL:'https://static.test/release/maps/',fallbackToGameServer:false};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');

test('delivery schema accepts explicit static origins and rejects insecure or ambiguous configurations',()=>{
 assert.deepEqual(validateDownloadConfig({...config,assetBaseURL:'https://static.test/release/assets'},page),config);
 assert(Object.isFrozen(validateDownloadConfig(config,page)));
 assert.deepEqual(validateDownloadConfig({schemaVersion:1},page),{schemaVersion:1,assetBaseURL:null,mapBaseURL:null,fallbackToGameServer:false});
 assert.equal(validateDownloadConfig({...config,assetBaseURL:'http://127.0.0.1:1234/assets'},'http://localhost/game/').assetBaseURL,'http://127.0.0.1:1234/assets/');
 for(const assetBaseURL of ['assets/','https:static.test/assets','http://static.test/assets/','http://localhost/assets/','https://user:pass@static.test/assets/',
  'https://@static.test/assets/','https://static.test/assets/?','https://static.test/assets/#','https://static.test/assets/%2fother/','https://static.test/assets/\\'])
  assert.throws(()=>validateDownloadConfig({...config,assetBaseURL},page),/download configuration/i,assetBaseURL);
 for(const value of [null,[],{...config,schemaVersion:2},{...config,fallbackToGameServer:'true'},{...config,socketURL:'wss://static.test/'}])
  assert.throws(()=>validateDownloadConfig(value,page),/download configuration/i);
});

test('only a same-origin config endpoint can install delivery settings; 404 preserves old same-origin behavior',async()=>{
 const requested=[];
 const installed=await initDownloadOrigin({pageURL:page,configURL:'../../../download-config.json',fetcher:async(url,options)=>{
  requested.push({url:String(url),options});return Response.json(config);
 }});
 assert.deepEqual(installed,config);
 assert.equal(getDownloadOrigin(),installed);
 assert.equal(requested[0].url,'https://game.test/download-config.json');
 assert.equal(requested[0].options.redirect,'error');
 assert.equal(requested[0].options.mode,'same-origin');
 for(const configURL of ['https://other.test/download-config.json','https://user@game.test/download-config.json','download-config.json?','download-config.json#'])
  await assert.rejects(initDownloadOrigin({pageURL:page,configURL,fetcher:()=>{throw Error('must not request untrusted configuration');}}),/game origin/);
 const external=new Response('{}');Object.defineProperty(external,'url',{value:'https://other.test/download-config.json'});
 await assert.rejects(initDownloadOrigin({pageURL:page,fetcher:async()=>external}),/outside the game origin/);
 await assert.rejects(initDownloadOrigin({pageURL:page,fetcher:async()=>Response.json({...config,schemaVersion:2})}),/schema/);
 await assert.rejects(initDownloadOrigin({pageURL:page,fetcher:async()=>new Response('',{status:503})}),/unavailable/);
 assert.equal(getDownloadOrigin(),installed,'failed configuration must not replace the validated settings');
 const legacy=await initDownloadOrigin({pageURL:page,fetcher:async()=>new Response('',{status:404})});
 assert.deepEqual(legacy,{schemaVersion:1,assetBaseURL:null,mapBaseURL:null,fallbackToGameServer:false});
});

test('only the source document assets directory moves, with hash queries and logical URLs preserved',()=>{
 const options={pageURL:page,config};
 assert.equal(assetDownloadURL('assets/weapons/rifle.glb?v=abc',options).href,'https://static.test/release/assets/weapons/rifle.glb?v=abc');
 assert.equal(assetDownloadURL('assets/data:mesh.bin',options).href,'https://static.test/release/assets/data:mesh.bin');
 for(const url of ['https://other.test/review/play/de_mirage/assets/rifle.glb','https://game.test/api/assets/rifle.glb',
  'https://game.test/review/maps/de_mirage/render/map.gltf','wss://game.test/review/play/de_mirage/ws',
  'https://game.test/review/play/de_mirage/assetsprefix/rifle.glb'])
  assert.equal(assetDownloadURL(url,options).href,url);
 for(const value of ['assets/','assets/a/%2fapi.bin','assets/a/%5capi.bin','assets/a//api.bin'])
  assert.throws(()=>assetDownloadURL(value,options),/outside the source assets directory/);
});

test('asset outages do not fall back by default; explicit fallback covers only availability failures and honors aborts',async()=>{
 const original=new URL('assets/rifle.glb?v=hash',page).href,remote=assetDownloadURL(original,{pageURL:page,config}).href,calls=[];
 const options={pageURL:page,config,cache:'force-cache',fetcher:async(url,request)=>{calls.push({url:String(url),request});return new Response('down',{status:503});}};
 assert.equal((await fetchAssetDownload(original,options)).status,503);
 assert.equal(calls.length,1);assert.equal(calls[0].url,remote);assert.equal(calls[0].request.credentials,'omit');assert.equal(calls[0].request.mode,'cors');
 const fallback={...config,fallbackToGameServer:true};
 const transferred=[];
 assert.equal((await fetchAssetDownload(original,{pageURL:page,config:fallback,fetcher:async url=>{transferred.push(String(url));return new Response('data',{status:transferred.length===1?503:200});}})).status,200);
 assert.deepEqual(transferred,[remote,original]);
 const network=[];
 assert.equal((await fetchAssetDownload(original,{pageURL:page,config:fallback,fetcher:async url=>{network.push(String(url));if(network.length===1)throw new TypeError('Failed to fetch');return new Response('data');}})).status,200);
 assert.deepEqual(network,[remote,original]);
 for(const status of [200,401,403]){
  const attempts=[];await fetchAssetDownload(original,{pageURL:page,config:fallback,fetcher:async url=>{attempts.push(String(url));return new Response('unverified content',{status});}});
  assert.deepEqual(attempts,[remote]);
 }
 for(const error of [new Error('program failure'),new DOMException('Cancelled','AbortError')]){
  let count=0;await assert.rejects(fetchAssetDownload(original,{pageURL:page,config:fallback,fetcher:async()=>{count++;throw error;}}),error);assert.equal(count,1);
 }
 const controller=new AbortController(),aborted=[];
 await assert.rejects(fetchAssetDownload(original,{pageURL:page,config:fallback,signal:controller.signal,fetcher:async url=>{aborted.push(String(url));controller.abort();throw new TypeError('connection closed');}}),{name:'AbortError'});
 assert.equal(aborted.length,1);
});

test('real HTTP downloads retain hash verification and reuse source-based caches after moving static hosts',async t=>{
 const raw=Buffer.from('immutable weapon geometry '.repeat(300)),hash=sha(raw),requests=[],sourceHashes=[],stores=new Map();
 let base;
 const server=createServer((req,res)=>{
  requests.push(req.url);
  if(req.url==='/game/download-config.json'){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({...config,assetBaseURL:base+'/cdn-a/',mapBaseURL:null}));return;}
  if(req.url?.startsWith('/cdn-a/asset-manifest')){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({files:[{path:'assets/weapons/rifle.glb',bytes:raw.length,sha256:hash,group:'weapons'}]}));return;}
  if(req.url?.startsWith('/cdn-a/weapons/rifle.glb')){res.writeHead(200,{'Content-Type':'application/octet-stream','Access-Control-Allow-Origin':'*'});res.end(raw);return;}
  if(req.url?.startsWith('/cdn-b/weapons/modified.glb')){res.writeHead(200,{'Content-Type':'application/octet-stream'});res.end(Buffer.alloc(raw.length,0));return;}
  res.writeHead(503);res.end('unexpected request');
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base=`http://127.0.0.1:${server.address().port}`;
 t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
 const oldDocument=globalThis.document,oldLocation=globalThis.location,oldCaches=globalThis.caches;
 globalThis.document={baseURI:base+'/game/'};globalThis.location={href:base+'/game/'};
 globalThis.caches={open:async name=>{
  if(!stores.has(name)){
   const entries=new Map();stores.set(name,{match:async key=>entries.get(String(key))?.clone(),put:async(key,response)=>{entries.set(String(key),response);sourceHashes.push(String(key));},keys:async()=>[...entries.keys()]});
  }
  return stores.get(name);
 }};
 t.after(()=>{globalThis.document=oldDocument;globalThis.location=oldLocation;globalThis.caches=oldCaches;});
 await initDownloadOrigin({pageURL:base+'/game/',fetcher:async()=>new Response('',{status:404})});
 const {fetchCachedAsset}=await import('../client/loading.js');
 // Reset to an actual game-owned endpoint, then ensure the loader reuses it.
 await initDownloadOrigin({pageURL:base+'/game/'});
 const first=await fetchCachedAsset('assets/weapons/rifle.glb');
 assert.equal(sha(Buffer.from(await first.arrayBuffer())),hash);
 assert.deepEqual(requests,['/game/download-config.json','/cdn-a/asset-manifest.json',`/cdn-a/weapons/rifle.glb?v=${hash.slice(0,12)}`]);
 assert.equal(first.headers.get('x-dust2-asset-url'),`${base}/game/assets/weapons/rifle.glb?v=${hash.slice(0,12)}`);
 assert(sourceHashes.every(url=>url.startsWith(base+'/game/')));
 assert(sourceHashes.some(url=>url.startsWith(base+'/game/__asset_cache__/sha256/')));
 const before=requests.length;
 await initDownloadOrigin({pageURL:base+'/game/',fetcher:async()=>Response.json({...config,assetBaseURL:base+'/cdn-b/',mapBaseURL:null})});
 assert.equal(sha(Buffer.from(await (await fetchCachedAsset('assets/weapons/rifle.glb',{sha256:hash,bytes:raw.length})).arrayBuffer())),hash);
 assert.equal(requests.length,before,'changing the static host must not redownload cached hashes');
 await initDownloadOrigin({pageURL:base+'/game/',fetcher:async()=>Response.json({...config,assetBaseURL:base+'/cdn-b/',mapBaseURL:null,fallbackToGameServer:true})});
 const changedHash=sha('expected modified geometry');
 await assert.rejects(fetchCachedAsset('assets/weapons/modified.glb',{sha256:changedHash,bytes:raw.length}),/校验失败/);
 assert.equal(requests.at(-1),`/cdn-b/weapons/modified.glb?v=${changedHash.slice(0,12)}`);
 assert(!requests.some(url=>url.startsWith('/game/assets/')),'content mismatch must not fall back to the game server');
});

test('private pages lazily initialize the shared config before downloading the asset manifest',()=>{
 const script=`
 import assert from 'node:assert/strict';
 import {createHash} from 'node:crypto';
 globalThis.document={baseURI:'https://game.test/review/play/de_mirage/'};
 globalThis.location={href:document.baseURI};
 globalThis.__DUST2_PRIVATE_MAP__={renderUrl:'https://game.test/review/maps/de_mirage/render/map.gltf'};
 const bytes=new TextEncoder().encode('asset data'),hash=createHash('sha256').update(bytes).digest('hex'),calls=[];
 globalThis.fetch=async value=>{const url=String(value);calls.push(url);
  if(url==='https://game.test/review/download-config.json')return Response.json({schemaVersion:1,assetBaseURL:'https://static.test/assets/',mapBaseURL:null,fallbackToGameServer:false});
  if(url==='https://static.test/assets/asset-manifest.json')return Response.json({files:[{path:'assets/rifle.glb',sha256:hash,bytes:bytes.length,group:'weapons'}]});
  if(url==='https://static.test/assets/rifle.glb?v='+hash.slice(0,12))return new Response(bytes);
  throw Error('Unexpected download: '+url);
 };
 const {fetchCachedAsset}=await import('./client/loading.js');
 assert.equal(await (await fetchCachedAsset('assets/rifle.glb')).text(),'asset data');
 assert.deepEqual(calls,['https://game.test/review/download-config.json','https://static.test/assets/asset-manifest.json','https://static.test/assets/rifle.glb?v='+hash.slice(0,12)]);
 `;
 const child=spawnSync(process.execPath,['--input-type=module','--eval',script],{cwd:new URL('../',import.meta.url),encoding:'utf8'});
 assert.equal(child.status,0,child.stderr||child.stdout);
});

test('installed bundles read local bytes before any delivery configuration or mirrored download',()=>{
 const script=`
 import assert from 'node:assert/strict';
 globalThis.document={baseURI:'http://127.0.0.1:17777/game/'};
 globalThis.location={href:document.baseURI};
 globalThis.__DUST2_PORTABLE__={bundledAssets:true};
 const calls=[];
 globalThis.fetch=async value=>{const url=String(value);calls.push(url);if(url.endsWith('bundle-manifest.json'))return Response.json({files:[{path:'assets/local.bin',sha256:'a'.repeat(64),bytes:5}]});if(url.endsWith('assets/local.bin'))return new Response('local');throw Error('Unexpected remote request: '+url);};
 const {fetchCachedAsset}=await import('./client/loading.js');
 const response=await fetchCachedAsset('assets/local.bin',{sha256:'a'.repeat(64),bytes:5});
 assert.equal(await response.text(),'local');
 assert.deepEqual(calls,['http://127.0.0.1:17777/game/bundle-manifest.json','http://127.0.0.1:17777/game/assets/local.bin']);
 `;
 const child=spawnSync(process.execPath,['--input-type=module','--eval',script],{cwd:new URL('../',import.meta.url),encoding:'utf8'});
 assert.equal(child.status,0,child.stderr||child.stdout);
});

test('Android installed optional assets read the game root configuration and keep bundled assets local',()=>{
 const script=`
 import assert from 'node:assert/strict';
 import {createHash} from 'node:crypto';
 globalThis.document={baseURI:'https://cs2.duskrain.cn/__installed__/index.html'};
 globalThis.location={href:document.baseURI};
 globalThis.__DUST2_PORTABLE__={bundledAssets:true};
 const bytes=new TextEncoder().encode('optional model'),hash=createHash('sha256').update(bytes).digest('hex'),calls=[];
 globalThis.fetch=async(value,options)=>{const url=String(value);calls.push({url,options});
  if(url.endsWith('/__installed__/bundle-manifest.json'))return Response.json({files:[{path:'assets/local.bin',sha256:'a'.repeat(64),bytes:5}]});
  if(url.endsWith('/__installed__/assets/local.bin'))return new Response('local');
  if(url==='https://cs2.duskrain.cn/download-config.json')return Response.json({schemaVersion:1,assetBaseURL:'https://downloads.test/release/assets/',fallbackToGameServer:false});
  if(url==='https://downloads.test/release/assets/optional.glb?v='+hash.slice(0,12))return new Response(bytes);
  throw Error('Unexpected request');
 };
 const {fetchCachedAsset}=await import('./client/loading.js');
 assert.equal(await (await fetchCachedAsset('assets/local.bin',{sha256:'a'.repeat(64),bytes:5})).text(),'local');
 assert.deepEqual(calls.map(c=>c.url),['https://cs2.duskrain.cn/__installed__/bundle-manifest.json','https://cs2.duskrain.cn/__installed__/assets/local.bin']);
 assert.equal(await (await fetchCachedAsset('assets/optional.glb',{sha256:hash,bytes:bytes.length})).text(),'optional model');
 assert.deepEqual(calls.slice(2).map(c=>c.url),['https://cs2.duskrain.cn/download-config.json','https://downloads.test/release/assets/optional.glb?v='+hash.slice(0,12)]);
 assert.equal(calls[2].options.mode,'same-origin');assert.equal(calls[2].options.cache,'no-store');
 assert.equal(calls[3].options.credentials,'omit');assert.equal(calls[3].options.mode,'cors');
 `;
 const child=spawnSync(process.execPath,['--input-type=module','--eval',script],{cwd:new URL('../',import.meta.url),encoding:'utf8'});
 assert.equal(child.status,0,child.stderr||child.stdout);
});
