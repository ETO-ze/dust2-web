import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {PrivateMapTransport,inflateMapBlock} from '../client/private-map-transport.js';
import {validateMapTransport} from '../scripts/maps/transport-schema.mjs';
import {deduplicatePrivateImages} from '../client/private-map-loader.js';

const sha=value=>createHash('sha256').update(value).digest('hex');
function fixture(){
 const raw=[Buffer.from('precise vertices'.repeat(1000)),Buffer.from('untouched collision'.repeat(1000))],wire=raw.map(b=>gzipSync(b));let offset=0;
 const chunks=wire.map((b,i)=>{const chunk={offset,bytes:b.length,sha256:sha(b),decodedBytes:raw[i].length,decodedSha256:sha(raw[i])};offset+=raw[i].length;return chunk;});
 const file={path:'raw/map.bin',bytes:offset,sha256:sha(Buffer.concat(raw)),encoding:'gzip-chunks',chunks};
 const identity={id:'de_inferno',sourceSha256:sha('source'),originalRenderGltfSha256:sha('gltf')};
 const manifest={schemaVersion:1,...identity,files:[file]},items=new Map();let calls=0;
 const cache={match:async key=>items.get(key)?.clone(),put:async(key,response)=>items.set(key,response),delete:async key=>items.delete(key)};
 const options={identity,baseURL:'https://local.test/private/maps/de_inferno/transport/',cacheStorage:{open:async()=>cache},fetcher:async url=>{calls++;const i=chunks.findIndex(c=>url.endsWith(c.sha256+'.gz'));return new Response(wire[i]);}};
 return {raw,wire,file,manifest,identity,options,items,cache,calls:()=>calls};
}
test('gzip transport restores exact bytes; a new reader reuses persisted compressed blocks',async()=>{
 const f=fixture(),first=new PrivateMapTransport(f.manifest,f.options),progress=[];
 const bytes=await first.read('raw/map.bin',{onBytes:(n,t)=>progress.push([n,t])});
 assert.equal(sha(Buffer.from(bytes)),f.file.sha256);assert.equal(f.calls(),2);assert.equal(first.stats.verifiedBlocks,2);assert.equal(first.stats.cacheHits,0);
 const second=new PrivateMapTransport(f.manifest,f.options),again=await second.read('raw/map.bin');assert.equal(sha(Buffer.from(again)),f.file.sha256);assert.equal(f.calls(),2);assert.equal(second.stats.cacheHits,2);assert.equal(second.stats.networkBytes,0);
 assert.equal(progress.at(-1)[0],f.wire.reduce((s,b)=>s+b.length,0));assert.equal(progress.at(-1)[0],progress.at(-1)[1]);
});
test('partial persistent cache resumes only missing blocks and repairs a corrupted entry',async()=>{
 const f=fixture(),first=new PrivateMapTransport(f.manifest,f.options);await first.block(f.file,f.file.chunks[0],()=>{});
 await new PrivateMapTransport(f.manifest,f.options).read('raw/map.bin');assert.equal(f.calls(),2);
 const key=[...f.items.keys()][0];f.items.set(key,new Response(Buffer.alloc(f.wire[0].length),{headers:{'Content-Length':String(f.wire[0].length)}}));
 const reader=new PrivateMapTransport(f.manifest,f.options);assert.equal(sha(Buffer.from(await reader.read('raw/map.bin'))),f.file.sha256);assert.equal(f.calls(),3);assert.equal(reader.stats.cacheHits,1);
});
test('quota exhaustion preserves gameplay and never clears another cache',async()=>{
 const f=fixture();f.cache.put=async()=>{throw Error('QuotaExceededError');};const reader=new PrivateMapTransport(f.manifest,f.options);
 assert.equal(sha(Buffer.from(await reader.read('raw/map.bin'))),f.file.sha256);assert(reader.stats.cacheWriteFailures>=1);assert.equal(f.items.size,0);
});
test('corrupted network blocks and wrong restored bytes fail closed',async()=>{
 const f=fixture();f.options.fetcher=async()=>new Response(Buffer.alloc(f.wire[0].length));
 await assert.rejects(new PrivateMapTransport(f.manifest,f.options).block(f.file,f.file.chunks[0],()=>{}),/完整性/);assert.equal(f.items.size,0);
 await assert.rejects(inflateMapBlock(f.wire[0],{...f.file.chunks[0],decodedSha256:sha('wrong')}),/还原校验/);
 await assert.rejects(inflateMapBlock(f.wire[0],{...f.file.chunks[0],decodedBytes:4}),/长度/);
});
test('abort between block reads prevents a partial map being returned',async()=>{
 const f=fixture(),abort=new AbortController();f.options.signal=abort.signal;const original=f.options.fetcher;f.options.fetcher=async(...args)=>{const r=await original(...args);abort.abort();return r;};
 await assert.rejects(new PrivateMapTransport(f.manifest,f.options).read('raw/map.bin'),{name:'AbortError'});
});
test('transport is bound to original glTF, file hashes and contiguous bounded offsets',()=>{
 const f=fixture();assert.equal(validateMapTransport(f.manifest,f.identity).size,1);
 for(const edit of [m=>m.originalRenderGltfSha256=sha('other'),m=>m.files[0].path='raw/../secret',m=>m.files[0].chunks[1].offset++,m=>m.files[0].chunks[0].decodedBytes=4*1024*1024+1,m=>m.files.push(m.files[0])]){const m=structuredClone(f.manifest);edit(m);assert.throws(()=>validateMapTransport(m,f.identity));}
 assert.throws(()=>new PrivateMapTransport(f.manifest,f.options).file('raw/map.bin',{bytes:f.file.bytes,sha256:sha('other')}));
});
test('lossless image proof must bind exact RGBA dimensions and pixel hash',()=>{
 const f=fixture(),pixel=sha('pixel'),file={path:'raw/a.png',bytes:100,sha256:sha('png'),encoding:'webp-lossless',width:2,height:3,decodedFormat:'rgba8',pixelSha256:pixel,chunks:[{offset:0,bytes:50,sha256:sha('webp'),decodedBytes:24,decodedSha256:pixel}]};
 assert.equal(validateMapTransport({...f.manifest,files:[file]},f.identity).size,1);
 for(const changed of [{width:3},{pixelSha256:sha('different')},{path:'compiled/physics.f32'}])assert.throws(()=>validateMapTransport({...f.manifest,files:[{...file,...changed}]},f.identity));
});
test('image aliases share only byte-identical originals without altering nodes, materials or image indices',()=>{
 const f={bytes:12,sha256:sha('same')},files=new Map([['a.png',f],['b.png',f],['c.png',{...f,sha256:sha('different')}] ]),json={images:[{uri:'a.png'},{uri:'b.png'},{uri:'c.png'}],nodes:[{mesh:2}],textures:[{source:0,sampler:4},{source:1,sampler:4},{source:2}],materials:[{name:'keep',normalTexture:{index:0}},{normalTexture:{index:1}},{normalTexture:{index:2}}]};
 const previous=structuredClone(json);assert.equal(deduplicatePrivateImages(json,files),1);assert.deepEqual(json.images.map(i=>i.uri),['a.png','a.png','c.png']);for(const key of ['nodes','materials','textures'])assert.deepEqual(json[key],previous[key]);
});
test('identical pixels used as color and linear data never alias their GLTF texture state',()=>{
 const f={bytes:4,sha256:sha('white')},json={images:[{uri:'color.png'},{uri:'orm.png'}],textures:[{source:0},{source:1}],materials:[{pbrMetallicRoughness:{baseColorTexture:{index:0},metallicRoughnessTexture:{index:1}}}]};assert.equal(deduplicatePrivateImages(json,new Map([['color.png',f],['orm.png',f]])),0);assert.equal(json.images[1].uri,'orm.png');
});
