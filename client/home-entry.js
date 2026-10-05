import './style.css';
import './interface.css';
import './mobile-layout.css';
import './home-menu.css';
import {preferences} from './persistence.js';
import {mountLobby} from './lobby.js';
import {connectionTarget} from './connection-target.js';
import {PUBLIC_MAPS,publicMapForPage,publicMapPage} from '../shared/public-map-pool.js';
import {requestGameFullscreen} from '../shared/mobile-fullscreen.js';
import {initOffline} from './offline.js';
import {initHomeImages,hydrateHomeImages,prepareHomeMapImages} from './image-asset-url.js';

// Selecting a map never imports the renderer, physics or resource loaders.
const $=id=>document.getElementById(id);
let selected=publicMapForPage(location.href),runtime=null,booting=null,lobby=null,failed=false;
const installed=globalThis.__DUST2_PORTABLE__||location.pathname.includes('/__installed__/');
if(installed){
 hydrateHomeImages();prepareHomeMapImages('de_dust2');
 for(const card of document.querySelectorAll('[data-map-id]'))card.hidden=card.dataset.mapId!=='de_dust2';
 import('./main.js').catch(error=>{$('menu-status').textContent='客户端启动失败：'+error.message;});
}else{
 initOffline().catch(()=>{});
 const homeImages=initHomeImages();homeImages.catch(()=>{});
 $('nickname').value=preferences.getItem('dust2.name')||'Player';
 const room=new URL(location.href).searchParams.get('room');if(room)$('room-code').value=room.slice(0,12);
 function syncSelection(){
  for(const card of document.querySelectorAll('[data-map-id]')){const chosen=card.dataset.mapId===selected.id;card.classList.toggle('selected',chosen);card.setAttribute('aria-pressed',String(chosen));}
  for(const label of document.querySelectorAll('.selected-map-name'))label.textContent=selected.name;
  $('room-capacity-note').textContent=selected.id==='de_mirage'?'米拉吉：1 个共享房间 · 最多 10 名玩家':'最多 10 名玩家 · 人机填充空位';
  document.title=selected.name+' · DUSKRAIN 战术对战';
 }
 function mountSelectedLobby(){
  lobby?.dispose();
  const page=publicMapPage(location.href,selected.id);
  lobby=mountLobby({mapId:selected.id,connection:connectionTarget(page.href),onJoin:()=>{$('team').value='auto';activate('join');}});
 }
 function pick(id){
  if(failed){location.assign(publicMapPage(location.href,id));return;}
  if(booting&&!runtime)return;
  const next=PUBLIC_MAPS.find(map=>map.id===id);if(!next||next.id===selected.id)return;
  if(runtime){location.assign(publicMapPage(location.href,id));return;}
  selected=next;$('room-code').value='';syncSelection();mountSelectedLobby();
  $('menu-status').textContent='当前地图：'+selected.name+'。进入对局时加载地图资源。';
 }
 for(const card of document.querySelectorAll('[data-map-id]'))card.addEventListener('click',()=>pick(card.dataset.mapId));
 function unlockAudio(){
  if(runtime){runtime.unlockAudioFromHome();return;}
  if(globalThis.__DUSTII_BOOT_AUDIO_CONTEXT__){globalThis.__DUSTII_BOOT_AUDIO_CONTEXT__.resume().catch(()=>{});return;}
  const Context=window.AudioContext||window.webkitAudioContext;
  if(Context){try{const context=new Context({latencyHint:'interactive'});globalThis.__DUSTII_BOOT_AUDIO_CONTEXT__=context;context.resume().catch(()=>{});}catch{}}
 }
 async function prepare(){
  if(runtime)return runtime;
  if(booting)return booting;
  const fields=Object.fromEntries(['nickname','mode','bots','team','room-code'].map(id=>[id,$(id).value]));
  const primary=document.querySelector('[data-primary].selected')?.dataset.primary||'ak47';
  preferences.setItem('dust2.name',fields.nickname.trim()||'Player');
  const page=publicMapPage(location.href,selected.id,{room:fields['room-code'].trim()||null});
  history.replaceState(null,'',page);
  lobby?.dispose();lobby=null;
  $('menu-status').textContent='正在准备 '+selected.name+' 客户端…';
  for(const id of ['start-button','join-button'])$(id).disabled=true;
  booting=(async()=>{
   await homeImages;
   const module=selected.id==='de_mirage'?await (await import('./private-main.js')).ready:await import('./main.js');
   if(!module)throw Error('地图启动失败，请刷新重试');
   for(const [id,value]of Object.entries(fields))$(id).value=value;
   module.prepareHomeLoadout({team:fields.team,primary});
   runtime=module;syncSelection();return module;
  })();
  try{return await booting;}catch(error){
   failed=true;
   $('menu-status').textContent='启动失败：'+error.message+'。再次点击即可刷新重试，已有缓存会保留。';
   throw error;
  }finally{for(const id of ['start-button','join-button'])$(id).disabled=false;}
 }
 async function activate(action){
  if(failed){location.reload();return;}
  if(booting&&!runtime)return;
  if(action==='join'&&!$('room-code').value.trim()){$('menu-status').textContent='请输入房间码，或在联机大厅选择可加入的房间。';return;}
  if(action==='start'||action==='join'){
   unlockAudio();
   if(matchMedia('(pointer: coarse)').matches&&preferences.readJSON('dust2.fullscreen.v1').automatic!==false)requestGameFullscreen().catch(()=>{});
  }
  try{const game=await prepare();if(action==='start'||action==='join'){prepareHomeMapImages(selected.id);game.startFromHome(action==='join');}else game.openHomePanel(action);}catch{}
 }
 // Capture prevents a lazy-loaded runtime from handling the same first click twice.
 const actions={'start-button':'start','join-button':'join','menu-settings':'settings','menu-skins':'skins','menu-offline':'offline'};
 for(const [id,action]of Object.entries(actions))$(id).addEventListener('click',event=>{event.preventDefault();event.stopImmediatePropagation();activate(action);},true);
 $('menu-play-tab').addEventListener('click',()=>$('start-button').focus());
 $('credits-button').addEventListener('click',()=>{$('credits').hidden=false;});$('close-credits').addEventListener('click',()=>{$('credits').hidden=true;});
 function syncMode(){const defuse=$('mode').value==='defuse';$('room-mode-note').textContent=defuse?'13 回合获胜 · 每 12 回合换边 · 12:12 加时，每 3 回合换边':'团队击杀累计至 100，比赛结束';$('loadout-mode').textContent=defuse?'手枪局开场，B 购买主武器':'团队死斗开局直接装备';$('lobby-mode-label').textContent=defuse?'竞技爆破':'团队死斗';}
 $('mode').addEventListener('change',syncMode);syncMode();
 for(const button of document.querySelectorAll('[data-team]'))button.addEventListener('click',()=>{if(runtime)return;$('team').value=button.dataset.team;for(const item of document.querySelectorAll('[data-team]')){const active=item===button;item.classList.toggle('selected',active);item.setAttribute('aria-pressed',String(active));}$('auto-team').setAttribute('aria-pressed','false');});
 $('auto-team').addEventListener('click',()=>{if(runtime)return;$('team').value='auto';$('auto-team').setAttribute('aria-pressed','true');for(const item of document.querySelectorAll('[data-team]')){item.classList.remove('selected');item.setAttribute('aria-pressed','false');}});
 for(const button of document.querySelectorAll('[data-primary]'))button.addEventListener('click',()=>{if(runtime)return;for(const item of document.querySelectorAll('[data-primary]')){const active=item===button;item.classList.toggle('selected',active);item.setAttribute('aria-pressed',String(active));}});
 syncSelection();mountSelectedLobby();
 window.__dust2Home={get selectedMap(){return selected.id;},get runtimeLoaded(){return Boolean(runtime);}};
}
