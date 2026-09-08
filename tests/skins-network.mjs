import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { WebSocket } from 'ws';
import { startGameServer } from '../server/index.js';
import { DEFAULT_SKINS, normalizeSkinLoadout } from '../shared/skins.js';
import { WEAPONS } from '../shared/weapons.js';
import { MAP } from '../shared/map-data.js';
import { raycastWorld } from '../shared/physics.js';

async function connect(port) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const messages = [], listeners = new Set();
  let received = 0;
  socket.on('message', data => {
    messages.push({ number: ++received, value: JSON.parse(data.toString()) });
    for (const check of listeners) check();
  });
  await once(socket, 'open');
  return {
    socket, seq: 0, lastEquip: 0,
    mark: () => received,
    send: message => socket.send(JSON.stringify(message)),
    waitFor(predicate, after = 0) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { listeners.delete(check); reject(new Error('Skin WebSocket message timeout')); }, 5000);
        function check() {
          const found = messages.find(message => message.number > after && predicate(message.value));
          if (!found) return;
          clearTimeout(timer); listeners.delete(check); resolve(found.value);
        }
        listeners.add(check); check();
      });
    },
  };
}

function input(peer, fields = {}) {
  return { type: 'input', seq: ++peer.seq, forward: 0, right: 0, yaw: 0, pitch: 0,
    fire: false, reload: false, jump: false, crouch: false, walk: false, slot: 0, ...fields };
}
const playerIn = (snapshot, id) => snapshot.players?.find(player => player.id === id);
const waitPlayer = (peer, id, predicate, after = 0) => peer.waitFor(message => message.type === 'snapshot'
  && playerIn(message, id) && predicate(playerIn(message, id)), after);

async function equip(peer, weapon, skin, extra = {}) {
  await delay(Math.max(0, peer.lastEquip + 280 - Date.now()));
  const after = peer.mark(); peer.lastEquip = Date.now();
  peer.send({ type: 'equipSkin', weapon, skin, ...extra });
  return peer.waitFor(message => message.type === 'skinEquipped' || message.type === 'error', after);
}

function clearLane() {
  const nodes = MAP.nav.filter(node => node.neighbors.length >= 3);
  for (const a of nodes) for (const b of nodes) {
    const dx = b.x - a.x, dz = b.z - a.z, distance = Math.hypot(dx, dz);
    if (distance < 4 || distance > 7 || Math.abs(a.y - b.y) > 0.08) continue;
    const origin = { x: a.x, y: a.y + 1.6, z: a.z }, dy = b.y + 1.0 - origin.y;
    const length = Math.hypot(distance, dy), direction = { x: dx / length, y: dy / length, z: dz / length };
    if (raycastWorld(origin, direction, length) === null) {
      return { a, b, yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, distance) };
    }
  }
  throw new Error('No unobstructed Dust2 torso shooting lane');
}

test('skin loadouts remain cosmetic across real WebSocket joins, equips and respawns', { timeout: 30000 }, async t => {
  const app = await startGameServer({ port: 0, host: '127.0.0.1' });
  const peers = [];
  t.after(async () => { for (const peer of peers) peer.socket.terminate(); await app.close(); });
  async function join(settings) {
    const peer = await connect(app.port); peers.push(peer);
    peer.send({ type: 'join', name: 'Skin network QA', room: 'SKNET1', mode: 'deathmatch', bots: 0, ...settings });
    peer.welcome = await peer.waitFor(message => message.type === 'welcome');
    return peer;
  }

  const chosen = normalizeSkinLoadout({ ak47: 'ak47-fire-serpent', m4a1: 'm4a1-printstream', awp: 'awp-dragon-lore',
    pistol: 'glock-bullet-queen', usp: 'usp-neo-noir', knife: 'karambit-ruby' });
  const owner = await join({ team: 'T', primary: 'ak47', skins: chosen });
  const observer = await join({ team: 'CT', primary: 'm4a1', skins: { m4a1: 'm4a1-golden-coil', usp: 'usp-kill-confirmed' } });
  const id = owner.welcome.id, otherId = observer.welcome.id;
  const room = app.rooms.get('SKNET1'), player = room.players.get(id), target = room.players.get(otherId);
  const weaponRules = structuredClone(WEAPONS);

  await t.test('join transports approved selections to the owner and another real client', async () => {
    const snapshots = await Promise.all([
      waitPlayer(owner, id, p => p.weapon === 'ak47' && p.skinId === chosen.ak47),
      waitPlayer(observer, id, p => p.weapon === 'ak47' && p.skinId === chosen.ak47),
      waitPlayer(owner, otherId, p => p.skinId === 'm4a1-golden-coil'),
    ]);
    assert.deepEqual(player.skins, chosen);
    for (const snapshot of snapshots.slice(0, 2)) {
      const p = playerIn(snapshot, id);
      assert.equal(p.ammo, WEAPONS.ak47.magazine); assert.equal(p.reserve, WEAPONS.ak47.reserve);
      assert.deepEqual(p.inventory.toSorted(), ['ak47', 'knife', 'pistol']);
    }
  });

  await t.test('malformed join selections fall back to defaults instead of accepting paths or other weapons', async () => {
    const rejected = await join({ room: 'SKBAD1', team: 'T', primary: 'ak47', skins: {
      ak47: '../assets/weapons/other.glb', m4a1: 'ak47-vulcan', awp: 'unknown-skin',
      pistol: 'https://invalid.example/weapon.glb', usp: null, knife: '__proto__',
    } });
    const snapshot = await waitPlayer(rejected, rejected.welcome.id, p => p.skinId === DEFAULT_SKINS.ak47);
    assert.equal(playerIn(snapshot, rejected.welcome.id).weapon, 'ak47');
    assert.deepEqual(app.rooms.get('SKBAD1').players.get(rejected.welcome.id).skins, DEFAULT_SKINS);
  });

  await t.test('equipSkin ACK and broadcast snapshot change appearance without changing ammunition or stats', async () => {
    player.inventory.ak47 = { ammo: 13, reserve: 61 };
    player.inventory.pistol = { ammo: 7, reserve: 42 };
    const inventory = structuredClone(player.inventory), before = { health: player.health, armor: player.armor, money: player.money };
    const ownerMark = owner.mark(), observerMark = observer.mark();
    const result = await equip(owner, 'ak47', 'ak47-vulcan', { ammo: 999, reserve: 999, health: 999, damage: 999 });
    assert.equal(result.type, 'skinEquipped'); assert.equal(result.weapon, 'ak47'); assert.equal(result.skin, 'ak47-vulcan');
    for (const [peer, mark] of [[owner, ownerMark], [observer, observerMark]]) {
      const snapshot = await waitPlayer(peer, id, p => p.skinId === 'ak47-vulcan', mark);
      const p = playerIn(snapshot, id);
      assert.equal(p.ammo, 13); assert.equal(p.reserve, 61);
      assert.deepEqual({ health: p.health, armor: p.armor, money: p.money }, before);
    }
    assert.deepEqual(player.inventory, inventory); assert.deepEqual(WEAPONS, weaponRules);
    assert.equal(target.skins.m4a1, 'm4a1-golden-coil', 'equipping cannot alter another player');
  });

  await t.test('cross-weapon, unknown-ID, URL, filesystem-path and invalid-slot equip messages are rejected', async () => {
    const before = structuredClone(player.skins), inventory = structuredClone(player.inventory);
    for (const [weapon, skin] of [
      ['ak47', 'm4a1-printstream'], ['ak47', 'not-a-skin'],
      ['ak47', 'https://invalid.example/weapon.glb'], ['ak47', '../public/assets/weapon.glb'],
      ['__proto__', 'ak47-fire-serpent'],
    ]) {
      const result = await equip(owner, weapon, skin);
      assert.equal(result.type, 'error'); assert.equal(result.code, 'SKIN_REJECTED');
      assert.deepEqual(player.skins, before); assert.deepEqual(player.inventory, inventory);
    }
    const mark = observer.mark();
    await waitPlayer(observer, id, p => p.skinId === before.ak47, mark);
  });

  await t.test('rate-limited rapid equips do not mutate the acknowledged server selection', async () => {
    await delay(Math.max(0, owner.lastEquip + 280 - Date.now()));
    const mark = owner.mark(); owner.lastEquip = Date.now();
    owner.send({ type: 'equipSkin', weapon: 'ak47', skin: 'ak47-fire-serpent' });
    owner.send({ type: 'equipSkin', weapon: 'ak47', skin: 'ak47-vulcan' });
    const ack = await owner.waitFor(m => m.type === 'skinEquipped', mark);
    const error = await owner.waitFor(m => m.type === 'error', mark);
    assert.equal(ack.skin, 'ak47-fire-serpent'); assert.equal(error.code, 'SKIN_RATE');
    assert.equal(player.skins.ak47, 'ak47-fire-serpent');
    await waitPlayer(observer, id, p => p.skinId === 'ak47-fire-serpent', observer.mark());
  });

  await t.test('real input slot switches retain every chosen skin and partially spent magazines', async () => {
    for (const [slot, weapon, skinId, ammo] of [
      [2, 'pistol', chosen.pistol, 7], [3, 'knife', chosen.knife, 0], [1, 'ak47', 'ak47-fire-serpent', 13],
    ]) {
      const mark = observer.mark(), command = input(owner, { slot }); owner.send(command);
      const snapshot = await waitPlayer(observer, id, p => p.seq >= command.seq && p.weapon === weapon, mark);
      const p = playerIn(snapshot, id); assert.equal(p.skinId, skinId); assert.equal(p.ammo, ammo);
    }
  });

  await t.test('default and optional skins produce identical authoritative hit damage and ammo consumption', async sub => {
    sub.mock.method(Math, 'random', () => 0.5);
    const lane = clearLane(), outcomes = [];
    for (const skinId of [DEFAULT_SKINS.ak47, 'ak47-fire-serpent']) {
      assert.equal((await equip(owner, 'ak47', skinId)).type, 'skinEquipped');
      Object.assign(player, { x: lane.a.x, y: lane.a.y, z: lane.a.z }, { alive: true, health: 100, armor: 0, vx: 0, vy: 0, vz: 0,
        grounded: true, crouch: false, nextShotAt: 0, reloadEndsAt: 0, protectionUntil: 0, triggerWasDown: false, pendingFire: false });
      Object.assign(target, { x: lane.b.x, y: lane.b.y, z: lane.b.z }, { alive: true, health: 100, armor: 100, vx: 0, vy: 0, vz: 0,
        grounded: true, crouch: false, protectionUntil: 0, respawnAt: 0 });
      player.inventory.ak47 = { ammo: 5, reserve: 30 };
      const mark = observer.mark();
      owner.send(input(owner, { yaw: lane.yaw, pitch: lane.pitch, fire: true }));
      owner.send(input(owner, { yaw: lane.yaw, pitch: lane.pitch, fire: false }));
      const snapshot = await observer.waitFor(m => m.type === 'snapshot'
        && m.events.some(e => e.type === 'hit' && e.shooterId === id && e.targetId === otherId), mark);
      const hit = snapshot.events.find(e => e.type === 'hit' && e.shooterId === id);
      const p = playerIn(snapshot, id), victim = playerIn(snapshot, otherId);
      assert.equal(p.skinId, skinId); assert.equal(p.ammo, 4); assert.equal(p.reserve, 30);
      assert.ok(hit.damage > 0); assert.equal(hit.headshot, false); assert.equal(hit.weapon, 'ak47');
      outcomes.push({ damage: hit.damage, health: victim.health, armor: victim.armor, ammo: p.ammo, reserve: p.reserve });
    }
    assert.deepEqual(outcomes[0], outcomes[1]); assert.deepEqual(WEAPONS, weaponRules);
  });

  await t.test('death and respawn snapshots preserve cosmetics and restore only the normal weapon ammunition', async () => {
    const selected = structuredClone(player.skins), deaths = player.deaths, deadMark = observer.mark();
    room.kill(player, target, 'm4a1');
    const dead = await waitPlayer(observer, id, p => !p.alive && p.deaths === deaths + 1, deadMark);
    assert.equal(playerIn(dead, id).skinId, selected.ak47);
    const liveMark = observer.mark(); player.respawnAt = Date.now() - 1;
    const respawned = await waitPlayer(observer, id, p => p.alive && p.deaths === deaths + 1, liveMark);
    const p = playerIn(respawned, id);
    assert.equal(p.skinId, selected.ak47); assert.equal(p.weapon, 'ak47');
    assert.equal(p.ammo, WEAPONS.ak47.magazine); assert.equal(p.reserve, WEAPONS.ak47.reserve);
    assert.equal(player.inventory.pistol.ammo, WEAPONS.pistol.magazine);
    assert.equal(p.health, 100); assert.equal(p.armor, 100); assert.deepEqual(player.skins, selected);
    assert.deepEqual(WEAPONS, weaponRules);
  });
});
