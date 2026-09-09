import { randomBytes } from 'node:crypto';
import { MAP } from '../shared/map-data.js';
import { createPlayerState, stepPlayer, raycastWorld } from '../shared/physics.js';
import { WEAPONS, PRIMARY_WEAPONS, getWeapon, normalizeWeapon, canTeamUseWeapon, defaultPrimaryForTeam, weaponSpeedScale } from '../shared/weapons.js';
import { DEFAULT_SKINS, getSkin, normalizeSkinLoadout } from '../shared/skins.js';
import { DEFAULT_AGENT_IDS, getAgent, normalizeAgentLoadout } from '../shared/agents.js';
import { EQUIPMENT, UTILITY_IDS, MAX_GRENADES, getEquipment, canTeamBuyEquipment, equipmentPrice, grenadeCount } from '../shared/equipment.js';
import { GrenadeSimulation } from './grenades.js';

export const TICK_RATE = 30;
export const SNAPSHOT_RATE = 15;
export const RULES = Object.freeze({ freezeSeconds: 6, roundSeconds: 115, endSeconds: 5, buySeconds: 25, plantSeconds: 3, defuseSeconds: 10, defuseKitSeconds: 5, bombSeconds: 40, respawnSeconds: 3, protectionSeconds: 2 });
const MAX_PLAYERS = 10;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lengthXZ = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const copyPoint = p => ({ x: p.x, y: p.y, z: p.z });
const eye = p => ({ x: p.x, y: p.y + (p.crouch ? 0.95 : 1.6), z: p.z });
const neutralInput = () => ({ forward: 0, right: 0, yaw: 0, pitch: 0, jump: false, crouch: false, walk: false, fire: false, reload: false, interact: false, slot: 0 });
const opposite = t => t === 'T' ? 'CT' : 'T';
const finite = v => typeof v === 'number' && Number.isFinite(v);
const round2 = n => Number.isFinite(n) ? Math.round(n * 1000) / 1000 : 0;

export function sanitizeInput(message) {
  if (!message || typeof message!=='object' || !Number.isSafeInteger(message.seq) || message.seq < 0 || message.seq > 2147483647) return null;
  if (!['forward', 'right', 'yaw', 'pitch'].every(k => finite(message[k]))) return null;
  return { seq: message.seq, forward: clamp(message.forward, -1, 1), right: clamp(message.right, -1, 1), yaw: ((message.yaw + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI,
    jumpId: Number.isSafeInteger(message.jumpId)&&message.jumpId>=0&&message.jumpId<=2147483647?message.jumpId:0, reloadId: Number.isSafeInteger(message.reloadId)&&message.reloadId>=0&&message.reloadId<=2147483647?message.reloadId:0, pitch: clamp(message.pitch, -1.48, 1.48), jump: message.jump === true, crouch: message.crouch === true,
    walk: message.walk === true, fire: message.fire === true, reload: message.reload === true,
    interact: message.interact === true, slot: [1, 2, 3, 4].includes(message.slot) ? message.slot : 0,
    utilityId: UTILITY_IDS.includes(message.utilityId) ? message.utilityId : null,
    zoomLevel: Number.isInteger(message.zoomLevel) && message.zoomLevel >= 0 && message.zoomLevel <= 2 ? message.zoomLevel : 0 };
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
  constructor(code, { mode = 'deathmatch', bots = 6, clock = () => Date.now(), rules = {} } = {}) {
    this.code = code; this.mode = mode; this.desiredBots = clamp(Math.floor(bots), 0, 8);
    this.clock = clock; this.rules = { ...RULES, ...rules }; this.players = new Map(); this.clients = new Map();
    this.scores = { T: 0, CT: 0 }; this.events = []; this.eventCounter = 0; this.botCounter = 0; this.spawnCounter = { T: 0, CT: 0 };
    this.createdAt = clock(); this.round = { number: 0, phase: mode === 'deathmatch' ? 'live' : 'waiting', phaseEndsAt: 0, buyEndsAt: 0, winner: null, reason: '' };
    this.bomb = this.emptyBomb();
    this.nav = Array.isArray(MAP.nav) ? MAP.nav : [];
    this.navMap = new Map(this.nav.map(n => [String(n.id), n]));
    this.grenades=new GrenadeSimulation({clock,raycastWorld,emit:(type,fields)=>this.emit(type,fields),onExplosion:(grenade,config)=>this.explodeGrenade(grenade,config),onFlash:(grenade,config)=>this.flashGrenade(grenade,config)});
  }

  emptyBomb() { return { state: 'none', carrierId: null, x: 0, y: 0, z: 0, site: null, plantedAt: 0, explodesAt: 0, planterId: null, actorId: null, action: null, progress: 0, remaining: 0 }; }
  emit(type, fields = {}) { this.events.push({ type, id: `${this.code}:${++this.eventCounter}`, time: this.clock(), ...fields }); if (this.events.length > 300) this.events.splice(0, this.events.length - 300); }
  count(team, humansOnly = false) { return [...this.players.values()].filter(p => p.team === team && (!humansOnly || !p.bot)).length; }
  get humanCount() { return this.clients.size; }

  addHuman(socket, { name, team = 'auto', primary = 'auto', skins, agents }) {
    if (this.humanCount >= MAX_PLAYERS) throw new Error('房间已满，最多 10 名玩家。');
    let assigned = team;
    if (!['T', 'CT'].includes(assigned)) assigned = this.count('T', true) <= this.count('CT', true) ? 'T' : 'CT';
    if (this.count(assigned, true) >= 5) { if (team !== 'auto') throw new Error('该阵营已有 5 名玩家，请选择另一队。'); assigned = opposite(assigned); }
    const botToReplace = [...this.players.values()].find(p => p.bot && (p.team === assigned || this.players.size >= 10));
    if (botToReplace) this.removePlayer(botToReplace.id);
    const id = `p_${randomBytes(6).toString('hex')}`;
    const player = this.makePlayer(id, name, assigned, false, primary);
    player.skins=normalizeSkinLoadout(skins);
    player.agents=normalizeAgentLoadout(agents);player.agentId=player.agents[assigned];
    this.players.set(id, player); this.clients.set(id, socket);
    if (this.mode === 'defuse' && ['live', 'ended'].includes(this.round.phase)) { player.alive = false; player.health = 0; player.respawnAt = 0; }
    this.ensureBots();
    this.emit('join', { playerId: id, name, team: assigned, bot: false });
    this.maybeStart();
    return player;
  }

  makePlayer(id, name, team, bot, primary = 'auto') {
    const player = { ...createPlayerState(this.pickSpawn(team)), id, name, team, bot, health: 100, armor: this.mode === 'deathmatch' ? 100 : 0, alive: true,
      money: this.mode === 'deathmatch' ? 16000 : 800, kills: 0, deaths: 0, assists: 0, inventory: {}, skins:{...DEFAULT_SKINS}, slot: this.mode === 'deathmatch' ? 1 : 2,
      helmet:this.mode==='deathmatch',defuseKit:false,zoomLevel:0,flashBlindUntil:0,agents:{...DEFAULT_AGENT_IDS},agentId:DEFAULT_AGENT_IDS[team],
      weapon: 'pistol', input: neutralInput(), inputAt: 0, seq: -1, lastReceivedSeq: -1, lastShotTime: 0, nextShotAt: 0, reloadEndsAt: 0,
      respawnAt: 0, protectionUntil: this.clock() + this.rules.protectionSeconds * 1000, triggerWasDown: false, hasBomb: false,
      botAI: { nextThinkAt: 0, targetId: null, path: [], goal: null, lastKnown: null, lastSeenAt: 0, reactionAt: 0, stuckAt: this.clock(), previous: null, wanderAt: 0, strafe: Math.random() < 0.5 ? -1 : 1 },
    };
    this.giveWeapon(player, team === 'CT' ? 'usp' : 'pistol'); this.giveWeapon(player, 'knife');
    primary=normalizeWeapon(primary);
    if (this.mode === 'deathmatch') this.giveWeapon(player, PRIMARY_WEAPONS.includes(primary)&&canTeamUseWeapon(team,primary) ? primary : defaultPrimaryForTeam(team));
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
      if (this.mode === 'defuse' && ['live', 'ended'].includes(this.round.phase)) { player.alive = false; player.health = 0; }
    }
  }

  removePlayer(id) {
    const player = this.players.get(id);
    if (!player) return;
    if (player.hasBomb) this.dropBomb(player);
    this.players.delete(id); this.clients.delete(id);
    this.emit('leave', { playerId: id, name: player.name, bot: player.bot });
  }

  receiveInput(id, message) {
    const player = this.players.get(id), input = sanitizeInput(message);
    if (!player || !input || input.seq <= player.lastReceivedSeq) return false;
    // Preserve a short click even when press and release arrive between ticks.
    // At most one edge is retained, still subject to ammo, reload and fire rate.
    if (input.fire && !player.input.fire) player.pendingFire = true;
    input.jumpId=Math.max(player.input.jumpId||0,input.jumpId);input.reloadId=Math.max(player.input.reloadId||0,input.reloadId);
    player.lastReceivedSeq = input.seq; player.input = input; player.inputAt = this.clock();
    return true;
  }

  giveWeapon(player, id) { const w = getWeapon(id); player.inventory[w.id] = { ammo: w.magazine, reserve: w.reserve }; }
  selectSlot(player, slot, utilityId=null) {
    const next = slot===4 ? (UTILITY_IDS.includes(utilityId)&&player.inventory[utilityId]?.ammo>0?utilityId:null) : Object.keys(player.inventory).find(id => getWeapon(id).slot === slot);
    if (!next || next === player.weapon) return;
    player.weapon = next; player.slot = slot; player.reloadEndsAt = 0;player.zoomLevel=0;
    player.nextShotAt = Math.max(player.nextShotAt, this.clock() + 180);
  }

  equipSkin(id,weapon,skinId){
    const player=this.players.get(id),skin=getSkin(skinId);
    if(!player||!skin||skin.weapon!==weapon)return {ok:false,message:'无效的武器皮肤。'};
    player.skins[weapon]=skin.id;
    return {ok:true,weapon,skin:skin.id};
  }

  equipAgent(id,agentId){
    const player=this.players.get(id),agent=getAgent(agentId);
    if(!player||!agent||agent.team!==player.team)return {ok:false,message:'请选择当前阵营可用的探员。'};
    player.agentId=agent.id;player.agents[player.team]=agent.id;
    return {ok:true,agent:agent.id,team:agent.team};
  }

  buyStatus(p) {
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
    p.money -= price;
    if (weapon === 'armor') p.armor = 100;
    else if(weapon==='helmet'){p.armor=100;p.helmet=true;}
    else if(weapon==='defusekit')p.defuseKit=true;
    else if(equipment?.slot===4){p.inventory[weapon]||={ammo:0,reserve:0};p.inventory[weapon].ammo++;}
    else { for (const id of Object.keys(p.inventory)) if (getWeapon(id).slot === gun.slot) delete p.inventory[id]; this.giveWeapon(p, weapon);p.reloadEndsAt=0;p.zoomLevel=0;this.selectSlot(p, gun.slot); }
    this.emit('buy', { playerId: id, weapon, money: p.money });
    return { ok: true, weapon, slot:gun?.slot??equipment?.slot??0, money: p.money };
  }

  maybeStart() {
    if (this.mode === 'defuse' && this.round.phase === 'waiting' && this.count('T') && this.count('CT')) this.startRound();
  }

  startRound() {
    const now = this.clock();
    this.round = { number: this.round.number + 1, phase: 'freeze', phaseEndsAt: now + this.rules.freezeSeconds * 1000, buyEndsAt: now + (this.rules.freezeSeconds + this.rules.buySeconds) * 1000, winner: null, reason: '' };
    this.bomb = this.emptyBomb();
    this.grenades.clear();
    for (const p of this.players.values()) this.respawn(p, true);
    const terrorists = [...this.players.values()].filter(p => p.team === 'T');
    const carrier = terrorists.find(p => !p.bot) || terrorists[0];
    if (carrier) { this.bomb.state = 'carried'; this.bomb.carrierId = carrier.id; carrier.hasBomb = true; Object.assign(this.bomb, copyPoint(carrier)); }
    this.emit('round_start', { number: this.round.number, mode: this.mode });
  }

  respawn(p, newRound = false) {
    const spawn = this.pickSpawn(p.team);
    if (newRound && !p.alive) { p.inventory = {}; p.armor = 0;p.helmet=false;p.defuseKit=false; this.giveWeapon(p, p.team === 'CT' ? 'usp' : 'pistol'); this.giveWeapon(p, 'knife'); }
    const consumedJump=p.input.jumpId||0, consumedReload=p.input.reloadId||0;
    Object.assign(p, createPlayerState(spawn), { lastJumpId:consumedJump,lastReloadId:consumedReload,alive: true, health: 100, hasBomb: false, respawnAt: 0, flashBlindUntil:0, reloadEndsAt: 0, triggerWasDown: false, pendingFire: false,
      protectionUntil: this.mode === 'deathmatch' ? this.clock() + this.rules.protectionSeconds * 1000 : 0,
      nextShotAt: this.clock() + 350, input: neutralInput(), inputAt: 0,zoomLevel:0 });
    p.input.yaw = p.yaw || spawn.yaw || 0;
    if (this.mode === 'deathmatch') {p.armor = 100;p.helmet=true;}
    if (newRound && p.bot) {
      const preferred = p.team === 'T' ? 'ak47' : 'm4a1';
      if (p.money >= WEAPONS[preferred].price) { p.money -= WEAPONS[preferred].price; this.giveWeapon(p, preferred); }
    }
    for (const id of Object.keys(p.inventory)) if(!UTILITY_IDS.includes(id))this.giveWeapon(p, id);
    p.botAI.path = []; p.botAI.goal = null; p.botAI.targetId = null; p.botAI.nextThinkAt = 0;
    this.selectSlot(p, Object.keys(p.inventory).some(id => getWeapon(id).slot === 1) ? 1 : 2);
    this.emit('spawn', { playerId: p.id, x: p.x, y: p.y, z: p.z });
  }

  endRound(team, reason) {
    if (this.round.phase !== 'live') return;
    this.round.phase = 'ended'; this.round.winner = team; this.round.reason = reason;
    this.round.phaseEndsAt = this.clock() + this.rules.endSeconds * 1000;
    this.scores[team]++;
    for (const p of this.players.values()) p.money = Math.min(16000, p.money + (p.team === team ? 3250 : 1900));
    this.bomb.action = null; this.bomb.actorId = null; this.bomb.progress = 0;
    this.emit('round_end', { winner: team, reason, scores: { ...this.scores } });
  }

  kill(victim, killer, weapon = 'world', headshot = false) {
    if (!victim.alive) return;
    victim.alive = false; victim.health = 0; victim.deaths++; victim.reloadEndsAt = 0;
    victim.respawnAt = this.mode === 'deathmatch' ? this.clock() + this.rules.respawnSeconds * 1000 : 0;
    if (victim.hasBomb) this.dropBomb(victim);
    if (killer && killer.id !== victim.id) { killer.kills++; killer.money = Math.min(16000, killer.money + (weapon === 'knife' ? 750 : 300)); if (this.mode === 'deathmatch') this.scores[killer.team]++; }
    this.emit('kill', { killerId: killer?.id || null, victimId: victim.id, killerName: killer?.name || '环境', victimName: victim.name, weapon, headshot });
  }

  damagePlayer(victim, attacker, rawDamage, weapon, headshot=false, armorRatio=1, bypassArmor=false) {
    const hit=applyArmorDamage(rawDamage,victim,{headshot,armorRatio,bypassArmor});
    victim.health=Math.max(0,victim.health-hit.damage);
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

  fire(p, input) {
    const now=this.clock(),w=getWeapon(p.weapon),ammo=p.inventory[p.weapon];
    const rising=input.fire&&!p.triggerWasDown;p.triggerWasDown=input.fire;
    if(!p.alive || !input.fire || (!w.automatic&&!rising) || !ammo || now<p.nextShotAt)return;
    // A loaded shell can be fired to interrupt a shell-by-shell reload.
    if(p.reloadEndsAt){if(w.reloadStyle==='shell'&&ammo.ammo>0)p.reloadEndsAt=0;else return;}
    if(w.slot===4){
      if(ammo.ammo<=0 || !this.grenades.throwGrenade(p,w.id,input))return;
      ammo.ammo--;if(ammo.ammo===0)delete p.inventory[w.id];
      p.lastShotTime=now;p.nextShotAt=now+w.fireInterval*1000;p.protectionUntil=0;
      const fallback=Object.keys(p.inventory).some(id=>getWeapon(id).slot===1)?1:Object.keys(p.inventory).some(id=>getWeapon(id).slot===2)?2:3;
      this.selectSlot(p,fallback);return;
    }
    if(w.magazine&&ammo.ammo<=0){this.reload(p);return;}
    if(w.magazine)ammo.ammo--;
    p.lastShotTime=now;p.nextShotAt=now+w.fireInterval*1000;p.protectionUntil=0;
    const scoped=p.zoomLevel>0&&w.zoomFovs.length>1,movement=Math.hypot(p.vx||0,p.vz||0);
    const baseSpread=scoped?w.scopedSpread:p.crouch?(w.crouchingSpread??w.spread):w.spread;
    const spread=baseSpread+(movement>.8?w.movingSpread:0)+(!p.grounded?w.movingSpread:0);
    const origin=eye(p),pellets=[],hits=new Map();
    for(let pellet=0;pellet<(w.pellets||1);pellet++){
      const dir=directionFromAngles(input.yaw+(Math.random()-.5)*spread*2,input.pitch+(Math.random()-.5)*spread*2);
      const worldDistance=raycastWorld(origin,dir,w.range);
      let nearest=worldDistance===null?w.range:Math.min(w.range,worldDistance),victim=null,headshot=false;
      for(const other of this.players.values()){
        if(!other.alive||other.id===p.id||other.team===p.team||now<other.protectionUntil)continue;
        const hit=rayHitPlayer(origin,dir,other,nearest);
        if(hit&&hit.distance<nearest){nearest=hit.distance;victim=other;headshot=hit.headshot;}
      }
      const end={x:origin.x+dir.x*nearest,y:origin.y+dir.y*nearest,z:origin.z+dir.z*nearest};
      pellets.push({end,hitId:victim?.id||null,hitWorld:!victim&&worldDistance!==null&&worldDistance<=w.range,headshot});
      if(victim){
        const damage=w.damage*(headshot?w.headMultiplier:1)*(w.id==='knife'?1:Math.pow(w.rangeModifier??.98,nearest/(500*.0254)));
        const hit=applyArmorDamage(damage,victim,{headshot,armorRatio:w.armorRatio??1,bypassArmor:w.id==='knife'});
        const total=hits.get(victim.id)||{victim,damage:0,headshot:false,armor:false};
        total.damage+=hit.damage;total.headshot||=headshot;total.armor||=hit.armor;hits.set(victim.id,total);
      }
    }
    const representative=pellets.find(pellet=>pellet.hitId)||pellets[0];
    this.emit('shot',{shooterId:p.id,weapon:p.weapon,origin,...representative,...(pellets.length>1?{pellets}: {})});
    for(const hit of hits.values()){
      hit.victim.health=Math.max(0,hit.victim.health-hit.damage);
      this.emit('hit',{shooterId:p.id,targetId:hit.victim.id,damage:hit.damage,headshot:hit.headshot,armor:hit.armor,weapon:w.id});
      if(hit.victim.health===0)this.kill(hit.victim,p,w.id,hit.headshot);
    }
    if(w.unzoomsAfterShot)p.zoomLevel=0;
  }

  reload(p) {
    const w=getWeapon(p.weapon),ammo=p.inventory[p.weapon];
    if(!p.reloadEndsAt&&w.slot!==4&&w.magazine&&ammo&&ammo.ammo<w.magazine&&ammo.reserve>0){
      p.reloadEndsAt=this.clock()+w.reloadTime*1000;p.zoomLevel=0;
    }
  }

  finishReload(p){
    const w=getWeapon(p.weapon),ammo=p.inventory[p.weapon],now=this.clock();
    if(!ammo){p.reloadEndsAt=0;return;}
    if(w.reloadStyle==='shell'){
      while(p.reloadEndsAt&&now>=p.reloadEndsAt){
        if(ammo.reserve>0&&ammo.ammo<w.magazine){ammo.ammo++;ammo.reserve--;}
        p.reloadEndsAt=ammo.reserve>0&&ammo.ammo<w.magazine?p.reloadEndsAt+w.reloadTime*1000:0;
      }
    }else{
      // CS2 2026 magazine reload discards the rounds left in the removed magazine.
      const transfer=Math.min(w.reserveAmmoAsClips?w.magazine:w.magazine-ammo.ammo,ammo.reserve);
      ammo.ammo=w.reserveAmmoAsClips?transfer:ammo.ammo+transfer;ammo.reserve-=transfer;p.reloadEndsAt=0;
    }
  }

  dropBomb(p) {
    p.hasBomb = false; this.bomb.state = 'dropped'; this.bomb.carrierId = null;
    Object.assign(this.bomb, copyPoint(p), { actorId: null, action: null, progress: 0 });
  }

  siteAt(p) { return Object.entries(MAP.sites || {}).find(([, site]) => lengthXZ(site, p) <= site.radius && Math.abs(site.y - p.y) < 3)?.[0] || null; }

  stepBomb(dt) {
    const now = this.clock(), bomb = this.bomb;
    if (bomb.state === 'carried') {
      const carrier = this.players.get(bomb.carrierId);
      if (!carrier?.alive) { if (carrier) this.dropBomb(carrier); else { bomb.state = 'dropped'; bomb.carrierId = null; } }
      else Object.assign(bomb, copyPoint(carrier));
    }
    if (bomb.state === 'dropped') {
      const pickup = [...this.players.values()].find(p => p.alive && p.team === 'T' && dist(p, bomb) < 2.3 && clearSight(eye(p), { x: bomb.x, y: bomb.y + 0.4, z: bomb.z }));
      if (pickup) { pickup.hasBomb = true; bomb.carrierId = pickup.id; bomb.state = 'carried'; }
    }
    if (bomb.state === 'planted' && now >= bomb.explodesAt) {
      bomb.state = 'exploded'; this.emit('bomb_exploded', { x: bomb.x, y: bomb.y, z: bomb.z }); this.endRound('T', '炸弹爆炸'); return;
    }
    let actor = null, action = null, site = null;
    if (bomb.state === 'carried') {
      const p = this.players.get(bomb.carrierId);
      site = p && this.siteAt(p);
      if (p?.alive && p.effectiveInput?.interact && site && Math.hypot(p.vx || 0, p.vz || 0) < 0.65) { actor = p; action = 'plant'; }
    } else if (bomb.state === 'planted') {
      actor = [...this.players.values()].find(p => p.alive && p.team === 'CT' && p.effectiveInput?.interact && dist(p, bomb) < 2.8 && Math.hypot(p.vx || 0, p.vz || 0) < 0.65 && clearSight(eye(p), { x: bomb.x, y: bomb.y + 0.3, z: bomb.z }));
      if (actor) action = 'defuse';
    }
    if (!actor) { bomb.actorId = null; bomb.action = null; bomb.progress = 0; return; }
    if (bomb.actorId !== actor.id || bomb.action !== action) { bomb.progress = 0; bomb.actorId = actor.id; bomb.action = action; }
    bomb.progress = Math.min(1, bomb.progress + dt / (action === 'plant' ? this.rules.plantSeconds : actor.defuseKit ? this.rules.defuseKitSeconds : this.rules.defuseSeconds));
    if (bomb.progress < 1 - 1e-8) return;
    if (action === 'plant') {
      actor.hasBomb = false; actor.money = Math.min(16000, actor.money + 300);
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
    const now = this.clock(), ai = p.botAI, input = neutralInput();
    input.yaw = p.yaw || 0; input.pitch = p.pitch || 0;
    if (now >= ai.nextThinkAt) {
      ai.nextThinkAt = now + 230 + Math.random() * 80;
      const candidates = [...this.players.values()].filter(e => e.alive && e.team !== p.team && now >= e.protectionUntil && dist(p, e) < 110).sort((a, b) => dist(p, a) - dist(p, b));
      const enemy = now<(p.flashBlindUntil||0)?null:candidates.find(e => this.visibleToBot(eye(p), eye(e)));
      if (enemy) {
        if (ai.targetId !== enemy.id) ai.reactionAt = now + 420 + Math.random() * 240;
        ai.targetId = enemy.id; ai.lastKnown = copyPoint(enemy); ai.lastSeenAt = now;
        // A hurt bot seeks an adjacent occluded node instead of knowing positions through walls.
        if (p.health < 40 && Math.random() < 0.25) {
          const node = this.nearestNav(p);
          const cover = (node?.neighbors || []).map(id => this.navMap.get(String(id))).find(n => n && !clearSight(eye(enemy), { x: n.x, y: n.y + 1.3, z: n.z }));
          if (cover) { ai.goal = copyPoint(cover); ai.path = this.planPath(p, cover); }
        }
      } else ai.targetId = null;
      if (!ai.goal || !ai.path.length || lengthXZ(p, ai.goal) < 1.6 || now > ai.wanderAt) {
        ai.goal = this.chooseBotGoal(p); ai.path = this.planPath(p, ai.goal); ai.wanderAt = now + 5500 + Math.random() * 3000;
      }
      if (!ai.previous || lengthXZ(ai.previous, p) > 0.55) { ai.previous = copyPoint(p); ai.stuckAt = now; }
      else if (now - ai.stuckAt > 2500) { ai.goal = null; ai.path = []; ai.stuckAt = now; }
    }
    const target = this.players.get(ai.targetId);
    while (ai.path.length && lengthXZ(p, ai.path[0]) < 0.8 && Math.abs(p.y - ai.path[0].y) < 1.5) ai.path.shift();
    const waypoint = ai.path[0];
    if (waypoint) {
      const dx = waypoint.x - p.x, dz = waypoint.z - p.z, d = Math.hypot(dx, dz);
      input.yaw = Math.atan2(-dx, -dz); input.pitch = 0;
      if (d > 0.15) input.forward = 1;
      if (waypoint.y - p.y > 0.4 || now - ai.stuckAt > 1300) input.jump = Math.floor(now / 600) % 2 === 0;
    }
    if (target?.alive && now>=(p.flashBlindUntil||0) && this.visibleToBot(eye(p), eye(target))) {
      const from = eye(p), to = eye(target), dx = to.x - from.x, dy = to.y - from.y - 0.28, dz = to.z - from.z;
      const aimError = 0.013 + dist(p, target) / 12000;
      input.yaw = Math.atan2(-dx, -dz) + Math.sin(now / 440 + Number(p.id.slice(2))) * aimError;
      input.pitch = Math.atan2(dy, Math.hypot(dx, dz)) + Math.cos(now / 630) * aimError;
      input.forward = 0; input.right = 0;
      if (now > ai.reactionAt) input.fire = Math.floor(now / 150) % 7 < 5;
      if (p.weapon === 'knife') input.forward = 1;
    } else if (waypoint) {
      const dx = waypoint.x - p.x, dz = waypoint.z - p.z, d = Math.max(0.01, Math.hypot(dx, dz));
      input.forward = (-Math.sin(input.yaw) * dx - Math.cos(input.yaw) * dz) / d;
      input.right = (Math.cos(input.yaw) * dx - Math.sin(input.yaw) * dz) / d;
    }
    const ammo = p.inventory[p.weapon]; if (ammo && ammo.ammo < 3) input.reload = true;
    if (this.mode === 'defuse') {
      const plant = p.hasBomb && this.siteAt(p);
      const defuse = p.team === 'CT' && this.bomb.state === 'planted' && dist(p, this.bomb) < 2.6;
      if (plant || defuse) { input.forward = 0; input.right = 0; input.fire = false; input.jump = false; input.interact = true; }
    }
    return input;
  }

  tick(dt = 1 / TICK_RATE) {
    const now = this.clock();
    this.maybeStart();
    if (this.mode === 'defuse') {
      if (this.round.phase === 'freeze' && now >= this.round.phaseEndsAt) { this.round.phase = 'live'; this.round.phaseEndsAt = now + this.rules.roundSeconds * 1000; }
      else if (this.round.phase === 'ended' && now >= this.round.phaseEndsAt) { if (this.count('T') && this.count('CT')) this.startRound(); else { this.round.phase = 'waiting'; this.round.phaseEndsAt = 0; } }
    }
    const canAct = this.round.phase === 'live';
    for (const p of this.players.values()) {
      if (!p.alive) { if (p.respawnAt && now >= p.respawnAt) this.respawn(p); continue; }
      const input = p.bot ? this.botInput(p, dt) : now - p.inputAt < 300 ? { ...p.input } : { ...neutralInput(), yaw: p.yaw || 0, pitch: p.pitch || 0 };
      if (!p.bot && p.pendingFire && now - p.inputAt < 300) { input.fire = true; p.triggerWasDown = false; }
      p.pendingFire = false;
      if(!p.bot){
        const fresh=now-p.inputAt<300;
        if(fresh&&(input.reloadId||0)>(p.lastReloadId||0))input.reload=true;
        p.lastReloadId=Math.max(p.lastReloadId||0,p.input.reloadId||0);
        if(!fresh||(!canAct&&this.mode==='defuse')){p.lastJumpId=Math.max(p.lastJumpId||0,p.input.jumpId||0);p.jumpBufferRemaining=0;}
      }
      p.seq = Math.max(p.seq, p.input.seq ?? -1);
      if (!canAct && this.mode === 'defuse') Object.assign(input, { forward: 0, right: 0, jump: false, fire: false, interact: false });
      if (input.slot) this.selectSlot(p, input.slot,input.utilityId);
      p.zoomLevel=p.reloadEndsAt?0:clamp(input.zoomLevel||0,0,getWeapon(p.weapon).zoomFovs.length-1);
      input.speedScale=weaponSpeedScale(p.weapon,p.zoomLevel);
      p.effectiveInput = input;
      p.yaw = input.yaw; p.pitch = input.pitch;
      stepPlayer(p, input, dt);
      if (!Number.isFinite(p.x + p.y + p.z) || p.outOfWorld || p.y < (MAP.bounds?.min?.y ?? -200) - 30) { this.kill(p, null); continue; }
      if(p.reloadEndsAt&&now>=p.reloadEndsAt)this.finishReload(p);
      if (input.reload) this.reload(p);
      if (canAct) this.fire(p, input);
    }
    if(canAct)this.grenades.tick(dt);
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
    const players = [...this.players.values()].map(p => ({ id: p.id, name: p.name, team: p.team, bot: p.bot, agentId:p.agentId||DEFAULT_AGENT_IDS[p.team], x: round2(p.x), y: round2(p.y), z: round2(p.z),
      vx: round2(p.vx), vy: round2(p.vy), vz: round2(p.vz), yaw: round2(p.yaw), pitch: round2(p.pitch), crouch: !!p.crouch, grounded: !!p.grounded,
      health: p.health, armor: round2(p.armor), helmet:!!p.helmet, defuseKit:!!p.defuseKit,zoomLevel:p.zoomLevel,utilityCounts:Object.fromEntries(UTILITY_IDS.map(id=>[id,p.inventory[id]?.ammo||0])), alive: p.alive, weapon: p.weapon, skinId:p.skins[p.weapon]||DEFAULT_SKINS[p.weapon], slot: p.slot, ammo: p.inventory[p.weapon]?.ammo || 0, reserve: p.inventory[p.weapon]?.reserve || 0,
      reserveAmmoAsClips:!!getWeapon(p.weapon).reserveAmmoAsClips,reserveClips:getWeapon(p.weapon).reserveAmmoAsClips?Math.ceil((p.inventory[p.weapon]?.reserve||0)/getWeapon(p.weapon).magazine):0,
      reloadRemaining: Math.max(0, (p.reloadEndsAt - now) / 1000), money: p.money, kills: p.kills, deaths: p.deaths, assists: p.assists, seq: p.seq,
      ...this.buyStatus(p), inventory: Object.keys(p.inventory), hasBomb: p.hasBomb, spawnProtectionRemaining: Math.max(0, (p.protectionUntil - now) / 1000),
      respawnIn: p.respawnAt ? Math.max(0, (p.respawnAt - now) / 1000) : 0, lastShotTime: p.lastShotTime }));
    const events = drainEvents ? this.events.splice(0) : [...this.events];
    return { type: 'snapshot', time: now, room: this.code, mode: this.mode, players,...this.grenades.snapshot(),
      round: { ...this.round, timeLeft: this.round.phaseEndsAt ? Math.max(0, (this.round.phaseEndsAt - now) / 1000) : 0 },
      bomb: { ...this.bomb, remaining: this.bomb.state === 'planted' ? Math.max(0, (this.bomb.explodesAt - now) / 1000) : 0 }, scores: { ...this.scores }, events };
  }
}
