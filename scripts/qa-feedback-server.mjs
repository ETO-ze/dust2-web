/** Local-only, disposable gameplay fixture. No production debug endpoint or fake events. */
import fs from 'node:fs';
import path from 'node:path';
import { startGameServer } from '../server/index.js';
import { MAP } from '../shared/map-data.js';
import { createPlayerState, stepPlayer, raycastWorld } from '../shared/physics.js';

const root = path.resolve(import.meta.dirname, '..');
const logFile = path.join(root, 'output/playwright/qa-feedback-authoritative.ndjson');
fs.mkdirSync(path.dirname(logFile), { recursive: true });
const log = event => { const text = JSON.stringify({ recordedAt: new Date().toISOString(), ...event }); fs.appendFileSync(logFile, text + '\n'); console.log(text); };
const app = await startGameServer({ port: 3002, host: '127.0.0.1', rules: { protectionSeconds: 0, respawnSeconds: 3 } });
const neutral = (yaw = 0, pitch = 0) => ({ forward: 0, right: 0, yaw, pitch, jump: false, crouch: false, walk: false, fire: false, reload: false, interact: false, slot: 0 });

function settle(node) {
  const p = createPlayerState({ ...node, y: node.y + .3 });
  for (let i = 0; i < 100; i++) stepPlayer(p, neutral(), 1 / 60);
  if (!p.grounded || Math.hypot(p.x - node.x, p.z - node.z) > .3) return null;
  return { x: p.x, y: p.y, z: p.z };
}
function findLane() {
  const reference = MAP.spawns.T[0];
  const nodes = MAP.nav.filter(n => n.neighbors.length >= 3).sort((a, b) => Math.hypot(a.x - reference.x, a.z - reference.z) - Math.hypot(b.x - reference.x, b.z - reference.z));
  for (const na of nodes) {
    const a = settle(na); if (!a) continue;
    for (const nb of nodes) {
      const rawDistance = Math.hypot(nb.x - a.x, nb.z - a.z);
      if (rawDistance < 5 || rawDistance > 7 || Math.abs(nb.y - a.y) > .25) continue;
      const b = settle(nb); if (!b) continue;
      const dx = b.x - a.x, dz = b.z - a.z, gap = Math.hypot(dx, dz);
      const origin = { x: a.x, y: a.y + 1.6, z: a.z };
      let clear = true;
      for (const height of [.4, 1.0, 1.62]) {
        const dy = b.y + height - origin.y, length = Math.hypot(gap, dy);
        if (raycastWorld(origin, { x: dx / length, y: dy / length, z: dz / length }, length) !== null) { clear = false; break; }
      }
      if (clear) return { a, b, gap, yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(b.y + 1.0 - origin.y, gap), navIds: [na.id, nb.id] };
    }
  }
  throw Error('No settled, unobstructed Dust2 shooting lane.');
}
let lane;
try { lane = findLane(); } catch (error) { await app.close(); throw error; }
log({ type: 'fixture_ready', url: 'http://127.0.0.1:3002/', lane, instructions: 'Choose deathmatch and AWP. This local fixture places the human on T, one stationary CT target at 100 HP / 100 armor, and aims at its chest. Left-click once; expect the real server shot/hit/kill sequence. Target respawns after 3 seconds. Normal movement/buy/reload still work.' });

const setRoom = app.rooms.set.bind(app.rooms);
app.rooms.set = (code, room) => {
  room.mode = 'deathmatch'; room.desiredBots = 1; room.round.phase = 'live';
  room.pickSpawn = team => ({ ...(team === 'T' ? lane.a : lane.b), yaw: team === 'T' ? lane.yaw : lane.yaw + Math.PI });
  const originalAdd = room.addHuman.bind(room);
  room.addHuman = (socket, settings) => {
    const p = originalAdd(socket, { ...settings, team: 'T' });
    p.pitch = lane.pitch; p.input = neutral(lane.yaw, lane.pitch); p.protectionUntil = 0;
    for (const target of room.players.values()) if (target.bot) { target.name = 'QA CT · 100血100甲'; target.protectionUntil = 0; }
    log({ type: 'fixture_join', room: code, playerId: p.id, weapon: p.weapon, player: { x: p.x, y: p.y, z: p.z }, yaw: p.yaw, pitch: p.pitch });
    return p;
  };
  // The bot is a real server player; only its AI movement and fire inputs are disabled.
  room.botInput = () => neutral(lane.yaw + Math.PI, 0);
  const originalTick = room.tick.bind(room);
  room.tick = dt => {
    for (const p of room.players.values()) if (p.bot && p.alive) Object.assign(p, lane.b, { vx: 0, vy: 0, vz: 0, protectionUntil: 0 });
    originalTick(dt);
  };
  const originalEmit = room.emit.bind(room);
  room.emit = (type, fields) => {
    originalEmit(type, fields);
    if (['shot', 'hit', 'kill'].includes(type)) log({ room: code, authoritative: true, ...room.events.at(-1) });
  };
  return setRoom(code, room);
};
const stop = () => app.close().then(() => process.exit(0));
process.once('SIGINT', stop); process.once('SIGTERM', stop);
