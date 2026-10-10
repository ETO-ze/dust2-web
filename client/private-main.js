import {configurePrivateMap} from '../shared/private-map-context.js';
import {privateConfig} from './private-game-config.js';
import {MIRAGE_JUMP_LINKS} from '../shared/private-map-jump-links.js';
import {initDownloadOrigin} from './download-origin.js';
import {privateMapDownloads,privateMapFetcher} from './private-map-download.js';

async function bootstrap(){
 const request=async url=>{const r=await fetch(url,{cache:'no-store'});if(!r.ok)throw Error('私有地图配置暂不可用 ('+r.status+')');return r.json();};
 const originalConfig=privateConfig(await request(new URL('private-map.json',location.href)),location.href);
 const delivery=await initDownloadOrigin({configURL:new URL('../../../download-config-1.3.0.json',originalConfig.renderUrl),pageURL:location.href});
 const config=privateMapDownloads(originalConfig,delivery),mapFetch=privateMapFetcher(config);
 const jumpLinks=config.id==='de_mirage'?MIRAGE_JUMP_LINKS:[];
 const jumpDigest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(jumpLinks)))),byte=>byte.toString(16).padStart(2,'0')).join('');
 if(config.jumpLinksSha256!==jumpDigest)throw Error('私有地图跳点与服务器版本不同');
 const verifiedJSON=async(url,expected,label)=>{const r=await mapFetch(url,{cache:'no-store'});if(!r.ok)throw Error(label+'暂不可用');const bytes=await r.arrayBuffer();const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');if(hash!==expected)throw Error(label+'与服务器版本不同');return JSON.parse(new TextDecoder().decode(bytes));};
 const [meta,nav]=await Promise.all([verifiedJSON(config.metadataUrl,config.metadataSha256,'出生与包点信息'),verifiedJSON(config.navUrl,config.navigationSha256,'导航')]);
 if(meta.id!==config.id||meta.public!==false||meta.sourceSha256!==config.sourceSha256)throw Error('原始地图版本与服务器不一致');
 const map=configurePrivateMap(meta,nav,config);
 const radarBase=new URL('../../../radars/',config.renderUrl),transforms=await request(new URL('transforms.json',radarBase));
 const radar=transforms[map.id];if(!radar||![radar.pos_x,radar.pos_y,radar.scale].every(Number.isFinite))throw Error('地图雷达标定缺失');
 map.overview={...radar,size:1024,image:new URL(map.id+'.png',radarBase).href};
 map.version='CS2 private '+meta.sourceBuild+' / '+config.mapSignature.slice(0,12);
 map.labels=[...Object.entries(map.sites).map(([text,p])=>({...p,text})),...['CT','T'].map(team=>({...map.spawns[team][0],text:team+' SPAWN'}))];
 globalThis.__DUST2_PRIVATE_MAP__=config;
 document.body.classList.add('private-game');document.title=map.name+(config.publicPool?' · DUSKRAIN 战术对战':' · 私有对战测试');
 for(const card of document.querySelectorAll('[data-map-id]')){const selected=card.dataset.mapId===map.id;card.classList.toggle('selected',selected);card.setAttribute('aria-pressed',String(selected));}
 for(const label of document.querySelectorAll('.selected-map-name'))label.textContent=map.name.toUpperCase();
 for(const el of document.querySelectorAll('.hero-copy h1,.loading-map-title h1'))el.textContent=map.name.toUpperCase();
 for(const el of document.querySelectorAll('.map-subtitle,.loading-location'))el.textContent=map.nameZh;
 const mapLabel=document.querySelector('.play-bar>span:nth-child(2)');if(mapLabel)mapLabel.textContent=map.name.toUpperCase()+' · '+map.nameZh;
 const region=document.querySelector('.match-heading .region');if(region)region.textContent=map.name.toUpperCase();
 const pauseHeading=document.querySelector('#pause-menu .eyebrow');if(pauseHeading)pauseHeading.textContent=map.name.toUpperCase()+' / IN MATCH';
 const boardHeading=document.querySelector('#scoreboard .board-heading h2');if(boardHeading){boardHeading.replaceChildren(document.createTextNode(map.name.toUpperCase()+' '));const label=document.createElement('small');label.textContent='战况';boardHeading.append(label);}
 if(!config.publicPool)for(const el of document.querySelectorAll('.map-emblem img,.loading-tactical img')){el.src=map.overview.image;el.alt=map.name+' 战术地图';}
 const banner=document.querySelector('.loading-map-title>p');if(banner)banner.textContent=config.publicPool?'A、B 双爆破点布局，中路连接多个攻防区域。':'私有原始地图联机测试。按图加载，规则仍由服务器计算。';
 const cover=new URL('../../../previews/'+map.id+'.png',config.renderUrl).href;
 if(!config.publicPool)document.documentElement.style.setProperty('--loading-map-cover',`url(${JSON.stringify(cover)})`);
 const style=document.createElement('style');style.textContent=`body.private-game .loading-image,body.private-game .menu-photo{background-image:url(${JSON.stringify(cover)})}body.private-game .map-showcase{background-image:none}
 body.private-game .private-map-switch{display:inline-flex;gap:12px;align-items:center;justify-content:center;min-height:40px;padding:9px 16px;border:1px solid #8e7950;background:#26332d;color:#f3d995;text-decoration:none;font-size:12px;white-space:nowrap;font-weight:650}
 body.private-game .play-bar>.private-map-switch{margin-left:auto}body.private-game .private-map-switch:hover{background:#35443a}body.private-game .private-map-switch:focus-visible{outline:2px solid #f3d995;outline-offset:3px}body.private-game .private-map-switch span{font-size:10px;font-weight:400;color:#cbd2bd}
 body.private-game .pause-map-switch{width:100%;min-height:42px;margin-top:5px}body.private-game .pause-actions{flex-wrap:wrap}
 @media(max-width:760px){body.private-game .private-map-switch{min-height:36px;padding:7px 11px;font-size:11px}body.private-game .play-bar>.private-map-switch span{display:none}body.private-game .play-bar{gap:12px;flex-wrap:wrap}body.private-game .play-bar>span:nth-child(2){max-width:42vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}}
 `;document.head.append(style);
 for(const back of document.querySelectorAll('[data-map-library]'))back.href=new URL('../../',location.href).href;
 return import('./main.js');
}
export const ready=bootstrap().catch(error=>{console.error(error);const status=document.getElementById('menu-status');if(status)status.textContent='无法启动地图：'+error.message;for(const id of ['start-button','join-button']){const button=document.getElementById(id);if(button)button.disabled=true;}throw error;});
// Private HTML uses this module directly; keep its rejection handled as well.
ready.catch(()=>{});
