import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { startGameServer } from '../server/index.js';
import { GameRoom } from '../server/game.js';
import { MAP } from '../shared/map-data.js';
import { raycastWorld } from '../shared/physics.js';

async function connect(port, settings) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`), messages = [], waiters = new Set();
  socket.on('message', value => { messages.push(JSON.parse(value)); for (const check of waiters) check(); });
  await once(socket, 'open');
  const waitFor = predicate => new Promise((resolve, reject) => {
    const timer = setTimeout(() => { waiters.delete(check); reject(new Error('Loadout snapshot timeout')); }, 4000);
    function check() { const index = messages.findIndex(predicate); if (index < 0) return; clearTimeout(timer); waiters.delete(check); resolve(messages.splice(index, 1)[0]); }
    waiters.add(check); check();
  });
  socket.send(JSON.stringify({ type: 'join', name: 'Loadout QA', bots: 0, mode: 'deathmatch', ...settings }));
  const welcome = await waitFor(message => message.type === 'welcome');
  const snapshot = await waitFor(message => message.type === 'snapshot' && message.players.some(player => player.id === welcome.id));
  return { socket, welcome, player: snapshot.players.find(player => player.id === welcome.id) };
}

function clearLane() {
  const nodes = MAP.nav.filter(node => node.neighbors.length >= 3);
  for (const a of nodes) for (const b of nodes) {
    const dx = b.x - a.x, dz = b.z - a.z, distance = Math.hypot(dx, dz);
    if (distance < 4 || distance > 7 || Math.abs(a.y - b.y) > 0.08) continue;
    const origin = { x: a.x, y: a.y + 1.6, z: a.z }, dy = b.y + 1.0 - origin.y;
    const length = Math.hypot(distance, dy), direction = { x: dx / length, y: dy / length, z: dz / length };
    if (raycastWorld(origin, direction, length) === null) return { a, b, distance, dx: dx / distance, dz: dz / distance };
  }
  throw new Error('No unobstructed chest-height shooting lane on Dust2.');
}

function fixture(lane, { primary = 'awp', mode = 'deathmatch' } = {}) {
  let now = 1000000;
  const room = new GameRoom('RULEQA', { bots: 0, mode, clock: () => now });
  const shooter = room.addHuman({}, { name: 'Shooter', team: 'T', primary });
  const target = room.addHuman({}, { name: 'Target', team: 'CT', primary: 'awp' });
  const advance = milliseconds => { now += milliseconds; };
  const place = (distance = lane.distance, armor = 0, head = false) => {
    Object.assign(shooter, { x: lane.a.x, y: lane.a.y, z: lane.a.z, vx: 0, vy: 0, vz: 0, grounded: true, alive: true, nextShotAt: 0, protectionUntil: 0, triggerWasDown: false });
    Object.assign(target, { x: lane.a.x + lane.dx * distance, y: lane.a.y, z: lane.a.z + lane.dz * distance, vx: 0, vy: 0, vz: 0, health: 100, armor, alive: true, protectionUntil: 0, respawnAt: 0 });
    room.events.length = 0;
    return { fire: true, yaw: Math.atan2(-lane.dx, -lane.dz), pitch: Math.atan2((head ? 1.62 : 1.0) - 1.6, distance) };
  };
  return { room, shooter, target, advance, place, now: () => now };
}

test('new loadouts and combat feedback contracts on the authoritative server', { timeout: 20000 }, async t => {
  const app = await startGameServer({ port: 0, host: '127.0.0.1' });
  const peers = [];
  t.after(async () => { for (const peer of peers) peer.socket.terminate(); await app.close(); });
  const lane = clearLane();

  await t.test('WebSocket join carries the chosen AWP and distinct T Glock / CT USP inventories', async () => {
    const terrorist = await connect(app.port, { room: 'LOAD01', team: 'T', primary: 'awp' }); peers.push(terrorist);
    const counter = await connect(app.port, { room: 'LOAD01', team: 'CT', primary: 'awp' }); peers.push(counter);
    assert.equal(terrorist.player.weapon, 'awp'); assert.equal(counter.player.weapon, 'awp');
    assert.deepEqual(terrorist.player.inventory.toSorted(), ['awp', 'knife', 'pistol']);
    assert.deepEqual(counter.player.inventory.toSorted(), ['awp', 'knife', 'usp']);
    const room = app.rooms.get('LOAD01');
    assert.equal(room.players.get(terrorist.welcome.id).inventory.pistol.ammo, 20);
    assert.equal(room.players.get(counter.welcome.id).inventory.usp.ammo, 12);
    const invalid = await connect(app.port, { room: 'LOAD02', team: 'CT', primary: 'knife' }); peers.push(invalid);
    assert.equal(invalid.player.weapon, 'm4a1', 'invalid primary must fall back to the team rifle');
    const defuse = await connect(app.port, { room: 'LOAD03', mode: 'defuse', team: 'CT', primary: 'awp' }); peers.push(defuse);
    assert.deepEqual(defuse.player.inventory.toSorted(), ['knife', 'usp'], 'defuse cannot get a free selected primary');
    assert.equal(defuse.player.weapon, 'usp');
  });

  await t.test('deathmatch respawn preserves selected or purchased primary and correct sidearm', () => {
    const { room, target, advance } = fixture(lane);
    for (const primary of ['awp', 'm4a1']) {
      if (primary === 'm4a1') assert.equal(room.buy(target.id, primary).ok, true);
      room.selectSlot(target, 2); target.inventory[primary].ammo = 0; target.inventory.usp.ammo = 1;
      room.kill(target, null); advance(3001); room.tick();
      assert.equal(target.alive, true); assert.equal(target.health, 100); assert.equal(target.armor, 100);
      assert.equal(target.weapon, primary); assert.equal(target.slot, 1);
      assert.equal(target.inventory[primary].ammo, primary === 'awp' ? 5 : 20);
      assert.equal(target.inventory.usp.ammo, 12); assert.equal(target.inventory.pistol, undefined);
    }
  });

  await t.test('defuse death clears the purchased primary but restores each team sidearm next round', () => {
    const { room, shooter, target } = fixture(lane, { mode: 'defuse' });
    target.money = 5000; assert.equal(room.buy(target.id, 'awp').ok, true);
    room.kill(target, shooter, 'ak47'); room.startRound();
    assert.equal(target.weapon, 'usp'); assert.deepEqual(Object.keys(target.inventory).sort(), ['knife', 'usp']);
    assert.equal(target.inventory.usp.ammo, 12);
    assert.equal(shooter.inventory.pistol.ammo, 20); assert.equal(shooter.inventory.usp, undefined);
  });

  await t.test('USP reload blocks firing, switching cancels it, and completion uses the current CS2 discard-magazine rule', () => {
    const { room, target, advance, now } = fixture(lane);
    room.selectSlot(target, 2); target.inventory.usp = { ammo: 2, reserve: 5 };
    room.reload(target); assert.equal(target.reloadEndsAt - now(), 2200);
    advance(500); room.events.length = 0; target.nextShotAt = 0;
    room.fire(target, { fire: true, yaw: 0, pitch: 0 });
    assert.equal(target.inventory.usp.ammo, 2); assert.equal(room.events.some(event => event.type === 'shot'), false);
    room.selectSlot(target, 1); assert.equal(target.reloadEndsAt, 0);
    advance(2000); room.tick(); assert.deepEqual(target.inventory.usp, { ammo: 2, reserve: 5 }, 'cancelled reload must not refill later');
    room.selectSlot(target, 2); room.reload(target); advance(2201); room.tick();
    assert.equal(target.reloadEndsAt, 0); assert.deepEqual(target.inventory.usp, { ammo: 5, reserve: 0 });
  });

  await t.test('empty AWP emits no shot/hit/kill; held attack no longer starts reload', () => {
    const { room, shooter, place } = fixture(lane);
    const aim = place(); shooter.inventory.awp = { ammo: 0, reserve: 0 };
    room.fire(shooter, aim);
    assert.equal(room.events.length, 0); assert.equal(shooter.reloadEndsAt, 0);
    assert.equal(shooter.inventory.awp.ammo, 0);
    room.fire(shooter, { ...aim, fire: false }); shooter.inventory.awp.reserve = 3;
    room.fire(shooter, aim);
    assert.equal(room.events.length, 0); assert.equal(shooter.reloadEndsAt,0);
    room.reload(shooter);assert.ok(shooter.reloadEndsAt>0);
    assert.deepEqual(shooter.inventory.awp, { ammo: 0, reserve: 3 });
  });

  await t.test('press and release between two ticks emits exactly one authoritative shot', () => {
    const { room, shooter, place, advance } = fixture(lane);
    const aim = place();
    const input = (seq, fire) => ({ ...aim, seq, fire, forward: 0, right: 0, slot: 1 });
    assert.equal(room.receiveInput(shooter.id, input(1, true)), true);
    assert.equal(room.receiveInput(shooter.id, input(2, false)), true);
    assert.equal(room.receiveInput(shooter.id, input(3, true)), true);
    assert.equal(room.receiveInput(shooter.id, input(4, false)), true);
    room.tick();
    assert.equal(shooter.seq, 4);
    assert.equal(shooter.inventory.awp.ammo, 4);
    assert.equal(room.events.filter(event => event.type === 'shot' && event.shooterId === shooter.id).length, 1);
    advance(1501); room.tick();
    assert.equal(shooter.inventory.awp.ammo, 4, 'a consumed edge must not fire again after cooldown');
    assert.equal(room.events.filter(event => event.type === 'shot' && event.shooterId === shooter.id).length, 1);
  });

  await t.test('freeze, death/respawn, and stale input cannot retain an old firing edge', () => {
    const sendTap = (room, shooter, seq) => {
      const input = { seq, forward: 0, right: 0, yaw: 0, pitch: 0, fire: true };
      assert.equal(room.receiveInput(shooter.id, input), true);
      assert.equal(room.receiveInput(shooter.id, { ...input, seq: seq + 1, fire: false }), true);
    };
    {
      const { room, shooter, advance, now } = fixture(lane, { mode: 'defuse' });
      room.round.phase = 'freeze'; room.round.phaseEndsAt = now() + 1000; room.events.length = 0;
      sendTap(room, shooter, 1); room.tick();
      advance(1001); room.tick();
      assert.equal(room.round.phase, 'live');
      assert.equal(shooter.inventory.pistol.ammo, 20);
      assert.equal(room.events.some(event => event.type === 'shot' && event.shooterId === shooter.id), false);
    }
    {
      const { room, shooter, advance } = fixture(lane);
      room.kill(shooter, null); room.events.length = 0; sendTap(room, shooter, 1);
      advance(3001); room.tick(); assert.equal(shooter.alive, true); assert.equal(shooter.pendingFire, false);
      room.receiveInput(shooter.id, { seq: 3, forward: 0, right: 0, yaw: 0, pitch: 0, fire: false });
      advance(33); room.tick(); advance(351); room.tick();
      assert.equal(shooter.inventory.awp.ammo, 5);
      assert.equal(room.events.some(event => event.type === 'shot' && event.shooterId === shooter.id), false);
    }
    {
      const { room, shooter, advance } = fixture(lane);
      room.events.length = 0; sendTap(room, shooter, 1); advance(301); room.tick();
      assert.equal(shooter.inventory.awp.ammo, 5);
      assert.equal(room.events.some(event => event.type === 'shot' && event.shooterId === shooter.id), false);
    }
  });

  await t.test('AWP lethal unarmored/armored body and armored head hits emit one complete feedback sequence', sub => {
    // Zero radius in the circular spread sampler isolates damage from accuracy.
    sub.mock.method(Math, 'random', () => 0);
    for (const [armor, head] of [[0, false], [100, false], [100, true]]) {
      const { room, shooter, target, place } = fixture(lane);
      room.fire(shooter, place(lane.distance, armor, head));
      assert.equal(target.alive, false); assert.equal(target.health, 0); assert.equal(shooter.kills, 1);
      assert.equal(shooter.inventory.awp.ammo, 4);
      assert.deepEqual(room.events.map(event => event.type), ['shot', 'hit', 'weapon_dropped', 'kill']);
      const [shot, hit, dropped, kill] = room.events;
      assert.equal(dropped.death,true);assert.ok(room.droppedWeapons.items.some(item=>item.id===dropped.droppedId));
      assert.equal(shot.hitId, target.id); assert.equal(hit.targetId, target.id); assert.equal(hit.weapon, 'awp');
      assert.equal(hit.armor, armor > 0); assert.equal(hit.headshot, head); assert.equal(kill.headshot, head);
      assert.equal(kill.killerName, 'Shooter'); assert.equal(kill.victimName, 'Target');
      assert.equal(new Set(room.events.map(event => event.id)).size, 4);
      room.fire(shooter, { fire: true, yaw: 0, pitch: 0 });
      assert.equal(room.events.length, 4, 'holding semi-automatic fire must not duplicate confirmation');
    }
  });

  await t.test('knife misses beyond reach, damages in reach, and never consumes firearm ammunition', () => {
    const { room, shooter, target, place, advance } = fixture(lane);
    room.selectSlot(shooter, 3);
    room.fire(shooter, place(2.8, 100));
    assert.equal(target.health, 100); assert.equal(room.events.filter(event => event.type === 'hit').length, 0);
    advance(501); const aim = place(1.6, 100); room.fire(shooter, aim);
    assert.equal(target.health, 45); assert.equal(target.armor, 100);
    const hit = room.events.find(event => event.type === 'hit');
    assert.equal(hit.weapon, 'knife'); assert.equal(hit.armor, false); assert.equal(hit.headshot, false);
    assert.equal(shooter.inventory.awp.ammo, 5); assert.equal(shooter.inventory.knife.ammo, 0);
  });
});
