import {readPrivateResource} from './private-map-loader.js';
import {validateMapTransport,transportBytes,transportObjectName} from '../scripts/maps/transport-schema.mjs';

const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');
const check=signal=>signal?.throwIfAborted();
export async function inflateMapBlock(bytes,chunk,{signal}={}){
 check(signal);const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
 const reader=stream.getReader(),output=new Uint8Array(chunk.decodedBytes);let offset=0;
 const abort=()=>reader.cancel(signal.reason).catch(()=>{});signal?.addEventListener('abort',abort,{once:true});
 try{while(true){check(signal);const {value,done}=await reader.read();check(signal);if(done)break;if(offset+value.byteLength>output.length)throw Error('地图分块解压长度超出清单');output.set(value,offset);offset+=value.byteLength;}if(offset!==output.length||await digest(output)!==chunk.decodedSha256)throw Error('地图分块还原校验失败');check(signal);return output;}
 finally{await reader.cancel().catch(()=>{});reader.releaseLock();signal?.removeEventListener('abort',abort);}
}

/** Small hash-addressed cache entries survive refresh and interrupted loads.
 * Quota/private-mode failures disable writes, never delete unrelated caches or
 * make a playable map fail. Large decoded map.bin is never cached or cloned. */
export class PrivateMapTransport{
 constructor(manifest,{identity,baseURL,signal,cacheStorage=globalThis.caches,fetcher=fetch}={}){
  this.files=validateMapTransport(manifest,identity);this.base=new URL(baseURL);this.signal=signal;this.fetcher=fetcher;this.cacheStorage=cacheStorage;this.cachePromise=null;this.writeEnabled=true;
  this.stats={networkBytes:0,cacheBytes:0,cacheHits:0,verifiedBlocks:0,cacheWriteFailures:0};
 }
 file(path,original){const entry=this.files.get(path);if(entry&&original&&(entry.bytes!==original.bytes||entry.sha256!==original.sha256))throw Error('加速资源与原始文件不一致');return entry;}
 bytes(path,fallback){const entry=this.files.get(path);return entry?transportBytes(entry):fallback;}
 async cache(){if(!this.cachePromise)this.cachePromise=Promise.resolve().then(()=>this.cacheStorage?.open('dust2-private-transport-v1:'+new URL('../../',this.base).pathname)).catch(()=>null);return this.cachePromise;}
 async block(file,chunk,onBytes){
  const {signal}=this;check(signal);const name=transportObjectName(file,chunk),url=new URL(name,this.base).href;
  const key=new URL('__private_transport_cache__/'+name,new URL('../../../',this.base)).href,cache=await this.cache();let data;
  const hit=await cache?.match(key).catch(()=>null);check(signal);
  if(hit){try{if(Number(hit.headers.get('Content-Length'))===chunk.bytes){data=await hit.arrayBuffer();if(data.byteLength===chunk.bytes&&await digest(data)===chunk.sha256){this.stats.cacheHits++;this.stats.cacheBytes+=data.byteLength;onBytes(data.byteLength);check(signal);return data;}}}catch(error){check(signal);}await cache.delete(key).catch(()=>{});}
  let received=0;
  data=await readPrivateResource(url,{signal,bytes:chunk.bytes,maxBytes:64*1024*1024,cache:'no-store',fetcher:this.fetcher,onBytes:loaded=>{this.stats.networkBytes+=loaded-received;received=loaded;onBytes(loaded);}});
  if(await digest(data)!==chunk.sha256)throw Error('地图资源完整性校验失败，请重试');check(signal);
  if(cache&&this.writeEnabled){try{await cache.put(key,new Response(data,{headers:{'Content-Type':'application/octet-stream','Content-Length':String(data.byteLength)}}));}catch{this.writeEnabled=false;this.stats.cacheWriteFailures++;}}
  check(signal);return data;
 }
 async read(path,{onBytes=()=>{}}={}){
  const file=this.files.get(path);if(!file)throw Error('地图加速资源缺失');const totals=new Array(file.chunks.length).fill(0),total=transportBytes(file);
  const report=(i,n)=>{totals[i]=n;onBytes(totals.reduce((a,b)=>a+b,0),total);};
  if(file.encoding==='webp-lossless')return this.block(file,file.chunks[0],n=>report(0,n));
  if(typeof DecompressionStream!=='function')throw Error('浏览器不支持地图分块解压，请更新浏览器后重试');
  const output=new Uint8Array(file.bytes);let next=0;
  // Two bounded blocks overlap network / native asynchronous decompression.
  // There is never a second full-size geometry ArrayBuffer.
  await Promise.all(Array.from({length:Math.min(2,file.chunks.length)},async()=>{while(next<file.chunks.length){check(this.signal);const i=next++,chunk=file.chunks[i],wire=await this.block(file,chunk,n=>report(i,n)),decoded=await inflateMapBlock(wire,chunk,{signal:this.signal});output.set(decoded,chunk.offset);this.stats.verifiedBlocks++;}}));
  check(this.signal);return output.buffer;
 }
}
