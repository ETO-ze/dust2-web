import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { startGameServer } from '../server/index.js';
import { GameRoom, directionFromAngles, rayHitPlayer, sanitizeInput } from '../server/game.js';
import { MAP } from '../shared/map-data.js';
import { raycastWorld } from '../shared/physics.js';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const input = (seq, overrides = {}) => ({ type: 'input', seq, forward: 0, right: 0, yaw: 0, pitch: 0, jump: false, crouch: false, walk: false, fire: false, reload: false, slot: 0, interact: false, ...overrides });

async function peer(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`), messages = [], listeners = new Set();
  ws.on('message', data => { const msg = JSON.parse(data.toString()); messages.push(msg); for (const fn of listeners) fn(); });
  await once(ws, 'open');
  return { ws, send: m => ws.send(typeof m === 'string' ? m : JSON.stringify(m)),
    waitFor(predicate, timeout = 4000) { return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { listeners.delete(check); reject(new Error('WebSocket message timeout')); }, timeout);
      const check = () => { const i = messages.findIndex(predicate); if (i >= 0) { clearTimeout(timer); listeners.delete(check); resolve(messages.splice(i, 1)[0]); } };
      listeners.add(check); check();
    }); },
    async close() { if (ws.readyState === WebSocket.CLOSED) return; const done = once(ws, 'close'); ws.close(); await done; },
  };
}

function clearPair() {
  const nodes = MAP.nav.filter(n => (n.neighbors?.length || 0) >= 3);
  for (const a of nodes) for (const b of nodes) {
    const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
    if (d < 4 || d > 7 || Math.abs(a.y - b.y) > 0.08) continue;
    const origin = { x: a.x, y: a.y + 1.55, z: a.z }, dir = { x: dx / d, y: 0, z: dz / d };
    if (raycastWorld(origin, dir, d) === null) return { a, b, yaw: Math.atan2(-dx, -dz) };
  }
  throw new Error('No clear shooting lane found in map');
}

test('authoritative server integration on real Dust2 collision', { timeout: 90000 }, async t => {
  const start = performance.now();
  const app = await startGameServer({ port: 0, host: '127.0.0.1' });
  t.after(() => app.close());
  console.log(`Collision/server startup: ${Math.round(performance.now() - start)} ms; RSS ${Math.round(process.memoryUsage().rss / 1048576)} MiB; heap ${Math.round(process.memoryUsage().heapUsed / 1048576)} MiB`);
  const clients = [];
  t.after(async () => { for (const client of clients) await client.close(); });

  await t.test('health endpoint and path isolation', async () => {
    const response = await fetch(`http://127.0.0.1:${app.port}/health`);
    assert.equal(response.status, 200); assert.equal((await response.json()).ok, true);
    const privateFile = await fetch(`http://127.0.0.1:${app.port}/server/index.js`);
    assert.equal(privateFile.status, 404);
  });

  let c1, c2, w1, w2, room;
  await t.test('two real WebSockets join the same authoritative room', async () => {
    c1 = await peer(app.port); c2 = await peer(app.port); clients.push(c1, c2);
    c1.send({ type: 'join', name: '<Alice>', room: 'TEST01', mode: 'deathmatch', team: 'T', bots: 0 });
    w1 = await c1.waitFor(m => m.type === 'welcome');
    c2.send({ type: 'join', name: 'Bob', room: w1.room, mode: 'defuse', team: 'CT', bots: 8 });
    w2 = await c2.waitFor(m => m.type === 'welcome');
    assert.equal(w1.room, w2.room); assert.equal(w2.mode, 'deathmatch'); assert.notEqual(w1.id, w2.id);
    const snap = await c1.waitFor(m => m.type === 'snapshot' && m.players.length === 2);
    assert.equal(snap.players.find(p => p.id === w1.id).name, 'Alice');
    room = app.rooms.get(w1.room);
  });

  await t.test('malformed messages, position forgery and stale inputs cannot mutate state', async () => {
    c1.send('{bad json'); const error = await c1.waitFor(m => m.type === 'error'); assert.equal(error.code, 'BAD_MESSAGE');
    const before = { ...room.players.get(w1.id) };
    c1.send(input(1, { x: 999999, y: 999999, health: 9999 }));
    const snap = await c1.waitFor(m => m.type === 'snapshot' && m.players.some(p => p.id === w1.id && p.seq === 1));
    const after = snap.players.find(p => p.id === w1.id);
    assert.ok(Math.abs(after.x - before.x) < 1); assert.ok(after.health <= 100);
    assert.equal(room.receiveInput(w1.id, input(1, { forward: 1 })), false);
    assert.equal(room.receiveInput(w1.id, input(2, { yaw: NaN })), false);
    assert.equal(sanitizeInput(input(3, { forward: 999 })).forward, 1);
  });

  await t.test('movement is simulated on server and stale movement expires', async () => {
    const before = { ...room.players.get(w1.id) };
    c1.send(input(2, { forward: 1 }));
    await delay(280);
    const moving = { ...room.players.get(w1.id) };
    assert.ok(Math.hypot(moving.x - before.x, moving.z - before.z) > 0.15);
    await delay(900); const stopped = { ...room.players.get(w1.id) }; await delay(300);
    const later = room.players.get(w1.id);
    assert.ok(Math.hypot(later.x - stopped.x, later.z - stopped.z) < 0.1);
  });

  await t.test('server shooting consumes ammo, damages a visible opponent, enforces reload', async () => {
    const { a, b, yaw } = clearPair(), shooter = room.players.get(w1.id), target = room.players.get(w2.id);
    Object.assign(shooter, { x: a.x, y: a.y, z: a.z }, { vx: 0, vy: 0, vz: 0, yaw, pitch: 0, protectionUntil: 0, nextShotAt: 0, grounded: true });
    Object.assign(target, { x: b.x, y: b.y, z: b.z }, { vx: 0, vy: 0, vz: 0, protectionUntil: 0, armor: 0 });
    // Aim at torso so a one-shot test is independent of the head multiplier.
    const pitch = Math.atan2((b.y + 1.0) - (a.y + 1.6), Math.hypot(b.x - a.x, b.z - a.z));
    c1.send(input(3, { yaw, pitch, fire: true }));
    const snap = await c1.waitFor(m => m.type === 'snapshot' && m.events.some(e => e.type === 'hit' && e.targetId === w2.id));
    assert.ok(snap.players.find(p => p.id === w2.id).health < 100);
    assert.ok(snap.players.find(p => p.id === w1.id).ammo < 30);
    c1.send(input(4, { yaw, pitch, fire: false }));
    await delay(70); shooter.inventory[shooter.weapon].ammo = 0; shooter.inventory[shooter.weapon].reserve = 12;
    room.reload(shooter); assert.ok(shooter.reloadEndsAt > Date.now());
    shooter.reloadAmmoAt=Date.now()-2;shooter.reloadEndsAt = Date.now() - 1; await delay(80);
    assert.equal(shooter.inventory[shooter.weapon].ammo, 12); assert.equal(shooter.inventory[shooter.weapon].reserve, 0);
  });

  await t.test('world geometry blocks shots and head/body hit shapes are distinct', () => {
    const shooter = room.players.get(w1.id), target = room.players.get(w2.id);
    Object.assign(shooter, MAP.spawns.T[0], { nextShotAt: 0, protectionUntil: 0, grounded: true, vx: 0, vz: 0, triggerWasDown: false });
    Object.assign(target, MAP.spawns.CT[0], { alive: true, health: 100, armor: 0, protectionUntil: 0 });
    const dx = target.x - shooter.x, dy = target.y - shooter.y, dz = target.z - shooter.z;
    room.fire(shooter, { fire: true, yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) });
    assert.equal(target.health, 100, 'T/CT spawn shot should be occluded');
    const dummy = { x: 0, y: 0, z: -5, crouch: false };
    assert.equal(rayHitPlayer({ x: 0, y: 1.62, z: 0 }, directionFromAngles(0, 0), dummy).headshot, true);
    assert.equal(rayHitPlayer({ x: 0, y: 0.9, z: 0 }, directionFromAngles(0, 0), dummy).headshot, false);
  });

  await t.test('deathmatch death respawns and free purchasing updates inventory', async () => {
    const victim = room.players.get(w2.id); room.kill(victim, room.players.get(w1.id), 'ak47');
    assert.equal(victim.alive, false); assert.ok(victim.respawnAt > Date.now()); victim.respawnAt = Date.now() - 1;
    await delay(80); assert.equal(victim.alive, true); assert.equal(victim.health, 100);
    c1.send({ type: 'buy', weapon: 'awp' }); await c1.waitFor(m => m.type === 'purchase' && m.weapon === 'awp');
    assert.equal(room.players.get(w1.id).weapon, 'awp');
  });

  await t.test('defuse plant, interrupted progress, defuse, explosion and round economy', () => {
    let now = 100000;
    const r = new GameRoom('BOMB01', { mode: 'defuse', bots: 0, clock: () => now, rules: { freezeSeconds: 0, plantSeconds: 0.1, defuseSeconds: 0.1, bombSeconds: 1 } });
    const terrorist = r.addHuman({}, { name: 'T', team: 'T' }), ct = r.addHuman({}, { name: 'CT', team: 'CT' });
    r.tick(); assert.equal(r.round.phase, 'live'); assert.equal(terrorist.hasBomb, true);
    assert.equal(r.buy(terrorist.id, 'awp').ok, false); terrorist.money = 5000;
    assert.equal(r.buy(terrorist.id, 'ak47').ok, true); assert.equal(terrorist.money, 2300);
    const site = MAP.sites.B; Object.assign(terrorist, site, { grounded:true,vx: 0, vz: 0, effectiveInput: { interact: true } });
    r.stepBomb(0.05); assert.ok(r.bomb.progress > 0);
    terrorist.effectiveInput.interact = false; r.stepBomb(0.05); assert.equal(r.bomb.progress, 0);
    terrorist.effectiveInput.interact = true; r.stepBomb(0.11); assert.equal(r.bomb.state, 'planted');
    Object.assign(ct, { x: site.x + 0.6, y: site.y, z: site.z, vx: 0, vz: 0, effectiveInput: { interact: true } });
    r.stepBomb(0.11); assert.equal(r.bomb.state, 'defused'); assert.equal(r.round.winner, 'CT'); assert.equal(r.scores.CT, 1);
    r.startRound(); r.tick(); Object.assign(terrorist, site, { grounded:true,vx: 0, vz: 0, effectiveInput: { interact: true } });
    r.stepBomb(0.11); assert.equal(r.bomb.state, 'planted'); now += 1100; r.stepBomb(0.01);
    assert.equal(r.bomb.state, 'exploded'); assert.equal(r.round.winner, 'T');
  });

  await t.test('bots fill both teams, follow real navigation and yield to humans', () => {
    let now = 500000;
    const r = new GameRoom('BOT001', { mode: 'deathmatch', bots: 8, clock: () => now });
    r.addHuman({}, { name: 'human', team: 'T' }); assert.equal(r.players.size, 9);
    const bots = [...r.players.values()].filter(p => p.bot), before = bots.map(p => ({ ...p }));
    for (let i = 0; i < 90; i++) { now += 1000 / 30; r.tick(1 / 30); }
    assert.ok(bots.some((p, i) => Math.hypot(p.x - before[i].x, p.z - before[i].z) > 1));
    assert.ok(bots.every(p => Number.isFinite(p.x + p.y + p.z)));
    r.addHuman({}, { name: 'human2', team: 'CT' }); r.addHuman({}, { name: 'human3', team: 'auto' });
    assert.equal(r.players.size, 10); assert.ok(r.count('T') <= 5 && r.count('CT') <= 5);
  });

  await t.test('disconnect cleans up players and empty rooms', async () => {
    await c2.close(); await delay(60); assert.equal(room.players.has(w2.id), false);
    await c1.close(); await delay(60); assert.equal(app.rooms.has('TEST01'), false);
  });
});
