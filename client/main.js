import './style.css';
import './controls.css';
import './interface.css';
import { GameControls, formatBinding } from './controls.js';
import { MatchView } from './match-view.js';
import { RuntimeDiagnostics, disconnectMessage } from './runtime-diagnostics.js';
import { CS2_BASE_FOV, AWP_ZOOM_FOVS, cs2FovToVertical, mouseRadiansPerCount, DEFAULT_CROSSHAIR, normalizeCrosshair } from '../shared/cs2-settings.js';
import { Crosshair } from './crosshair.js';
import { mountSettings } from './settings-ui.js';
import { WeaponShop } from './shop.js';
import { SkinMenu } from './skin-menu.js';
import { getSkin } from '../shared/skins.js';
import { loadSkin } from './skin-assets.js';
import { mountOfflineMenu } from './offline-menu.js';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createMapScene } from './map-scene.js';
import { initPhysics, createPlayerState, stepPlayer, raycastWorld } from '../shared/physics.js';
import { MAP } from '../shared/map-data.js';
import { getWeapon } from '../shared/weapons.js';
import { GameAudio } from './audio.js';
import { loadModels, PlayerModel, ViewWeapon, Effects } from './models.js';
import { HUD } from './hud.js';
import { downloadAssets, releaseDownloads } from './loading.js';

const $=id=>document.getElementById(id);
const canvas=$('game-canvas');
let renderer;
try{renderer=new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance'});}catch(e){$('menu-status').textContent='无法启动 3D：请启用浏览器硬件加速后重试。';throw e;}
renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.setSize(innerWidth,innerHeight);renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFShadowMap;renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.03;renderer.info.autoReset=false;
const scene=new THREE.Scene();
const camera=new THREE.PerspectiveCamera(cs2FovToVertical(CS2_BASE_FOV),innerWidth/innerHeight,.045,400);camera.rotation.order='YXZ';
const gunScene=new THREE.Scene();
const gunCamera=new THREE.PerspectiveCamera(62,innerWidth/innerHeight,.025,10);gunCamera.rotation.order='YXZ';gunScene.add(gunCamera);gunScene.add(new THREE.HemisphereLight(0xe8f2ff,0x8f795b,.4));const gunSun=new THREE.DirectionalLight(0xffecd0,1.2);gunSun.position.set(-2,3,2);gunScene.add(gunSun);
let weaponEnvironment=null;
function rebuildWeaponEnvironment(){
  const generator=new THREE.PMREMGenerator(renderer),room=new RoomEnvironment();
  try{const next=generator.fromScene(room,.04);gunScene.environment=next.texture;gunScene.environmentIntensity=.45;weaponEnvironment?.dispose();weaponEnvironment=next;}
  finally{room.dispose();generator.dispose();}
}
rebuildWeaponEnvironment();
const hud=new HUD();
const audio=new GameAudio();
const actors=new Map();
const effects=new Effects(scene);
const matchView=new MatchView();
let diagnosticStorage=null;try{diagnosticStorage=localStorage;}catch{}
const diagnostics=new RuntimeDiagnostics(diagnosticStorage);
let contextLost=false,spectating=null;

let viewWeapon=null, socket=null,myId=null,room=null,mode='deathmatch',snapshot=null,self=null;
let loaded=false,loading=false,connected=false,lookYaw=0,lookPitch=0,slot=1;
let mouseFire=false,wasFire=false,scoped=false,seq=0,lastShot=0,fireTimer=0,recoil=0;
let fixed=0,networkAcc=0,hudAcc=0,pingAcc=0,lastTime=performance.now(),fps=60,ping=0,lastStep=0;
let lastSnapshotAlive=false,previousHealth=100,inviteBase=null;
let primary='ak47',primaryExplicit=false,downloadAbort=null,pendingJoin=false;
const handledEvents=new Set();
let previousWeapon=null,previousReload=0;
let modelsReady=false,mapResultCache=null;
let serverAmmo=0,pendingShots=[],lastSentInputSeq=-1;
let storedSettings={};try{storedSettings=JSON.parse(localStorage.getItem('dust2.cs-settings.v1')||'{}');}catch{}
let sensitivity=Math.max(.05,Math.min(20,Number(storedSettings.sensitivity)||1));
let zoomSensitivity=Math.max(.05,Math.min(5,Number(storedSettings.zoomSensitivity)||1));
let crosshairSettings=normalizeCrosshair(storedSettings.crosshair||DEFAULT_CROSSHAIR);
let zoomLevel=0, resumeZoom=0, zoomResumeAt=0, lastSlot=2, jumpId=0, reloadId=0;
const crosshair=new Crosshair($('crosshair'),{settings:crosshairSettings});
const controls=new GameControls({target:window,enabled:(action)=>{
  if(!connected||$('settings-menu')?.hidden===false||$('skin-menu')?.hidden===false||$('offline-menu')?.hidden===false)return false;
  if(['buy','menu','scoreboard'].includes(action))return true;
  return document.pointerLockElement===canvas&&$('buy-menu').hidden&&$('pause-menu').hidden&&(self?.alive||(['fire','altFire'].includes(action)&&!contextLost));
},onAction:controlAction});
const shop=new WeaponShop($('buy-menu'),{buy:weapon=>send({type:'buy',weapon}),close:()=>toggleBuy()});
const settingsUI=mountSettings({controls,crosshair,getSettings:()=>({sensitivity,zoomSensitivity,crosshair:crosshairSettings}),onSettings:values=>{
  if(values.sensitivity!==undefined)sensitivity=values.sensitivity;
  if(values.zoomSensitivity!==undefined)zoomSensitivity=values.zoomSensitivity;
  if(values.crosshair)crosshairSettings=values.crosshair;
  localStorage.setItem('dust2.cs-settings.v1',JSON.stringify({sensitivity,zoomSensitivity,crosshair:crosshairSettings}));
  $('sensitivity').value=sensitivity;$('sens-value').textContent=sensitivity.toFixed(2);
}});
let pendingSkinEquip=null,lastSkinEquipAt=0;
async function equipSkin(skin){
  if(!connected)return;
  const wait=Math.max(0,300-(performance.now()-lastSkinEquipAt));if(wait)await new Promise(resolve=>setTimeout(resolve,wait));
  if(!connected)throw new Error('连接已断开，请重试。');
  return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pendingSkinEquip=null;reject(new Error('服务器确认超时，请重试。'));},5000);pendingSkinEquip={skin:skin.id,resolve:()=>{clearTimeout(timer);pendingSkinEquip=null;resolve();},reject:message=>{clearTimeout(timer);pendingSkinEquip=null;reject(new Error(message));}};lastSkinEquipAt=performance.now();send({type:'equipSkin',weapon:skin.weapon,skin:skin.id});});
}
const skins=new SkinMenu({onEquip:equipSkin});
const offlineMenu=mountOfflineMenu();
let volume=Number(localStorage.getItem('dust2.volume')??.6);
let quality=localStorage.getItem('dust2.quality')||'high';
audio.setVolume(volume);$('volume').value=volume;$('vol-value').textContent=`${Math.round(volume*100)}%`;$('sensitivity').value=sensitivity;$('sens-value').textContent=sensitivity.toFixed(2);$('quality').value=quality;
$('nickname').value=localStorage.getItem('dust2.name')||'Player';
const initialQuery=new URLSearchParams(location.search);if(initialQuery.has('room')){$('room-code').value=initialQuery.get('room').replace(/[^A-Za-z0-9]/g,'').slice(0,12);$('menu-status').textContent='好友邀请已就绪，输入呼号后点击加入房间。';}

function setLoadStage(stage,label){
  $('load-label').textContent=label;
  const order=['download','scene','connect'];
  document.querySelectorAll('[data-load-step]').forEach(el=>{el.classList.toggle('active',el.dataset.loadStep===stage);el.classList.toggle('done',order.indexOf(el.dataset.loadStep)<order.indexOf(stage));});
  $('cancel-load').disabled=stage!=='download';
  if(stage!=='download'){$('load-percent').textContent=stage==='scene'?'准备中':'连接中';$('load-rate').textContent='';}
}
function downloadProgress(p){
  const percent=p.total?Math.min(100,p.bytes/p.total*100):0;
  $('load-percent').textContent=`${percent.toFixed(0)}%`;$('load-fill').style.width=`${percent}%`;
  const mb=n=>(n/1048576).toFixed(1);
  $('load-bytes').textContent=`已载入 ${mb(p.bytes)} / ${mb(p.total)} MB`;
  $('load-files').textContent=`${p.complete} / ${p.count} 个文件`;
  $('load-rate').textContent=p.rate>0?`资源读取 ${mb(p.rate)} MB/s`:'';
  const labels={map:'下载 Dust II 地图与原版材质',collision:'载入地图碰撞',characters:'载入对战角色',weapons:'下载武器、皮肤与手部动作'};
  $('load-label').textContent=labels[p.current]||'准备资源下载';
}
function loadError(error){
  $('loading-error').hidden=false;$('loading-error-text').textContent=`${error.message || error}。可重试加载。`;
  $('loading-spinner').hidden=true;$('cancel-load').disabled=false;
  $('menu-status').textContent=`加载未完成：${error.message || error}`;
  loading=false;$('start-button').disabled=false;$('join-button').disabled=false;
}
const paint=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
function send(data){if(socket?.readyState===WebSocket.OPEN)socket.send(JSON.stringify(data));}
function sendInput(input){if(input.seq<=lastSentInputSeq)return;lastSentInputSeq=input.seq;send({type:'input',...input});}
function controlsEnabled(){return connected&&document.pointerLockElement===canvas&&$('buy-menu').hidden&&$('pause-menu').hidden&&self?.alive&&snapshot?.round?.phase!=='freeze';}
function currentInput(){
  const enabled=controlsEnabled();
  if(controls.consume('jump')&&enabled)jumpId++;
  if(controls.consume('reload')&&enabled)reloadId++;
  const firePressed=controls.consume('fire');
  return {seq:++seq,forward:enabled?(Number(controls.down('forward'))-Number(controls.down('back'))):0,right:enabled?(Number(controls.down('right'))-Number(controls.down('left'))):0,yaw:lookYaw,pitch:lookPitch,jump:enabled&&controls.down('jump'),jumpId,crouch:enabled&&controls.down('crouch'),walk:enabled&&controls.down('walk'),fire:enabled&&(mouseFire||firePressed),reload:enabled&&controls.down('reload'),reloadId,slot,interact:enabled&&controls.down('interact')};
}
function resetScope(){zoomLevel=0;scoped=false;resumeZoom=0;zoomResumeAt=0;}
function selectSlot(next){
  if(!self?.inventory?.some(id=>getWeapon(id).slot===next)||next===slot)return;
  lastSlot=slot;slot=next;fireTimer=Math.max(fireTimer,.2);resetScope();audio.cancelReload();
}
function controlAction(action,{pressed,event}){
  if(self&&!self.alive&&['fire','altFire'].includes(action)){if(pressed)matchView.cycle(self,snapshot,action==='fire'?1:-1);return;}
  if(action==='fire'){mouseFire=pressed&&controlsEnabled();return;}
  if(action==='scoreboard'){$('scoreboard').hidden=!pressed;return;}
  if(!pressed)return;
  if(action==='buy'){toggleBuy();return;}
  if(action==='menu'){$('buy-menu').hidden=true;$('scoreboard').hidden=true;document.exitPointerLock?.();$('pause-menu').hidden=false;controls.clear();return;}
  if(action==='altFire'&&self?.weapon==='awp'&&controlsEnabled()&&self.reloadRemaining<=0&&fireTimer<=0){zoomLevel=(zoomLevel+1)%3;scoped=zoomLevel>0;resumeZoom=0;return;}
  if(action==='primary')selectSlot(1);
  if(action==='secondary')selectSlot(2);
  if(action==='knife')selectSlot(3);
  if(action==='lastWeapon')selectSlot(lastSlot);
  if(action==='previousWeapon'||action==='nextWeapon'){
    const slots=[...new Set((self?.inventory||[]).map(id=>getWeapon(id).slot))].sort();
    if(slots.length)selectSlot(slots[(slots.indexOf(slot)+(action==='nextWeapon'?1:slots.length-1))%slots.length]);
  }
  if(action==='inspect')viewWeapon?.inspect();
  if(action==='reload')resetScope();
}


async function loadGame(audioReady){
  if(loaded){await audioReady;return;}
  setLoadStage('download','下载地图与武器资源');
  downloadAbort=new AbortController();
  await downloadAssets({signal:downloadAbort.signal,onProgress:downloadProgress});
  downloadAbort=null;
  setLoadStage('scene','解码原版材质与骨骼动画');await paint();
  // Wait for every parser before opening Retry. Successful heavy work is kept
  // so a failed audio/model request cannot append a second map on the next try.
  const tasks=await Promise.allSettled([
    modelsReady?Promise.resolve():loadModels().then(()=>{modelsReady=true;}),
    mapResultCache?Promise.resolve(mapResultCache):createMapScene(scene,{onProgress:message=>{$('load-label').textContent=message;}}).then(result=>{mapResultCache=result;return result;}),
    audioReady,
    ...Object.values(skins.loadout).filter(id=>!getSkin(id)?.isDefault).map(id=>loadSkin(id)),
  ]);
  const failure=tasks.find(task=>task.status==='rejected');
  if(failure)throw failure.reason;
  const mapResult=mapResultCache;
  $('load-label').textContent='建立碰撞与武器动作';await paint();
  initPhysics(mapResult.positions);viewWeapon ||= new ViewWeapon(gunCamera);applyQuality();
  $('load-label').textContent='预热场景与武器着色器';await paint();
  const spawn=MAP.spawns[$('team').value==='CT'?'CT':'T'][0];camera.position.set(spawn.x,spawn.y+1.62,spawn.z);
  await renderer.compileAsync(scene,camera);await renderer.compileAsync(gunScene,gunCamera);
  loaded=true;releaseDownloads();
}

async function start(joinExisting=false){
  if(loading)return;loading=true;pendingJoin=joinExisting;
  $('start-button').disabled=true;$('join-button').disabled=true;$('loading-screen').hidden=false;
  $('loading-error').hidden=true;$('loading-spinner').hidden=false;
  $('loading-mode').textContent=$('mode').value==='defuse'?'经典爆破 · 回合制':'团队死斗 · 自动重生';
  $('loading-team').textContent={T:'进攻方 T',CT:'防守方 CT',auto:'自动平衡阵营'}[$('team').value];
  const weapon=getWeapon(primary);$('loading-weapon').textContent=`${weapon.name} · ${weapon.skin}`;
  $('menu-status').textContent='正在加载战场。资源会缓存，之后进入更快。';
  setLoadStage(loaded?'connect':'download',loaded?'连接对战房间':'准备资源清单');
  const audioReady=audio.start();audioReady.catch(()=>{});
  try{await loadGame(audioReady);setLoadStage('connect','建立多人对战连接');connect(joinExisting);}
  catch(e){downloadAbort=null;if(e.name==='AbortError'){$('loading-screen').hidden=true;loading=false;$('start-button').disabled=false;$('join-button').disabled=false;$('menu-status').textContent='已取消加载。';}else{console.error(e);loadError(e);}}
}
function connect(joinExisting){
  if(socket)socket.close();
  const url=new URL('ws',new URL('.',location.href));url.protocol=location.protocol==='https:'?'wss:':'ws:';
  socket=new WebSocket(url);const activeSocket=socket;
  const timeout=setTimeout(()=>{if(!connected&&socket===activeSocket){$('menu-status').textContent='服务器连接超时，请确认游戏服务已启动。';socket.close();}},15000);
  socket.addEventListener('open',()=>{if(socket!==activeSocket)return;const name=$('nickname').value.trim()||'Player';localStorage.setItem('dust2.name',name);activeSocket.send(JSON.stringify({type:'join',name,room:joinExisting?$('room-code').value.trim().toUpperCase():undefined,mode:$('mode').value,team:$('team').value,primary,skins:skins.loadout,bots:Number($('bots').value)}));});
  socket.addEventListener('message',e=>{if(socket!==activeSocket)return;let data;try{data=JSON.parse(e.data);}catch{return;}
    if(data.type==='welcome'){
      clearTimeout(timeout);myId=data.id;room=data.room;mode=data.mode;connected=true;seq=0;jumpId=0;reloadId=0;resetScope();controls.clear();lastSentInputSeq=-1;pendingShots=[];self=null;lastSnapshotAlive=false;previousHealth=100;handledEvents.clear();previousWeapon=null;previousReload=0;hud.reset();matchView.reset();spectating=null;diagnostics.event('connected');
      document.exitPointerLock?.();document.body.classList.remove('mouse-captured');$('loading-screen').hidden=true;
      $('menu').hidden=true;$('hud').hidden=false;document.body.classList.add('playing');$('pause-menu').hidden=false;
      $('room-label').textContent=room;$('board-room').textContent=`房间 ${room}`;$('room-code').value=room;
      const q=new URL(location.href);q.searchParams.set('room',room);history.replaceState(null,'',q);
      loading=false;$('start-button').disabled=false;$('join-button').disabled=false;
      hud.toast(`已加入 ${data.team} 阵营 · 点击继续进入战场`);
    } else if(data.type==='snapshot'){handleSnapshot(data);}
    else if(data.type==='skinEquipped'){if(pendingSkinEquip?.skin===data.skin)pendingSkinEquip.resolve();hud.toast(`已装备 ${getSkin(data.skin)?.name||'新皮肤'}`);}
    else if(data.type==='purchase'){shop.result(data);if(data.weapon!=='armor')selectSlot(1);hud.toast(`已购买 ${data.weapon==='armor'?'防弹护甲':getWeapon(data.weapon).name}`);}
    else if(data.type==='pong'){ping=Math.round(performance.now()-data.time);}
    else if(data.type==='error'){if(data.code?.startsWith('SKIN'))pendingSkinEquip?.reject(data.message);if(data.code?.startsWith('BUY'))shop.result({ok:false,message:data.message});hud.toast(data.message||'操作未完成');$('menu-status').textContent=data.message||'服务器拒绝连接';if(!connected){loadError(new Error(data.message||'服务器拒绝连接'));}}
  });
  socket.addEventListener('close',event=>{clearTimeout(timeout);if(socket!==activeSocket)return;const wasConnected=connected;connected=false;loading=false;mouseFire=false;$('start-button').disabled=false;$('join-button').disabled=false;if(wasConnected){diagnostics.event('disconnected',{code:event.code,reason:event.reason.slice(0,120),wasClean:event.wasClean});pendingSkinEquip?.reject('连接已断开，请重新加入后装备。');showMenu();$('menu-status').textContent=disconnectMessage(event.code,event.reason);}else if(!$('loading-screen').hidden)loadError(new Error('连接失败，请确认服务器地址和网络后重试')); });
  socket.addEventListener('error',()=>{if(socket!==activeSocket)return;if(!connected)$('menu-status').textContent='无法连接游戏服务器，请稍后重试。';});
}

function handleSnapshot(data){
  snapshot=data;const p=data.players.find(p=>p.id===myId);if(!p)return;
  const life=matchView.update(p,data,performance.now());
  if(life.died||life.respawned){controls.clear();mouseFire=false;wasFire=false;resetScope();fireTimer=0;pendingShots=[];diagnostics.event(life.died?'death':'respawn');}
  if(previousWeapon!==p.weapon||!p.alive||!lastSnapshotAlive||p.ammo>serverAmmo)pendingShots=[];
  else if(p.ammo<serverAmmo)pendingShots.splice(0,serverAmmo-p.ammo);
  serverAmmo=p.ammo;
  if(previousWeapon!==p.weapon||!p.alive){audio.cancelReload();resetScope();}
  if(p.alive&&p.reloadRemaining>0&&(previousReload<=0||previousWeapon!==p.weapon))audio.weaponReload(p.weapon,{team:p.team,duration:p.reloadRemaining});
  previousWeapon=p.weapon;previousReload=p.reloadRemaining;
  if(!self||p.alive&&!lastSnapshotAlive){self={...createPlayerState(p),...p};lookYaw=p.yaw;lookPitch=p.pitch;slot=p.slot;camera.position.set(p.x,p.y+1.6,p.z);recoil=0;self.lastJumpId=jumpId;lastStep=p.stepDistance||0;resetScope();}
  else {
    const dist=Math.hypot(self.x-p.x,self.y-p.y,self.z-p.z);
    const shouldSnap=dist>3||!p.alive||!document.pointerLockElement;
    const keep={x:shouldSnap?p.x:THREE.MathUtils.lerp(self.x,p.x,.18),y:shouldSnap?p.y:THREE.MathUtils.lerp(self.y,p.y,.32),z:shouldSnap?p.z:THREE.MathUtils.lerp(self.z,p.z,.18),vx:self.vx,vy:self.vy,vz:self.vz,lastJump:self.lastJump,lastJumpId:self.lastJumpId,jumpBufferRemaining:shouldSnap?0:self.jumpBufferRemaining,grounded:shouldSnap?p.grounded:self.grounded,crouch:shouldSnap?p.crouch:self.crouch,stepDistance:self.stepDistance};
    Object.assign(self,p,keep);if(shouldSnap){self.vx=p.vx;self.vy=p.vy;self.vz=p.vz;}
  }
  if(p.health<previousHealth&&p.alive)hud.damage();previousHealth=p.health;lastSnapshotAlive=p.alive;
  const present=new Set(data.players.map(p=>p.id));for(const [id,actor]of actors){if(!present.has(id)){actor.dispose(scene);actors.delete(id);}}
  for(const other of data.players){if(other.id!==myId&&!actors.has(other.id))actors.set(other.id,new PlayerModel(other.team,scene));}
  for(const e of data.events||[]){if(e.id&&handledEvents.has(e.id))continue;if(e.id){handledEvents.add(e.id);if(handledEvents.size>512)handledEvents.delete(handledEvents.values().next().value);}hud.event(e,data,myId);handleEvent(e);}
}

function handleEvent(e){
  if(e.type==='shot'){
    if(e.weapon!=='knife'&&e.origin&&e.end)effects.shot(e.origin,e.end,e.shooterId===myId);
    if(e.weapon==='knife'&&e.shooterId===myId&&e.hitWorld)audio.knife('wall');
    if(e.shooterId!==myId&&self&&e.origin){const listener=spectating?camera.position:self,listenerYaw=spectating?camera.rotation.y:lookYaw;const dx=e.origin.x-listener.x,dz=e.origin.z-listener.z;const distance=Math.hypot(dx,dz);const pan=(dx*Math.cos(listenerYaw)-dz*Math.sin(listenerYaw))/Math.max(1,distance);audio.shot(e.weapon,distance,pan,{remote:true,team:snapshot.players.find(p=>p.id===e.shooterId)?.team});}
  }
  if(e.type==='hit'&&e.shooterId===myId){audio.hit({headshot:e.headshot,armor:e.armor,weapon:e.weapon});}
  if(e.type==='kill'&&e.killerId===myId){audio.kill({headshot:e.headshot});}
  if(['bomb_planted','bomb_defused','round_start'].includes(e.type))audio.beep(820,.17,.15);
  if(e.type==='buy'&&e.playerId===myId){audio.beep(440,.08,.08);}
}

function localShoot(input,dt){
  fireTimer=Math.max(0,fireTimer-dt);if(!self?.alive)return;const w=getWeapon(self.weapon);
  // Reserve ammunition immediately while the authoritative shot is in flight.
  // Rejected inputs expire, so packet loss cannot permanently lock the weapon.
  pendingShots=pendingShots.filter(time=>performance.now()-time<Math.max(1500,ping*4));
  if(input.fire&&self.slot===slot&&(!wasFire||w.automatic)&&fireTimer<=0&&self.reloadRemaining<=0&&(self.ammo-pendingShots.length>0||w.id==='knife')){
    if(w.id!=='knife')pendingShots.push(performance.now());
    sendInput(input);
    fireTimer=w.fireInterval;lastShot=performance.now();if(w.id==='awp'){resumeZoom=zoomLevel;zoomResumeAt=performance.now()+w.fireInterval*1000;zoomLevel=0;scoped=false;}viewWeapon?.shoot();audio.shot(w.id,0,0,{team:self.team});recoil=Math.min(.10,recoil+w.recoil*.55);lookPitch=Math.min(1.48,lookPitch+w.recoil*.35);
  }
  wasFire=input.fire;
}

async function lockPointer(){if(!connected||!self||contextLost)return;$('pause-menu').hidden=true;$('buy-menu').hidden=true;controls.clear();try{await audio.start();await canvas.requestPointerLock({unadjustedMovement:true});}catch{try{await canvas.requestPointerLock();}catch{$('pause-menu').hidden=false;hud.toast('请点击继续游戏以启用鼠标控制。');}}}
function showMenu(){audio.stopAll();effects.clear();hud.reset();matchView.reset();spectating=null;pendingShots=[];mouseFire=false;wasFire=false;controls.clear();resetScope();document.exitPointerLock?.();document.body.classList.remove('playing');$('menu').hidden=false;$('hud').hidden=true;$('pause-menu').hidden=true;$('buy-menu').hidden=true;$('scoreboard').hidden=true;for(const a of actors.values())a.dispose(scene);actors.clear();self=null;snapshot=null;}
function toggleBuy(){if(!connected)return;if(!self?.alive&&$('buy-menu').hidden){hud.toast('阵亡时无法购买，重生或下一回合后可打开商店。');return;}if($('buy-menu').hidden){$('buy-menu').hidden=false;$('pause-menu').hidden=true;mouseFire=false;resetScope();controls.clear();shop.update({player:self,mode,round:snapshot?.round,time:snapshot?.time});document.exitPointerLock();$('close-buy').focus();}else{$('buy-menu').hidden=true;lockPointer();}}

async function invite(){if(!room)return;let url=new URL(location.href);url.searchParams.set('room',room);if(inviteBase){url=new URL(inviteBase);url.searchParams.set('room',room);}try{await navigator.clipboard.writeText(url.href);hud.toast('邀请链接已复制，发送给朋友即可加入');}catch{hud.toast(`房间 ${room} · ${url.href}`);}}
function applyQuality(){renderer.setPixelRatio(quality==='low'?1:Math.min(devicePixelRatio,1.5));renderer.shadowMap.enabled=quality!=='low';renderer.setSize(innerWidth,innerHeight);scene.traverse(o=>{if(o.isLight&&o.shadow)o.shadow.needsUpdate=true;});}

function choosePrimary(id,explicit=true){
  primary=id;if(explicit)primaryExplicit=true;
  document.querySelectorAll('[data-primary]').forEach(el=>{const selected=el.dataset.primary===id;el.classList.toggle('selected',selected);el.setAttribute('aria-pressed',String(selected));});
}
function chooseTeam(team){
  $('team').value=team;$('auto-team').setAttribute('aria-pressed',String(team==='auto'));
  document.querySelectorAll('[data-team]').forEach(el=>{const selected=el.dataset.team===team;el.classList.toggle('selected',selected);el.setAttribute('aria-pressed',String(selected));});
  if(!primaryExplicit)choosePrimary(team==='CT'?'m4a1':'ak47',false);
}
document.querySelectorAll('[data-team]').forEach(el=>el.addEventListener('click',()=>chooseTeam(el.dataset.team)));
document.querySelectorAll('[data-primary]').forEach(el=>el.addEventListener('click',()=>choosePrimary(el.dataset.primary)));
$('auto-team').addEventListener('click',()=>chooseTeam('auto'));
$('mode').addEventListener('change',()=>{$('loadout-mode').textContent=$('mode').value==='defuse'?'爆破从手枪局开始，B 购买主武器':'死斗开局直接装备';});
$('cancel-load').addEventListener('click',()=>{if(downloadAbort)downloadAbort.abort();else if(!loading)$('loading-screen').hidden=true;});
$('back-load').addEventListener('click',()=>{$('loading-screen').hidden=true;});
$('retry-load').addEventListener('click',()=>start(pendingJoin));

$('start-button').addEventListener('click',()=>start(false));$('join-button').addEventListener('click',()=>{if(!$('room-code').value.trim()){$('menu-status').textContent='请输入朋友发来的房间码。';return;}start(true);});
$('menu-skins').onclick=()=>skins.open();$('game-skins').onclick=()=>skins.open();$('menu-offline').onclick=()=>offlineMenu.open();
$('game-settings').addEventListener('click',()=>settingsUI.open());$('menu-settings').addEventListener('click',()=>settingsUI.open());
$('resume-button').addEventListener('click',lockPointer);
$('invite-button').addEventListener('click',invite);$('pause-invite').addEventListener('click',invite);
$('leave-button').addEventListener('click',()=>{connected=false;socket?.close();socket=null;showMenu();const q=new URL(location.href);q.searchParams.delete('room');history.replaceState(null,'',q);$('menu-status').textContent='已退出房间，可以开始新的对局。';});
$('credits-button').addEventListener('click',()=>$('credits').hidden=false);$('close-credits').addEventListener('click',()=>$('credits').hidden=true);
$('sensitivity').addEventListener('change',e=>{const n=Number(e.target.value);if(!Number.isFinite(n)||n<.05||n>20){e.target.value=sensitivity;return;}sensitivity=n;$('sens-value').textContent=sensitivity.toFixed(2);localStorage.setItem('dust2.cs-settings.v1',JSON.stringify({sensitivity,zoomSensitivity,crosshair:crosshairSettings}));document.getElementById('cs-sensitivity').value=sensitivity;});
$('volume').addEventListener('input',e=>{volume=Number(e.target.value);audio.setVolume(volume);$('vol-value').textContent=`${Math.round(volume*100)}%`;localStorage.setItem('dust2.volume',volume);});
$('quality').addEventListener('change',e=>{quality=e.target.value;applyQuality();localStorage.setItem('dust2.quality',quality);});
document.addEventListener('pointerlockchange',()=>{document.body.classList.toggle('mouse-captured',document.pointerLockElement===canvas);if(document.pointerLockElement!==canvas){controls.clear();mouseFire=false;resetScope();if(connected&&$('buy-menu').hidden)$('pause-menu').hidden=false;}else $('pause-menu').hidden=true;});
const pointerMenus=[$('menu'),$('pause-menu'),$('buy-menu'),settingsUI.element,skins.element,offlineMenu.element];
const pointerGuard=new MutationObserver(()=>{if(pointerMenus.some(menu=>!menu.hidden)&&document.pointerLockElement===canvas)document.exitPointerLock();});
pointerMenus.forEach(menu=>pointerGuard.observe(menu,{attributes:true,attributeFilter:['hidden']}));
document.addEventListener('mousemove',e=>{if(document.pointerLockElement!==canvas||!self?.alive)return;const fov=AWP_ZOOM_FOVS[zoomLevel];lookYaw-=e.movementX*mouseRadiansPerCount(sensitivity,'yaw',fov,zoomSensitivity);lookPitch=THREE.MathUtils.clamp(lookPitch-e.movementY*mouseRadiansPerCount(sensitivity,'pitch',fov,zoomSensitivity),-1.48,1.48);});
document.addEventListener('contextmenu',e=>{if(connected)e.preventDefault();});
window.addEventListener('blur',()=>{controls.clear();mouseFire=false;resetScope();document.exitPointerLock?.();document.body.classList.remove('mouse-captured');});
window.addEventListener('resize',()=>{camera.aspect=gunCamera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();gunCamera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);});

let bombMesh=null;
function updateBomb(){
  const bomb=snapshot?.bomb;const visible=bomb&&['planted','dropped'].includes(bomb.state);
  if(visible&&!bombMesh){bombMesh=new THREE.Group();const pack=new THREE.Mesh(new THREE.BoxGeometry(.32,.10,.23),new THREE.MeshStandardMaterial({color:0x575d3f,roughness:.8}));bombMesh.add(pack);const light=new THREE.Mesh(new THREE.SphereGeometry(.018,6,6),new THREE.MeshBasicMaterial({color:0xff2a1a}));light.position.set(.08,.06,0);bombMesh.add(light);scene.add(bombMesh);}
  if(bombMesh){bombMesh.visible=!!visible;if(visible){bombMesh.position.set(bomb.x,bomb.y+.09,bomb.z);bombMesh.children[1].visible=bomb.state==='planted'&&Math.floor(performance.now()/300)%2===0;}}
}
function frame(now){
  requestAnimationFrame(frame);const frameSeconds=(now-lastTime)/1000,dt=Math.min(.05,Math.max(0,frameSeconds));lastTime=now;fps=THREE.MathUtils.lerp(fps,1/Math.max(.001,frameSeconds),.025);
  if(!loaded||!connected||!self||contextLost)return;
  fixed+=dt;networkAcc+=dt;hudAcc+=dt;pingAcc+=dt;
  const input=currentInput();
  while(fixed>=1/60){if(self.alive&&snapshot.round.phase!=='freeze')stepPlayer(self,input,1/60);localShoot(input,1/60);fixed-=1/60;}
  if(networkAcc>=1/30){networkAcc%=1/30;sendInput(input);}
  if(pingAcc>=2){pingAcc=0;send({type:'ping',time:performance.now()});}
  if(self.grounded&&controlsEnabled()&&Math.hypot(self.vx,self.vz)>.8&&(self.stepDistance||0)-lastStep>(self.crouch?2.6:1.8)){audio.step();lastStep=self.stepDistance;}
  recoil=Math.max(0,recoil-dt*.15);const eye=self.alive?(self.crouch?.95:1.62):.75;
  camera.position.x=self.x;camera.position.z=self.z;camera.position.y=THREE.MathUtils.lerp(camera.position.y,self.y+eye,Math.min(1,dt*20));
  camera.rotation.set(lookPitch+recoil,lookYaw,0,'YXZ');if(!self.alive)resetScope();
  spectating=matchView.spectating(self,snapshot,now);
  if(spectating){const actor=actors.get(spectating.id);const position=actor?.group.position||spectating;camera.position.set(position.x,position.y+(spectating.crouch?.95:1.62),position.z);camera.rotation.set(spectating.pitch,spectating.yaw,0,'YXZ');}
  if(resumeZoom&&now>=zoomResumeAt&&controlsEnabled()&&self.weapon==='awp'&&self.reloadRemaining<=0&&self.ammo>0){zoomLevel=resumeZoom;scoped=true;resumeZoom=0;}
  const targetFov=cs2FovToVertical(AWP_ZOOM_FOVS[zoomLevel]);if(Math.abs(camera.fov-targetFov)>.1){camera.fov=THREE.MathUtils.lerp(camera.fov,targetFov,Math.min(1,dt/.05));camera.updateProjectionMatrix();}
  $('scope').hidden=!scoped;$('scope-readout').textContent=zoomLevel===2?'10° / 第二档':'40° / 第一档';crosshair.update({scoped,alive:self.alive,spread:Math.hypot(self.vx,self.vz),recoilY:-Math.tan(recoil)*innerHeight/(2*Math.tan(camera.fov*Math.PI/360))});

  for(const p of snapshot.players){if(p.id!==myId)actors.get(p.id)?.update(p,dt);}
  viewWeapon?.update(dt,self,scoped);effects.update(dt);updateBomb();
  if(hudAcc>.075){hudAcc=0;hud.update(snapshot,self,{ping,fps:Math.round(fps),spectating,scoreboardKey:formatBinding(controls.getBindings().scoreboard[0]),menuKey:formatBinding(controls.getBindings().menu[0]),nextSpectatorKey:formatBinding(controls.getBindings().fire[0]),previousSpectatorKey:formatBinding(controls.getBindings().altFire[0])});$('weapon-skin').textContent=getSkin(self.skinId)?.name||getWeapon(self.weapon).skin;if(!$('buy-menu').hidden)shop.update({player:self,mode,round:snapshot.round,time:snapshot.time});}
  const observedActor=spectating&&actors.get(spectating.id);if(observedActor)observedActor.group.visible=false;
  renderer.info.reset();renderer.autoClear=true;renderer.render(scene,camera);
  if(observedActor)observedActor.group.visible=true;
  if(self.alive&&!scoped){renderer.autoClear=false;renderer.clearDepth();renderer.render(gunScene,gunCamera);renderer.autoClear=true;}
}
requestAnimationFrame(frame);
function resourceMetrics(){return {fps:Math.round(fps),ping,connected,contextLost,geometries:renderer.info.memory.geometries,textures:renderer.info.memory.textures,programs:renderer.info.programs?.length||0,actors:actors.size,effects:effects.items.length,audioVoices:audio.voices.size,viewWeapons:viewWeapon?.cache.size||0,heapMiB:performance.memory?Math.round(performance.memory.usedJSHeapSize/1048576):null};}
setInterval(()=>{if(loaded)diagnostics.sample(resourceMetrics());},10000);
window.addEventListener('error',event=>diagnostics.event('javascript-error',{message:String(event.message).slice(0,300)}));
window.addEventListener('unhandledrejection',event=>diagnostics.event('unhandled-rejection',{message:String(event.reason?.message||event.reason).slice(0,300)}));
window.addEventListener('pagehide',event=>diagnostics.event('page-hide',{persisted:event.persisted}));
for(const parent of [$('pause-menu').querySelector('.pause-actions'),$('menu').querySelector('footer')||$('menu').querySelector('.utility-row')||$('menu').querySelector('main')]){const button=document.createElement('button');button.textContent='导出运行诊断';button.className='diagnostics-button';button.onclick=()=>diagnostics.download();parent.append(button);}
const recovery=document.createElement('div');recovery.id='graphics-recovery';recovery.className='overlay';recovery.hidden=true;recovery.innerHTML='<section class="pause-card"><div class="eyebrow">DUST II / GRAPHICS</div><h2>正在恢复游戏画面</h2><p>浏览器中断了 3D 渲染，正在等待显卡恢复。若长时间没有恢复，可重新载入；已缓存的资源会继续复用。</p><button class="primary-button" id="reload-graphics">重新载入游戏</button><button id="graphics-report">导出运行诊断</button></section>';document.body.append(recovery);
$('reload-graphics').onclick=()=>location.reload();$('graphics-report').onclick=()=>diagnostics.download();
canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();contextLost=true;diagnostics.event('webgl-context-lost',resourceMetrics());controls.clear();mouseFire=false;resetScope();document.exitPointerLock?.();recovery.hidden=false;});
canvas.addEventListener('webglcontextrestored',()=>{try{rebuildWeaponEnvironment();applyQuality();contextLost=false;diagnostics.event('webgl-context-restored');recovery.hidden=true;if(connected)$('pause-menu').hidden=false;}catch(error){diagnostics.event('graphics-recovery-failed',{message:String(error.message).slice(0,300)});}});
window.__dust2={getDiagnostics:()=>diagnostics.report(),getStatus:()=>({loaded,connected,contextLost,spectatingId:spectating?.id||null,resources:resourceMetrics(),room,mode,myId,fps:Math.round(fps),ping,player:self?{...self}:null,players:snapshot?.players||[],round:snapshot?.round,bomb:snapshot?.bomb,drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,mapVersion:MAP.version,zoomLevel,zoomFov:AWP_ZOOM_FOVS[zoomLevel],cameraFov:camera.fov,settings:{sensitivity,zoomSensitivity,crosshair:crosshairSettings},bindings:controls.getBindings(),jumpId,reloadId})};
