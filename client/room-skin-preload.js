import { fetchCachedAsset, isAssetSaved } from './loading.js';
import { skinResources } from '../shared/room-cosmetics.js';
import { getSkin } from '../shared/skins.js';
import { AGENT_CATALOG,getAgent } from '../shared/agents.js';

export function readRoomAppearance(msg) {
  const approved=ids=>[...new Set((Array.isArray(ids)?ids:[]).slice(0,128).map(id=>getSkin(id)?.id).filter(Boolean))];
  const skinIds=approved(msg.skinIds);
  return {skinIds,activeSkinIds:approved(msg.activeSkinIds).filter(id=>skinIds.includes(id)).slice(0,10),
    carriedSkinIds:approved(msg.carriedSkinIds).filter(id=>skinIds.includes(id)),
    revision:typeof msg.revision==='string'&&/^[0-9a-f]{24}$/.test(msg.revision)?msg.revision:null,
    mode:msg.mode,agentIds:[...new Set((Array.isArray(msg.agentIds)?msg.agentIds:[]).filter(id=>getAgent(id)))].slice(0,AGENT_CATALOG.length)};
}

// Reserve weapons share a small decoding budget. All carried files are cached
// regardless; dropped/stored finishes never increase this GPU budget.
export function reserveWarmIds(carried,active,mobile) {
  const chosen=[],seen=new Set(active);
  let budget=(mobile?4:12)*1024*1024;
  for(const id of carried){
    const skin=getSkin(id);
    if(!skin||seen.has(skin.id))continue;
    const bytes=skin.bytes+(skin.animation?.bytes||0);
    if(bytes>budget)continue;
    chosen.push(skin.id);seen.add(skin.id);budget-=bytes;
    if(chosen.length>=(mobile?1:4))break;
  }
  return chosen;
}

export function queryRoomAppearance(url,room,{signal, Socket=WebSocket}={}) {
  signal?.throwIfAborted();
  return new Promise((resolve,reject) => {
    const socket = new Socket(url);
    const timer = setTimeout(() => finish(new Error('获取房间外观清单超时，请重试。')),10000);
    let settled = false;
    const cancel = () => finish(signal.reason);
    function finish(error,ids) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort',cancel);
      socket.close();
      if (error) reject(error); else resolve(ids);
    }
    signal?.addEventListener('abort',cancel,{once:true});
    socket.addEventListener('open',() => socket.send(JSON.stringify({type:'roomCosmetics',room})));
    socket.addEventListener('message',event => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }
      if (msg.type === 'roomCosmetics' && msg.room === room && Array.isArray(msg.skinIds)) {
        return finish(null,readRoomAppearance(msg));
      }
      // Older online servers only know the regular join protocol.
      if (msg.type === 'error' && msg.code === 'NOT_JOINED') return finish(null,readRoomAppearance({}));
      if (msg.type === 'error') finish(new Error(msg.message || '无法获取房间外观清单'));
    });
    socket.addEventListener('error',() => finish(new Error('无法连接房间外观服务')));
    socket.addEventListener('close',() => finish(new Error('房间外观连接中断')));
  });
}

export async function queryRoomSkins(url,room,options) {
  return (await queryRoomAppearance(url,room,options)).skinIds;
}

// Browsers without persistent Cache Storage can still reuse recent preloads
// during the next GLTF parse. Limit the fallback to a small amount of RAM.
const ephemeral = new Map();
let ephemeralBytes = 0;
function remember(item,response) {
  const limit = 16*1024*1024;
  if (item.bytes > limit || ephemeral.has(item.sha256)) return;
  while (ephemeralBytes + item.bytes > limit) {
    const [key,entry] = ephemeral.entries().next().value;
    ephemeral.delete(key); ephemeralBytes -= entry.bytes;
  }
  ephemeral.set(item.sha256,{response,bytes:item.bytes});
  ephemeralBytes += item.bytes;
}

export function takePreloadedSkin(item) {
  const entry = ephemeral.get(item.sha256);
  if (!entry) return null;
  ephemeral.delete(item.sha256); ephemeralBytes -= entry.bytes;
  return entry.response;
}

export async function preloadRoomSkins(ids,{signal,onProgress=()=>{},saved=isAssetSaved,fetchAsset=fetchCachedAsset,pageURL=document.baseURI,readyHashes}={}) {
  const items = skinResources(ids).filter(item=>!readyHashes?.has(item.sha256));
  const stats = {done:0,total:items.length,cached:0,downloadBytes:0};
  let next = 0;
  const controller = new AbortController();
  const cancel = () => controller.abort(signal.reason);
  signal?.throwIfAborted();signal?.addEventListener('abort',cancel,{once:true});
  async function worker() {
    while (next < items.length) {
      controller.signal.throwIfAborted();
      const item = items[next++];
      if (ephemeral.has(item.sha256) || await saved(item.sha256,item.bytes)) stats.cached++;
      else {
        let persistent = false,fromCache = false;
        const response = await fetchAsset(new URL(item.model,pageURL), {
          signal:controller.signal,sha256:item.sha256,bytes:item.bytes,
          onProgress:p => {persistent=p.cached; fromCache=p.fromCache;},
        });
        if (!response.ok) throw new Error('房间外观资源下载失败');
        if (!persistent) remember(item,response);
        if (fromCache) stats.cached++; else stats.downloadBytes += item.bytes;
      }
      stats.done++;
      onProgress({...stats});
    }
  }
  const workers = Array.from({length:Math.min(2,items.length)},worker);
  try {
    onProgress({...stats});
    await Promise.all(workers);
    controller.signal.throwIfAborted();
    return stats;
  } catch(error) {
    controller.abort(error);
    await Promise.allSettled(workers);
    throw error;
  } finally { signal?.removeEventListener('abort',cancel); }
}

// A join may need one refresh when another player changes equipment while
// assets are downloading. Keep the work completed by the first preparation.
export async function prepareRoomWeapons({active,carried,prepared,signal,warm,preload=preloadRoomSkins,onModel,onFiles}) {
  const hands=[...new Set(active)].filter(id=>!prepared.hands.has(id));
  for(const [index,id] of hands.entries()){
    signal.throwIfAborted();
    onModel?.(index,hands.length);
    await warm(id,signal);
    signal.throwIfAborted();
    prepared.hands.add(id);
    prepared.files.add(id);
  }
  const remaining=[...new Set(carried)].filter(id=>!prepared.files.has(id));
  const readyHashes=new Set(skinResources(prepared.files).map(item=>item.sha256));
  const files=await preload(remaining,{signal,readyHashes,onProgress:onFiles});
  signal.throwIfAborted();
  remaining.forEach(id=>prepared.files.add(id));
  return {...files,decoded:hands.length};
}
