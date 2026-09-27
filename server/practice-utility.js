import { UTILITY_IDS, getEquipment } from '../shared/equipment.js';
import { isUtilityMode } from '../shared/match-rules.js';
import { cloneThrowRecord, sanitizePracticeName, sanitizePackId, PRACTICE_KIT, PRACTICE_AMMO, cloneThrowTape } from '../shared/practice-throws.js';
import { loadBuiltInPracticePacks, practicePackColor } from '../shared/practice-packs.js';
import { eyePosition } from '../shared/aim.js';
import { raycastWorld } from '../shared/physics.js';
import { formatModeHelp } from '../shared/mode-help.js';

const DUPLICATE_RECORD_TIP = '名称已存在 · 先 /remake <旧名> <新名> 改名，或 /redo <名> on 覆盖投掷';
const SESSION_PACK = 'session';
const REMOVE_RANGE = 48;

export { PRACTICE_KIT, PRACTICE_AMMO };

export function practiceUtilityAt(index) {
  return PRACTICE_KIT[Math.max(0, Math.min(PRACTICE_KIT.length - 1, index))] || 'hegrenade';
}

export function equipPracticeKit(player) {
  if (!player || player.practiceDummy) return false;
  player.inventory = {};
  for (const id of PRACTICE_KIT) player.inventory[id] = { ammo: PRACTICE_AMMO, reserve: 0 };
  player.weapon = 'hegrenade';
  player.slot = 4;
  player.money = 0;
  player.armor = 100;
  player.helmet = true;
  player.defuseKit = false;
  player.hasBomb = false;
  player.zoomLevel = 0;
  return true;
}

export function refillPracticeAmmo(player) {
  if (!player?.inventory) return;
  for (const id of PRACTICE_KIT) {
    if (player.inventory[id]) player.inventory[id].ammo = PRACTICE_AMMO;
    else player.inventory[id] = { ammo: PRACTICE_AMMO, reserve: 0 };
  }
}

function practiceState(room) {
  if (!room.practice) {
    room.practice = {
      throws: new Map(),
      packs: new Map(),
      lastByPlayer: new Map(),
      redoByPlayer: new Map(),
      impactsByOwner: new Map(),
      dummySerial: 0,
      nextPackColor: 0,
    };
  }
  return room.practice;
}

function ensurePack(state, packId, { builtIn = false, color = null } = {}) {
  const id = sanitizePackId(packId) || SESSION_PACK;
  let pack = state.packs.get(id);
  if (!pack) {
    pack = {
      id,
      builtIn: !!builtIn,
      color: color || practicePackColor(state.nextPackColor++),
      names: new Set(),
    };
    state.packs.set(id, pack);
  }
  return pack;
}

function putThrow(state, entry, packId) {
  const saved = cloneThrowRecord(entry);
  const key = sanitizePracticeName(saved?.name);
  if (!key || !saved?.weapon || !saved.stand) return null;
  const pack = ensurePack(state, packId || saved.packId || SESSION_PACK);
  const previous = state.throws.get(key);
  if (previous?.packId && previous.packId !== pack.id) {
    state.packs.get(previous.packId)?.names.delete(key);
  }
  saved.name = key;
  saved.packId = pack.id;
  state.throws.set(key, saved);
  pack.names.add(key);
  return saved;
}

function seedBuiltInPacks(state) {
  for (const pack of loadBuiltInPracticePacks()) {
    ensurePack(state, pack.id, { builtIn: true, color: pack.color });
    for (const entry of pack.throws) putThrow(state, entry, pack.id);
  }
  ensurePack(state, SESSION_PACK, { builtIn: false, color: practicePackColor(7) });
}

export function initPracticeRoom(room) {
  if (!isUtilityMode(room.mode)) return;
  const state = practiceState(room);
  seedBuiltInPacks(state);
  room.desiredBots = 0;
}

export function capturePracticeThrow(room, player, meta) {
  if (!isUtilityMode(room.mode) || !player || player.bot) return;
  const state = practiceState(room);
  const impacts = state.impactsByOwner.get(player.id) || [];
  state.impactsByOwner.set(player.id, []);
  const tape = meta.tape || finalizePracticeThrowTape(player);
  const record = {
    name: null,
    weapon: meta.weapon,
    team: player.team,
    stand: { x: meta.stand.x, y: meta.stand.y, z: meta.stand.z },
    yaw: meta.yaw,
    pitch: meta.pitch,
    throwMode: meta.throwMode,
    throwStrength: meta.throwStrength,
    jumpThrow: !!meta.jumpThrow,
    crouch: !!meta.crouch,
    velocity: { x: meta.vx || 0, y: meta.vy || 0, z: meta.vz || 0 },
    impacts: impacts.map((i) => ({ ...i })),
    recordedAt: room.clock(),
    ...(tape ? { tape } : {}),
  };
  state.lastByPlayer.set(player.id, record);
  const redoName = state.redoByPlayer.get(player.id);
  if (redoName && state.throws.has(redoName)) {
    const existing = state.throws.get(redoName);
    putThrow(state, { ...record, name: redoName }, existing.packId || SESSION_PACK);
  }
}

const TAPE_MAX_MS = 4500;
const TAPE_MAX_FRAMES = 160;
const r3 = (n) => (Number.isFinite(n) ? Math.round(n * 1000) / 1000 : 0);

function compactTapeFrame(t, player, input = {}) {
  return {
    t: Math.max(0, Math.round(t)),
    x: r3(player.x),
    y: r3(player.y),
    z: r3(player.z),
    yaw: r3(player.yaw ?? input.yaw),
    pitch: r3(player.pitch ?? input.pitch),
    vx: r3(player.vx),
    vy: r3(player.vy),
    vz: r3(player.vz),
    fwd: r3(input.forward || 0),
    right: r3(input.right || 0),
    walk: !!input.walk,
    jump: !!input.jump,
    crouch: !!(player.crouch || input.crouch),
    fire: !!input.fire,
    fire2: !!input.fire2,
    grounded: !!player.grounded,
    jumpId: Number.isFinite(input.jumpId) ? input.jumpId : 0,
  };
}

/** Begin capturing press→release motion when a nade is primed. */
export function startPracticeThrowTape(room, player, input) {
  if (!isUtilityMode(room.mode) || !player || player.bot || player.practiceDummy) return;
  player.practiceTape = { startedAt: room.clock(), frames: [] };
  samplePracticeThrowTape(room, player, input);
}

export function samplePracticeThrowTape(room, player, input) {
  if (!isUtilityMode(room.mode) || !player?.practiceTape) return;
  const tape = player.practiceTape;
  const t = room.clock() - tape.startedAt;
  if (t > TAPE_MAX_MS || tape.frames.length >= TAPE_MAX_FRAMES) return;
  const frame = compactTapeFrame(t, player, input || player.input || {});
  const prev = tape.frames[tape.frames.length - 1];
  // Keep first frame + release density; skip near-duplicate mid frames.
  if (prev && frame.t - prev.t < 28) {
    const samePose =
      Math.abs(prev.x - frame.x) < 0.02
      && Math.abs(prev.y - frame.y) < 0.02
      && Math.abs(prev.z - frame.z) < 0.02
      && Math.abs(prev.yaw - frame.yaw) < 0.01
      && Math.abs(prev.pitch - frame.pitch) < 0.01
      && prev.crouch === frame.crouch
      && prev.jump === frame.jump
      && prev.fire === frame.fire
      && prev.fire2 === frame.fire2
      && prev.walk === frame.walk
      && Math.abs(prev.fwd - frame.fwd) < 0.05
      && Math.abs(prev.right - frame.right) < 0.05;
    if (samePose) {
      tape.frames[tape.frames.length - 1] = frame;
      return;
    }
  }
  tape.frames.push(frame);
}

export function finalizePracticeThrowTape(player) {
  const tape = player?.practiceTape;
  player.practiceTape = null;
  if (!tape?.frames?.length) return null;
  return cloneThrowTape({
    version: 1,
    durationMs: tape.frames[tape.frames.length - 1].t,
    frames: tape.frames,
  });
}

export function clearPracticeThrowTape(player) {
  if (player) player.practiceTape = null;
}

function applyTapeFrame(player, frame) {
  if (!player || !frame) return;
  Object.assign(player, {
    x: frame.x,
    y: frame.y,
    z: frame.z,
    yaw: frame.yaw,
    pitch: frame.pitch,
    vx: frame.vx,
    vy: frame.vy,
    vz: frame.vz,
    crouch: !!frame.crouch,
    height: frame.crouch ? 1.1 : 1.8,
    grounded: !!frame.grounded,
  });
  if (player.input) {
    Object.assign(player.input, {
      yaw: frame.yaw,
      pitch: frame.pitch,
      forward: frame.fwd,
      right: frame.right,
      walk: !!frame.walk,
      jump: !!frame.jump,
      crouch: !!frame.crouch,
      fire: !!frame.fire,
      fire2: !!frame.fire2,
      jumpId: frame.jumpId || 0,
    });
  }
}

function frameAtElapsed(frames, elapsedMs) {
  let frame = frames[0];
  for (let i = 0; i < frames.length; i++) {
    if (frames[i].t <= elapsedMs) frame = frames[i];
    else break;
  }
  return frame;
}

/** Start /show motion replay; returns true if tape playback is running. */
export function beginPracticeReplay(room, player, entry) {
  const tape = cloneThrowTape(entry?.tape);
  if (!tape?.frames?.length) return false;
  clearPracticeThrowTape(player);
  player.practiceReplay = null;
  room.grenades.projectiles = room.grenades.projectiles.filter((g) => g.ownerId !== player.id);
  player.godMode = true;
  player.svCheats = true;
  player.noclip = false;
  player.fly = false;
  const weapon = entry.weapon;
  equipPracticeKit(player);
  refillPracticeAmmo(player);
  player.weapon = weapon;
  player.slot = 4;
  applyTapeFrame(player, tape.frames[0]);
  if (player.input) {
    player.input.slot = 4;
    player.input.utilityId = weapon;
  }
  player.alive = true;
  player.health = 100;
  player.respawnAt = 0;
  player.practiceReplay = {
    name: entry.name,
    entry,
    frames: tape.frames,
    durationMs: tape.durationMs,
    startedAt: room.clock(),
    thrown: false,
    observeUntil: 0,
  };
  return true;
}

/**
 * Drive kinematic press→release replay.
 * @returns {'active'|'observe'|false}
 */
export function stepPracticeReplay(room, player) {
  const rp = player?.practiceReplay;
  if (!rp) return false;
  const now = room.clock();
  player.inputAt = now;

  if (!rp.thrown) {
    const elapsed = now - rp.startedAt;
    const frame = frameAtElapsed(rp.frames, elapsed);
    applyTapeFrame(player, frame);
    if (elapsed < rp.durationMs) return 'active';

    const entry = rp.entry;
    const weapon = entry.weapon;
    applyTapeFrame(player, rp.frames[rp.frames.length - 1]);
    Object.assign(player, {
      yaw: entry.yaw,
      pitch: entry.pitch,
      vx: entry.velocity?.x || 0,
      vy: entry.velocity?.y || (entry.jumpThrow ? 4.2 : 0),
      vz: entry.velocity?.z || 0,
      crouch: !!entry.crouch,
      grounded: !entry.jumpThrow && !(entry.velocity?.y > 0.4),
    });
    const ok = room.grenades.throwGrenade(player, weapon, {
      yaw: entry.yaw,
      pitch: entry.pitch,
      throwMode: entry.throwMode,
      throwStrength: entry.throwStrength,
    });
    refillPracticeAmmo(player);
    player.noclip = true;
    player.fly = true;
    player.vx = 0;
    player.vy = 0;
    player.vz = 0;
    rp.thrown = true;
    rp.observeUntil = now + 900;
    if (ok) {
      room.emit('grenade_thrown', {
        shooterId: player.id,
        weapon,
        mode: entry.throwMode,
        practiceShow: entry.name,
        origin: { x: player.x, y: player.y + 1.4, z: player.z },
      });
    }
    return 'observe';
  }

  if (now < rp.observeUntil) return 'observe';
  player.practiceReplay = null;
  return false;
}

export function clearPracticeReplay(player) {
  if (player) player.practiceReplay = null;
}

export function notePracticeImpact(room, ownerId, impact) {
  if (!isUtilityMode(room.mode) || !ownerId) return;
  const state = practiceState(room);
  const list = state.impactsByOwner.get(ownerId) || [];
  list.push({ ...impact, at: room.clock() });
  if (list.length > 24) list.splice(0, list.length - 24);
  state.impactsByOwner.set(ownerId, list);
  const last = state.lastByPlayer.get(ownerId);
  if (last) last.impacts = [...(last.impacts || []), { ...impact, at: room.clock() }].slice(-24);
}

export function bumpPracticeDummyHud(dummy, hit = {}) {
  if (!dummy?.practiceDummy) return;
  const hud = dummy.practiceHud || (dummy.practiceHud = { he: 0, fire: 0, flashPct: 0, flashSec: 0, at: 0 });
  // Each new hit refreshes that line (latest throw), instead of keeping historical max/total forever.
  if (hit.type === 'he' || hit.type === 'damage') {
    hud.he = Math.round((Number(hit.damage) || 0) * 10) / 10;
  }
  if (hit.type === 'fire') {
    // Molotov applies as ticks — accumulate within the burn; a later HE/flash leaves fire as last burn total until next fire starts.
    const gapMs = hud.at ? Date.now() - hud.at : 1e9;
    const freshBurn = gapMs > 800 || (hud._lastType && hud._lastType !== 'fire');
    const dmg = Number(hit.damage) || 0;
    hud.fire = Math.round(((freshBurn ? 0 : hud.fire) + dmg) * 10) / 10;
  }
  if (hit.type === 'flash') {
    hud.flashPct = Math.round(Math.max(0, Math.min(1, Number(hit.exposure) || 0)) * 100);
    hud.flashSec = Math.round(Math.max(0, Number(hit.duration) || 0) * 10) / 10;
  }
  hud._lastType = hit.type || null;
  hud.at = Date.now();
}

export function practiceDummyHudSnapshot(dummy) {
  const hud = dummy?.practiceHud;
  if (!hud) return null;
  return {
    he: Math.round(hud.he || 0),
    fire: Math.round(hud.fire || 0),
    flashPct: Math.round(hud.flashPct || 0),
    flashSec: Math.round((hud.flashSec || 0) * 10) / 10,
  };
}

export function resetPracticeDummyHud(dummy) {
  if (!dummy) return;
  dummy.practiceHud = { he: 0, fire: 0, flashPct: 0, flashSec: 0, at: 0, _lastType: null };
}

export function practiceDummyInput(p) {
  const input = {
    seq: 0,
    forward: 0,
    right: 0,
    yaw: p.yaw || 0,
    pitch: p.pitch || 0,
    jump: false,
    jumpId: p.input?.jumpId || 0,
    crouch: !!p.crouch,
    walk: false,
    fire: false,
    fire2: false,
    cancelGrenade: true,
    reload: false,
    reloadId: p.input?.reloadId || 0,
    slot: p.slot || 2,
    utilityId: null,
    zoomLevel: 0,
    speedScale: 1,
    interact: false,
    viewTime: null,
  };
  return input;
}

export function placePracticeDummy(room, placer, teamArg) {
  const team = String(teamArg || '').toUpperCase() === 'CT' ? 'CT' : String(teamArg || '').toUpperCase() === 'T' ? 'T' : null;
  if (!team) return { ok: true, private: true, reply: '用法：/set T 或 /set CT' };
  const state = practiceState(room);
  const existing = [...room.players.values()].find((p) => p.practiceDummy && p.team === team);
    if (existing) {
    existing.holdPoint = { x: placer.x, y: placer.y, z: placer.z, yaw: placer.yaw || 0, pitch: placer.pitch || 0 };
    Object.assign(existing, { x: placer.x, y: placer.y, z: placer.z, yaw: placer.yaw || 0, pitch: 0, vx: 0, vy: 0, vz: 0 });
    resetPracticeDummyHud(existing);
    if (!existing.alive) {
      existing.respawnAt = 0;
      room.respawn(existing);
      applyHoldPoint(existing);
    }
    return { ok: true, private: true, reply: `已移动 ${team} 假人到当前位置（死亡后仍回此点）` };
  }
  const n = ++state.dummySerial;
  const id = `practice_${team}_${n}`;
  const dummy = room.makePlayer(id, `${team} 假人 ${n}`, team, true);
  dummy.practiceDummy = true;
  resetPracticeDummyHud(dummy);
  dummy.holdPoint = { x: placer.x, y: placer.y, z: placer.z, yaw: placer.yaw || 0, pitch: 0 };
  Object.assign(dummy, {
    x: placer.x,
    y: placer.y,
    z: placer.z,
    yaw: placer.yaw || 0,
    pitch: 0,
    money: 0,
    armor: 100,
    helmet: true,
  });
  room.players.set(id, dummy);
  return { ok: true, private: true, reply: `已放置 ${team} 假人 · 站桩不动 · 死亡后在此点重生` };
}

function aimDirection(yaw, pitch) {
  const c = Math.cos(pitch);
  return { x: -Math.sin(yaw) * c, y: Math.sin(pitch), z: -Math.cos(yaw) * c };
}

function sphereHit(origin, dir, center, radius) {
  const ox = origin.x - center.x;
  const oy = origin.y - center.y;
  const oz = origin.z - center.z;
  const b = ox * dir.x + oy * dir.y + oz * dir.z;
  const c = ox * ox + oy * oy + oz * oz - radius * radius;
  const discriminant = b * b - c;
  if (discriminant < 0) return null;
  const d = -b - Math.sqrt(discriminant);
  return d >= 0 ? d : (-b + Math.sqrt(discriminant) >= 0 ? 0 : null);
}

function boxHit(origin, dir, lo, hi) {
  let near = 0;
  let far = Infinity;
  for (const axis of ['x', 'y', 'z']) {
    if (Math.abs(dir[axis]) < 1e-8) {
      if (origin[axis] < lo[axis] || origin[axis] > hi[axis]) return null;
      continue;
    }
    let a = (lo[axis] - origin[axis]) / dir[axis];
    let b = (hi[axis] - origin[axis]) / dir[axis];
    if (a > b) [a, b] = [b, a];
    near = Math.max(near, a);
    far = Math.min(far, b);
    if (near > far) return null;
  }
  return far >= 0 ? near : null;
}

function rayHitPracticeDummy(origin, direction, player, maxDistance = Infinity) {
  const height = player.crouch ? 1.1 : 1.8;
  const head = sphereHit(origin, direction, { x: player.x, y: player.y + height - 0.18, z: player.z }, 0.22);
  const body = boxHit(
    origin,
    direction,
    { x: player.x - 0.28, y: player.y + 0.08, z: player.z - 0.28 },
    { x: player.x + 0.28, y: player.y + height - 0.39, z: player.z + 0.28 },
  );
  if (head !== null && head <= maxDistance && (body === null || head <= body)) return head;
  return body !== null && body <= maxDistance ? body : null;
}

/** Remove the practice T/CT dummy under the caller's crosshair. */
export function removePracticeDummyAtCrosshair(room, player) {
  if (!player) return { ok: true, private: true, reply: '无法移除' };
  const origin = eyePosition(player);
  const dir = aimDirection(player.yaw || 0, player.pitch || 0);
  const worldHit = raycastWorld(origin, dir, REMOVE_RANGE);
  const maxDist = worldHit == null ? REMOVE_RANGE : Math.max(0.2, worldHit - 0.02);
  let best = null;
  let bestDist = maxDist;
  for (const dummy of room.players.values()) {
    if (!dummy.practiceDummy || dummy.id === player.id) continue;
    const hit = rayHitPracticeDummy(origin, dir, dummy, bestDist);
    if (hit === null) continue;
    best = dummy;
    bestDist = hit;
  }
  if (!best) {
    return { ok: true, private: true, reply: '准心处没有 T/CT 假人 · 对准后再 /remove' };
  }
  const team = best.team;
  const name = best.name;
  room.removePlayer(best.id);
  return { ok: true, private: true, reply: `已移除 ${team} 假人（${name}）` };
}

function applyHoldPoint(p) {
  if (!p?.holdPoint) return;
  Object.assign(p, {
    x: p.holdPoint.x,
    y: p.holdPoint.y,
    z: p.holdPoint.z,
    yaw: p.holdPoint.yaw || 0,
    pitch: p.holdPoint.pitch || 0,
    vx: 0,
    vy: 0,
    vz: 0,
  });
  if (p.input) {
    p.input.yaw = p.yaw;
    p.input.pitch = p.pitch;
  }
}

export function afterPracticeRespawn(room, p) {
  if (!p?.practiceDummy || !p.holdPoint) return;
  applyHoldPoint(p);
  // Keep practiceHud so the last nade/fire/flash numbers stay readable after death.
}

function requireName(args, usage) {
  const name = sanitizePracticeName(args);
  if (!name) return { error: usage };
  return { name };
}

export function handlePracticeCommand(room, player, command) {
  if (!isUtilityMode(room.mode)) return null;
  const { name, args } = command;
  const state = practiceState(room);

  if (name === 'help') {
    return formatModeHelp(room.mode);
  }

  if (name === 'set') {
    return placePracticeDummy(room, player, args.trim().split(/\s+/)[0]);
  }

  if (name === 'remove') {
    return removePracticeDummyAtCrosshair(room, player);
  }

  if (name === 'fly') {
    player.svCheats = true;
    const on = !(player.noclip && player.fly);
    player.noclip = on;
    player.fly = on;
    if (!on && player.godMode) player.godMode = false;
    return { ok: true, private: true, reply: `fly ${on ? 'on（飞行+穿墙）' : 'off'}` };
  }

  if (name === 'god') {
    player.godMode = !player.godMode;
    if (player.godMode) {
      player.noclip = true;
      player.fly = true;
      player.svCheats = true;
    }
    return { ok: true, private: true, reply: `上帝模式 ${player.godMode ? 'on（穿墙+飞天+无敌）' : 'off'}` };
  }

  if (name === 'record') {
    const { name: key, error } = requireName(args, '用法：/record <名字>');
    if (error) return { ok: true, private: true, reply: error };
    const last = state.lastByPlayer.get(player.id);
    if (!last) return { ok: true, private: true, reply: '还没有投掷记录 · 先丢一颗道具再 /record' };
    if (state.throws.has(key) && state.redoByPlayer.get(player.id) !== key) {
      const reply = `「${key}」${DUPLICATE_RECORD_TIP}`;
      return {
        ok: true,
        private: true,
        reply,
        clientCommand: 'practice_toast',
        args: JSON.stringify({ text: reply, tone: 'warn' }),
      };
    }
    const saved = cloneThrowRecord(last);
    saved.name = key;
    putThrow(state, saved, SESSION_PACK);
    const impactNote = saved.impacts?.length ? ` · 命中样本 ${saved.impacts.length}` : '';
    const tapeNote = saved.tape?.frames?.length ? ` · 过程 ${saved.tape.frames.length} 帧/${saved.tape.durationMs}ms` : '';
    return {
      ok: true,
      private: true,
      reply: `已记录 ${key} · ${saved.weapon} · ${saved.throwMode}${saved.jumpThrow ? ' · 跳投' : ''}${saved.crouch ? ' · 蹲' : ''}${tapeNote}${impactNote}`,
    };
  }

  if (name === 'remake') {
    const parts = args.trim().split(/\s+/).filter(Boolean);
    if (parts.length < 2) return { ok: true, private: true, reply: '用法：/remake <旧名> <新名>' };
    const from = sanitizePracticeName(parts[0]);
    const to = sanitizePracticeName(parts[1]);
    if (!from || !to) return { ok: true, private: true, reply: '用法：/remake <旧名> <新名>' };
    if (!state.throws.has(from)) return { ok: true, private: true, reply: `未找到「${from}」` };
    if (from === to) return { ok: true, private: true, reply: '新旧名称相同' };
    if (state.throws.has(to)) return { ok: true, private: true, reply: `「${to}」已被占用` };
    const entry = state.throws.get(from);
    state.throws.delete(from);
    state.packs.get(entry.packId)?.names.delete(from);
    entry.name = to;
    putThrow(state, entry, entry.packId || SESSION_PACK);
    for (const [pid, redo] of state.redoByPlayer) {
      if (redo === from) state.redoByPlayer.set(pid, to);
    }
    return { ok: true, private: true, reply: `已改名 ${from} → ${to}` };
  }

  if (name === 'redo') {
    const parts = args.trim().split(/\s+/).filter(Boolean);
    const key = sanitizePracticeName(parts[0] || '');
    const flag = String(parts[1] || '').toLowerCase();
    if (!key || !['on', 'off'].includes(flag)) {
      return { ok: true, private: true, reply: '用法：/redo <名字> on 或 /redo <名字> off' };
    }
    if (!state.throws.has(key)) return { ok: true, private: true, reply: `未找到「${key}」` };
    if (flag === 'on') {
      state.redoByPlayer.set(player.id, key);
      return { ok: true, private: true, reply: `redo on · 之后每次投掷会更新「${key}」· 用 /redo ${key} off 结束` };
    }
    const last = state.lastByPlayer.get(player.id);
    if (last) {
      const existing = state.throws.get(key);
      putThrow(state, { ...last, name: key }, existing?.packId || SESSION_PACK);
    }
    if (state.redoByPlayer.get(player.id) === key) state.redoByPlayer.delete(player.id);
    return { ok: true, private: true, reply: `redo off · 已写入「${key}」` };
  }

  if (name === 'show') {
    const { name: key, error } = requireName(args, '用法：/show <名字>');
    if (error) return { ok: true, private: true, reply: error };
    const entry = state.throws.get(key);
    if (!entry) return { ok: true, private: true, reply: `未找到「${key}」` };
    return replayPracticeThrow(room, player, entry);
  }

  if (name === 'out') {
    const token = args.trim().toLowerCase();
    if (!token) return { ok: true, private: true, reply: '用法：/out <名字> 或 /out all' };
    if (token === 'all') {
      const list = [...state.throws.values()].map(cloneThrowRecord);
      if (!list.length) return { ok: true, private: true, reply: '没有已记录的道具点' };
      return {
        ok: true,
        private: true,
        reply: `导出全部 ${list.length} 条道具点`,
        clientCommand: 'practice_export',
        args: JSON.stringify({ all: true, throws: list }),
      };
    }
    const key = sanitizePracticeName(args);
    const entry = state.throws.get(key);
    if (!entry) return { ok: true, private: true, reply: `未找到「${key}」` };
    return {
      ok: true,
      private: true,
      reply: `导出「${key}」`,
      clientCommand: 'practice_export',
      args: JSON.stringify({ all: false, throws: [cloneThrowRecord(entry)] }),
    };
  }

  if (name === 'in') {
    const flag = String(args || '').trim().toLowerCase();
    if (flag && flag !== 'force' && flag !== 'replace') {
      return { ok: true, private: true, reply: '用法：/in 选择 JSON 导入 · /in force 覆盖同名' };
    }
    const force = flag === 'force' || flag === 'replace';
    return {
      ok: true,
      private: true,
      reply: force ? '请选择 JSON · 同名将覆盖' : '请选择要导回的道具练习 JSON',
      clientCommand: 'practice_import_pick',
      args: JSON.stringify({ force }),
    };
  }

  if (name === 'list') {
    return formatPracticeList(state, args);
  }

  if (name === 'clear') {
    if (String(args || '').trim().toLowerCase() !== 'all') {
      return { ok: true, private: true, reply: '用法：/clear all（清除当局 session 录制；内置包保留）' };
    }
    const session = state.packs.get(SESSION_PACK);
    const removed = [];
    for (const key of [...(session?.names || [])]) {
      state.throws.delete(key);
      removed.push(key);
    }
    if (session) session.names.clear();
    // Also drop non-built-in import packs.
    for (const [packId, pack] of [...state.packs.entries()]) {
      if (pack.builtIn || packId === SESSION_PACK) continue;
      for (const key of [...pack.names]) state.throws.delete(key);
      state.packs.delete(packId);
    }
    state.redoByPlayer.clear();
    return {
      ok: true,
      private: true,
      reply: `已清除当局录制 ${removed.length} 条 · 内置包仍在 · /list 查看`,
    };
  }

  return null;
}

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatPracticeList(state, args) {
  const token = String(args || '').trim();
  const packs = [...state.packs.values()].filter((p) => p.names.size || p.builtIn);
  if (!token) {
    if (!packs.length && !state.throws.size) {
      return { ok: true, private: true, reply: '暂无道具包 · 内置 seed 应自动加载 · /record 可录当局' };
    }
    const parts = packs.map((p) => `${p.id}(${p.names.size})`);
    const reply = `道具包 ${packs.length}：${parts.join(' · ')} · /list all 或 /list <包名>`;
    const html = `道具包 ${packs.length}：${packs.map((p) => `<span style="color:${p.color}">${escapeHtml(p.id)}</span>(${p.names.size})`).join(' · ')} · /list all`;
    return {
      ok: true,
      private: true,
      reply,
      clientCommand: 'practice_list',
      args: JSON.stringify({ html, plain: reply }),
    };
  }

  const wantAll = token.toLowerCase() === 'all';
  const packId = wantAll ? null : sanitizePackId(token) || sanitizePracticeName(token);
  if (!wantAll && packId && !state.packs.has(packId)) {
    return { ok: true, private: true, reply: `未找到包「${packId}」· /list 查看包名` };
  }

  const rows = [];
  if (wantAll) {
    for (const pack of packs) {
      for (const key of [...pack.names].sort((a, b) => a.localeCompare(b, 'zh'))) {
        rows.push({ key, pack });
      }
    }
  } else {
    const pack = state.packs.get(packId);
    for (const key of [...pack.names].sort((a, b) => a.localeCompare(b, 'zh'))) {
      rows.push({ key, pack });
    }
  }
  if (!rows.length) {
    return { ok: true, private: true, reply: wantAll ? '没有道具点' : `包「${packId}」为空` };
  }
  const plain = `${wantAll ? '全部' : packId} ${rows.length}：${rows.map((r) => r.key).join(' · ')}`;
  const html = `${wantAll ? '全部' : escapeHtml(packId)} ${rows.length}：${rows.map((r) => `<span style="color:${r.pack.color}">${escapeHtml(r.key)}</span>`).join(' · ')}`;
  return {
    ok: true,
    private: true,
    reply: plain,
    clientCommand: 'practice_list',
    args: JSON.stringify({ html, plain }),
  };
}

function replayPracticeThrow(room, player, entry) {
  clearPracticeReplay(player);
  clearPracticeThrowTape(player);
  const weapon = entry.weapon;
  if (!UTILITY_IDS.includes(weapon) || !getEquipment(weapon)) {
    return { ok: true, private: true, reply: `记录「${entry.name}」武器无效` };
  }

  const tapeFrames = entry.tape?.frames?.length || 0;
  if (beginPracticeReplay(room, player, entry)) {
    const tip = entry.impacts?.length ? ` · 命中样本 ${entry.impacts.length}` : '';
    return {
      ok: true,
      private: true,
      reply: `演示 ${entry.name} · ${weapon} · 回放蓄力过程 ${tapeFrames} 帧${entry.jumpThrow ? ' · 跳投' : ''}${entry.crouch ? ' · 蹲' : ''}${tip}`,
      clientCommand: 'practice_show',
      args: JSON.stringify({
        name: entry.name,
        weapon: entry.weapon,
        yaw: entry.tape.frames[0].yaw,
        pitch: entry.tape.frames[0].pitch,
        throwMode: entry.throwMode,
        jumpThrow: !!entry.jumpThrow,
        stand: { x: entry.tape.frames[0].x, y: entry.tape.frames[0].y, z: entry.tape.frames[0].z },
        tapeMs: entry.tape.durationMs,
      }),
    };
  }

  // Legacy records without tape: instant throw at release pose.
  room.grenades.projectiles = room.grenades.projectiles.filter((g) => g.ownerId !== player.id);
  player.godMode = true;
  player.svCheats = true;
  player.noclip = false;
  player.fly = false;
  Object.assign(player, {
    x: entry.stand.x,
    y: entry.stand.y,
    z: entry.stand.z,
    yaw: entry.yaw,
    pitch: entry.pitch,
    vx: entry.velocity?.x || 0,
    vy: entry.velocity?.y || (entry.jumpThrow ? 4.2 : 0),
    vz: entry.velocity?.z || 0,
    crouch: !!entry.crouch,
    grounded: !entry.jumpThrow && !(entry.velocity?.y > 0.4),
    alive: true,
    health: 100,
    respawnAt: 0,
  });
  if (player.input) {
    player.input.yaw = entry.yaw;
    player.input.pitch = entry.pitch;
    player.input.crouch = !!entry.crouch;
  }
  equipPracticeKit(player);
  refillPracticeAmmo(player);
  player.weapon = weapon;
  player.slot = 4;
  if (player.input) {
    player.input.slot = 4;
    player.input.utilityId = weapon;
  }
  const ok = room.grenades.throwGrenade(player, weapon, {
    yaw: entry.yaw,
    pitch: entry.pitch,
    throwMode: entry.throwMode,
    throwStrength: entry.throwStrength,
  });
  refillPracticeAmmo(player);
  player.noclip = true;
  player.fly = true;
  player.vx = 0;
  player.vy = 0;
  player.vz = 0;
  if (!ok) return { ok: true, private: true, reply: `演示失败：无法投掷 ${weapon}` };
  room.emit('grenade_thrown', {
    shooterId: player.id,
    weapon,
    mode: entry.throwMode,
    practiceShow: entry.name,
    origin: { x: entry.stand.x, y: entry.stand.y + 1.4, z: entry.stand.z },
  });
  const tip = entry.impacts?.length ? ` · 上次命中样本 ${entry.impacts.length} 条` : '';
  return {
    ok: true,
    private: true,
    reply: `演示 ${entry.name} · ${weapon} · ${entry.throwMode}${entry.jumpThrow ? ' · 跳投' : ''} · 无过程录像（旧记录）· 已出手${tip}`,
    clientCommand: 'practice_show',
    args: JSON.stringify({
      name: entry.name,
      weapon: entry.weapon,
      yaw: entry.yaw,
      pitch: entry.pitch,
      throwMode: entry.throwMode,
      jumpThrow: !!entry.jumpThrow,
      stand: entry.stand,
    }),
  };
}

export function listPracticeThrows(room) {
  if (!isUtilityMode(room.mode)) return [];
  return [...practiceState(room).throws.values()].map(cloneThrowRecord);
}

export function practiceThrowCount(room) {
  if (!isUtilityMode(room.mode)) return 0;
  return practiceState(room).throws.size;
}

/** Merge exported throws into the current utility room. Skips name clashes unless force. */
export function importPracticeThrows(room, entries, { force = false, packId = 'import' } = {}) {
  if (!isUtilityMode(room.mode)) return { ok: false, message: '仅道具练习模式可导入。' };
  if (!Array.isArray(entries) || !entries.length) return { ok: false, message: '没有可导入的道具点。' };
  const state = practiceState(room);
  const targetPack = sanitizePackId(packId) || 'import';
  ensurePack(state, targetPack, { builtIn: false });
  let added = 0;
  let replaced = 0;
  let skipped = 0;
  const skippedNames = [];
  for (const entry of entries) {
    const key = sanitizePracticeName(entry?.name);
    if (!key || !entry?.weapon || !entry.stand) {
      skipped++;
      continue;
    }
    if (state.throws.has(key) && !force) {
      skipped++;
      if (skippedNames.length < 8) skippedNames.push(key);
      continue;
    }
    if (state.throws.has(key)) replaced++;
    else added++;
    putThrow(state, entry, targetPack);
  }
  if (!added && !replaced) {
    const tip = skippedNames.length ? ` · 重名：${skippedNames.join(' · ')}${skipped > skippedNames.length ? '…' : ''}` : '';
    return {
      ok: false,
      message: `未导入任何记录（跳过 ${skipped}）${tip} · 可用 /in force 覆盖同名`,
      added,
      replaced,
      skipped,
    };
  }
  const parts = [];
  if (added) parts.push(`新增 ${added}`);
  if (replaced) parts.push(`覆盖 ${replaced}`);
  if (skipped) parts.push(`跳过重名 ${skipped}`);
  return {
    ok: true,
    message: `已导入到包 ${targetPack} · ${parts.join(' · ')} · 共 ${state.throws.size} 条 · /list ${targetPack}`,
    added,
    replaced,
    skipped,
    total: state.throws.size,
    packId: targetPack,
  };
}
