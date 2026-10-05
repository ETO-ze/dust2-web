import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {createServer} from 'node:http';
import {privateMapDownloads,privateMapDownloadURL,privateMapFetcher} from '../client/private-map-download.js';
import {PrivateMapTransport} from '../client/private-map-transport.js';

const base={id:'de_inferno',renderUrl:'https://game.test:8443/review/maps/de_inferno/render/map.gltf',
 socketURL:'wss://game.test:8443/review/play/de_inferno/ws'};
const delivery={mapBaseURL:'https://downloads.test/release/maps/',fallbackToGameServer:false};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');

test('map downloads move to the mirror while the websocket and original cache URLs stay stable',()=>{
 const config=privateMapDownloads(base,delivery);
 for(const source of ['https://game.test:8443/review/maps/de_inferno/',
  'https://game.test:8443/review/play/de_inferno/maps/de_inferno/']){
  assert.equal(privateMapDownloadURL(source+'physics.f32?v=abc',config).href,
   'https://downloads.test/release/maps/de_inferno/physics.f32?v=abc');
 }
 assert.equal(privateMapDownloadURL(base.renderUrl,config).href,'https://downloads.test/release/maps/de_inferno/render/map.gltf');
 assert.equal(config.socketURL,base.socketURL);
 assert.equal(config.renderUrl,base.renderUrl);
 for(const url of [base.socketURL,'https://game.test:8443/review/radars/de_inferno.png',
  'https://game.test/review/maps/de_inferno/map.json','https://other.test/review/maps/de_inferno/map.json'])
  assert.equal(privateMapDownloadURL(url,config).href,url);
});

test('a mirror outage does not send the large transfer to the game server by default',async()=>{
 const requested=[],config=privateMapDownloads(base,delivery);
 const reader=privateMapFetcher(config,{fetcher:async(url,options)=>{
  requested.push({url:String(url),options});return new Response('unavailable',{status:503});
 }});
 assert.equal((await reader(base.renderUrl,{cache:'no-store'})).status,503);
 assert.equal(requested.length,1);
 assert.equal(new URL(requested[0].url).host,'downloads.test');
 assert.equal(requested[0].options.credentials,'omit');
 assert.equal(requested[0].options.mode,'cors');
 const network=privateMapFetcher(config,{fetcher:async url=>{requested.push({url:String(url)});throw new TypeError('Failed to fetch');}});
 await assert.rejects(network(base.renderUrl),/Failed to fetch/);
 assert.equal(requested.length,2);
});

test('explicit fallback is bounded to availability errors and respects cancellation',async()=>{
 const calls=[],config=privateMapDownloads(base,{...delivery,fallbackToGameServer:true});
 const fallback=privateMapFetcher(config,{fetcher:async url=>{calls.push(String(url));return new Response('data',{status:calls.length===1?503:200});}});
 assert.equal((await fallback(base.renderUrl)).status,200);
 assert.deepEqual(calls,[privateMapDownloadURL(base.renderUrl,config).href,base.renderUrl]);
 const controller=new AbortController(),aborted=[];
 const reader=privateMapFetcher(config,{fetcher:async url=>{aborted.push(String(url));controller.abort();throw new TypeError('connection closed');}});
 await assert.rejects(reader(base.renderUrl,{signal:controller.signal}),{name:'AbortError'});
 assert.equal(aborted.length,1);
 for(const error of [new DOMException('cancelled','AbortError'),new Error('unrelated failure')]){
  let count=0;
  const noFallback=privateMapFetcher(config,{fetcher:async()=>{count++;throw error;}});
  await assert.rejects(noFallback(base.renderUrl),error);
  assert.equal(count,1);
 }
 const corrupt=privateMapFetcher(config,{fetcher:async url=>{calls.push(String(url));return new Response('wrong content');}});
 assert.equal(await (await corrupt(base.renderUrl)).text(),'wrong content');
 assert.equal(calls.length,3,'content verification must fail in the existing hash loader rather than retry the game server');
});

test('real HTTP mirror restores hash-verified blocks and survives changing download origins without redownloading',async t=>{
 const raw=Buffer.from('unchanged map geometry '.repeat(300)),wire=gzipSync(raw),hash=sha(wire),requests=[];
 const server=createServer((req,res)=>{requests.push(req.url);res.writeHead(200,{'Content-Length':wire.length,'Access-Control-Allow-Origin':'*'});res.end(wire);});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
 const original={id:'de_inferno',renderUrl:'http://127.0.0.1:1/review/maps/de_inferno/render/map.gltf',socketURL:'ws://127.0.0.1:1/review/play/de_inferno/ws'};
 const identity={id:'de_inferno',sourceSha256:sha('source'),originalRenderGltfSha256:sha('gltf')};
 const manifest={schemaVersion:1,...identity,files:[{path:'raw/map.bin',bytes:raw.length,sha256:sha(raw),encoding:'gzip-chunks',
  chunks:[{offset:0,bytes:wire.length,sha256:hash,decodedBytes:raw.length,decodedSha256:sha(raw)}]}]};
 const cached=new Map(),cacheNames=[],cache={match:async key=>cached.get(key)?.clone(),put:async(key,value)=>cached.set(key,value),delete:async key=>cached.delete(key)};
 const cacheStorage={open:async name=>{cacheNames.push(name);return cache;}};
 const options={identity,baseURL:new URL('../transport/',original.renderUrl),cacheStorage};
 const config=privateMapDownloads(original,{mapBaseURL:`http://127.0.0.1:${server.address().port}/release/maps/`});
 const first=new PrivateMapTransport(manifest,{...options,fetcher:privateMapFetcher(config)});
 assert.equal(sha(Buffer.from(await first.read('raw/map.bin'))),sha(raw));
 assert.deepEqual(requests,[`/release/maps/de_inferno/transport/${hash}.gz`]);
 const relocated=privateMapDownloads(original,{mapBaseURL:'https://another-download.test/next/maps/'});
 const second=new PrivateMapTransport(manifest,{...options,fetcher:privateMapFetcher(relocated,{fetcher:()=>{throw Error('cached objects must not hit the new mirror');}})});
 assert.equal(sha(Buffer.from(await second.read('raw/map.bin'))),sha(raw));
 assert.equal(second.stats.cacheHits,1);
 assert.equal(cacheNames[0],cacheNames[1]);
 assert([...cached.keys()].every(key=>new URL(key).host==='127.0.0.1:1'));
});
