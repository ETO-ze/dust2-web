import {PRIVATE_MOVEMENT_MODEL} from '../shared/ladder-movement.js';
import {isPerformanceMap} from '../shared/performance-map-pool.js';
export const PRIVATE_MAP_IDS=['de_dust2','de_mirage','de_inferno'];
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
export function privateConfig(config,pageURL){
 const page=new URL(pageURL),match=/\/play\/(de_[a-z0-9]+)\/$/.exec(page.pathname);
 const allowed=match && (PRIVATE_MAP_IDS.includes(match[1]) || (config?.flatOnly===true && page.pathname.startsWith('/perf/play/') && isPerformanceMap(match[1])));
 if(!allowed||config?.private!==true||config.id!==match[1]||config.mapId!==match[1])throw Error('私有地图入口与服务器配置不一致');
 for(const key of ['mapSignature','sourceSha256','physicsSha256','maskSha256','policySha256','navigationSha256','metadataSha256','jumpLinksSha256'])if(!hash(config[key]))throw Error('私有地图缺少有效签名：'+key);
 if(config.movementModel===PRIVATE_MOVEMENT_MODEL&&!hash(config.laddersSha256))throw Error('私有地图缺少梯子签名');
 if(![PRIVATE_MOVEMENT_MODEL,'source-air-private-v1'].includes(config.movementModel))throw Error('私有地图移动模型与客户端不一致');
 const result={...config};
 for(const key of ['metadataUrl','navUrl','physicsUrl','maskUrl','groupsUrl','policyUrl','renderUrl']){
  const url=new URL(config[key],page);
  const prefixes=[page.pathname.split('/play/')[0]+'/maps/'+config.id+'/',page.pathname+'maps/'+config.id+'/'];
  if(url.origin!==page.origin||!prefixes.some(prefix=>url.pathname.startsWith(prefix))||url.username||url.password)throw Error('地图资源地址不在私有库中');
  result[key]=url.href;
 }
 const socket=new URL(config.socketPath||'ws',page);socket.protocol=page.protocol==='https:'?'wss:':'ws:';
 if(socket.host!==page.host||socket.pathname!==page.pathname+'ws'||socket.username||socket.password)throw Error('私有对战连接地址无效');
 result.socketURL=socket.href;
 return Object.freeze(result);
}
export function privateCompatibilityError(message,config){
 if(!config)return null;
 return message.mapId!==config.mapId||message.mapSignature!==config.mapSignature||message.physicsSha256!==config.physicsSha256?'服务器地图或碰撞版本不同，请返回地图库刷新后重试。':null;
}
export function clientAssetManifest(manifest,privateMode=false){
 const files=manifest.files.filter(file=>file.group!=='sky'&&(!privateMode||
  (!['map','collision'].includes(file.group)&&!/(?:^|\/)assets\/(?:map-cs2|map-mobile|valve-dust2)\//.test(file.path))));
 if(files.length===manifest.files.length)return manifest;
 return {...manifest,files,totalBytes:files.reduce((n,f)=>n+f.bytes,0)};
}
export function privateMapMemoryReason({renderBytes,physicsBytes,deviceMemory=0,remainingHeap=Infinity}){
 if(!Number.isSafeInteger(renderBytes)||renderBytes<=0||!Number.isSafeInteger(physicsBytes)||physicsBytes<=0)return '地图清单大小无效，已停止载入。';
 if(renderBytes>512*1024*1024)return '此地图原始几何体积较大，完整对战仍在内存验收中；请先试玩 Mirage。';
 if(deviceMemory&&deviceMemory<=4&&renderBytes>180*1024*1024)return '当前设备内存预算不足，请使用电脑试玩这张原始精度地图。';
 if(renderBytes*3+physicsBytes*12>remainingHeap*.65)return '浏览器剩余内存不足，请关闭其他地图标签后重试。';
 return null;
}
