import {MatchAudio,mountMusicSettings} from './match-audio.js';
import {BombView} from './bomb-view.js';
import {RoomMenu} from './room-menu.js';
import './style.css';
import './controls.css';
import './interface.css';
import { GameControls, formatBinding } from './controls.js';
import { MatchView } from './match-view.js';
import { RuntimeDiagnostics, disconnectMessage } from './runtime-diagnostics.js';
import { CS2_BASE_FOV, cs2FovToVertical, mouseRadiansPerCount, DEFAULT_CROSSHAIR, normalizeCrosshair } from '../shared/cs2-settings.js';
import { Crosshair } from './crosshair.js';
import { mountSettings } from './settings-ui.js';
import { WeaponShop } from './shop.js';
import { AgentMenu } from './agent-menu.js';
import { loadAgent,loadedPlayerAsset,requestAgent } from './player-assets.js';
import { DEFAULT_AGENT_IDS,getAgent } from '../shared/agents.js';
import { SkinMenu } from './skin-menu.js';
import { getSkin } from '../shared/skins.js';
import { loadSkin } from './skin-assets.js';
import { mountOfflineMenu } from './offline-menu.js';
import * as THREE from 'three';
import { createWeaponLighting } from './weapon-lighting.js';
import { createMapScene } from './map-scene.js';
import { initPhysics, createPlayerState, stepPlayer, raycastWorld } from '../shared/physics.js';
import { MAP } from '../shared/map-data.js';
import { getWeapon, canTeamUseWeapon, defaultPrimaryForTeam, weaponSpeedScale } from '../shared/weapons.js';
import { UTILITY_IDS, EQUIPMENT } from '../shared/equipment.js';
import { UtilityEffects } from './utility-effects.js';
import { GameAudio } from './audio.js';
import { loadModels, PlayerModel, ViewWeapon } from './models.js';
import { Effects } from './shot-effects.js';
import { DroppedWeapons } from './dropped-weapons.js';
import { MatchPresentation } from './match-presentation.js';
import {RemotePlayers} from './remote-players.js';
import {aimPitch,eyePosition,accuracyForShot} from '../shared/aim.js';
import {ScopeOverlay} from './scope-overlay.js';
import {MovementPrediction} from './movement-prediction.js';
import {movementState} from '../shared/movement-commands.js';
import { HUD } from './hud.js';
import { downloadAssets, releaseDownloads } from './loading.js';
import { connectionTarget } from './connection-target.js';

const connection = connectionTarget(location.href, globalThis.__DUST2_PORTABLE__);

const $=id=>document.getElementById(id);
const canvas=$('game-canvas');
canvas.tabIndex=-1;
let renderer;
try{renderer=new THREE.WebGLRenderer({canvas,antialias:false,powerPreference:'high-performance'});}catch(e){$('menu-status').textContent='无法启动 3D：请启用浏览器硬件加速后重试。';throw e;}
renderer.setPixelRatio(1);renderer.setSize(innerWidth,innerHeight);renderer.shadowMap.enabled=false;renderer.shadowMap.type=THREE.PCFShadowMap;renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.03;renderer.info.autoReset=false;
const scene=new THREE.Scene();
const camera=new THREE.PerspectiveCamera(cs2FovToVertical(CS2_BASE_FOV),innerWidth/innerHeight,.045,400);camera.rotation.order='YXZ';
const gunScene=new THREE.Scene();
const gunCamera=new THREE.PerspectiveCamera(62,innerWidth/innerHeight,.025,10);gunCamera.rotation.order='YXZ';gunScene.add(gunCamera);
const weaponLighting=createWeaponLighting(renderer,gunScene);
function rebuildWeaponEnvironment(){weaponLighting.rebuild();}
const hud=new HUD();
const audio=new GameAudio();
const matchAudio=new MatchAudio(audio),bombView=new BombView(scene);
const actors=new Map();
const remotePlayers=new RemotePlayers();
const movementPrediction=new MovementPrediction();let movementSupported=false;
const scopeOverlay=new ScopeOverlay($('scope'));
const effects=new Effects(scene);
const utilityEffects=new UtilityEffects(scene);
const matchView=new MatchView();
const matchPresentation=new MatchPresentation(document.body,{onReturn:()=>$('leave-button').click(),onEnd:()=>{controls.clear();document.exitPointerLock?.();$('pause-menu').hidden=true;}});
const droppedWeapons=new DroppedWeapons(scene);
let spectatorLook=null;
let displayedHostBots=null;
const visibilityFrustum=new THREE.Frustum(),visibilityMatrix=new THREE.Matrix4(),actorBounds=new THREE.Sphere(new THREE.Vector3(),1.6);
const frameSamples=[];
function frameStats(){const percentile=key=>{const values=frameSamples.map(s=>s[key]).sort((a,b)=>a-b);return Math.round((values[Math.floor(values.length*.95)]||0)*100)/100;};return {samples:frameSamples.length,frameP95Ms:percentile('frame'),cpuP95Ms:percentile('cpu'),actorsP95Ms:percentile('actors'),renderSubmitP95Ms:percentile('render')};}
let diagnosticStorage=null;try{diagnosticStorage=localStorage;}catch{}
const diagnostics=new RuntimeDiagnostics(diagnosticStorage);
let contextLost=false,spectating=null;

let viewWeapon=null, socket=null,myId=null,room=null,mode='defuse',snapshot=null,self=null;
let loaded=false,loading=false,connected=false,lookYaw=0,lookPitch=0,slot=1;
let mouseFire=false,pendingFirePress=false,wasFire=false,scoped=false,seq=0,lastShot=0,fireTimer=0,recoil=0;
let fixed=0,networkAcc=0,hudAcc=0,pingAcc=0,lastTime=performance.now(),fps=60,ping=0,lastStep=0;
let lastSnapshotAlive=false,previousHealth=100,inviteBase=connection.inviteBase;
let primary='ak47',primaryExplicit=false,downloadAbort=null,pendingJoin=false;
const handledEvents=new Set();
let previousWeapon=null,previousReload=0;
let modelsReady=false,mapResultCache=null;
let serverAmmo=0,pendingShots=[],lastSentInputSeq=-1,shotId=0,lastShotEvidence=null;
let storedSettings={};try{storedSettings=JSON.parse(localStorage.getItem('dust2.cs-settings.v1')||'{}');}catch{}
let sensitivity=Math.max(.05,Math.min(20,Number(storedSettings.sensitivity)||1));
let zoomSensitivity=Math.max(.05,Math.min(5,Number(storedSettings.zoomSensitivity)||1));
let crosshairSettings=normalizeCrosshair(storedSettings.crosshair||DEFAULT_CROSSHAIR);
let quality=localStorage.getItem('dust2.quality.v2')||'low';
let brightness=Math.max(60,Math.min(160,Number(localStorage.getItem('dust2.brightness'))||100));
let utilityId='hegrenade';
let zoomLevel=0, resumeZoom=0, zoomResumeAt=0, lastSlot=2, jumpId=0, reloadId=0;
const crosshair=new Crosshair($('crosshair'),{settings:crosshairSettings});
const controls=new GameControls({target:window,enabled:(action)=>{
  if(!connected||snapshot?.match?.status==='ended'||$('settings-menu')?.hidden===false||$('skin-menu')?.hidden===false||$('offline-menu')?.hidden===false||$('agent-menu')?.hidden===false||$('room-menu')?.hidden===false)return false;
  if(['buy','menu'].includes(action))return true;
  if(action==='scoreboard')return document.pointerLockElement===canvas&&$('buy-menu').hidden&&$('pause-menu').hidden;
  return document.pointerLockElement===canvas&&$('buy-menu').hidden&&$('pause-menu').hidden&&(self?.alive||(['fire','altFire'].includes(action)&&!contextLost));
},onAction:controlAction});
let lastBuyAckAt=-Infinity;
const shop=new WeaponShop($('buy-menu'),{buy:async weapon=>{
  const connection=socket,wait=Math.max(0,280-(performance.now()-lastBuyAckAt));
  if(wait)await new Promise(resolve=>setTimeout(resolve,wait));
  if(!connected||socket!==connection){shop.result({ok:false,message:'连接已断开，请重新加入。'});return;}
  send({type:'buy',weapon});
},close:()=>toggleBuy()});
const settingsUI=mountSettings({controls,crosshair,getSettings:()=>({sensitivity,zoomSensitivity,crosshair:crosshairSettings,quality,brightness}),onSettings:values=>{
  if(values.sensitivity!==undefined)sensitivity=values.sensitivity;
  if(values.zoomSensitivity!==undefined)zoomSensitivity=values.zoomSensitivity;
  if(values.crosshair)crosshairSettings=values.crosshair;
  if(values.quality!==undefined)setQuality(values.quality);
  if(values.brightness!==undefined)setBrightness(values.brightness);
  localStorage.setItem('dust2.cs-settings.v1',JSON.stringify({sensitivity,zoomSensitivity,crosshair:crosshairSettings,quality,brightness}));
  $('sensitivity').value=sensitivity;$('sens-value').textContent=sensitivity.toFixed(2);
}});
mountMusicSettings(settingsUI,matchAudio,audio);
let pendingSkinEquip=null,lastSkinEquipAt=0;
async function equipSkin(skin){
  if(!connected)return;
  const wait=Math.max(0,300-(performance.now()-lastSkinEquipAt));if(wait)await new Promise(resolve=>setTimeout(resolve,wait));
  if(!connected)throw new Error('连接已断开，请重试。');
  return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pendingSkinEquip=null;reject(new Error('服务器确认超时，请重试。'));},5000);pendingSkinEquip={skin:skin.id,resolve:()=>{clearTimeout(timer);pendingSkinEquip=null;resolve();},reject:message=>{clearTimeout(timer);pendingSkinEquip=null;reject(new Error(message));}};lastSkinEquipAt=performance.now();send({type:'equipSkin',weapon:skin.weapon,skin:skin.id});});
}
const skins=new SkinMenu({onEquip:equipSkin});
let pendingAgentEquip=null;
const agentsUI=new AgentMenu({onEquip:async agent=>{
 if(!connected||agent.team!==self?.team)return;
 return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pendingAgentEquip=null;reject(new Error('服务器确认超时'));},5000);pendingAgentEquip={id:agent.id,resolve:()=>{clearTimeout(timer);pendingAgentEquip=null;resolve();},reject:message=>{clearTimeout(timer);pendingAgentEquip=null;reject(new Error(message));}};send({type:'equipAgent',agent:agent.id});});
}});
const roomMenu=new RoomMenu({send,invite,onClose:resume=>{controls.clear();if(resume)lockPointer();else $('pause-menu').hidden=false;}});
const offlineMenu=mountOfflineMenu();
let volume=Number(localStorage.getItem('dust2.volume')??.6);

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
function sendInput(input){if(input.seq<=lastSentInputSeq)return;lastSentInputSeq=input.seq;send({type:'input',...input,...(movementSupported?{moves:movementPrediction.packet(),moveId:movementPrediction.nextId}: {})});}
function controlsEnabled(){return connected&&document.pointerLockElement===canvas&&$('buy-menu').hidden&&$('pause-menu').hidden&&self?.alive&&snapshot?.round?.phase==='live';}
function equipmentControlsEnabled(){return connected&&document.pointerLockElement===canvas&&$('buy-menu').hidden&&$('pause-menu').hidden&&self?.alive&&['live','freeze'].includes(snapshot?.round?.phase);}
function currentInput(){
  const enabled=controlsEnabled();
  if(controls.consume('jump')&&enabled)jumpId++;
  if(controls.consume('reload')&&enabled)reloadId++;
  const firePressed=controls.consume('fire');
  // A render frame can occur without a 60 Hz simulation step. Retain a short click
  // until simulation consumes it, just as jump/reload IDs survive between ticks.
  const utility=slot===4;
  if(!enabled||utility)pendingFirePress=false;else if(firePressed)pendingFirePress=true;
  return {seq:++seq,forward:enabled?(Number(controls.down('forward'))-Number(controls.down('back'))):0,right:enabled?(Number(controls.down('right'))-Number(controls.down('left'))):0,yaw:lookYaw,pitch:aimPitch(lookPitch,recoil),jump:enabled&&controls.down('jump'),jumpId,crouch:enabled&&controls.down('crouch'),walk:enabled&&controls.down('walk'),fire:enabled&&(utility?controls.down('fire'):(mouseFire||pendingFirePress)),fire2:enabled&&utility&&controls.down('altFire'),cancelGrenade:!enabled,reload:enabled&&controls.down('reload'),reloadId,slot,utilityId,zoomLevel,speedScale:weaponSpeedScale(self?.weapon,zoomLevel),interact:equipmentControlsEnabled()&&controls.down('interact'),viewTime:remotePlayers.viewTime||null};
}
function resetScope(){zoomLevel=0;scoped=false;resumeZoom=0;zoomResumeAt=0;}
function zoomFov(){return getWeapon(self?.weapon).zoomFovs?.[zoomLevel]||CS2_BASE_FOV;}
function selectUtility(){const owned=UTILITY_IDS.filter(id=>(self?.utilityCounts?.[id]||0)>0);if(!owned.length){hud.toast('没有投掷物 · 按 B 购买');return;}const i=slot===4?owned.indexOf(utilityId):-1;utilityId=owned[(i+1)%owned.length];selectSlot(4);resetScope();sendInput(currentInput());}
function selectSlot(next){
  if(next===4&&!(self?.utilityCounts?.[utilityId]>0))utilityId=UTILITY_IDS.find(id=>self?.utilityCounts?.[id]>0)||'hegrenade';
  if(!self?.inventory?.some(id=>getWeapon(id).slot===next)||next===slot)return;
  lastSlot=slot;slot=next;fireTimer=Math.max(fireTimer,.2);resetScope();audio.cancelReload();
}
function controlAction(action,{pressed,event,source}){
  if(self&&!self.alive&&['fire','altFire'].includes(action)){if(pressed)matchView.cycle(self,snapshot,action==='fire'?1:-1);return;}
  if(action==='fire'){
    mouseFire=pressed&&controlsEnabled();
    if(slot>=4)sendInput({...currentInput(),...(source==='clear'?{cancelGrenade:true}:{} )});
    else if(mouseFire)localShoot(currentInput(),0);
    else {pendingFirePress=false;wasFire=false;sendInput(currentInput());}
    return;
  }
  if(action==='altFire'&&slot===4){sendInput({...currentInput(),...(source==='clear'?{cancelGrenade:true}:{} )});return;}
  if(action==='interact'){sendInput(currentInput());return;}
  if(action==='scoreboard'){$('scoreboard').hidden=!pressed;return;}
  if(!pressed)return;
  if(action==='drop'){if(equipmentControlsEnabled())send({type:'dropWeapon'});return;}
  if(action==='buy'){toggleBuy();return;}
  if(action==='menu'){$('buy-menu').hidden=true;$('scoreboard').hidden=true;document.exitPointerLock?.();$('pause-menu').hidden=false;controls.clear();return;}
  if(action==='altFire'&&getWeapon(self?.weapon).zoomFovs?.length>1&&controlsEnabled()&&self.reloadRemaining<=0&&fireTimer<=0){zoomLevel=(zoomLevel+1)%getWeapon(self.weapon).zoomFovs.length;scoped=zoomLevel>0;resumeZoom=0;sendInput(currentInput());return;}
  if(action==='primary')selectSlot(1);
  if(action==='secondary')selectSlot(2);
  if(action==='knife')selectSlot(3);
  if(action==='bomb')selectSlot(5);
  if(action==='utility')selectUtility();
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
    loadAgent(agentsUI.loadout[$('team').value==='CT'?'CT':'T']),
    ...[primary,$('team').value==='CT'?'usp':'pistol','knife'].map(id=>skins.loadout[id]).filter(Boolean).map(id=>loadSkin(id)),
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
  const weapon=getWeapon(primary);$('loading-weapon').textContent=`${weapon.name} · ${getSkin(skins.loadout[primary])?.name||weapon.skin}`;
  $('menu-status').textContent='正在加载战场。资源会缓存，之后进入更快。';
  setLoadStage(loaded?'connect':'download',loaded?'连接对战房间':'准备资源清单');
  const audioReady=audio.start();audioReady.catch(()=>{});
  try{await loadGame(audioReady);setLoadStage('connect','建立多人对战连接');connect(joinExisting);}
  catch(e){downloadAbort=null;if(e.name==='AbortError'){$('loading-screen').hidden=true;loading=false;$('start-button').disabled=false;$('join-button').disabled=false;$('menu-status').textContent='已取消加载。';}else{console.error(e);loadError(e);}}
}
function connect(joinExisting){
  if(socket)socket.close();
  const url=connection.socketURL;
  socket=new WebSocket(url);const activeSocket=socket;
  const timeout=setTimeout(()=>{if(!connected&&socket===activeSocket){$('menu-status').textContent='服务器连接超时，请确认游戏服务已启动。';socket.close();}},15000);
  socket.addEventListener('open',()=>{if(socket!==activeSocket)return;const name=$('nickname').value.trim()||'Player';localStorage.setItem('dust2.name',name);activeSocket.send(JSON.stringify({type:'join',name,movementProtocol:1,room:joinExisting?$('room-code').value.trim().toUpperCase():undefined,mode:$('mode').value,team:$('team').value,primary,skins:skins.loadout,agents:agentsUI.loadout,bots:Number($('bots').value)}));});
  socket.addEventListener('message',e=>{if(socket!==activeSocket)return;let data;try{data=JSON.parse(e.data);}catch{return;}
    if(data.type==='welcome'){
      movementSupported=data.movementProtocol===1;movementPrediction.reset();fixed=0;networkAcc=0;
      clearTimeout(timeout);displayedHostBots=null;matchPresentation.reset();myId=data.id;room=data.room;mode=data.mode;connected=true;seq=0;shotId=0;lastShotEvidence=null;remotePlayers.clear();frameSamples.length=0;jumpId=0;reloadId=0;resetScope();controls.clear();lastSentInputSeq=-1;pendingShots=[];self=null;lastSnapshotAlive=false;previousHealth=100;handledEvents.clear();previousWeapon=null;previousReload=0;hud.reset();matchView.reset();spectating=null;diagnostics.event('connected');
      document.exitPointerLock?.();document.body.classList.remove('mouse-captured');$('loading-screen').hidden=true;
      $('menu').hidden=true;$('hud').hidden=false;document.body.classList.add('playing');$('pause-menu').hidden=false;roomMenu.open();
      $('room-label').textContent=room;$('board-room').textContent=`房间 ${room}`;$('room-code').value=room;
      const q=new URL(location.href);q.searchParams.set('room',room);history.replaceState(null,'',q);
      loading=false;$('start-button').disabled=false;$('join-button').disabled=false;
      hud.toast(`已加入 ${data.team} 阵营 · 点击继续进入战场`);
    } else if(data.type==='snapshot'){handleSnapshot(data);}
    else if(data.type==='agentEquipped'){if(pendingAgentEquip?.id===data.agent)pendingAgentEquip.resolve();hud.toast(`已装备 ${getAgent(data.agent)?.name||'探员'}`);}
    else if(data.type==='skinEquipped'){if(pendingSkinEquip?.skin===data.skin)pendingSkinEquip.resolve();hud.toast(`已装备 ${getSkin(data.skin)?.name||'新皮肤'}`);}
    else if(data.type==='purchase'){lastBuyAckAt=performance.now();shop.result(data);if(data.slot>0){lastSlot=slot;slot=data.slot;if(data.slot===4)utilityId=data.weapon;resetScope();}hud.toast(`已购买 ${(EQUIPMENT[data.weapon]||getWeapon(data.weapon)).name}`);}
    else if(data.type==='pong'){ping=Math.round(performance.now()-data.time);}
    else if(data.type==='botsUpdated'){hud.toast(data.ok?'机器人数量已更新':data.message||'更新未完成');}
    else if(data.type==='weaponDropped'){if(data.ok)hud.toast('已丢弃 '+getWeapon(data.weaponId).name);}
    else if(data.type==='error'){if(data.code?.startsWith('AGENT'))pendingAgentEquip?.reject(data.message);if(data.code?.startsWith('SKIN'))pendingSkinEquip?.reject(data.message);if(data.code?.startsWith('BUY'))shop.result({ok:false,message:data.message});hud.toast(data.message||'操作未完成');$('menu-status').textContent=data.message||'服务器拒绝连接';if(!connected){loadError(new Error(data.message||'服务器拒绝连接'));}}
  });
  socket.addEventListener('close',event=>{clearTimeout(timeout);if(socket!==activeSocket)return;const wasConnected=connected;connected=false;loading=false;mouseFire=false;$('start-button').disabled=false;$('join-button').disabled=false;if(wasConnected){diagnostics.event('disconnected',{code:event.code,reason:event.reason.slice(0,120),wasClean:event.wasClean});pendingAgentEquip?.reject('连接已断开');pendingSkinEquip?.reject('连接已断开，请重新加入后装备。');showMenu();$('menu-status').textContent=disconnectMessage(event.code,event.reason);}else if(!$('loading-screen').hidden)loadError(new Error('连接失败，请确认服务器地址和网络后重试')); });
  socket.addEventListener('error',()=>{if(socket!==activeSocket)return;if(!connected)$('menu-status').textContent='无法连接游戏服务器，请稍后重试。';});
}

function handleSnapshot(data){
  const previousRound=snapshot?.round?.number;
  snapshot=data;roomMenu.update(data,myId);utilityEffects.sync(data);droppedWeapons.sync(data);const p=data.players.find(p=>p.id===myId);if(!p)return;
  const relocated=!!self&&(p.team!==self.team||p.lifeId!==self.lifeId||previousRound!==data.round.number);
  if(relocated||!self)remotePlayers.clear();remotePlayers.push(data,performance.now());
  matchPresentation.update(data,myId);
  if($('host-bot-controls')){$('host-bot-controls').hidden=data.hostId!==myId;if(displayedHostBots!==data.desiredBots){displayedHostBots=data.desiredBots;$('host-bots').value=String(data.desiredBots??0);}$('host-bots-status').textContent=`当前 ${data.botCount??0} 个机器人 · 房间最多 10 人`;}
  const life=matchView.update(p,data,performance.now());
  if(life.died||life.respawned){utilityEffects.resetFlash();controls.clear();mouseFire=false;wasFire=false;resetScope();fireTimer=0;pendingShots=[];diagnostics.event(life.died?'death':'respawn');}
  if(previousWeapon!==p.weapon||!p.alive||!lastSnapshotAlive||p.ammo>serverAmmo)pendingShots=[];
  else if(p.ammo<serverAmmo)pendingShots.splice(0,serverAmmo-p.ammo);
  serverAmmo=p.ammo;
  if(previousWeapon!==p.weapon||!p.alive){audio.cancelReload();if(p.weapon==='c4')audio.play('bombDraw',{level:.45});resetScope();}
  if(p.alive&&p.reloadRemaining>0&&(previousReload<=0||previousWeapon!==p.weapon||getWeapon(p.weapon).reloadStyle==='shell'&&p.reloadRemaining>previousReload+.05))audio.weaponReload(p.weapon,{team:p.team,duration:p.reloadDuration||p.reloadRemaining,elapsed:p.reloadElapsed,empty:p.reloadEmpty});
  if(previousWeapon&&getWeapon(previousWeapon).slot>=4&&getWeapon(p.weapon).slot<4){slot=p.slot;mouseFire=false;controls.clear();}
  if(p.weapon==='c4'&&p.bombAction==='plant')slot=5;
  previousWeapon=p.weapon;previousReload=p.reloadRemaining;
  if(!self||p.alive&&!lastSnapshotAlive||relocated){self={...createPlayerState(p),...p};lookYaw=p.yaw;lookPitch=p.pitch;slot=p.slot;camera.position.set(p.x,p.y+1.6,p.z);recoil=0;self.lastJumpId=jumpId;lastStep=p.stepDistance||0;resetScope();if(relocated){controls.clear();pendingShots=[];}}
  else {
    const predicted=movementState(self);Object.assign(self,p,predicted);
    if(movementSupported&&p.alive)movementPrediction.reconcile(self,p);
    else{Object.assign(self,p);movementPrediction.reset(self);}
  }
  if(relocated||!lastSnapshotAlive){movementPrediction.reset(self);fixed=0;}
  if(p.health<previousHealth&&p.alive)hud.damage();previousHealth=p.health;lastSnapshotAlive=p.alive;
  const present=new Set(data.players.map(p=>p.id));for(const [id,actor]of actors){if(!present.has(id)){actor.dispose(scene);actors.delete(id);}}
  for(const other of data.players){
    if(other.id===myId)continue;
    const wanted=other.agentId||DEFAULT_AGENT_IDS[other.team];requestAgent(wanted);
    const visible=loadedPlayerAsset(wanted)?wanted:DEFAULT_AGENT_IDS[other.team],actor=actors.get(other.id);
    // Keep an existing death pose until respawn; a late skin download must not replay it.
    if(actor&&!other.alive&&actor.team===other.team)continue;
    if(!actor||actor.agentId!==visible||actor.team!==other.team){
      const replacement=new PlayerModel(other.team,scene,visible);
      replacement.group.position.set(other.x,other.y,other.z);
      replacement.group.rotation.y=other.yaw;
      actor?.dispose();actors.set(other.id,replacement);
    }
  }
  if(!p.inventory.some(id=>getWeapon(id).slot===slot))slot=p.slot;
  for(const e of data.events||[]){if(e.id&&handledEvents.has(e.id))continue;if(e.id){handledEvents.add(e.id);if(handledEvents.size>512)handledEvents.delete(handledEvents.values().next().value);}hud.event(e,data,myId);handleEvent(e);}
}

function handleEvent(e){
  matchPresentation.handleEvent(e,snapshot,myId);matchAudio.event(e,self);
  if(e.type==='match_end'){controls.clear();mouseFire=false;document.exitPointerLock?.();$('pause-menu').hidden=true;$('buy-menu').hidden=true;}
  if(e.type==='weapon_picked_up'&&e.playerId===myId){slot=self.slot;resetScope();hud.toast(`已拾取 ${getWeapon(e.weaponId).name}`);}
  utilityEffects.event(e,spectating?.id||myId);
  if(e.type==='bomb_exploded')utilityEffects.event({type:'explosion',origin:{x:e.x,y:e.y+.1,z:e.z}},myId);
  if(e.type==='explosion'&&e.origin){audio.play('heExplosion',{level:.7,distance:camera.position.distanceTo(e.origin)});}
  if(e.type==='flash')audio.play('flashExplosion',{level:.3});
  if(e.type==='grenade_thrown')audio.play(e.weapon==='smokegrenade'?'smokeThrow':'heThrow',{level:.4});
  if(e.type==='grenade_thrown')actors.get(e.shooterId)?.throwGrenade(e.mode);
  if(e.type==='grenade_thrown'&&e.shooterId===(spectating?.id||myId))viewWeapon?.shoot({mode:e.mode});
  if(e.type==='grenade_thrown'&&e.shooterId===myId){slot=self?.inventory?.some(id=>getWeapon(id).slot===1)?1:self?.inventory?.some(id=>getWeapon(id).slot===2)?2:3;mouseFire=false;wasFire=false;resetScope();controls.clear();sendInput(currentInput());}
  if(e.type==='shot'){
    if(e.shooterId===myId)lastShotEvidence={weapon:e.weapon,shotId:e.shotId,zoomLevel:e.zoomLevel,accuracy:e.accuracy,rewindMs:e.rewindMs,aim:e.aim,origin:e.origin,end:e.end,hitId:e.hitId,at:performance.now()};
    if(e.weapon!=='knife'&&e.origin&&e.end){const own=e.shooterId===(spectating?.id||myId),muzzle=own?viewWeapon?.getMuzzleWorldPosition(new THREE.Vector3(),camera):null;for(const pellet of e.pellets?.length?e.pellets:[e])effects.shot(e.origin,pellet.end||e.end,own,{weapon:e.weapon,shooterId:e.shooterId,muzzle,hitWorld:pellet.hitWorld??e.hitWorld,segments:pellet.segments||e.segments||[]});}
    if(e.weapon==='knife'&&e.shooterId===myId&&e.hitWorld)audio.knife('wall');
    if(e.shooterId!==myId&&self&&e.origin){const listener=spectating?camera.position:self,listenerYaw=spectating?camera.rotation.y:lookYaw;const dx=e.origin.x-listener.x,dz=e.origin.z-listener.z;const distance=Math.hypot(dx,dz);const pan=(dx*Math.cos(listenerYaw)-dz*Math.sin(listenerYaw))/Math.max(1,distance);audio.shot(e.weapon,distance,pan,{remote:true,team:snapshot.players.find(p=>p.id===e.shooterId)?.team});}
  }
  if(e.type==='hit'&&e.shooterId===myId){audio.hit({headshot:e.headshot,armor:e.armor,weapon:e.weapon});}
  if(e.type==='kill'&&e.killerId===myId){audio.kill({headshot:e.headshot});}
  if(e.type==='buy'&&e.playerId===myId){audio.beep(440,.08,.08);}
}

function localShoot(input,dt){
  pendingFirePress=false;
  fireTimer=Math.max(0,fireTimer-dt);if(!self?.alive)return;const w=getWeapon(self.weapon);
  if(w.slot>=4||self.bombAction){wasFire=input.fire;return;}
  // Reserve ammunition immediately while the authoritative shot is in flight.
  // Rejected inputs expire, so packet loss cannot permanently lock the weapon.
  pendingShots=pendingShots.filter(time=>performance.now()-time<Math.max(1500,ping*4));
  if(input.fire&&self.slot===slot&&(!wasFire||w.automatic)&&fireTimer<=0&&!(self.fireReadyRemaining>0)&&(self.reloadRemaining<=0||w.reloadStyle==='shell'&&self.ammo>0)&&(self.ammo-pendingShots.length>0||w.id==='knife')){
    if(w.id!=='knife')pendingShots.push(performance.now());
    if(w.reloadStyle==='shell'&&self.reloadRemaining>0){audio.cancelReload();self.reloadRemaining=0;}
    sendInput({...input,shotId:++shotId,shotWeapon:w.id});
    fireTimer=w.fireInterval;lastShot=performance.now();if(w.unzoomsAfterShot){resumeZoom=zoomLevel;zoomResumeAt=performance.now()+w.fireInterval*1000;zoomLevel=0;scoped=false;}viewWeapon?.shoot();if(w.slot!==4)audio.shot(w.id,0,0,{team:self.team});recoil=Math.min(.10,recoil+w.recoil*.55);lookPitch=Math.min(1.48,lookPitch+w.recoil*.35);
  }
  wasFire=input.fire;
}

async function lockPointer(){if(!connected||!self||contextLost||snapshot?.match?.status==='ended')return;canvas.focus({preventScroll:true});$('pause-menu').hidden=true;$('buy-menu').hidden=true;controls.clear();try{await audio.start();await canvas.requestPointerLock({unadjustedMovement:true});}catch{try{await canvas.requestPointerLock();}catch{$('pause-menu').hidden=false;hud.toast('请点击继续游戏以启用鼠标控制。');}}}
function showMenu(){matchAudio.stop();bombView.clear();roomMenu.element.hidden=true;displayedHostBots=null;audio.stopAll();effects.clear();utilityEffects.clear();droppedWeapons.clear();hud.reset();matchView.reset();matchPresentation.reset();spectating=null;spectatorLook=null;pendingShots=[];mouseFire=false;wasFire=false;controls.clear();resetScope();document.exitPointerLock?.();document.body.classList.remove('playing');$('menu').hidden=false;$('hud').hidden=true;$('pause-menu').hidden=true;$('buy-menu').hidden=true;$('scoreboard').hidden=true;for(const a of actors.values())a.dispose(scene);actors.clear();self=null;snapshot=null;}
function toggleBuy(){if(!connected)return;if(!self?.alive&&$('buy-menu').hidden){hud.toast('阵亡时无法购买，重生或下一回合后可打开商店。');return;}if($('buy-menu').hidden){$('buy-menu').hidden=false;$('pause-menu').hidden=true;mouseFire=false;resetScope();controls.clear();shop.update({player:{...self,skins:skins.loadout},mode,round:snapshot?.round,time:snapshot?.time});document.exitPointerLock();$('close-buy').focus();}else{$('buy-menu').hidden=true;lockPointer();}}

async function invite(){if(!room)return;if(connection.offline){hud.toast('当前是本机练习；与朋友对战请使用“在线联机”启动入口');return;}let url=new URL(location.href);url.searchParams.set('room',room);if(inviteBase){url=new URL(inviteBase);url.searchParams.set('room',room);}try{await navigator.clipboard.writeText(url.href);hud.toast('邀请链接已复制，发送给朋友即可加入');}catch{hud.toast(`房间 ${room} · ${url.href}`);}}
function setQuality(value){quality=value==='high'?'high':'low';localStorage.setItem('dust2.quality.v2',quality);$('quality').value=quality;applyQuality();}
function setBrightness(value){brightness=Math.max(60,Math.min(160,Number(value)||100));localStorage.setItem('dust2.brightness',brightness);renderer.toneMappingExposure=1.03*brightness/100;}
function applyQuality(){renderer.toneMappingExposure=1.03*brightness/100;renderer.setPixelRatio(quality==='low'?Math.min(1,devicePixelRatio):Math.min(devicePixelRatio,1.5));renderer.shadowMap.enabled=quality!=='low';renderer.setSize(innerWidth,innerHeight);scene.traverse(o=>{if(o.isLight&&o.shadow)o.shadow.needsUpdate=true;});}

function choosePrimary(id,explicit=true){
  primary=id;if(explicit)primaryExplicit=true;
  document.querySelectorAll('[data-primary]').forEach(el=>{const selected=el.dataset.primary===id;el.classList.toggle('selected',selected);el.setAttribute('aria-pressed',String(selected));});
}
function chooseTeam(team){
  $('team').value=team;$('auto-team').setAttribute('aria-pressed',String(team==='auto'));
  document.querySelectorAll('[data-team]').forEach(el=>{const selected=el.dataset.team===team;el.classList.toggle('selected',selected);el.setAttribute('aria-pressed',String(selected));});
  if(!primaryExplicit||team!=='auto'&&!canTeamUseWeapon(team,primary))choosePrimary(defaultPrimaryForTeam(team),false);
  document.querySelectorAll('[data-primary]').forEach(el=>{el.disabled=team!=='auto'&&!canTeamUseWeapon(team,el.dataset.primary);});
}
document.querySelectorAll('[data-team]').forEach(el=>el.addEventListener('click',()=>chooseTeam(el.dataset.team)));
document.querySelectorAll('[data-primary]').forEach(el=>el.addEventListener('click',()=>choosePrimary(el.dataset.primary)));
$('auto-team').addEventListener('click',()=>chooseTeam('auto'));chooseTeam($('team').value);
function updateModeLabels(){const defuse=$('mode').value==='defuse';$('loadout-mode').textContent=defuse?'爆破从手枪局开始，B 购买主武器':'团队死斗开局直接装备';if($('room-mode-note'))$('room-mode-note').textContent=defuse?'13 回合获胜 · 每 12 回合换边 · 12:12 进入加时，每 3 回合换边':'团队击杀累计至 100，比赛结束';if($('lobby-mode-label'))$('lobby-mode-label').textContent=defuse?'竞技爆破':'团队死斗';}
$('mode').addEventListener('change',updateModeLabels);updateModeLabels();
$('host-bots-apply')?.addEventListener('click',()=>{send({type:'setBots',bots:Number($('host-bots').value)});});
$('menu-play-tab')?.addEventListener('click',()=>$('start-button').focus());
$('cancel-load').addEventListener('click',()=>{if(downloadAbort)downloadAbort.abort();else if(!loading)$('loading-screen').hidden=true;});
$('back-load').addEventListener('click',()=>{$('loading-screen').hidden=true;});
$('retry-load').addEventListener('click',()=>start(pendingJoin));

for(const parent of [$('pause-menu').querySelector('.utility-row'),$('invite-button').parentElement]){const button=document.createElement('button');button.className='room-open';button.textContent='房间 / 阵营';button.onclick=()=>{controls.clear();mouseFire=false;roomMenu.update(snapshot,myId);roomMenu.open();};parent.append(button);}
$('start-button').addEventListener('click',()=>start(false));$('join-button').addEventListener('click',()=>{if(!$('room-code').value.trim()){$('menu-status').textContent='请输入朋友发来的房间码。';return;}start(true);});
for(const parent of [$('menu-settings').parentElement,$('game-settings').parentElement]){const button=document.createElement('button');button.type='button';button.textContent='探员仓库';button.className='agents-button';button.onclick=()=>agentsUI.open(self?.team||$('team').value);parent.append(button);}
$('menu-skins').onclick=()=>skins.open();$('game-skins').onclick=()=>skins.open();$('menu-offline').onclick=()=>offlineMenu.open();
$('game-settings').addEventListener('click',()=>settingsUI.open());$('menu-settings').addEventListener('click',()=>settingsUI.open());
$('resume-button').addEventListener('click',lockPointer);
$('invite-button').addEventListener('click',invite);$('pause-invite').addEventListener('click',invite);
$('leave-button').addEventListener('click',()=>{connected=false;socket?.close();socket=null;showMenu();const q=new URL(location.href);q.searchParams.delete('room');history.replaceState(null,'',q);$('menu-status').textContent='已退出房间，可以开始新的对局。';});
$('credits-button').addEventListener('click',()=>$('credits').hidden=false);$('close-credits').addEventListener('click',()=>$('credits').hidden=true);
$('sensitivity').addEventListener('change',e=>{const n=Number(e.target.value);if(!Number.isFinite(n)||n<.05||n>20){e.target.value=sensitivity;return;}sensitivity=n;$('sens-value').textContent=sensitivity.toFixed(2);localStorage.setItem('dust2.cs-settings.v1',JSON.stringify({sensitivity,zoomSensitivity,crosshair:crosshairSettings,quality,brightness}));document.getElementById('cs-sensitivity').value=sensitivity;});
$('volume').addEventListener('input',e=>{volume=Number(e.target.value);audio.setVolume(volume);$('vol-value').textContent=`${Math.round(volume*100)}%`;localStorage.setItem('dust2.volume',volume);});
$('quality').addEventListener('change',e=>setQuality(e.target.value));
document.addEventListener('pointerlockchange',()=>{document.body.classList.toggle('mouse-captured',document.pointerLockElement===canvas);if(document.pointerLockElement!==canvas){controls.clear();mouseFire=false;resetScope();if(connected&&$('buy-menu').hidden&&snapshot?.match?.status!=='ended')$('pause-menu').hidden=false;}else $('pause-menu').hidden=true;});
const pointerMenus=[roomMenu.element,agentsUI.element,$('menu'),$('pause-menu'),$('buy-menu'),settingsUI.element,skins.element,offlineMenu.element];
const pointerGuard=new MutationObserver(()=>{if(pointerMenus.some(menu=>!menu.hidden)&&document.pointerLockElement===canvas)document.exitPointerLock();});
pointerMenus.forEach(menu=>pointerGuard.observe(menu,{attributes:true,attributeFilter:['hidden']}));
document.addEventListener('mousemove',e=>{if(document.pointerLockElement!==canvas||!self?.alive)return;const fov=zoomFov();lookYaw-=e.movementX*mouseRadiansPerCount(sensitivity,'yaw',fov,zoomSensitivity);lookPitch=THREE.MathUtils.clamp(lookPitch-e.movementY*mouseRadiansPerCount(sensitivity,'pitch',fov,zoomSensitivity),-1.48,1.48);});
document.addEventListener('contextmenu',e=>{if(document.pointerLockElement===canvas)e.preventDefault();});
window.addEventListener('blur',()=>{controls.clear();mouseFire=false;resetScope();document.exitPointerLock?.();document.body.classList.remove('mouse-captured');});
window.addEventListener('resize',()=>{camera.aspect=gunCamera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();gunCamera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);});

function frame(now){
  requestAnimationFrame(frame);const frameSeconds=(now-lastTime)/1000,dt=Math.min(.05,Math.max(0,frameSeconds));lastTime=now;fps=THREE.MathUtils.lerp(fps,1/Math.max(.001,frameSeconds),.025);
  if(!loaded||!connected||!self||contextLost)return;
  const cpuStart=performance.now(),renderPlayers=remotePlayers.sample(now);
  fixed+=dt;networkAcc+=dt;hudAcc+=dt;pingAcc+=dt;
  recoil=Math.max(0,recoil-dt*.15);
  const input=currentInput();
  while(fixed>=1/60){if(self.alive){if(movementSupported)movementPrediction.step(self,input,snapshot.round.phase==='live');else if(snapshot.round.phase==='live')stepPlayer(self,input,1/60);}localShoot(input,1/60);fixed-=1/60;}
  if(networkAcc>=1/30){networkAcc%=1/30;sendInput(input);}
  if(pingAcc>=2){pingAcc=0;send({type:'ping',time:performance.now()});}
  if(self.grounded&&controlsEnabled()&&Math.hypot(self.vx,self.vz)>.8&&(self.stepDistance||0)-lastStep>(self.crouch?2.6:1.8)){audio.step();lastStep=self.stepDistance;}
  const renderedPosition=movementSupported?movementPrediction.render(self,fixed*60,dt):self;
  const eye=self.alive?eyePosition({...self,...renderedPosition}):{x:self.x,y:self.y+.75,z:self.z};
  camera.position.set(eye.x,eye.y,eye.z);
  camera.rotation.set(aimPitch(lookPitch,recoil),lookYaw,0,'YXZ');if(!self.alive)resetScope();
  if(!self.alive){const death=matchView.deathCamera(now);if(death){camera.position.set(death.x,death.y,death.z);camera.rotation.set(death.pitch,death.yaw,death.roll,'YXZ');}}
  spectating=matchView.spectating(self,snapshot,now);
  if(spectating)spectating=renderPlayers.find(p=>p.id===spectating.id)||spectating;
  if(spectating){const actor=actors.get(spectating.id);const position=actor?.group.position||spectating;camera.position.set(position.x,position.y+(spectating.crouch?.95:1.62),position.z);if(spectatorLook?.id!==spectating.id)spectatorLook={id:spectating.id,yaw:spectating.yaw,pitch:spectating.pitch};const blend=1-Math.exp(-12*dt),delta=Math.atan2(Math.sin(spectating.yaw-spectatorLook.yaw),Math.cos(spectating.yaw-spectatorLook.yaw));spectatorLook.yaw+=delta*blend;spectatorLook.pitch=THREE.MathUtils.lerp(spectatorLook.pitch,spectating.pitch,blend);camera.rotation.set(spectatorLook.pitch,spectatorLook.yaw,0,'YXZ');}else spectatorLook=null;
  if(resumeZoom&&now>=zoomResumeAt&&controlsEnabled()&&getWeapon(self.weapon).unzoomsAfterShot&&self.reloadRemaining<=0&&self.ammo>0){zoomLevel=resumeZoom;scoped=true;resumeZoom=0;}
  const viewed=spectating||self,renderZoom=spectating?(spectating.zoomLevel||0):zoomLevel,renderFov=getWeapon(viewed.weapon).zoomFovs?.[renderZoom]||CS2_BASE_FOV;
  const targetFov=cs2FovToVertical(renderFov);if(camera.fov!==targetFov){camera.fov=Math.abs(camera.fov-targetFov)<.1?targetFov:THREE.MathUtils.lerp(camera.fov,targetFov,Math.min(1,dt/.05));camera.updateProjectionMatrix();}
  const renderWeapon=getWeapon(viewed.weapon),fullScope=renderZoom>0&&renderWeapon.zoomStyle==='scope',optic=renderZoom>0&&renderWeapon.zoomStyle==='optic';
  scopeOverlay.update({weapon:renderWeapon,zoomLevel:renderZoom,accuracy:accuracyForShot(renderWeapon,viewed,renderZoom).total,verticalFov:camera.fov});
  crosshair.update({scoped:fullScope||optic,alive:self.alive,spread:Math.hypot(self.vx,self.vz),recoilY:0});

  const actorStart=performance.now();camera.updateMatrixWorld();visibilityFrustum.setFromProjectionMatrix(visibilityMatrix.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
  for(const p of renderPlayers){if(p.id===myId)continue;const actor=actors.get(p.id);if(!actor)continue;actorBounds.center.set(p.x,p.y+.9,p.z);const visible=visibilityFrustum.intersectsSphere(actorBounds);actor.group.visible=visible;const distance=camera.position.distanceTo(actorBounds.center);actor.update(p,dt,{exactPosition:true,animationRate:visible?(distance<25?60:30):12});}
  const actorMs=performance.now()-actorStart;
  viewWeapon?.update(dt,viewed,fullScope,{optic});if(!fullScope)weaponLighting.update(scene,camera);effects.update(dt);utilityEffects.update(dt,camera,self.alive||!!spectating);bombView.update(snapshot.bomb,now);matchAudio.update(snapshot,camera.position,now);
  if(hudAcc>.075){hudAcc=0;hud.update(snapshot,self,{ping,fps:Math.round(fps),spectating,scoreboardKey:formatBinding(controls.getBindings().scoreboard[0]),menuKey:formatBinding(controls.getBindings().menu[0]),nextSpectatorKey:formatBinding(controls.getBindings().fire[0]),previousSpectatorKey:formatBinding(controls.getBindings().altFire[0])});$('weapon-skin').textContent=getWeapon(self.weapon).slot>=4?'原厂装备':getSkin(self.skinId)?.name||getWeapon(self.weapon).skin;if(!$('buy-menu').hidden)shop.update({player:{...self,skins:skins.loadout},mode,round:snapshot.round,time:snapshot.time});}
  droppedWeapons.update(self,camera,equipmentControlsEnabled(),formatBinding(controls.getBindings().interact[0]));
  const observedActor=spectating&&actors.get(spectating.id);if(observedActor)observedActor.group.visible=false;
  const renderStart=performance.now();renderer.info.reset();renderer.autoClear=true;renderer.render(scene,camera);
  if(observedActor)observedActor.group.visible=true;
  if((self.alive||spectating)&&!fullScope){renderer.autoClear=false;renderer.clearDepth();renderer.render(gunScene,gunCamera);renderer.autoClear=true;}
  frameSamples.push({frame:frameSeconds*1000,cpu:performance.now()-cpuStart,actors:actorMs,render:performance.now()-renderStart});if(frameSamples.length>300)frameSamples.shift();
}
requestAnimationFrame(frame);
function resourceMetrics(){return {fps:Math.round(fps),ping,connected,contextLost,geometries:renderer.info.memory.geometries,textures:renderer.info.memory.textures,programs:renderer.info.programs?.length||0,actors:actors.size,effects:effects.items.length,audioVoices:audio.voices.size,viewWeapons:viewWeapon?.cache.size||0,heapMiB:performance.memory?Math.round(performance.memory.usedJSHeapSize/1048576):null,timing:frameStats()};}
setInterval(()=>{if(loaded)diagnostics.sample(resourceMetrics());},10000);
window.addEventListener('error',event=>diagnostics.event('javascript-error',{message:String(event.message).slice(0,300)}));
window.addEventListener('unhandledrejection',event=>diagnostics.event('unhandled-rejection',{message:String(event.reason?.message||event.reason).slice(0,300)}));
window.addEventListener('pagehide',event=>diagnostics.event('page-hide',{persisted:event.persisted}));
for(const parent of [$('pause-menu').querySelector('.pause-actions'),$('menu').querySelector('footer')||$('menu').querySelector('.utility-row')||$('menu').querySelector('main')]){const button=document.createElement('button');button.textContent='导出运行诊断';button.className='diagnostics-button';button.onclick=()=>diagnostics.download();parent.append(button);}
const recovery=document.createElement('div');recovery.id='graphics-recovery';recovery.className='overlay';recovery.hidden=true;recovery.innerHTML='<section class="pause-card"><div class="eyebrow">DUST II / GRAPHICS</div><h2>正在恢复游戏画面</h2><p>浏览器中断了 3D 渲染，正在等待显卡恢复。若长时间没有恢复，可重新载入；已缓存的资源会继续复用。</p><button class="primary-button" id="reload-graphics">重新载入游戏</button><button id="graphics-report">导出运行诊断</button></section>';document.body.append(recovery);
$('reload-graphics').onclick=()=>location.reload();$('graphics-report').onclick=()=>diagnostics.download();
canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();contextLost=true;diagnostics.event('webgl-context-lost',resourceMetrics());controls.clear();mouseFire=false;resetScope();document.exitPointerLock?.();recovery.hidden=false;});
canvas.addEventListener('webglcontextrestored',()=>{try{rebuildWeaponEnvironment();applyQuality();contextLost=false;diagnostics.event('webgl-context-restored');recovery.hidden=true;if(connected)$('pause-menu').hidden=false;}catch(error){diagnostics.event('graphics-recovery-failed',{message:String(error.message).slice(0,300)});}});
window.__dust2={getDiagnostics:()=>diagnostics.report(),getStatus:()=>({viewModel:{id:viewWeapon?.id,skinId:viewWeapon?.skinId,waiting:viewWeapon?.waiting||false,visible:viewWeapon?.group.visible||false,action:viewWeapon?.active?.actionName},music:matchAudio.status(),loaded,connected,contextLost,spectatingId:spectating?.id||null,resources:resourceMetrics(),room,mode,myId,fps:Math.round(fps),ping,player:self?{...self}:null,players:snapshot?.players||[],round:snapshot?.round,match:snapshot?.match,hostId:snapshot?.hostId,desiredBots:snapshot?.desiredBots,seats:snapshot?.seats,droppedWeapons:snapshot?.droppedWeapons||[],bomb:snapshot?.bomb,drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,mapVersion:MAP.version,sky:scene.userData.sky,zoomLevel,zoomFov:zoomFov(),cameraFov:camera.fov,cameraPosition:{x:camera.position.x,y:camera.position.y,z:camera.position.z},cameraAim:{yaw:camera.rotation.y,pitch:camera.rotation.x},lastShot:lastShotEvidence,renderPlayers:remotePlayers.sample(performance.now()),viewTime:remotePlayers.viewTime,movement:movementPrediction.status(),settings:{sensitivity,zoomSensitivity,crosshair:crosshairSettings,quality,brightness},bindings:controls.getBindings(),jumpId,reloadId,utilityId,agentLoadout:{...agentsUI.loadout},grenades:snapshot?.grenades||[],smokes:snapshot?.smokes||[]})};
