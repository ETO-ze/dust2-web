import {visibleAimPoint,observationPoint,lookAt,hearGunshot} from './bot-perception.js';
import {combatSlot} from './bot-utility.js';
import {tacticalGoal,shareSighting,botUtility,separateTeammates} from './bot-tactics.js';
import { randomBytes } from 'node:crypto';
import { MAP } from '../shared/map-data.js';
import { createPlayerState, stepPlayer, raycastWorld, raycastWorldContact } from '../shared/physics.js';
import { WEAPONS, PRIMARY_WEAPONS, getWeapon, normalizeWeapon, canTeamUseWeapon, defaultPrimaryForTeam, weaponSpeedScale } from '../shared/weapons.js';
import { DEFAULT_SKINS, getSkin, normalizeSkinLoadout } from '../shared/skins.js';
import { DEFAULT_AGENT_IDS, getAgent, normalizeAgentLoadout } from '../shared/agents.js';
import { EQUIPMENT, UTILITY_IDS, MAX_GRENADES, getEquipment, canTeamBuyEquipment, equipmentPrice, grenadeCount } from '../shared/equipment.js';
import { GrenadeSimulation } from './grenades.js';
import { MATCH_RULES, botCount, defuseDecision, grenadeMode, grenadeStrength } from '../shared/match-rules.js';
import { BOT_AIM, smoothBotAim } from './bot-aim.js';
import { DroppedWeapons } from './dropped-weapons.js';
import { traceBullet as defaultTraceBullet } from './bullet-penetration.js';
import {eyePosition,accuracyForShot,sampleShotDirection} from '../shared/aim.js';
import {PlayerTimeline,MAX_REWIND_MS} from '../shared/player-timeline.js';
import {MovementStream,sanitizeMoves,movementState} from '../shared/movement-commands.js';
import {reloadProfile} from '../shared/reload-profiles.js';
import {traceKnife,knifeDamage,knifeInterval} from '../shared/melee.js';

export const TICK_RATE = 30;
export const SNAPSHOT_RATE = 15;
export const RULES = Object.freeze({ freezeSeconds: 6, roundSeconds: 115, endSeconds: 5, buySeconds: 25, plantSeconds: 3, defuseSeconds: 10, defuseKitSeconds: 5, bombSeconds: 40, respawnSeconds: 3, protectionSeconds: 2 });
const MAX_PLAYERS = 10;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lengthXZ = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const copyPoint = p => ({ x: p.x, y: p.y, z: p.z });
const eye = eyePosition;
const neutralInput = () => ({ forward: 0, right: 0, yaw: 0, pitch: 0, jump: false, crouch: false, walk: false, fire: false, fire2:false, cancelGrenade:false, reload: false, interact: false, slot: 0 });
const opposite = t => t === 'T' ? 'CT' : 'T';
const finite = v => typeof v === 'number' && Number.isFinite(v);
const round2 = n => Number.isFinite(n) ? Math.round(n * 1000) / 1000 : 0;

export function sanitizeInput(message) {
  if (!message || typeof message!=='object' || !Number.isSafeInteger(message.seq) || message.seq < 0 || message.seq > 2147483647) return null;
  if (!['forward', 'right', 'yaw', 'pitch'].every(k => finite(message[k]))) return null;
  return { seq: message.seq, forward: clamp(message.forward, -1, 1), right: clamp(message.right, -1, 1), yaw: ((message.yaw + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI,
    jumpId: Number.isSafeInteger(message.jumpId)&&message.jumpId>=0&&message.jumpId<=2147483647?message.jumpId:0, reloadId: Number.isSafeInteger(message.reloadId)&&message.reloadId>=0&&message.reloadId<=2147483647?message.reloadId:0, pitch: clamp(message.pitch, -1.48, 1.48), jump: message.jump === true, crouch: message.crouch === true,
    walk: message.walk === true, fire: message.fire === true, fire2:message.fire2===true, cancelGrenade:message.cancelGrenade===true, reload: message.reload === true,
    interact: message.interact === true, slot: [1, 2, 3, 4, 5].includes(message.slot) ? message.slot : 0,
    utilityId: UTILITY_IDS.includes(message.utilityId) ? message.utilityId : null,
    zoomLevel: Number.isInteger(message.zoomLevel) && message.zoomLevel >= 0 && message.zoomLevel <= 2 ? message.zoomLevel : 0,
    shotId:Number.isSafeInteger(message.shotId)&&message.shotId>0&&message.shotId<=2147483647?message.shotId:0,
    shotWeapon:typeof message.shotWeapon==='string'&&Object.hasOwn(WEAPONS,message.shotWeapon)?message.shotWeapon:null,
    viewTime:finite(message.viewTime)?message.viewTime:null,moves:sanitizeMoves(message.moves),moveId:Number.isSafeInteger(message.moveId)&&message.moveId>0&&message.moveId<=2147483647?message.moveId:0 };
}

export function directionFromAngles(yaw, pitch) {
  const c = Math.cos(pitch);
  return { x: -Math.sin(yaw) * c, y: Math.sin(pitch), z: -Math.cos(yaw) * c };
}

function sphereHit(origin, dir, center, radius) {
  const ox = origin.x - center.x, oy = origin.y - center.y, oz = origin.z - center.z;
  const b = ox * dir.x + oy * dir.y + oz * dir.z;
  const c = ox * ox + oy * oy + oz * oz - radius * radius;
  const discriminant = b * b - c;
  if (discriminant < 0) return null;
  const d = -b - Math.sqrt(discriminant);
  return d >= 0 ? d : (-b + Math.sqrt(discriminant) >= 0 ? 0 : null);
}

function boxHit(origin, dir, lo, hi) {
  let near = 0, far = Infinity;
  for (const axis of ['x', 'y', 'z']) {
    if (Math.abs(dir[axis]) < 1e-8) { if (origin[axis] < lo[axis] || origin[axis] > hi[axis]) return null; continue; }
    let a = (lo[axis] - origin[axis]) / dir[axis], b = (hi[axis] - origin[axis]) / dir[axis];
    if (a > b) [a, b] = [b, a];
    near = Math.max(near, a); far = Math.min(far, b);
    if (near > far) return null;
  }
  return far >= 0 ? near : null;
}

export function rayHitPlayer(origin, direction, player, maxDistance = Infinity) {
  const height = player.crouch ? 1.1 : 1.8;
  const head = sphereHit(origin, direction, { x: player.x, y: player.y + height - 0.18, z: player.z }, 0.22);
  const body = boxHit(origin, direction, { x: player.x - 0.28, y: player.y + 0.08, z: player.z - 0.28 }, { x: player.x + 0.28, y: player.y + height - 0.39, z: player.z + 0.28 });
  if (head !== null && head <= maxDistance && (body === null || head <= body)) return { distance: head, headshot: true };
  return body !== null && body <= maxDistance ? { distance: body, headshot: false } : null;
}

function clearSight(a, b) {
  const d = dist(a, b);
  if (d < 0.01) return true;
  const hit = raycastWorld(a, { x: (b.x - a.x) / d, y: (b.y - a.y) / d, z: (b.z - a.z) / d }, d);
  return hit === null || hit >= d - 0.18;
}

export function applyArmorDamage(rawDamage, player, { headshot=false, armorRatio=1, bypassArmor=false }={}) {
  const armorHit=!bypassArmor&&player.armor>0&&(!headshot||player.helmet===true);
  let damage=rawDamage;
  if(armorHit){const protectedDamage=rawDamage*Math.min(1,Math.max(0,armorRatio*.5)),cost=(rawDamage-protectedDamage)*.5;
    if(cost>player.armor){damage=rawDamage-player.armor*2;player.armor=0;}else{damage=protectedDamage;player.armor-=cost;}}
  return {damage:Math.max(0,Math.round(damage)),armor:armorHit};
}

export class GameRoom {
  constructor(code, { mode = 'defuse', bots = 6, clock = () => Date.now(), rules = {}, traceBullet=defaultTraceBullet } = {}) {
    this.code = code; this.mode = mode==='deathmatch'?'deathmatch':'defuse'; this.desiredBots = botCount(bots);
    mode=this.mode;this.traceBullet=traceBullet;this.hostId=null;
    this.clock = clock; this.rules = { ...RULES, ...rules }; this.players = new Map(); this.clients = new Map();
    this.scores = { T: 0, CT: 0 }; this.events = []; this.eventCounter = 0; this.botCounter = 0; this.spawnCounter = { T: 0, CT: 0 };
    this.teamSides={A:'CT',B:'T'};
    this.match={status:'live',period:'regulation',roundsPlayed:0,overtimeNumber:0,winTarget:mode==='deathmatch'?MATCH_RULES.deathmatchWinTarget:13,winnerTeamId:null};
    this.pendingTransition=null;
    this.createdAt = clock(); this.round = { number: 0, phase: mode === 'deathmatch' ? 'live' : 'waiting', phaseEndsAt: 0, buyEndsAt: 0, winner: null, reason: '' };
    this.bomb = this.emptyBomb();
    this.nav = Array.isArray(MAP.nav) ? MAP.nav : [];
    this.navMap = new Map(this.nav.map(n => [String(n.id), n]));
    this.grenades=new GrenadeSimulation({clock,raycastWorld,raycastContact:raycastWorldContact,onFire:(fire,config)=>this.burnPlayers(fire,config),emit:(type,fields)=>this.emit(type,fields),onExplosion:(grenade,config)=>this.explodeGrenade(grenade,config),onFlash:(grenade,config)=>this.flashGrenade(grenade,config)});
    this.defuseKits=[];this.kitSerial=0;
    this.droppedWeapons=new DroppedWeapons({clock,raycastWorld});
    this.poseHistory=new PlayerTimeline(16);
  }

  emptyBomb() { return { state: 'none', carrierId: null, x: 0, y: 0, z: 0, site: null, plantedAt: 0, explodesAt: 0, planterId: null, actorId: null, action: null, progress: 0, remaining: 0 }; }
  emit(type, fields = {}) { this.events.push({ type, id: `${this.code}:${++this.eventCounter}`, time: this.clock(), ...fields }); if (this.events.length > 300) this.events.splice(0, this.events.length - 300); }
  count(team, humansOnly = false) { return [...this.players.values()].filter(p => p.team === team && (!humansOnly || !p.bot)).length; }
  get humanCount() { return this.clients.size; }
  get botCount(){return [...this.players.values()].filter(p=>p.bot).length;}
  teamForSide(side){return this.teamSides.A===side?'A':'B';}
  matchSnapshot(){return {...this.match,teams:Object.fromEntries(Object.entries(this.teamSides).map(([id,side])=>[id,{side,score:this.scores[side]}]))};}
  setBots(id,value){
    if(id!==this.hostId)return {ok:false,message:'只有房主可以设置机器人数量。'};
    if(!Number.isInteger(value)||value<0||value>9)return {ok:false,message:'机器人数量必须为 0–9 的整数。'};
    this.desiredBots=value;this.ensureBots();this.maybeStart();
    const result={ok:true,bots:value,desiredBots:value,botCount:this.botCount,hostId:this.hostId};
    this.emit('bots_changed',result);return result;
  }

  freeSeat(team){return [0,1,2,3,4].find(seat=>![...this.players.values()].some(p=>p.team===team&&p.seat===seat))??-1;}
  roomSeats(){return Object.fromEntries(['CT','T'].map(team=>[team,Array.from({length:5},(_,seat)=>{
    const p=[...this.players.values()].find(p=>p.team===team&&p.seat===seat);
    return {team,seat,playerId:p?.id||null,name:p?.name||'',bot:!!p?.bot,alive:!!p?.alive,host:p?.id===this.hostId};
  })]));}
  takeSeat(id,team,seat){
    const p=this.players.get(id);
    if(!p||p.bot||!['T','CT'].includes(team)||!Number.isInteger(seat)||seat<0||seat>4)return {ok:false,message:'无效的房间位置。'};
    if([...this.players.values()].some(other=>other.id!==id&&other.team===team&&other.seat===seat))return {ok:false,message:'这个位置已有人，请选择空位。'};
    if(p.team!==team){
      if(p.hasBomb)this.dropBomb(p);
      this.cancelReload(p);this.cancelGrenade(p,'team');
      if(this.bomb.actorId===id)Object.assign(this.bomb,{actorId:null,action:null,progress:0});
      p.team=team;p.teamId=this.teamForSide(team);p.agentId=p.agents[team]||DEFAULT_AGENT_IDS[team];
      p.inventory={};this.giveWeapon(p,team==='CT'?'usp':'pistol');this.giveWeapon(p,'knife');
      p.weapon=team==='CT'?'usp':'pistol';p.slot=2;p.armor=0;p.helmet=false;p.defuseKit=false;p.loadoutPrimary=defaultPrimaryForTeam(team);
      this.respawn(p);
      if(this.match.status==='ended'||this.mode==='defuse'&&['live','ended'].includes(this.round.phase)){p.alive=false;p.health=0;p.respawnAt=0;}
    }
    p.seat=seat;this.maybeStart();this.emit('seat_changed',{playerId:id,team,seat});return {ok:true,team,seat};
  }
  setSeatBot(id,team,seat,enabled){
    if(id!==this.hostId)return {ok:false,message:'只有房主可以添加或移除人机。'};
    if(!['T','CT'].includes(team)||!Number.isInteger(seat)||seat<0||seat>4||typeof enabled!=='boolean')return {ok:false,message:'无效的房间位置。'};
    const occupant=[...this.players.values()].find(p=>p.team===team&&p.seat===seat);
    if(occupant&&!occupant.bot)return {ok:false,message:'玩家位置不能替换为人机。'};
    if(enabled&&!occupant){
      const number=++this.botCounter,p=this.makePlayer(`b_${number}`,`${team==='T'?'沙狐':'哨兵'} BOT ${number}`,team,true);p.seat=seat;
      if(this.match.status==='ended'||this.mode==='defuse'&&['live','ended'].includes(this.round.phase)){p.alive=false;p.health=0;}
      this.players.set(p.id,p);
    }else if(!enabled&&occupant)this.removePlayer(occupant.id);
    this.desiredBots=this.botCount;this.maybeStart();this.emit('bots_changed',{botCount:this.botCount,desiredBots:this.desiredBots});return {ok:true,botCount:this.botCount};
  }

  addHuman(socket, { name, team = 'auto', primary = 'auto', skins, agents, movementProtocol }) {
    if (this.humanCount >= MAX_PLAYERS) throw new Error('房间已满，最多 10 名玩家。');
    let assigned = team;
    if (!['T', 'CT'].includes(assigned)) assigned = this.count('T', true) <= this.count('CT', true) ? 'T' : 'CT';
    if (this.count(assigned, true) >= 5) { if (team !== 'auto') throw new Error('该阵营已有 5 名玩家，请选择另一队。'); assigned = opposite(assigned); }
    const botToReplace = (this.count(assigned)>=5||this.players.size>=10)?[...this.players.values()].find(p=>p.bot&&p.team===assigned)||[...this.players.values()].find(p=>p.bot):null;
    if (botToReplace) this.removePlayer(botToReplace.id);
    const id = `p_${randomBytes(6).toString('hex')}`;
    const player = this.makePlayer(id, name, assigned, false, primary);
    if(movementProtocol===1){player.movementStream=new MovementStream(player.lifeId);player.movementAt=this.clock();}
    player.skins=normalizeSkinLoadout(skins);
    player.agents=normalizeAgentLoadout(agents);player.agentId=player.agents[assigned];
    this.players.set(id, player); this.clients.set(id, socket);
    if(!this.hostId)this.hostId=id;
    if (this.match.status==='ended'||(this.mode === 'defuse' && ['live', 'ended'].includes(this.round.phase))) { player.alive = false; player.health = 0; player.respawnAt = 0; }
    this.ensureBots();
    this.emit('join', { playerId: id, name, team: assigned, bot: false });
    this.maybeStart();
    return player;
  }

  makePlayer(id, name, team, bot, primary = 'auto') {
    const player = { ...createPlayerState(this.pickSpawn(team)), id, seat:this.freeSeat(team), lifeId:1,name, team, teamId:this.teamForSide(team), bot, health: 100, armor: this.mode === 'deathmatch' ? 100 : 0, alive: true,
      money: this.mode === 'deathmatch' ? 16000 : 800, kills: 0, roundKills:0,lifeKills:0,killCards:[],deaths: 0, assists: 0, inventory: {}, skins:{...DEFAULT_SKINS}, slot: this.mode === 'deathmatch' ? 1 : 2,
      helmet:this.mode==='deathmatch',defuseKit:false,zoomLevel:0,flashBlindUntil:0,agents:{...DEFAULT_AGENT_IDS},agentId:DEFAULT_AGENT_IDS[team],
      weapon: 'pistol', input: neutralInput(), inputAt: 0, seq: -1, lastReceivedSeq: -1, lastShotTime: 0, nextShotAt: 0, reloadEndsAt: 0,
      respawnAt: 0, protectionUntil: this.clock() + this.rules.protectionSeconds * 1000, triggerWasDown: false, hasBomb: false,
      grenadeState:null,grenadeRequireRelease:false,pendingInteract:false,interactWasDown:false,
      botAI: { nextThinkAt: 0, targetId: null, path: [], goal: null, lastKnown: null, lastSeenAt: 0, reactionAt: 0, stuckAt: this.clock(), previous: null, wanderAt: 0, strafe: Math.random() < 0.5 ? -1 : 1 },
    };
    this.giveWeapon(player, team === 'CT' ? 'usp' : 'pistol'); this.giveWeapon(player, 'knife');
    primary=normalizeWeapon(primary);
    player.loadoutPrimary=PRIMARY_WEAPONS.includes(primary)&&canTeamUseWeapon(team,primary)?primary:defaultPrimaryForTeam(team);
    if (this.mode === 'deathmatch') this.giveWeapon(player,player.loadoutPrimary);
    this.selectSlot(player, player.slot);
    player.input.yaw = player.yaw || 0;
    return player;
  }

  pickSpawn(team) {
    const pool = MAP.spawns?.[team];
    if (!Array.isArray(pool) || !pool.length) throw new Error(`Map has no ${team} spawn points`);
    // Favor a spawn with fewer visible opponents, then rotate equivalent candidates.
    const order = this.spawnCounter[team]++;
    const candidates = pool.map((p, i) => ({ p, score: [...this.players.values()].filter(e => e.alive && e.team !== team).reduce((s, e) => s + Math.max(0, 30 - lengthXZ(p, e)), 0), tie: (i - order % pool.length + pool.length) % pool.length }));
    candidates.sort((a, b) => a.score - b.score || a.tie - b.tie);
    return candidates[0].p;
  }

  ensureBots() {
    const wanted = Math.min(this.desiredBots, MAX_PLAYERS - this.humanCount);
    let bots = [...this.players.values()].filter(p => p.bot);
    while (bots.length > wanted) { this.removePlayer(bots.pop().id); }
    while (bots.length < wanted) {
      const team = this.count('T') <= this.count('CT') ? 'T' : 'CT';
      const number = ++this.botCounter;
      const player = this.makePlayer(`b_${number}`, `${team === 'T' ? '沙狐' : '哨兵'} BOT ${number}`, team, true);
      this.players.set(player.id, player); bots.push(player);
      if (this.match.status==='ended'||(this.mode === 'defuse' && ['live', 'ended'].includes(this.round.phase))) { player.alive = false; player.health = 0; }
    }
  }

  removePlayer(id) {
    const player = this.players.get(id);
    if (!player) return;
    if(player.botAI?.utility&&!player.botAI.utility.released)this.utilityClaims?.delete(player.botAI.utility.key);
    if (player.hasBomb) this.dropBomb(player);
    this.players.delete(id); this.clients.delete(id);
    if(this.hostId===id){this.hostId=this.clients.keys().next().value||null;this.emit('host_changed',{hostId:this.hostId});}
    this.emit('leave', { playerId: id, name: player.name, bot: player.bot });
  }

  receiveInput(id, message) {
    const player = this.players.get(id), input = sanitizeInput(message);
    if (!player || !input || input.seq <= player.lastReceivedSeq) return false;
    if(input.moves.length){if(!player.movementStream){player.movementStream=new MovementStream(player.lifeId);player.movementAt=this.clock();}player.movementStream.receive(input.moves);}
    // Retain the complete click sample. A later release/turn/unzoom/switch must
    // not overwrite the aim that actually fired. New clients send one shot ID
    // per predicted shot; legacy clients still use rising edges and held fire.
    const explicit=input.shotId>0;
    if(explicit)player.shotCommands=true;
    const attacking=input.fire||(input.slot===3&&input.fire2);
    if(attacking&&input.slot!==4&&((explicit&&input.shotId>(player.lastShotId||0))||(!player.shotCommands&&(!player.input.fire&&!player.input.fire2)))){
      const weaponId=input.shotWeapon||player.weapon;
      if(player.inventory[weaponId]&&getWeapon(weaponId).slot!==4){
        player.fireQueue||=[];
        if(player.fireQueue.length<4)player.fireQueue.push({input:{...input},weaponId,receivedAt:this.clock(),lifeId:player.lifeId});
      }
      player.lastShotId=Math.max(player.lastShotId||0,input.shotId);
    }
    if(input.interact&&!player.input.interact)player.pendingInteract=true;
    this.captureGrenadeInput(player,input);
    input.jumpId=Math.max(player.input.jumpId||0,input.jumpId);input.reloadId=Math.max(player.input.reloadId||0,input.reloadId);
    player.lastReceivedSeq = input.seq; player.input = input; player.inputAt = this.clock();
    return true;
  }

  giveWeapon(player, id) { const w = getWeapon(id); player.inventory[w.id] = { ammo: w.magazine, reserve: w.reserve }; }
  fireQueued(player){
    const queue=player.fireQueue,now=this.clock();if(!queue?.length)return false;
    while(queue.length&&(now-queue[0].receivedAt>150||queue[0].lifeId!==player.lifeId||!player.inventory[queue[0].weaponId]))queue.shift();
    if(!queue.length)return false;
    const command=queue[0];
    if(command.weaponId!==player.weapon){queue.shift();return true;}
    if(player.movementStream&&command.input.moveId>player.movementStream.ack)return true;
    if(now<player.nextShotAt)return true;
    queue.shift();player.triggerWasDown=false;
    this.fire(player,command.input,command);return true;
  }

  recordPoses(){this.poseHistory.push(this.clock(),[...this.players.values()].map(p=>({id:p.id,x:p.x,y:p.y,z:p.z,yaw:p.yaw,pitch:p.pitch,crouch:p.crouch,alive:p.alive,team:p.team,lifeId:p.lifeId,protectionUntil:p.protectionUntil})));}
  shotTargets(viewTime,receivedAt){
    const current=[...this.players.values()];if(!Number.isFinite(viewTime))return {players:current,rewindMs:0};
    const time=clamp(viewTime,receivedAt-MAX_REWIND_MS,receivedAt),past=new Map(this.poseHistory.sample(time).map(p=>[p.id,p]));
    return {rewindMs:Math.round(receivedAt-time),players:current.map(p=>{const old=past.get(p.id);return old?.alive&&p.alive&&old.lifeId===p.lifeId&&old.team===p.team?{...p,x:old.x,y:old.y,z:old.z,crouch:old.crouch}:p;})};
  }
  selectSlot(player, slot, utilityId=null) {
    const next = slot===4 ? (UTILITY_IDS.includes(utilityId)&&player.inventory[utilityId]?.ammo>0?utilityId:null) : Object.keys(player.inventory).find(id => getWeapon(id).slot === slot);
    if (!next || next === player.weapon) return;
    if(player.grenadeState&&player.grenadeState.weapon!==next)this.cancelGrenade(player,'switch');
    this.cancelReload(player);
    player.weapon = next; player.slot = slot;player.zoomLevel=0;
    player.nextShotAt = Math.max(player.nextShotAt, this.clock() + 180);
  }

  equipSkin(id,weapon,skinId){
    const player=this.players.get(id),skin=getSkin(skinId);
    if(!player||!skin||skin.weapon!==weapon)return {ok:false,message:'无效的武器皮肤。'};
    player.skins[weapon]=skin.id;
    if(player.inventory[weapon])delete player.inventory[weapon].skinId;
    return {ok:true,weapon,skin:skin.id};
  }

  equipAgent(id,agentId){
    const player=this.players.get(id),agent=getAgent(agentId);
    if(!player||!agent||agent.team!==player.team)return {ok:false,message:'请选择当前阵营可用的探员。'};
    player.agentId=agent.id;player.agents[player.team]=agent.id;
    return {ok:true,agent:agent.id,team:agent.team};
  }

  buyStatus(p) {
    if(this.match.status==='ended')return {buyAllowed:false,buyReason:'本场比赛已经结束。'};
    if(!p?.alive)return {buyAllowed:false,buyReason:'存活时才可以购买。'};
    if(this.mode==='defuse'){
      if(!['freeze','live'].includes(this.round.phase)||this.clock()>this.round.buyEndsAt)return {buyAllowed:false,buyReason:'购买时间已经结束。'};
      if(!MAP.spawns[p.team].some(s=>lengthXZ(s,p)<9&&Math.abs(s.y-p.y)<3))return {buyAllowed:false,buyReason:'请在己方出生区购买。'};
    }
    return {buyAllowed:true,buyReason:''};
  }

  buy(id, rawWeapon) {
    const p = this.players.get(id);
    if (!p?.alive) return { ok: false, message: '存活时才可以购买。' };
    if (typeof rawWeapon !== 'string') return { ok: false, message: '无效的购买物品。' };
    const availability=this.buyStatus(p);if(!availability.buyAllowed)return {ok:false,message:availability.buyReason};
    const weapon = normalizeWeapon(rawWeapon);
    const equipment=getEquipment(weapon),gun=Object.hasOwn(WEAPONS,weapon)?WEAPONS[weapon]:null;
    if(!equipment&&(!gun||![1,2].includes(gun.slot)))return {ok:false,message:'无效的购买物品。'};
    if(equipment?!canTeamBuyEquipment(p.team,weapon):!canTeamUseWeapon(p.team,weapon))return {ok:false,message:'该装备不在当前阵营的购买清单中。'};
    if(equipment?.slot===4&&((p.inventory[weapon]?.ammo||0)>=equipment.maxCount||grenadeCount(p.inventory)>=MAX_GRENADES))return {ok:false,message:'投掷物携带数量已达上限（同类闪光2枚，其余1枚，总计4枚）。'};
    if(weapon==='defusekit'&&p.defuseKit)return {ok:false,message:'已持有拆弹工具。'};
    if(weapon==='armor'&&p.armor>=100)return {ok:false,message:'防弹背心已完好。'};
    if(weapon==='helmet'&&p.armor>=100&&p.helmet)return {ok:false,message:'防弹背心和头盔已完好。'};
    const price = this.mode === 'deathmatch' ? 0 : equipment ? equipmentPrice(weapon,p) : gun.price;
    if (p.money < price) return { ok: false, message: '余额不足。' };
    if(gun)this.cancelReload(p);
    p.money -= price;
    if (weapon === 'armor') p.armor = 100;
    else if(weapon==='helmet'){p.armor=100;p.helmet=true;}
    else if(weapon==='defusekit')p.defuseKit=true;
    else if(equipment?.slot===4){p.inventory[weapon]||={ammo:0,reserve:0};p.inventory[weapon].ammo++;}
    else { for (const id of Object.keys(p.inventory)) if (getWeapon(id).slot === gun.slot){const ammo=p.inventory[id],drop=this.droppedWeapons.drop(p,{weaponId:id,skinId:this.heldSkin(p,id),ammo:ammo.ammo,reserve:ammo.reserve,...(ammo.reloadReadyAt?{reloadReadyAt:ammo.reloadReadyAt}:{})});delete p.inventory[id];if(p.purchases)delete p.purchases[id];this.emit('weapon_dropped',{playerId:p.id,droppedId:drop.id,weaponId:id,skinId:drop.skinId,death:false});} this.giveWeapon(p, weapon);if(gun.slot===1)p.loadoutPrimary=weapon;p.reloadEndsAt=0;p.zoomLevel=0;this.selectSlot(p, gun.slot); }
    if(gun&&price>0)(p.purchases||={})[weapon]={price,round:this.round.number,life:p.lifeId};
    this.emit('buy', { playerId: id, weapon, money: p.money });
    return { ok: true, weapon, slot:gun?.slot??equipment?.slot??0, money: p.money };
  }

  refundable(p){
    if(!this.buyStatus(p).buyAllowed)return [];
    return Object.entries(p.purchases||{}).filter(([id,r])=>p.inventory[id]&&r.round===this.round.number&&r.life===p.lifeId).map(([weapon,r])=>({weapon,price:r.price}));
  }
  refund(id,weapon){
    const p=this.players.get(id),receipt=p&&this.refundable(p).find(r=>r.weapon===weapon);
    if(!receipt)return {ok:false,message:'只能退还本回合在购买区购买且尚未使用、未丢弃的枪械。'};
    this.cancelReload(p);delete p.inventory[weapon];delete p.purchases[weapon];p.money=Math.min(16000,p.money+receipt.price);
    if(p.weapon===weapon)this.selectSlot(p,Object.keys(p.inventory).some(id=>getWeapon(id).slot===1)?1:Object.keys(p.inventory).some(id=>getWeapon(id).slot===2)?2:3);
    this.emit('refund',{playerId:id,weapon,money:p.money});return {ok:true,weapon,money:p.money,refunded:true};
  }

  maybeStart() {
    if (this.match.status!=='ended'&&this.mode === 'defuse' && this.round.phase === 'waiting' && this.count('T') && this.count('CT')) this.startRound();
  }

  startRound() {
    if(this.match.status==='ended')return;
    const now = this.clock();
    if(this.pendingTransition){
      const {swapSides,resetMoney}=this.pendingTransition;this.pendingTransition=null;
      if(swapSides){
        [this.scores.T,this.scores.CT]=[this.scores.CT,this.scores.T];
        for(const id of Object.keys(this.teamSides))this.teamSides[id]=opposite(this.teamSides[id]);
        for(const p of this.players.values()){p.team=this.teamSides[p.teamId];p.agentId=p.agents[p.team]||DEFAULT_AGENT_IDS[p.team];}
        this.emit('sides_swapped',{kind:this.match.period==='overtime'?'overtime':'halftime',period:this.match.period,overtimeNumber:this.match.overtimeNumber,teams:this.matchSnapshot().teams,round:this.round.number+1});
      }
      if(resetMoney!==null)for(const p of this.players.values()){
        p.inventory={};p.armor=0;p.helmet=false;p.defuseKit=false;p.money=resetMoney;p.alive=true;
        this.giveWeapon(p,p.team==='CT'?'usp':'pistol');this.giveWeapon(p,'knife');p.weapon=p.team==='CT'?'usp':'pistol';p.slot=2;
        this.cancelGrenade(p,'period');
      }
    }
    this.round = { number: this.round.number + 1, phase: 'freeze', phaseEndsAt: now + this.rules.freezeSeconds * 1000, buyEndsAt: now + (this.rules.freezeSeconds + this.rules.buySeconds) * 1000, winner: null, reason: '' };
    this.bomb = this.emptyBomb();this.teamIntel={};this.botAttackSite=null;this.utilityClaims=new Map();this.botExecutions=new Map();
    this.grenades.clear();this.defuseKits=[];
    this.droppedWeapons.clear();
    this.poseHistory.clear();
    for (const p of this.players.values()){this.respawn(p,true);p.roundKills=0;}
    const terrorists = [...this.players.values()].filter(p => p.team === 'T');
    const carrier = terrorists.find(p => !p.bot) || terrorists[0];
    if (carrier) { this.bomb.state = 'carried'; this.bomb.carrierId = carrier.id; carrier.hasBomb = true;this.giveWeapon(carrier,'c4'); Object.assign(this.bomb, copyPoint(carrier)); }
    this.emit('round_start', { number: this.round.number, mode: this.mode });
  }

  respawn(p, newRound = false) {
    p.purchases={};p.lifeKills=0;p.killCards=[];p.lastKnifeAt=-Infinity;
    delete p.inventory.c4;
    const spawn = this.pickSpawn(p.team);
    if (newRound && !p.alive) { p.inventory = {}; p.armor = 0;p.helmet=false;p.defuseKit=false; this.giveWeapon(p, p.team === 'CT' ? 'usp' : 'pistol'); this.giveWeapon(p, 'knife'); }
    const consumedJump=p.input.jumpId||0, consumedReload=p.input.reloadId||0;
    Object.assign(p, createPlayerState(spawn), { lifeId:(p.lifeId||0)+1,objectiveLocked:false,fireQueue:[],lastJumpId:consumedJump,lastReloadId:consumedReload,alive: true, health: 100, hasBomb: false, respawnAt: 0, flashBlindUntil:0, reloadEndsAt: 0, triggerWasDown: false, pendingFire: false,pendingInteract:false,grenadeState:null,grenadeRequireRelease:true,
      protectionUntil: this.mode === 'deathmatch' ? this.clock() + this.rules.protectionSeconds * 1000 : 0,
      nextShotAt: this.clock() + 350, input: neutralInput(), inputAt: 0,zoomLevel:0 });
    p.input.yaw = p.yaw || spawn.yaw || 0;
    p.movementStream?.reset(p.lifeId);
    p.movementAt=this.clock();
    if (this.mode === 'deathmatch') {p.armor = 100;p.helmet=true;if(!Object.keys(p.inventory).some(id=>getWeapon(id).slot===1))this.giveWeapon(p,p.loadoutPrimary||defaultPrimaryForTeam(p.team));if(!Object.keys(p.inventory).some(id=>getWeapon(id).slot===2))this.giveWeapon(p,p.team==='CT'?'usp':'pistol');}
    if (newRound && p.bot) {
      const preferred = p.team === 'T' ? 'ak47' : 'm4a1';
      if (p.money >= WEAPONS[preferred].price) { p.money -= WEAPONS[preferred].price; this.giveWeapon(p, preferred); }
    }
    for (const id of Object.keys(p.inventory)) if(!UTILITY_IDS.includes(id)){const skinId=p.inventory[id].skinId;this.giveWeapon(p,id);if(skinId)p.inventory[id].skinId=skinId;}
    p.botAI.engaging=false;p.botAI.action='advance';p.botAI.watchPoints=[];p.botAI.watchPoint=null;p.botAI.watchUntil=0;p.botAI.hurtAt=-Infinity;p.botAI.heardPoint=null;p.botAI.heardAt=0;p.botAI.utility=null;p.botAI.utilityAfter=this.clock()+6000+(p.seat||0)*400;p.botAI.lastKnown=null;p.botAI.lastSeenAt=0;p.botAI.routeKey=null;
    if(newRound&&p.bot){for(const id of ['armor',...(p.team==='CT'?['defusekit']:[]),'smokegrenade','hegrenade','flashbang',p.team==='T'?'molotov':'incgrenade'])this.buy(p.id,id);}
    p.botAI.path = []; p.botAI.goal = null; p.botAI.targetId = null; p.botAI.nextThinkAt = 0;
    this.selectSlot(p, Object.keys(p.inventory).some(id => getWeapon(id).slot === 1) ? 1 : 2);
    this.emit('spawn', { playerId: p.id, x: p.x, y: p.y, z: p.z });
  }

  endRound(team, reason) {
    if (this.round.phase !== 'live'||this.match.status==='ended') return;
    this.round.phase = 'ended'; this.round.winner = team; this.round.reason = reason;
    this.round.phaseEndsAt = this.clock() + this.rules.endSeconds * 1000;
    this.scores[team]++;
    this.match.roundsPlayed++;
    for (const p of this.players.values()) p.money = Math.min(16000, p.money + (p.team === team ? 3250 : 1900));
    this.bomb.action = null; this.bomb.actorId = null; this.bomb.progress = 0;
    const mvp=[...this.players.values()].filter(p=>p.team===team).sort((a,b)=>(b.roundKills||0)-(a.roundKills||0))[0];
    this.emit('round_end', { winner: team, reason,mvpId:mvp?.id||null, scores: { ...this.scores } });
    const scores=Object.fromEntries(Object.entries(this.teamSides).map(([id,side])=>[id,this.scores[side]]));
    const decision=defuseDecision(scores,this.match.roundsPlayed);
    Object.assign(this.match,{period:decision.period,overtimeNumber:decision.overtimeNumber,winTarget:decision.winTarget});
    for(const p of this.players.values())this.cancelGrenade(p,'round');
    if(decision.winnerTeamId)this.endMatch(decision.winnerTeamId,'率先赢得比赛所需回合');
    else this.pendingTransition=decision;
  }

  endMatch(winnerTeamId,reason){
    if(this.match.status==='ended')return;
    Object.assign(this.match,{status:'ended',winnerTeamId,reason,endedAt:this.clock()});
    Object.assign(this.round,{phase:'matchEnded',phaseEndsAt:0,winner:this.teamSides[winnerTeamId],reason});
    this.pendingTransition=null;this.grenades.clear();this.defuseKits=[];
    for(const p of this.players.values()){p.respawnAt=0;p.reloadEndsAt=0;p.pendingFire=false;this.cancelGrenade(p,'match');p.input=neutralInput();p.effectiveInput=neutralInput();p.vx=p.vy=p.vz=0;}
    this.emit('match_end',{winnerTeamId,winner:this.teamSides[winnerTeamId],reason,match:this.matchSnapshot()});
  }

  kill(victim, killer, weapon = 'world', headshot = false, metadata={}) {
    if (!victim.alive||this.match.status==='ended') return;
    if(victim.botAI?.utility&&!victim.botAI.utility.released)this.utilityClaims?.delete(victim.botAI.utility.key);
    this.dropWeapon(victim.id,true);
    if(victim.defuseKit){this.defuseKits.push({id:`kit_${++this.kitSerial}`,...copyPoint(victim)});if(this.defuseKits.length>20)this.defuseKits.shift();victim.defuseKit=false;}
    victim.objectiveLocked=false;
    victim.alive = false; victim.health = 0; victim.deaths++; victim.reloadEndsAt = 0;
    this.cancelGrenade(victim,'death');
    victim.respawnAt = this.mode === 'deathmatch' ? this.clock() + this.rules.respawnSeconds * 1000 : 0;
    if (victim.hasBomb) this.dropBomb(victim);
    const credited=!!killer&&killer.id!==victim.id&&killer.team!==victim.team;
    if (credited) { killer.kills++;killer.roundKills=(killer.roundKills||0)+1;killer.lifeKills=(killer.lifeKills||0)+1;killer.killCards||=[];if(killer.killCards.length<5)killer.killCards.push({weapon,headshot,backstab:metadata.backstab===true});killer.money = Math.min(16000, killer.money + (weapon === 'knife' ? 750 : 300)); if (this.mode === 'deathmatch') this.scores[killer.team]++; }
    this.emit('kill', { killerId: killer?.id || null, victimId: victim.id, killerName: killer?.name || '环境', victimName: victim.name, weapon, headshot,...metadata,credited,killerRoundKills:credited?killer.roundKills:0,killerLifeKills:credited?killer.lifeKills:0 });
    if(this.mode==='deathmatch'&&killer&&this.scores[killer.team]>=MATCH_RULES.deathmatchWinTarget)this.endMatch(killer.teamId,'队伍率先完成 100 次击杀');
  }

  damagePlayer(victim, attacker, rawDamage, weapon, headshot=false, armorRatio=1, bypassArmor=false) {
    if(!victim.alive||this.match.status==='ended')return;
    const hit=applyArmorDamage(rawDamage,victim,{headshot,armorRatio,bypassArmor});
    victim.health=Math.max(0,victim.health-hit.damage);if(victim.bot)victim.botAI.hurtAt=this.clock();
    this.emit('hit',{shooterId:attacker?.id||null,targetId:victim.id,...hit,headshot,weapon});
    if(victim.health===0)this.kill(victim,attacker,weapon,headshot);
  }

  explodeGrenade(grenade, config) {
    const attacker=this.players.get(grenade.ownerId), now=this.clock();
    for(const victim of this.players.values()){
      if(!victim.alive || now<victim.protectionUntil || (victim.team===grenade.team&&victim.id!==grenade.ownerId))continue;
      const target={x:victim.x,y:victim.y+.9,z:victim.z},distance=dist(grenade,target);
      if(distance>=config.radius || !this.grenades.clearSight(grenade,target))continue;
      const damage=config.damage*Math.max(0,1-distance/config.radius);
      this.damagePlayer(victim,attacker,damage,grenade.weapon,false,1);
    }
  }

  burnPlayers(fire,config){
    const attacker=this.players.get(fire.ownerId),now=this.clock();
    for(const p of this.players.values()){
      if(!p.alive||now<p.protectionUntil||p.team===fire.team&&p.id!==fire.ownerId)continue;
      const burning=fire.cells.some(c=>Math.hypot(p.x-c.x,p.z-c.z)<.75&&p.y<c.y+1.3&&p.y>c.y-.4&&this.grenades.clearSight({...c,y:c.y+.2},{x:p.x,y:p.y+.5,z:p.z}));
      if(burning)this.damagePlayer(p,attacker,config.damage,fire.weapon,false,1,true);
    }
  }
  pickupKits(){
    this.defuseKits=this.defuseKits.filter(kit=>{const p=[...this.players.values()].find(p=>p.alive&&p.team==='CT'&&!p.defuseKit&&dist(p,kit)<1.3&&clearSight(eye(p),{...kit,y:kit.y+.25}));if(!p)return true;p.defuseKit=true;this.emit('kit_picked_up',{playerId:p.id});return false;});
  }

  flashGrenade(grenade,config){
    const now=this.clock(),affected=[];
    for(const p of this.players.values()){
      if(!p.alive)continue;
      const from=eye(p),distance=dist(from,grenade);
      if(distance>=config.radius || !this.grenades.clearSight(from,grenade))continue;
      const facing=directionFromAngles(p.yaw||0,p.pitch||0);
      const dot=distance<.01?1:(facing.x*(grenade.x-from.x)+facing.y*(grenade.y-from.y)+facing.z*(grenade.z-from.z))/distance;
      const exposure=clamp((.25+.75*Math.max(0,dot))*(1-distance/config.radius),0,1);
      const duration=config.duration*exposure;
      p.flashBlindUntil=Math.max(p.flashBlindUntil||0,now+duration*1000);
      affected.push({playerId:p.id,exposure:round2(exposure),duration:round2(duration)});
    }
    this.emit('flash',{grenadeId:grenade.id,ownerId:grenade.ownerId,origin:copyPoint(grenade),radius:config.radius,duration:config.duration,affected});
  }

  visibleToBot(a,b){return clearSight(a,b)&&!this.grenades.blocksSight(a,b);}

  heldSkin(p,weapon=p.weapon){return p.inventory[weapon]?.skinId||p.skins[weapon]||DEFAULT_SKINS[weapon];}
  dropWeapon(id,death=false){
    const p=this.players.get(id),current=p&&getWeapon(p.weapon);
    if(!death&&p?.alive&&p.weapon==='c4'&&p.hasBomb&&['freeze','live'].includes(this.round.phase)){this.dropBomb(p);p.bombPickupAfter=this.clock()+1500;return {ok:true,weaponId:'c4'};}
    const dropId=death&&current&&![1,2].includes(current.slot)?Object.keys(p.inventory).find(id=>getWeapon(id).slot===1)||Object.keys(p.inventory).find(id=>getWeapon(id).slot===2):p?.weapon;
    const w=dropId&&getWeapon(dropId);
    if(!p?.alive||this.match.status==='ended'||(!death&&!['live','freeze'].includes(this.round.phase))||!w||![1,2].includes(w.slot)||!p.inventory[w.id])return {ok:false,message:'当前没有可丢弃的枪械。'};
    this.cancelReload(p);
    const ammo=p.inventory[w.id],drop=this.droppedWeapons.drop(p,{weaponId:w.id,skinId:this.heldSkin(p,w.id),ammo:ammo.ammo,reserve:ammo.reserve,...(ammo.reloadReadyAt?{reloadReadyAt:ammo.reloadReadyAt}:{})});
    delete p.inventory[w.id];if(p.purchases)delete p.purchases[w.id];p.reloadEndsAt=0;p.zoomLevel=0;this.cancelGrenade(p,'drop');
    this.selectSlot(p,Object.keys(p.inventory).some(id=>getWeapon(id).slot===1)?1:Object.keys(p.inventory).some(id=>getWeapon(id).slot===2)?2:3);
    this.emit('weapon_dropped',{playerId:id,droppedId:drop.id,weaponId:w.id,skinId:drop.skinId,death});
    return {ok:true,id:drop.id,weaponId:w.id};
  }
  pickupWeapon(p,automatic=false){
    if(!p.alive||this.match.status==='ended')return false;
    const bombPriority=this.mode==='defuse'&&((p.hasBomb&&this.siteAt(p))||(p.team==='CT'&&this.bomb.state==='planted'&&dist(p,this.bomb)<2.8));
    if(bombPriority)return false;
    const candidate=automatic?this.droppedWeapons.autoCandidate(p,slot=>Object.keys(p.inventory).some(id=>getWeapon(id).slot===slot),id=>getWeapon(id).slot):this.droppedWeapons.candidate(p);if(!candidate)return false;
    const w=getWeapon(candidate.weaponId),old=Object.keys(p.inventory).find(id=>getWeapon(id).slot===w.slot);
    const item=this.droppedWeapons.take(candidate.id);if(!item)return false;
    if(!automatic)this.cancelReload(p);
    if(old){const ammo=p.inventory[old],drop=this.droppedWeapons.drop(p,{weaponId:old,skinId:this.heldSkin(p,old),ammo:ammo.ammo,reserve:ammo.reserve,...(ammo.reloadReadyAt?{reloadReadyAt:ammo.reloadReadyAt}:{})});delete p.inventory[old];if(p.purchases)delete p.purchases[old];this.emit('weapon_dropped',{playerId:p.id,droppedId:drop.id,weaponId:old,skinId:drop.skinId,death:false});}
    p.inventory[w.id]={ammo:item.ammo,reserve:item.reserve,skinId:item.skinId,...(item.reloadReadyAt?{reloadReadyAt:item.reloadReadyAt}:{})};if(!automatic){p.reloadEndsAt=0;p.zoomLevel=0;this.cancelGrenade(p,'pickup');}
    if(!automatic){this.selectSlot(p,w.slot);p.nextShotAt=Math.max(p.nextShotAt,this.clock()+250);}
    this.emit('weapon_picked_up',{playerId:p.id,droppedId:item.id,weaponId:w.id,skinId:item.skinId});return true;
  }

  cancelGrenade(p,reason){
    if(p.grenadeState)this.emit('grenade_cancelled',{playerId:p.id,weapon:p.grenadeState.weapon,reason});
    p.grenadeState=null;p.grenadeRequireRelease=true;
  }

  captureGrenadeInput(p,input){
    const now=this.clock(),held=input.fire||input.fire2;
    if(!held)p.grenadeRequireRelease=false;
    const requested=input.slot===4?input.utilityId:input.slot?Object.keys(p.inventory).find(id=>getWeapon(id).slot===input.slot):p.weapon;
    if(!p.alive||this.round.phase!=='live'||input.cancelGrenade){this.cancelGrenade(p,input.cancelGrenade?'cancel':'inactive');return;}
    if(p.grenadeState&&requested!==p.grenadeState.weapon){this.cancelGrenade(p,'switch');return;}
    if(!UTILITY_IDS.includes(requested)||!p.inventory[requested]?.ammo)return;
    let state=p.grenadeState;
    if(!state){
      // A press must begin while this utility is selected. Release-only packets,
      // replays, and holding a button through respawn/switch cannot prime it.
      if(!held||p.grenadeRequireRelease||(p.input.fire||p.input.fire2))return;
      state=p.grenadeState={state:'primed',weapon:requested,mode:grenadeMode(input.fire,input.fire2),primedAt:now,readyAt:Math.max(now+200,p.nextShotAt),lastChordAt:input.fire&&input.fire2?now:-Infinity,releaseInput:null};
      this.emit('grenade_primed',{playerId:p.id,weapon:requested,mode:state.mode,strength:grenadeStrength(state.mode)});
    }
    if(state.releaseInput)return;
    if(held){state.mode=grenadeMode(input.fire,input.fire2);if(input.fire&&input.fire2)state.lastChordAt=now;}
    else {if(now-state.lastChordAt<=60)state.mode='lob';state.releaseInput={yaw:input.yaw,pitch:input.pitch,moveId:input.moveId||0,jumpId:input.jumpId||0};}
  }

  stepGrenade(p){
    const state=p.grenadeState;if(!state)return;
    const now=this.clock();
    if(!p.alive||this.round.phase!=='live'||p.weapon!==state.weapon||now-p.inputAt>=300){this.cancelGrenade(p,'inactive');return;}
    if(!state.releaseInput||now<state.readyAt||now<p.nextShotAt)return;
    if(p.movementStream&&(p.movementStream.ack<state.releaseInput.moveId||(p.lastJumpId||0)<state.releaseInput.jumpId))return;
    const ammo=p.inventory[state.weapon],w=getWeapon(state.weapon);
    if(!ammo?.ammo||!this.grenades.throwGrenade(p,state.weapon,{...state.releaseInput,throwMode:state.mode,throwStrength:grenadeStrength(state.mode)})){this.cancelGrenade(p,'unavailable');return;}
    ammo.ammo--;if(ammo.ammo===0)delete p.inventory[state.weapon];
    p.grenadeState=null;p.grenadeRequireRelease=true;p.lastShotTime=now;p.nextShotAt=now+w.fireInterval*1000;p.protectionUntil=0;
    const fallback=Object.keys(p.inventory).some(id=>getWeapon(id).slot===1)?1:Object.keys(p.inventory).some(id=>getWeapon(id).slot===2)?2:3;
    this.selectSlot(p,fallback);
  }

  fire(p, input, command=null) {
    if(p.weapon==='c4'||this.bomb.actorId===p.id&&this.bomb.action)return;
    const now=this.clock(),w=getWeapon(p.weapon),ammo=p.inventory[p.weapon];
    if(w.slot===4||this.match.status==='ended')return;
    if(w.id==='knife'){this.swingKnife(p,input,command);return;}
    const rising=input.fire&&!p.triggerWasDown;p.triggerWasDown=input.fire;
    if(!p.alive || !input.fire || (!w.automatic&&!rising) || !ammo || now<p.nextShotAt)return;
    // A loaded shell can be fired to interrupt a shell-by-shell reload.
    if(p.reloadEndsAt){if(w.reloadStyle==='shell'&&ammo.ammo>0)p.reloadEndsAt=0;else return;}
    if(now<(ammo.reloadReadyAt||0)||w.magazine&&ammo.ammo<=0)return;
    if(w.magazine){ammo.ammo--;if(p.purchases)delete p.purchases[w.id];}
    p.lastShotTime=now;p.nextShotAt=(command?Math.max(command.receivedAt,p.nextShotAt):now)+w.fireInterval*1000;p.protectionUntil=0;
    const zoomLevel=clamp(command?input.zoomLevel:p.zoomLevel||0,0,w.zoomFovs.length-1),scoped=zoomLevel>0;
    const accuracy=accuracyForShot(w,p,zoomLevel),targets=this.shotTargets(command?.input.viewTime,command?.receivedAt??now);
    const origin=eye(p),pellets=[],hits=new Map();
    for(let pellet=0;pellet<(w.pellets||1);pellet++){
      const dir=sampleShotDirection(input.yaw,input.pitch,accuracy);
      let trace;
      if(this.traceBullet&&w.id!=='knife')trace=this.traceBullet({origin,direction:dir,weapon:w,shooter:p,players:targets.players,now,rayHitPlayer,raycastWorld});
      if(!trace){
        const worldDistance=raycastWorld(origin,dir,w.range);
        let nearest=worldDistance===null?w.range:Math.min(w.range,worldDistance),victim=null,headshot=false;
        for(const other of targets.players){
          if(!other.alive||other.id===p.id||other.team===p.team||now<other.protectionUntil)continue;
          const hit=rayHitPlayer(origin,dir,other,nearest);
          if(hit&&hit.distance<nearest){nearest=hit.distance;victim=other;headshot=hit.headshot;}
        }
        trace={end:{x:origin.x+dir.x*nearest,y:origin.y+dir.y*nearest,z:origin.z+dir.z*nearest},hitWorld:!victim&&worldDistance!==null&&worldDistance<=w.range,hits:victim?[{playerId:victim.id,distance:nearest,headshot,damageScale:1}]:[]};
      }
      const accepted=[],hitIds=new Set();
      for(const result of trace.hits||[]){
        const victim=this.players.get(result.playerId);
        if(!victim?.alive||victim.team===p.team||victim.id===p.id||now<victim.protectionUntil||hitIds.has(victim.id)||!Number.isFinite(result.distance)||result.distance<0||result.distance>w.range)continue;
        hitIds.add(victim.id);
        const metadata={wallbang:result.wallbang===true,penetrations:Math.max(0,Math.min(4,Number.isInteger(result.penetrations)?result.penetrations:0))};
        const headshot=result.headshot===true,scale=Number.isFinite(result.damageScale)?clamp(result.damageScale,0,1):1;
        const damage=w.damage*(headshot?w.headMultiplier:1)*(w.id==='knife'?1:Math.pow(w.rangeModifier??.98,result.distance/(500*.0254)))*scale;
        // Trace all pellets against a temporary armor state. A winning kill may
        // end the match before later targets are applied, including their armor.
        const total=hits.get(victim.id)||{victim,armorState:{armor:victim.armor,helmet:victim.helmet},damage:0,headshot:false,armor:false,wallbang:false,penetrations:0};
        const hit=applyArmorDamage(damage,total.armorState,{headshot,armorRatio:w.armorRatio??1,bypassArmor:w.id==='knife'});
        total.damage+=hit.damage;total.headshot||=headshot;total.armor||=hit.armor;total.wallbang||=metadata.wallbang;total.penetrations=Math.max(total.penetrations,metadata.penetrations);hits.set(victim.id,total);
        accepted.push({playerId:victim.id,headshot,...metadata});
      }
      const first=accepted[0];
      pellets.push({end:trace.end,hitId:first?.playerId||null,hitWorld:trace.hitWorld===true,headshot:first?.headshot||false,wallbang:trace.wallbang===true||accepted.some(hit=>hit.wallbang),penetrations:Math.max(trace.penetrations||0,...accepted.map(hit=>hit.penetrations)),segments:trace.segments||[],...(accepted.length>1?{hits:accepted}:{})});

    }
    const representative=pellets.find(pellet=>pellet.hitId)||pellets[0];
    this.emit('shot',{shooterId:p.id,weapon:p.weapon,shotId:input.shotId||0,inputSeq:input.seq,zoomLevel,accuracy:accuracy.total,rewindMs:targets.rewindMs,aim:{yaw:input.yaw,pitch:input.pitch},origin,...representative,...(pellets.length>1?{pellets}: {})});
    hearGunshot(this,p);
    for(const hit of hits.values()){
      if(this.match.status==='ended')break;
      hit.victim.armor=hit.armorState.armor;
      hit.victim.health=Math.max(0,hit.victim.health-hit.damage);if(hit.victim.bot)hit.victim.botAI.hurtAt=now;
      this.emit('hit',{shooterId:p.id,targetId:hit.victim.id,damage:hit.damage,headshot:hit.headshot,armor:hit.armor,weapon:w.id,wallbang:hit.wallbang,penetrations:hit.penetrations});
      if(hit.victim.health===0)this.kill(hit.victim,p,w.id,hit.headshot,{wallbang:hit.wallbang,penetrated:hit.wallbang,penetrations:hit.penetrations,attackerBlind:now<(p.flashBlindUntil||0),attackerInAir:!p.grounded,noScope:w.zoomStyle==='scope'&&!scoped,throughSmoke:this.grenades.blocksSight(origin,eye(hit.victim))});
    }
    if(w.unzoomsAfterShot)p.zoomLevel=0;
  }

  swingKnife(p,input,command=null){
    const now=this.clock(),heavy=input.fire2===true;
    if(!p.alive||(!input.fire&&!heavy)||now<p.nextShotAt||!p.inventory.knife||p.reloadEndsAt)return;
    const targets=this.shotTargets(command?.input.viewTime,command?.receivedAt??now),origin=eye(p),direction=directionFromAngles(input.yaw,input.pitch);
    const hit=traceKnife({origin,direction,shooter:p,players:targets.players,heavy,now,raycastWorld});
    const first=now-(p.lastKnifeAt??-Infinity)>1000;
    p.lastKnifeAt=now;p.lastShotTime=now;p.protectionUntil=0;p.nextShotAt=(command?Math.max(command.receivedAt,p.nextShotAt):now)+knifeInterval(heavy)*1000;
    this.emit('shot',{shooterId:p.id,weapon:'knife',shotId:input.shotId||0,inputSeq:input.seq,heavy,origin,...hit,headshot:false,zoomLevel:0,accuracy:0,rewindMs:targets.rewindMs,aim:{yaw:input.yaw,pitch:input.pitch}});
    const victim=this.players.get(hit.hitId);if(!victim?.alive)return;
    const damage=knifeDamage({heavy,backstab:hit.backstab,first,armor:victim.armor});
    victim.health=Math.max(0,victim.health-damage);if(victim.bot)victim.botAI.hurtAt=now;
    this.emit('hit',{shooterId:p.id,targetId:victim.id,weapon:'knife',damage,heavy,backstab:hit.backstab,headshot:false,armor:victim.armor>0});
    if(victim.health===0)this.kill(victim,p,'knife',false,{heavy,backstab:hit.backstab});
  }

  reload(p) {
    const w=getWeapon(p.weapon),ammo=p.inventory[p.weapon];
    if(!p.reloadEndsAt&&w.slot<4&&w.magazine&&ammo&&this.clock()>=(ammo.reloadReadyAt||0)&&ammo.ammo<w.magazine&&ammo.reserve>0){
      p.reloadStartedAt=this.clock();p.reloadEndsAt=p.reloadStartedAt+w.reloadTime*1000;p.zoomLevel=0;
      p.reloadEmpty=ammo.ammo===0;p.reloadWeapon=p.weapon;p.reloadCommitted=false;
      p.reloadAmmoAt=p.reloadStartedAt+(w.reloadStyle==='shell'?1:reloadProfile(p.weapon,p.reloadEmpty)?.commitFraction??1)*w.reloadTime*1000;
    }
  }

  commitReload(p){
    if(!p.reloadEndsAt||p.reloadCommitted||this.clock()<p.reloadAmmoAt)return;
    const w=getWeapon(p.reloadWeapon),ammo=p.inventory[p.reloadWeapon];if(!ammo||w.reloadStyle==='shell')return;
    const transfer=Math.min(w.reserveAmmoAsClips?w.magazine:w.magazine-ammo.ammo,ammo.reserve);
    ammo.ammo=w.reserveAmmoAsClips?transfer:ammo.ammo+transfer;ammo.reserve-=transfer;
    ammo.reloadReadyAt=p.reloadEndsAt;p.reloadCommitted=true;
  }

  cancelReload(p){
    this.commitReload(p);p.reloadEndsAt=0;p.reloadAmmoAt=0;p.reloadStartedAt=0;p.reloadWeapon=null;
  }

  finishReload(p){
    const w=getWeapon(p.weapon),ammo=p.inventory[p.weapon],now=this.clock();
    if(!ammo){p.reloadEndsAt=0;return;}
    if(w.reloadStyle==='shell'){
      while(p.reloadEndsAt&&now>=p.reloadEndsAt){
        if(ammo.reserve>0&&ammo.ammo<w.magazine){ammo.ammo++;ammo.reserve--;}
        p.reloadStartedAt=p.reloadEndsAt;p.reloadEndsAt=ammo.reserve>0&&ammo.ammo<w.magazine?p.reloadEndsAt+w.reloadTime*1000:0;
      }
    }else{
      this.commitReload(p);delete ammo.reloadReadyAt;p.reloadEndsAt=0;
    }
  }

  dropBomb(p) {
    p.hasBomb = false;delete p.inventory.c4;if(p.weapon==='c4')this.selectSlot(p,Object.keys(p.inventory).some(id=>getWeapon(id).slot===1)?1:Object.keys(p.inventory).some(id=>getWeapon(id).slot===2)?2:3); this.bomb.state = 'dropped'; this.bomb.carrierId = null;
    Object.assign(this.bomb, copyPoint(p), { actorId: null, action: null, progress: 0 });
  }

  siteAt(p) { return Object.entries(MAP.sites || {}).find(([, site]) => lengthXZ(site, p) <= site.radius && Math.abs(site.y - p.y) < 3)?.[0] || null; }

  bombIntent(p,input){
    if(!p?.alive||!p.grounded||this.mode!=='defuse'||this.round.phase!=='live')return null;
    const bomb=this.bomb,continuing=bomb.actorId===p.id;
    if(bomb.state==='carried'&&bomb.carrierId===p.id&&this.siteAt(p)&&(input.interact||p.weapon==='c4'&&input.fire))return 'plant';
    if(bomb.state==='planted'&&p.team==='CT'&&input.interact&&dist(p,bomb)<2.8&&(continuing||clearSight(eye(p),{...bomb,y:bomb.y+.3})))return 'defuse';
    return null;
  }

  stepBomb(dt) {
    const now = this.clock(), bomb = this.bomb;
    if (bomb.state === 'carried') {
      const carrier = this.players.get(bomb.carrierId);
      if (!carrier?.alive) { if (carrier) this.dropBomb(carrier); else { bomb.state = 'dropped'; bomb.carrierId = null; } }
      else Object.assign(bomb, copyPoint(carrier));
    }
    if (bomb.state === 'dropped') {
      const pickup = [...this.players.values()].find(p => p.alive && p.team === 'T' && now>=(p.bombPickupAfter||0) && dist(p, bomb) < 2.3 && clearSight(eye(p), { x: bomb.x, y: bomb.y + 0.4, z: bomb.z }));
      if (pickup) { pickup.hasBomb = true;this.giveWeapon(pickup,'c4'); bomb.carrierId = pickup.id; bomb.state = 'carried'; }
    }
    if (bomb.state === 'planted' && now >= bomb.explodesAt) {
      bomb.state = 'exploded'; this.emit('bomb_exploded', { x: bomb.x, y: bomb.y, z: bomb.z }); this.endRound('T', '炸弹爆炸'); return;
    }
    let actor = null, action = null, site = null;
    if (bomb.state === 'carried') {
      const p = this.players.get(bomb.carrierId);
      site = p && this.siteAt(p);
      if (p&&this.bombIntent(p,p.effectiveInput||{})==='plant') { actor = p; action = 'plant'; }
    } else if (bomb.state === 'planted') {
      actor = [...this.players.values()].find(p => this.bombIntent(p,p.effectiveInput||{})==='defuse');
      if (actor) action = 'defuse';
    }
    for(const p of this.players.values())p.objectiveLocked=p===actor;
    if(actor){actor.vx=actor.vy=actor.vz=0;actor.crouch=true;actor.height=1.1;actor.jumpBufferRemaining=0;}
    if (!actor) { bomb.actorId = null; bomb.action = null; bomb.progress = 0; return; }
    if (bomb.actorId !== actor.id || bomb.action !== action) { bomb.progress = 0; bomb.actorId = actor.id; bomb.action = action;this.cancelReload(actor);
      if(action==='plant'){this.giveWeapon(actor,'c4');this.selectSlot(actor,5);actor.input.slot=5;}
      this.emit('bomb_action',{playerId:actor.id,action,x:actor.x,y:actor.y,z:actor.z});
    }
    bomb.progress = Math.min(1, bomb.progress + dt / (action === 'plant' ? this.rules.plantSeconds : actor.defuseKit ? this.rules.defuseKitSeconds : this.rules.defuseSeconds));
    if (bomb.progress < 1 - 1e-8) return;
    actor.objectiveLocked=false;
    if (action === 'plant') {
      actor.hasBomb = false;delete actor.inventory.c4;this.selectSlot(actor,Object.keys(actor.inventory).some(id=>getWeapon(id).slot===1)?1:Object.keys(actor.inventory).some(id=>getWeapon(id).slot===2)?2:3);actor.input.slot=actor.slot; actor.money = Math.min(16000, actor.money + 300);
      Object.assign(bomb, copyPoint(actor), { state: 'planted', carrierId: null, site, plantedAt: now, explodesAt: now + this.rules.bombSeconds * 1000, planterId: actor.id, action: null, actorId: null, progress: 0 });
      this.emit('bomb_planted', { playerId: actor.id, site, explodesAt: bomb.explodesAt, x: bomb.x, y: bomb.y, z: bomb.z });
    } else { bomb.state = 'defused'; this.emit('bomb_defused', { playerId: actor.id }); this.endRound('CT', '炸弹已拆除'); }
  }

  nearestNav(point) {
    let best = null, bestScore = Infinity;
    for (const n of this.nav) { const score = lengthXZ(n, point) + Math.abs(n.y - point.y) * 3; if (score < bestScore) { best = n; bestScore = score; } }
    return best;
  }

  planPath(p, goal) {
    const start = this.nearestNav(p), end = this.nearestNav(goal);
    if (!start || !end) return [copyPoint(goal)];
    const frontier = [{ id: String(start.id), cost: 0 }], cost = new Map([[String(start.id), 0]]), came = new Map();
    let expansions = 0;
    while (frontier.length && expansions++ < 3500) {
      frontier.sort((a, b) => a.cost - b.cost);
      const current = frontier.shift();
      if (current.id === String(end.id)) break;
      const node = this.navMap.get(current.id);
      for (const nextId of node?.neighbors || []) {
        const key = String(nextId), next = this.navMap.get(key); if (!next) continue;
          const nextCost = cost.get(current.id) + dist(node, next) + Math.max(0, next.y - node.y - .35) * 30;
        if (nextCost < (cost.get(key) ?? Infinity)) { cost.set(key, nextCost); came.set(key, current.id); frontier.push({ id: key, cost: nextCost + lengthXZ(next, end) }); }
      }
    }
    if (String(start.id) !== String(end.id) && !came.has(String(end.id))) return [copyPoint(start)];
    const result = [copyPoint(goal)]; let cursor = String(end.id), guard = 0;
    while (cursor !== String(start.id) && guard++ < 3500) { result.unshift(copyPoint(this.navMap.get(cursor))); cursor = came.get(cursor); if (!cursor) break; }
    return result;
  }

  chooseBotGoal(p) {
    const ai = p.botAI, bomb = this.bomb;
    if(this.mode==='defuse')return tacticalGoal(this,p);
    if (this.mode === 'defuse') {
      if (bomb.state === 'planted') return copyPoint(bomb);
      if (p.team === 'T' && bomb.state === 'dropped') return copyPoint(bomb);
      if (p.hasBomb) return copyPoint(MAP.sites?.[Number(p.id.slice(2)) % 2 ? 'A' : 'B'] || Object.values(MAP.sites)[0]);
    }
    if (ai.lastKnown && this.clock() - ai.lastSeenAt < 6500) return ai.lastKnown;
    if (this.mode === 'defuse' && MAP.sites) {
      const sites = Object.values(MAP.sites); const site = sites[Math.floor(Math.random() * sites.length)];
      if (site && Math.random() < 0.7) return copyPoint(site);
    }
    if (this.nav.length) return copyPoint(this.nav[Math.floor(Math.random() * this.nav.length)]);
    const enemies = [...this.players.values()].filter(e => e.team !== p.team && e.alive);
    return copyPoint(enemies[Math.floor(Math.random() * enemies.length)] || p);
  }

  botInput(p, dt) {
    const now=this.clock(),ai=p.botAI,input=neutralInput(),from=eye(p);
    input.yaw=p.yaw||0;input.pitch=p.pitch||0;input.slot=combatSlot(p);
    if(now>=ai.nextThinkAt){
      ai.nextThinkAt=now+230+Math.random()*80;
      const candidates=[...this.players.values()].filter(e=>e.alive&&e.team!==p.team&&now>=e.protectionUntil&&dist(p,e)<110).sort((a,b)=>dist(p,a)-dist(p,b));
      const current=this.players.get(ai.targetId);
      const blind=now<(p.flashBlindUntil||0);
      const visible=blind?[]:candidates.filter(e=>visibleAimPoint(this,p,e,{acquire:e.id!==ai.targetId}));
      let enemy=visible.find(e=>e.id===ai.targetId)||visible[0];
      if(enemy&&enemy.id===ai.targetId&&visible[0]!==enemy&&now-(ai.targetChangedAt||0)>1200&&dist(p,visible[0])<dist(p,enemy)*.65)enemy=visible[0];
      if(enemy){
        if(ai.targetId!==enemy.id){ai.reactionAt=now+420+Math.random()*240;ai.targetChangedAt=now;ai.alignedFor=0;}
        ai.targetId=enemy.id;ai.lastKnown=copyPoint(enemy);ai.lastSeenAt=now;shareSighting(this,p,enemy);
        if(p.health<40&&Math.random()<.25){
          const node=this.nearestNav(p);
          const cover=(node?.neighbors||[]).map(id=>this.navMap.get(String(id))).find(n=>n&&!clearSight(eye(enemy),{x:n.x,y:n.y+1.3,z:n.z}));
          if(cover){ai.goal=copyPoint(cover);ai.path=this.planPath(p,cover);}
        }
      }else if(blind||!current?.alive||now-ai.lastSeenAt>600){ai.targetId=null;ai.alignedFor=0;}
      if(!ai.utility&&(!ai.goal||(!ai.path.length&&lengthXZ(p,ai.goal)>2)||now>ai.wanderAt)){ai.goal=this.chooseBotGoal(p);ai.path=this.planPath(p,ai.goal);ai.wanderAt=now+(this.mode==='defuse'?1600:5500)+Math.random()*400;}
      if(!ai.previous||lengthXZ(ai.previous,p)>.55){ai.previous=copyPoint(p);ai.stuckAt=now;}
      else if(now-ai.stuckAt>2500){ai.goal=null;ai.path=[];ai.stuckAt=now;}
    }
    const target=this.players.get(ai.targetId);
    while(ai.path.length&&lengthXZ(p,ai.path[0])<.8&&Math.abs(p.y-ai.path[0].y)<1.5)ai.path.shift();
    const waypoint=ai.path[0];
    let desired={yaw:input.yaw,pitch:input.pitch},engaging=false;
    if(waypoint){desired={yaw:Math.atan2(-(waypoint.x-p.x),-(waypoint.z-p.z)),pitch:0};if(waypoint.y-p.y>.4||now-ai.stuckAt>1300)input.jump=Math.floor(now/600)%2===0;}
    const watch=observationPoint(this,p,waypoint);if(watch)desired=lookAt(from,watch);
    const exposed=target?.alive&&now>=(p.flashBlindUntil||0)?visibleAimPoint(this,p,target):null;
    if(exposed){
      const to=exposed,dx=to.x-from.x,dy=to.y-from.y,dz=to.z-from.z;
      const aimError=.013+dist(p,target)/12000;
      desired={yaw:Math.atan2(-dx,-dz)+Math.sin(now/440+Number(p.id.slice(2)))*aimError,pitch:Math.atan2(dy,Math.hypot(dx,dz))+Math.cos(now/630)*aimError};engaging=true;
    }
    ai.engaging=engaging;ai.aimPoint=exposed||watch;ai.action=engaging?'engage':ai.phase||'advance';
    const aim=smoothBotAim({yaw:input.yaw,pitch:input.pitch},desired,dt);
    input.yaw=aim.yaw;input.pitch=aim.pitch;
    ai.alignedFor=engaging&&aim.aligned?(ai.alignedFor||0)+Math.max(0,Math.min(.1,dt)):0;
    if(engaging){
      input.fire=now>ai.reactionAt&&ai.alignedFor>=BOT_AIM.settleSeconds&&Math.floor(now/150)%7<5;
      if(p.weapon==='knife')input.forward=1;
    }else if(waypoint){
      const dx=waypoint.x-p.x,dz=waypoint.z-p.z,d=Math.max(.01,Math.hypot(dx,dz));
      input.forward=(-Math.sin(input.yaw)*dx-Math.cos(input.yaw)*dz)/d;input.right=(Math.cos(input.yaw)*dx-Math.sin(input.yaw)*dz)/d;
    }
    const ammo=p.inventory[p.weapon];if(ammo&&getWeapon(p.weapon).slot<3&&ammo.ammo<3)input.reload=true;
    if(this.mode==='defuse'){
      const plant=p.hasBomb&&this.siteAt(p),defuse=p.team==='CT'&&p.botAI.role==='defuser'&&this.bomb.state==='planted'&&dist(p,this.bomb)<2.6;
      if(plant||defuse){input.forward=input.right=0;input.fire=input.jump=false;input.interact=true;}
    }
    separateTeammates(this,p,input);
    return botUtility(this,p,input,dt);
  }

  tick(dt = 1 / TICK_RATE) {
    const now = this.clock();
    if(this.match.status==='ended')return;
    this.maybeStart();
    this.recordPoses();
    if (this.mode === 'defuse') {
      if (this.round.phase === 'freeze' && now >= this.round.phaseEndsAt) { this.round.phase = 'live'; this.round.phaseEndsAt = now + this.rules.roundSeconds * 1000; }
      else if (this.round.phase === 'ended' && now >= this.round.phaseEndsAt) { if (this.count('T') && this.count('CT')) this.startRound(); else { this.round.phase = 'waiting'; this.round.phaseEndsAt = 0; } }
    }
    const canAct = this.round.phase === 'live', canMove=canAct||this.round.phase==='ended';
    for (const p of this.players.values()) {
      if(this.match.status==='ended')break;
      if (!p.alive) { if (p.respawnAt && now >= p.respawnAt) this.respawn(p); continue; }
      const input = p.bot ? this.botInput(p, dt) : now - p.inputAt < 300 ? { ...p.input } : { ...neutralInput(), yaw: p.yaw || 0, pitch: p.pitch || 0 };
      if(p.bot){this.captureGrenadeInput(p,input);p.input={...input};p.inputAt=now;}
      p.pendingFire = false;
      if(!p.bot){
        const fresh=now-p.inputAt<300;
        if(fresh&&(input.reloadId||0)>(p.lastReloadId||0))input.reload=true;
        p.lastReloadId=Math.max(p.lastReloadId||0,p.input.reloadId||0);
        if(!fresh||(!canMove&&this.mode==='defuse')){p.lastJumpId=Math.max(p.lastJumpId||0,p.input.jumpId||0);p.jumpBufferRemaining=0;}
      }
      p.seq = Math.max(p.seq, p.input.seq ?? -1);
      this.commitReload(p);
      if(!canMove)Object.assign(input,{forward:0,right:0,jump:false});
      if(!canAct)Object.assign(input,{fire:false,fire2:false,interact:false});
      p.objectiveLocked=canAct&&!!this.bombIntent(p,input);
      if(p.objectiveLocked){input.crouch=true;input.forward=input.right=0;input.jump=input.reload=false;p.vx=p.vy=p.vz=0;p.jumpBufferRemaining=0;if(this.bombIntent(p,input)==='plant')input.slot=5;}
      const movementOptions={canMove,speedLimit:weaponSpeedScale(p.weapon,p.zoomLevel)};
      const shotMove=p.fireQueue?.[0]?.input.moveId;
      if(p.movementStream){
        // Timer callbacks can arrive late. Accrue real server time, then run
        // bounded fixed 60 Hz commands; never accumulate a permanent input lag.
        const elapsed=Math.max(0,(now-(p.movementAt??now))/1000);p.movementAt=now;
        p.movementStream.advance(p,elapsed,movementOptions,shotMove||Infinity);
      }
      if(p.objectiveLocked){p.fireQueue.length=0;this.cancelGrenade(p,'objective');}
      const queuedShot=canAct&&!p.objectiveLocked&&!p.bot&&this.fireQueued(p);
      if(this.match.status==='ended')break;
      if(!canAct&&p.fireQueue)p.fireQueue.length=0;
      const awaitingShotMove=p.movementStream&&p.fireQueue?.[0]?.input.moveId>p.movementStream.ack;
      if(this.bomb.actorId===p.id&&this.bomb.action==='plant'&&input.interact)input.slot=5;
      if (input.slot&&!awaitingShotMove) this.selectSlot(p, input.slot,input.utilityId);
      if(p.grenadeState&&(now-p.inputAt>=300||!canAct))this.cancelGrenade(p,'inactive');
      p.zoomLevel=p.reloadEndsAt?0:clamp(input.zoomLevel||0,0,getWeapon(p.weapon).zoomFovs.length-1);
      input.speedScale=weaponSpeedScale(p.weapon,p.zoomLevel);
      p.effectiveInput = input;
      p.yaw = input.yaw; p.pitch = input.pitch;
      if(p.movementStream){
        p.movementStream.advance(p,0,{canMove,speedLimit:input.speedScale},awaitingShotMove?shotMove:Infinity);
        // View/fire input remains immediate; queued movement never rewinds aim.
        p.yaw=input.yaw;p.pitch=input.pitch;
      }else stepPlayer(p, input, dt);
      if (!Number.isFinite(p.x + p.y + p.z) || p.outOfWorld || p.y < (MAP.bounds?.min?.y ?? -200) - 30) { this.kill(p, null); continue; }
      if(p.reloadEndsAt&&now>=p.reloadEndsAt)this.finishReload(p);
      if (input.reload) this.reload(p);
      const heldAmmo=p.inventory[p.weapon];
      if(canAct&&!input.fire&&!input.cancelGrenade&&now-p.inputAt<300&&now>=p.nextShotAt&&!p.fireQueue?.length&&getWeapon(p.weapon).magazine&&heldAmmo?.ammo===0)this.reload(p);
      if((canAct||this.round.phase==='freeze')&&!p.bot&&p.pendingInteract&&now-p.inputAt<300)this.pickupWeapon(p);
      p.pendingInteract=false;
      if(canMove||this.round.phase==='freeze')this.pickupWeapon(p,true);
      if (canAct&&!p.objectiveLocked) {this.stepGrenade(p);if(!p.shotCommands&&!queuedShot)this.fire(p,input);}
    }
    if(canAct)this.grenades.tick(dt);
    this.droppedWeapons.tick(dt);this.pickupKits();
    this.recordPoses();
    if (this.mode === 'defuse' && this.round.phase === 'live') {
      this.stepBomb(dt);
      if (this.round.phase !== 'live') return;
      const livingT = [...this.players.values()].some(p => p.team === 'T' && p.alive), livingCT = [...this.players.values()].some(p => p.team === 'CT' && p.alive);
      if (!livingCT && this.count('CT')) this.endRound('T', 'CT 全部被击败');
      else if (!livingT && this.count('T') && this.bomb.state !== 'planted') this.endRound('CT', 'T 全部被击败');
      else if (now >= this.round.phaseEndsAt && this.bomb.state !== 'planted') this.endRound('CT', '回合时间耗尽');
    }
  }

  snapshot({ drainEvents = true } = {}) {
    const now = this.clock();
    const players = [...this.players.values()].map(p => ({ id: p.id,seat:p.seat, lifeId:p.lifeId,name: p.name, team: p.team, teamId:p.teamId, bot: p.bot, agentId:p.agentId||DEFAULT_AGENT_IDS[p.team], x: round2(p.x), y: round2(p.y), z: round2(p.z),
      vx: round2(p.vx), vy: round2(p.vy), vz: round2(p.vz), yaw: round2(p.yaw), pitch: round2(p.pitch), crouch: !!p.crouch, grounded: !!p.grounded,
      ...(p.movementStream?{movementAck:p.movementStream.ack,movementState:movementState(p)}:{}),
      objectiveLocked:!!p.objectiveLocked,health: p.health, armor: round2(p.armor), helmet:!!p.helmet, defuseKit:!!p.defuseKit,zoomLevel:p.zoomLevel,utilityCounts:Object.fromEntries(UTILITY_IDS.map(id=>[id,p.inventory[id]?.ammo||0])), alive: p.alive, weapon: p.weapon, skinId:this.heldSkin(p), slot: p.slot, ammo: p.inventory[p.weapon]?.ammo || 0, reserve: p.inventory[p.weapon]?.reserve || 0,
      reserveAmmoAsClips:!!getWeapon(p.weapon).reserveAmmoAsClips,reserveClips:getWeapon(p.weapon).reserveAmmoAsClips?Math.ceil((p.inventory[p.weapon]?.reserve||0)/getWeapon(p.weapon).magazine):0,
      grenadeState:p.grenadeState?{state:'primed',weapon:p.grenadeState.weapon,mode:p.grenadeState.mode,strength:grenadeStrength(p.grenadeState.mode),primedAt:p.grenadeState.primedAt}:{state:'idle',weapon:null,mode:'full',strength:1,primedAt:0},
      reloadRemaining: Math.max(0, (p.reloadEndsAt - now) / 1000),reloadDuration:p.reloadEndsAt?getWeapon(p.weapon).reloadTime:0,reloadElapsed:p.reloadEndsAt?Math.max(0,(now-p.reloadStartedAt)/1000):0,reloadEmpty:!!p.reloadEmpty,reloadCommitted:!!p.reloadEndsAt&&!!p.reloadCommitted,fireReadyRemaining:Math.max(0,((p.inventory[p.weapon]?.reloadReadyAt||0)-now)/1000), money: p.money, kills: p.kills, deaths: p.deaths, assists: p.assists, seq: p.seq,
      ...this.buyStatus(p), refundable:this.refundable(p), inventory: Object.keys(p.inventory), hasBomb: p.hasBomb,bombAction:this.bomb.actorId===p.id?this.bomb.action:null,bombProgress:this.bomb.actorId===p.id?this.bomb.progress:0,bombActionDuration:this.bomb.action==='plant'?this.rules.plantSeconds:p.defuseKit?this.rules.defuseKitSeconds:this.rules.defuseSeconds, spawnProtectionRemaining: Math.max(0, (p.protectionUntil - now) / 1000),
      roundKills:p.roundKills||0,lifeKills:p.lifeKills||0,killCards:p.killCards||[],
      respawnIn: p.respawnAt ? Math.max(0, (p.respawnAt - now) / 1000) : 0, lastShotTime: p.lastShotTime }));
    const events = drainEvents ? this.events.splice(0) : [...this.events];
    return { type: 'snapshot', time: now, room: this.code, mode: this.mode, hostId:this.hostId,seats:this.roomSeats(),desiredBots:this.desiredBots,botCount:this.botCount,match:this.matchSnapshot(),players,droppedWeapons:this.droppedWeapons.snapshot(),defuseKits:this.defuseKits.map(k=>({...k})),...this.grenades.snapshot(),
      round: { ...this.round, timeLeft: this.round.phaseEndsAt ? Math.max(0, (this.round.phaseEndsAt - now) / 1000) : 0 },
      bomb: { ...this.bomb, remaining: this.bomb.state === 'planted' ? Math.max(0, (this.bomb.explodesAt - now) / 1000) : 0 }, scores: { ...this.scores }, events };
  }
}
