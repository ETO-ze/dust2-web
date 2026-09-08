// Isolated diagnostic child process. Never points at the production server.
import { performance, monitorEventLoopDelay } from 'node:perf_hooks';
import { setImmediate as immediate } from 'node:timers/promises';
import os from 'node:os';
import { GameRoom } from '../server/game.js';
import { startGameServer } from '../server/index.js';

let app;
const timings = { tick: [], snapshot: [], planPath: [], botInput: [] };
const totals = { ticks: 0, shots: 0, hits: 0, kills: 0, spawns: 0, batches: 0 };
const intervals = [];
let previousBatch = 0;
for (const name of Object.keys(timings)) {
  const original = GameRoom.prototype[name];
  GameRoom.prototype[name] = function (...args) {
    const start = performance.now();
    if (name === 'tick') {
      totals.ticks++;
      if (app?.rooms.values().next().value === this) {
        totals.batches++;
        if (previousBatch) intervals.push(start - previousBatch);
        previousBatch = start;
      }
    }
    try { return original.apply(this, args); }
    finally { timings[name].push(performance.now() - start); }
  };
}
const originalEmit = GameRoom.prototype.emit;
GameRoom.prototype.emit = function (type, ...args) {
  const key = { shot: 'shots', hit: 'hits', kill: 'kills', spawn: 'spawns' }[type];
  if (key) totals[key]++;
  return originalEmit.call(this, type, ...args);
};
const summarize = values => {
  if (!values.length) return { count: 0, mean: 0, p50: 0, p95: 0, p99: 0, max: 0, total: 0 };
  const sorted = values.toSorted((a, b) => a - b), total = values.reduce((a, b) => a + b, 0);
  return { count: values.length, mean: total / values.length, p50: sorted[Math.floor(sorted.length * .5)],
    p95: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * .95))],
    p99: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * .99))], max: sorted.at(-1), total };
};
const loop = monitorEventLoopDelay({ resolution: 10 }); loop.enable();
let previousCpu = process.cpuUsage(), previousWall = performance.now(), previousTotals = { ...totals };
function sample(label, gc = false) {
  if (gc && global.gc) global.gc();
  const now = performance.now(), cpu = process.cpuUsage(previousCpu), elapsed = now - previousWall;
  previousCpu = process.cpuUsage(); previousWall = now;
  const memory = process.memoryUsage();
  const rooms = [...app.rooms.values()];
  const clients = [...app.wss.clients];
  const durations = Object.fromEntries(Object.entries(timings).map(([key, values]) => [key, summarize(values.splice(0))]));
  const changes = Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, value - previousTotals[key]]));
  previousTotals = { ...totals };
  const result = { label, timestamp: new Date().toISOString(), elapsedMs: elapsed,
    cpuPercentOfOneCore: (cpu.user + cpu.system) / (elapsed * 1000) * 100,
    cpuUserMs: cpu.user / 1000, cpuSystemMs: cpu.system / 1000,
    memory, gc, rooms: rooms.length, humans: rooms.reduce((n, r) => n + r.humanCount, 0),
    players: rooms.reduce((n, r) => n + r.players.size, 0), sockets: clients.length,
    bots: rooms.reduce((n, r) => n + [...r.players.values()].filter(p => p.bot).length, 0),
    bufferedBytes: clients.reduce((n, socket) => n + socket.bufferedAmount, 0),
    largestEventQueue: Math.max(0, ...rooms.map(r => r.events.length)),
    largestBotPath: Math.max(0, ...rooms.flatMap(r => [...r.players.values()].map(p => p.botAI.path.length))),
    finitePlayers: rooms.every(r => [...r.players.values()].every(p => Number.isFinite(p.x + p.y + p.z))),
    workMs: durations, tickIntervalMs: summarize(intervals.splice(0)), changes,
    summedRoomTickMsPerBatch: changes.batches ? durations.tick.total / changes.batches : 0,
    eventLoopDelayMs: { mean: loop.mean / 1e6, p95: loop.percentile(95) / 1e6, max: loop.max / 1e6 } };
  loop.reset(); return result;
}

async function soak(seconds = 600) {
  let now = 1_000_000, seed = 419071;
  const originalRandom = Math.random;
  Math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const rooms = Array.from({ length: 4 }, (_, i) => {
    const room = new GameRoom('SIM' + i, { bots: 8, clock: () => now });
    room.addHuman({}, { name: 'T observer', team: 'T' }); room.addHuman({}, { name: 'CT observer', team: 'CT' });
    return room;
  });
  const checkpoints = [], started = performance.now(), cpu = process.cpuUsage();
  let maxEventQueue = 0, maxPath = 0;
  try {
    for (let tick = 0; tick < seconds * 30; tick++) {
      now += 1000 / 30;
      for (const room of rooms) {
        room.tick(1 / 30);
        maxEventQueue = Math.max(maxEventQueue, room.events.length);
        // A live server drains on every second tick; do the same here.
        if (tick % 2 === 1) room.snapshot();
        for (const player of room.players.values()) {
          if (!Number.isFinite(player.x + player.y + player.z)) throw Error('Non-finite bot in soak');
          maxPath = Math.max(maxPath, player.botAI.path.length);
        }
      }
      if (tick % 30 === 0) await immediate();
      if ((tick + 1) % 1800 === 0) {
        const checkpoint = { simulatedSeconds: (tick + 1) / 30, ...sample('simulated-soak-checkpoint') };
        checkpoints.push(checkpoint); process.send?.({ type: 'soakProgress', simulatedSeconds: checkpoint.simulatedSeconds });
      }
    }
  } finally { Math.random = originalRandom; }
  const used = process.cpuUsage(cpu);
  return { seconds, rooms: rooms.length, players: rooms.reduce((n, r) => n + r.players.size, 0),
    wallMs: performance.now() - started, cpuMs: (used.user + used.system) / 1000,
    maxEventQueue, maxPath, checkpoints };
}

const started = performance.now();
app = await startGameServer({ port: 0, host: '127.0.0.1' });
process.send?.({ type: 'ready', port: app.port, pid: process.pid, startupMs: performance.now() - started,
  runtime: process.version, platform: process.platform, cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length });
process.on('message', async message => {
  try {
    if (message.type === 'sample') process.send?.({ type: 'sample', request: message.request, result: sample(message.label, message.gc) });
    if (message.type === 'soak') process.send?.({ type: 'soak', request: message.request, result: await soak(message.seconds) });
    if (message.type === 'stop') { loop.disable(); await app.close(); process.send?.({ type: 'stopped' }); process.exit(0); }
  } catch (error) { process.send?.({ type: 'workerError', message: String(error), stack: error.stack }); }
});
process.on('disconnect', async () => { await app.close(); process.exit(0); });
