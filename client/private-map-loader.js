import {Texture} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';

const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const filename=value=>typeof value==='string'&&value.length>0&&value!=='.'&&value!=='..'&&!/[\\/%\x00-\x1f?#]/.test(value);
export function privateRenderManifest(manifest,config){
 if(manifest?.schemaVersion!==1||manifest.id!==config.id||manifest.sourceSha256!==config.sourceSha256||!Array.isArray(manifest.files)||!manifest.files.length||manifest.files.length>4096)throw Error('原图资源清单与服务器版本不一致');
 const files=new Map();
 for(const file of manifest.files){if(!filename(file.path)||!Number.isSafeInteger(file.bytes)||file.bytes<=0||file.bytes>512*1024*1024||!hash(file.sha256)||files.has(file.path))throw Error('原图资源清单无效');files.set(file.path,{...file});}
 if(!files.has('map.gltf'))throw Error('原图资源清单缺少场景');return files;
}
export function privateRenderDependencies(json,files){
 const result=new Set(['map.gltf']);
 for(const buffer of json.buffers||[]){if(!filename(buffer.uri)||!files.has(buffer.uri)||files.get(buffer.uri).bytes!==buffer.byteLength)throw Error('原图几何依赖与资源清单不一致');result.add(buffer.uri);}
 for(const source of json.images||[]){if(!filename(source.uri)||!files.has(source.uri))throw Error('原图贴图依赖不在资源清单中');result.add(source.uri);}
 return [...result];
}
export function deduplicatePrivateImages(json,files){
 const canonical=new Map(),usage=new Map();let duplicates=0;
 const colorSlots=new Set(['baseColorTexture','emissiveTexture','diffuseTexture','specularGlossinessTexture','sheenColorTexture','specularColorTexture']);
 const visit=value=>{for(const [name,child]of Object.entries(value||{})){if(!child||typeof child!=='object')continue;if(name.endsWith('Texture')&&Number.isInteger(child.index)){const image=json.textures?.[child.index]?.source;if(image!==undefined){if(!usage.has(image))usage.set(image,new Set());usage.get(image).add(colorSlots.has(name)?'srgb':'linear');}}else visit(child);}};
 for(const material of json.materials||[])visit(material);
 for(const [index,source]of (json.images||[]).entries()){const file=files.get(source.uri);if(!file)throw Error('原图贴图依赖不在资源清单中');const roles=usage.get(index);if(!roles||roles.size!==1)continue;const key=file.sha256+':'+file.bytes+':'+[...roles][0];if(canonical.has(key)){if(source.uri!==canonical.get(key))duplicates++;source.uri=canonical.get(key);}else canonical.set(key,source.uri);}
 return duplicates;
}

/** One destination buffer, no Response.clone, Cache API copy or large SHA copy.
 * Timeout measures lack of incoming bytes, not the whole transfer duration. */
export async function readPrivateResource(url,{signal,bytes=0,onBytes=()=>{},idleMs=45000,fetcher=fetch,maxBytes=512*1024*1024,cache='default'}={}){
 signal?.throwIfAborted();const abort=new AbortController();let timer,reader,offset=0;
 const cancel=()=>abort.abort(signal.reason),touch=()=>{clearTimeout(timer);timer=setTimeout(()=>abort.abort(Error('原图下载长时间没有数据，请检查连接后重试')),idleMs);};
 signal?.addEventListener('abort',cancel,{once:true});touch();
 try{
  const response=await fetcher(url,{signal:abort.signal,cache});
  if(!response.ok||response.type==='opaque')throw Error('原图下载失败 ('+response.status+')');
  const header=Number(response.headers.get('content-length')),compressed=!!response.headers.get('content-encoding');
  if(bytes&&header&&!compressed&&header!==bytes)throw Error('原图文件长度与版本清单不一致');
  const length=bytes||(!compressed&&header)||0;if(length>maxBytes)throw Error('原图文件超过安全读取预算');
  touch();onBytes(0,length);
  reader=response.body?.getReader();
  if(!reader){const result=await response.arrayBuffer();if(result.byteLength>maxBytes||(bytes&&result.byteLength!==bytes))throw Error('原图文件不完整');onBytes(result.byteLength,result.byteLength);return result;}
  const output=length?new Uint8Array(length):null,chunks=[];
  while(true){abort.signal.throwIfAborted();const {done,value}=await reader.read();if(done)break;touch();offset+=value.byteLength;if(offset>maxBytes||(output&&offset>output.length))throw Error('原图文件长度超出清单');if(output)output.set(value,offset-value.byteLength);else chunks.push(value);onBytes(offset,length||offset);}
  abort.signal.throwIfAborted();if(length&&offset!==length)throw Error('原图文件下载不完整');
  if(output)return output.buffer;
  const result=new Uint8Array(offset);let position=0;for(const chunk of chunks){result.set(chunk,position);position+=chunk.byteLength;}return result.buffer;
 }catch(error){abort.abort(error);await reader?.cancel(error).catch(()=>{});throw signal?.aborted?signal.reason:abort.signal.reason||error;}
 finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel);reader?.releaseLock();}
}

export class PrivateMapProgress{
 constructor(onProgress=()=>{},now=()=>performance.now()){this.onProgress=onProgress;this.now=now;this.started=now();this.lastTick=0;this.lastRate=this.started;this.lastBytes=0;this.rate=0;this.files=new Map();this.decoded=0;this.decodeTasks=0;this.activeDecodes=0;this.decodeTaskMs=0;this.maxDecodeMs=0;this.finished=false;this.phase='map-download';}
 plan(key,bytes=0,kind='file'){if(!this.files.has(key))this.files.set(key,{bytes,loaded:0,complete:false,requested:false,kind});}
 begin(key){const f=this.files.get(key);f.requested=true;this.current=key;this.emit(true);}
 bytes(key,loaded,total){const f=this.files.get(key);f.loaded=loaded;if(!f.bytes&&total)f.bytes=total;this.emit();}
 done(key){this.files.get(key).complete=true;this.lastDownloadAt=this.now();this.emit(true);}
 decodeStart(){this.activeDecodes++;this.decodeTasks++;this.emit();return this.now();}
 decodeEnd(start,success){this.activeDecodes--;if(success)this.decoded++;const elapsed=this.now()-start;this.decodeTaskMs+=elapsed;this.maxDecodeMs=Math.max(this.maxDecodeMs,elapsed);this.emit(true);}
 finish(){for(const [key,f]of this.files)if(!f.requested)this.files.delete(key);this.finished=true;this.phase='map-assemble';this.emit(true);}
 snapshot(){const files=[...this.files.values()];return{phase:this.phase,bytes:files.reduce((n,f)=>n+f.loaded,0),total:files.reduce((n,f)=>n+f.bytes,0),complete:files.filter(f=>f.complete).length,count:files.length,decoded:this.decoded,textureCount:files.filter(f=>f.kind==='texture').length,activeDecodes:this.activeDecodes,rate:this.rate,elapsedMs:Math.round(this.now()-this.started),downloadSpanMs:Math.round((this.lastDownloadAt||this.started)-this.started),decodeTaskMs:Math.round(this.decodeTaskMs),maxDecodeMs:Math.round(this.maxDecodeMs),pending:[...this.files].filter(([,f])=>f.requested&&!f.complete).sort((a,b)=>(b[1].bytes-b[1].loaded)-(a[1].bytes-a[1].loaded)).slice(0,3).map(([name,f])=>({name,kind:f.kind,loaded:f.loaded,bytes:f.bytes})),finished:this.finished};}
 emit(force=false){const now=this.now();if(!force&&now-this.lastTick<100)return;this.lastTick=now;const p=this.snapshot();if(now-this.lastRate>350){this.rate=(p.bytes-this.lastBytes)/((now-this.lastRate)/1000);this.lastRate=now;this.lastBytes=p.bytes;}p.rate=this.rate;const requested=[...this.files.values()].filter(file=>file.requested),waiting=requested.length>0&&requested.every(file=>file.complete);const label=p.finished?'原图读取完成，正在组装场景':waiting?'解码原版贴图 '+p.decoded+' / '+p.textureCount:'下载原图资源 · 贴图已解码 '+p.decoded+' / '+p.textureCount;this.onProgress(label,{...p,phase:p.finished?'map-assemble':waiting?'map-decode':'map-download'});}
}

export async function decodePrivateImage(blob,{signal,timeoutMs=45000,decode=globalThis.createImageBitmap}={}){
 signal?.throwIfAborted();if(typeof decode!=='function')throw Error('当前浏览器不支持原图贴图解码，请升级 Chrome、Edge 或安卓系统 WebView 后重试');let expired=false,timer,abort;
 const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{expired=true;reject(Error('原版贴图解码超时，请关闭其他地图页面后重试'));},timeoutMs);abort=()=>{expired=true;reject(signal.reason);};signal?.addEventListener('abort',abort,{once:true});});
 try{return await Promise.race([decode(blob,{premultiplyAlpha:'none',colorSpaceConversion:'none'}).then(bitmap=>{if(expired||signal?.aborted){bitmap.close();throw signal?.reason||Error('贴图解码已取消');}return bitmap;}),deadline]);}
 finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}

/** Separate private-map loader: preserve original image pixels and keep at most
 * four image transfers/decodes alive. Shared weapon loading is unchanged. */
export function privateGLTFLoader(manager,{signal,files,baseURL,progress,transport=null,fetcher=fetch,onFailure=()=>{}}){
 if(typeof globalThis.createImageBitmap!=='function')throw Error('当前浏览器不支持原图贴图解码，请升级 Chrome、Edge 或安卓系统 WebView 后重试');
 const loader=new GLTFLoader(manager),base=new URL(baseURL),pending=[],loadedTextures=new Set();let active=0,failure=null;
 const parse=loader.parseAsync.bind(loader);loader.parseAsync=(...args)=>parse(...args).catch(error=>{throw failure||signal?.reason||error;});
 loader.disposePrivateTextures=()=>{for(const texture of loadedTextures){texture.dispose();texture.image?.close?.();}loadedTextures.clear();};
 const resolve=value=>{const url=new URL(value,base);if(url.origin!==base.origin||new URL('.',url).href!==base.href||url.search||url.hash)throw Error('原图依赖路径越过当前地图');const name=decodeURIComponent(url.pathname.split('/').pop()),file=files.get(name);if(!file)throw Error('原图依赖未列入资源清单');url.searchParams.set('v',file.sha256);return{url:url.href,name,file};};
 const fail=error=>{failure||=error;onFailure(failure);};
 const read=async value=>{signal?.throwIfAborted();if(failure)throw failure;const item=resolve(value);progress.begin(item.name);const onBytes=(loaded,total)=>progress.bytes(item.name,loaded,total),entry=transport?.file('raw/'+item.name,item.file);const bytes=entry?await transport.read('raw/'+item.name,{onBytes}):await readPrivateResource(item.url,{signal,bytes:item.file.bytes,onBytes,fetcher});progress.done(item.name);return bytes;};
 const pump=()=>{while(active<4&&pending.length){const job=pending.shift();active++;job.work().then(job.resolve,job.reject).finally(()=>{active--;pump();});}};
 const schedule=work=>new Promise((resolve,reject)=>{pending.push({work,resolve,reject});pump();});
 loader.register(parser=>{
  parser.fileLoader.load=(url,onLoad,_onProgress,onError)=>{manager.itemStart(url);read(url).then(onLoad,error=>{fail(error);manager.itemError(url);onError?.(error);}).finally(()=>manager.itemEnd(url));};
  parser.textureLoader={load(url,onLoad,_onProgress,onError){manager.itemStart(url);progress.begin(resolve(url).name);schedule(async()=>{
   let bitmap;try{const entry=transport?.file('raw/'+resolve(url).name),bytes=await read(url),blob=new Blob([bytes],{type:entry?.encoding==='webp-lossless'?'image/webp':'image/png'}),start=progress.decodeStart();try{bitmap=await decodePrivateImage(blob,{signal});if(entry?.encoding==='webp-lossless'&&(bitmap.width!==entry.width||bitmap.height!==entry.height))throw Error('原图贴图解码尺寸不一致');progress.decodeEnd(start,true);}catch(error){progress.decodeEnd(start,false);throw error;}const texture=new Texture(bitmap);texture.needsUpdate=true;loadedTextures.add(texture);return texture;}catch(error){bitmap?.close();fail(error);throw error;}
  }).then(onLoad,error=>{manager.itemError(url);onError?.(error);}).finally(()=>manager.itemEnd(url));}};
  return{name:'PRIVATE_ORIGINAL_MAP_TRANSPORT',afterRoot(result){if(failure){const geometries=new Set(),materials=new Set();result.scene.traverse(object=>{if(object.geometry)geometries.add(object.geometry);for(const material of [].concat(object.material||[]))materials.add(material);});geometries.forEach(geometry=>geometry.dispose());materials.forEach(material=>material.dispose());loader.disposePrivateTextures();throw failure;}}};
 });return loader;
}
