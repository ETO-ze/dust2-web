import { DefaultLoadingManager } from 'three';
const blobs=new Map(),inflight=new Map();let manifestMemory=null,manifestChecked=false;
const base=()=>new URL('.',document.baseURI),absolute=value=>new URL(value,document.baseURI);
const canonical=value=>{const u=absolute(value);return u.origin+u.pathname;};
const cacheNames=()=>({assets:`dust2-assets-v1:${base().pathname}`,meta:`dust2-meta-v1:${base().pathname}`});
const hashKey=hash=>new URL(`__asset_cache__/sha256/${hash}`,base()).href;
const indexKey=url=>new URL(`__asset_cache__/url/${encodeURIComponent(absolute(url).href)}`,base()).href;
const manifestURL=()=>new URL('assets/asset-manifest.json',base()).href;
const check=signal=>{if(signal?.aborted)throw signal.reason||new DOMException('已取消','AbortError');};
const digest=async data=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),b=>b.toString(16).padStart(2,'0')).join('');
const changed=()=>{if(typeof window!=='undefined'&&typeof CustomEvent!=='undefined')window.dispatchEvent(new CustomEvent('dust2-cache-change'));};
async function stores(){try{if(!globalThis.caches)return null;const n=cacheNames();return{assets:await caches.open(n.assets),meta:await caches.open(n.meta)};}catch{return null;}}
export function assetURL(value){return blobs.get(canonical(value))||value;}
export function releaseDownloads(){for(const b of blobs.values())URL.revokeObjectURL(b);blobs.clear();}
export function useDownloadedAssets(manager=DefaultLoadingManager){manager.setURLModifier(assetURL);}
export async function isAssetSaved(sha256,bytes){const cache=await stores();if(!cache||!sha256)return false;const hit=await cache.assets.match(hashKey(sha256));return !!hit&&Number(hit.headers.get('x-dust2-bytes'))===bytes;}

/** SHA-keyed immutable assets. Without a supplied hash, the computed SHA is
 * indexed by URL; use sha256 or a versioned URL when optional content changes.
 * onProgress receives {loaded,total,fromCache,cached}, in decoded bytes. */
function pendingResult(promise,signal){
  if(!signal)return promise;
  return new Promise((resolve,reject)=>{const abort=()=>reject(signal.reason||new DOMException('已取消','AbortError'));signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();promise.then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));});
}
export async function fetchCachedAsset(value,options={}){
  check(options.signal);const settings={...options};
  if(!settings.sha256){
    const manifest=manifestChecked?manifestMemory:await loadManifest({signal:settings.signal}).catch(error=>{check(settings.signal);return null;});
    const file=manifest?.files.find(f=>canonical(f.path)===canonical(value));
    if(file){settings.sha256=file.sha256;settings.bytes??=file.bytes;}
  }
  const key=canonical(value),existing=inflight.get(key);
  if(existing){
    try{const response=await pendingResult(existing,settings.signal);check(settings.signal);
      if((!settings.sha256||response.headers.get('x-dust2-sha256')===settings.sha256.toLowerCase())&&(!Number.isFinite(settings.bytes)||Number(response.headers.get('x-dust2-bytes'))===settings.bytes)){
        const n=Number(response.headers.get('x-dust2-bytes'));settings.onProgress?.({loaded:n,total:n,fromCache:true,cached:true});return response.clone();}}
    catch(error){check(settings.signal);}
  }
  const promise=readCachedAsset(value,settings);inflight.set(key,promise);
  try{return(await promise).clone();}finally{if(inflight.get(key)===promise)inflight.delete(key);}
}
async function readCachedAsset(value,{sha256,bytes,signal,onProgress}={}){
  check(signal);const url=absolute(value);url.hash='';
  if(sha256&&!/^[a-f\d]{64}$/i.test(sha256))throw new Error('无效的资源 SHA-256');
  sha256=sha256?.toLowerCase();if(sha256)url.searchParams.set('v',sha256.slice(0,12));
  const cache=await stores();let expected=sha256;
  if(!expected&&cache){const hit=await cache.meta.match(indexKey(url));if(hit)expected=(await hit.json()).sha256;}
  if(expected&&cache){const hit=await cache.assets.match(hashKey(expected)),length=Number(hit?.headers.get('x-dust2-bytes'));
    if(hit&&(!Number.isFinite(bytes)||length===bytes)){check(signal);onProgress?.({loaded:length,total:length,fromCache:true,cached:true});return hit;}}
  const response=await fetch(url,{signal,cache:sha256?'force-cache':'default'});
  if(!response.ok||response.type==='opaque')throw new Error(`资源下载失败 (${response.status})：${url.pathname.split('/').pop()}`);
  if(response.headers.get('content-type')?.includes('text/html')&&!url.pathname.endsWith('.html'))throw new Error(`资源地址返回了网页：${url.pathname.split('/').pop()}`);
  const chunks=[];let received=0;const reader=response.body?.getReader();
  try{if(reader){while(true){check(signal);const {done,value}=await reader.read();if(done)break;chunks.push(value);received+=value.byteLength;onProgress?.({loaded:received,total:bytes||received,fromCache:false,cached:false});}}
    else{const value=new Uint8Array(await response.arrayBuffer());chunks.push(value);received=value.byteLength;}}
  catch(error){await reader?.cancel(error).catch(()=>{});throw error;}
  check(signal);if(Number.isFinite(bytes)&&received!==bytes)throw new Error(`资源不完整：${url.pathname.split('/').pop()}，请重试`);
  const blob=new Blob(chunks,{type:response.headers.get('content-type')||'application/octet-stream'}),actual=await digest(await blob.arrayBuffer());
  check(signal);if(sha256&&actual!==sha256)throw new Error(`资源校验失败：${url.pathname.split('/').pop()}，请重试`);
  const headers=new Headers(response.headers);headers.delete('content-encoding');headers.delete('transfer-encoding');headers.set('content-length',String(received));
  headers.set('x-dust2-sha256',actual);headers.set('x-dust2-bytes',String(received));headers.set('x-dust2-asset-url',url.href);
  const result=new Response(blob,{status:200,headers});let cached=false;
  if(cache){try{await cache.assets.put(hashKey(actual),result.clone());await cache.meta.put(indexKey(url),new Response(JSON.stringify({sha256:actual,bytes:received}),{headers:{'content-type':'application/json'}}));cached=true;changed();}
    catch(error){console.warn('资源已加载，但浏览器未保存持久缓存：',error.name||error.message);}}
  check(signal);onProgress?.({loaded:received,total:bytes||received,fromCache:false,cached});return result;
}

async function loadManifest({signal,refresh=true}={}){
  check(signal);if(!refresh&&manifestMemory)return manifestMemory;const cache=await stores();
  if(!refresh&&cache){const hit=await cache.meta.match(manifestURL());if(hit){manifestMemory=await hit.json();return manifestMemory;}}
  try{const response=await fetch(manifestURL(),{cache:'no-cache',signal});if(!response.ok)throw new Error(`资源清单加载失败 (${response.status})`);
    const manifest=await response.clone().json();
    if(!Array.isArray(manifest.files)||!manifest.files.every(f=>typeof f.path==='string'&&Number.isSafeInteger(f.bytes)&&f.bytes>=0&&/^[a-f\d]{64}$/i.test(f.sha256)))throw new Error('资源清单格式错误');
    manifestMemory=manifest;manifestChecked=true;try{await cache?.meta.put(manifestURL(),response.clone());}catch{}return manifest;
  }catch(error){check(signal);const hit=await cache?.meta.match(manifestURL());if(hit){manifestMemory=await hit.json();manifestChecked=true;return manifestMemory;}throw error;}
}

async function collectAssets({signal,onProgress,makeBlobs=false}={}){
  if(makeBlobs)releaseDownloads();const controller=new AbortController(),parent=signal,abort=()=>controller.abort(parent?.reason);
  parent?.addEventListener('abort',abort,{once:true});if(parent?.aborted)abort();signal=controller.signal;let workers=[];
  try{const manifest=await loadManifest({signal}),total=manifest.files.reduce((n,f)=>n+f.bytes,0);
    let next=0,complete=0,bytes=0,lastBytes=0,lastTime=performance.now(),rate=0,cachedFiles=0;
    const tick=current=>{const now=performance.now(),elapsed=(now-lastTime)/1000;if(elapsed>.35){rate=(bytes-lastBytes)/elapsed;lastTime=now;lastBytes=bytes;}onProgress?.({bytes,total,complete,count:manifest.files.length,rate,current,cachedFiles});};tick('准备地图资源');
    workers=Array.from({length:2},async()=>{while(next<manifest.files.length){check(signal);const file=manifest.files[next++],url=absolute(file.path);url.searchParams.set('v',file.sha256.slice(0,12));let seen=0,fromCache=false;
      const response=await fetchCachedAsset(url,{sha256:file.sha256,bytes:file.bytes,signal,onProgress:p=>{bytes+=p.loaded-seen;seen=p.loaded;fromCache=p.fromCache;tick(file.group);}});
      if(makeBlobs)blobs.set(canonical(url),URL.createObjectURL(await response.blob()));if(fromCache)cachedFiles++;complete++;tick(file.group);
    }});await Promise.all(workers);if(makeBlobs)useDownloadedAssets();return manifest;
  }catch(error){controller.abort();await Promise.allSettled(workers);if(makeBlobs)releaseDownloads();throw error;}
  finally{parent?.removeEventListener('abort',abort);}
}
export async function downloadAssets(options={}){
  // A controlling worker can serve verified cache entries directly. Retaining
  // every compressed file as a second set of Blob URLs only increases the peak.
  const controlled=!!globalThis.navigator?.serviceWorker?.controller;
  return collectAssets({...options,makeBlobs:!controlled});
}
export async function saveBaseAssets(options={}){
  if(!await stores())throw new Error('此浏览器无法使用离线缓存，请使用 HTTPS 或本机地址');await collectAssets({...options,makeBlobs:false});
  const stats=await getAssetCacheStats();if(!stats.complete)throw new Error('浏览器存储空间不足或缓存未能保存，请释放空间后重试');return stats;
}
export async function getAssetCacheStats(){
  const cache=await stores(),manifest=await loadManifest({refresh:false}).catch(()=>null);
  const stats={supported:!!cache,bytes:0,count:0,baseBytes:0,baseCount:0,totalBytes:manifest?.files.reduce((n,f)=>n+f.bytes,0)||0,totalCount:manifest?.files.length||0,complete:false,persisted:false,usage:null,quota:null};
  if(cache){for(const key of await cache.assets.keys()){const r=await cache.assets.match(key);stats.bytes+=Number(r?.headers.get('x-dust2-bytes'))||0;stats.count++;}
    for(const file of manifest?.files||[]){const r=await cache.assets.match(hashKey(file.sha256.toLowerCase()));if(r&&Number(r.headers.get('x-dust2-bytes'))===file.bytes){stats.baseCount++;stats.baseBytes+=file.bytes;}}
    stats.complete=stats.totalCount>0&&stats.baseCount===stats.totalCount;}
  try{stats.persisted=await navigator.storage?.persisted?.()||false;const e=await navigator.storage?.estimate?.();stats.usage=e?.usage??null;stats.quota=e?.quota??null;}catch{}return stats;
}
export async function clearAssetCache(){const n=cacheNames();if(globalThis.caches)await Promise.all([caches.delete(n.assets),caches.delete(n.meta)]);manifestMemory=null;manifestChecked=false;changed();return getAssetCacheStats();}
