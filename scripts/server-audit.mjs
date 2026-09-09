import fs from 'node:fs';
import path from 'node:path';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { WebSocket } from 'ws';

const args = process.argv.slice(2), repro = args.includes('--repro');
const realSeconds = Number(args.find(x => x.startsWith('--seconds='))?.split('=')[1] || 90);
const soakSeconds = Number(args.find(x => x.startsWith('--soak='))?.split('=')[1] || 600);
const roomCount=Math.max(1,Math.min(4,Number(args.find(x=>x.startsWith('--rooms='))?.split('=')[1])||4));
const humanCount=Math.max(1,Math.min(2,Number(args.find(x=>x.startsWith('--humans='))?.split('=')[1])||2));
const botCount=Math.max(0,Math.min(10-humanCount,Number(args.find(x=>x.startsWith('--bots='))?.split('=')[1]??8)));
const reportPath = args.find(x => x.startsWith('--output='))?.slice(9) || 'output/server-audit/baseline.json';
fs.mkdirSync(path.dirname(reportPath), { recursive: true });

async function worker() {
  const child = fork(new URL('./server-audit-worker.mjs', import.meta.url), [], {
    env: { ...process.env, MAX_ROOMS: '4' }, execArgv: ['--expose-gc'], windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  const messages = [], listeners = new Set(); let stderr = '', exited;
  child.stdout.on('data', data => process.stdout.write(data));
  child.stderr.on('data', data => { stderr += data.toString(); });
  child.on('exit', (code, signal) => { exited = { code, signal }; for (const check of listeners) check(); });
  child.on('message', message => {
    messages.push(message); for (const check of listeners) check();
    if (message.type === 'soakProgress') console.log(`Simulated ${message.simulatedSeconds}s`);
  });
  function waitFor(predicate, timeout = 10000) { return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { listeners.delete(check); reject(Error('Audit worker response timeout')); }, timeout);
    function check() {
      const index = messages.findIndex(predicate);
      if (index >= 0) { clearTimeout(timer); listeners.delete(check); resolve(messages.splice(index, 1)[0]); }
      else if (exited) { clearTimeout(timer); listeners.delete(check); reject(Error('Worker exited: ' + JSON.stringify(exited) + '\n' + stderr)); }
    }
    listeners.add(check); check();
  }); }
  const ready = await waitFor(message => message.type === 'ready');
  return { child, ready, waitFor, get stderr() { return stderr; }, get exited() { return exited; },
    async request(type, fields = {}, timeout = 10000) {
      const request = Math.random().toString(36); child.send({ type, request, ...fields });
      return (await waitFor(m => m.type === type && m.request === request, timeout)).result;
    },
    async stop() { if (exited) return; child.send({ type: 'stop' }); await waitFor(m => m.type === 'stopped'); },
  };
}

async function peer(port, settings) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`), messages = [], errors = [], closes = [];
  let seq = 0, snapshots = 0, bytes = 0;
  socket.on('error', error => errors.push(String(error)));
  socket.on('close', (code, reason) => closes.push({ code, reason: reason.toString() }));
  socket.on('message', data => {
    bytes += data.length; const message = JSON.parse(data.toString());
    if (message.type === 'snapshot') snapshots++; else messages.push(message);
  });
  await once(socket, 'open');
  if (settings) socket.send(JSON.stringify({ type: 'join', name: 'Audit player', bots: 8, mode: 'deathmatch', ...settings }));
  return { socket, messages, errors, closes, get snapshots() { return snapshots; }, get bytes() { return bytes; },
    sendInput(index, frame) {
      if (socket.readyState !== WebSocket.OPEN) return;
      socket.send(JSON.stringify({ type: 'input', seq: ++seq, yaw: Math.sin(frame / 190 + index) * Math.PI,
        pitch: 0, forward: Math.sin(frame / 170 + index) > -.4 ? 1 : -1, right: Math.cos(frame / 80 + index),
        fire: frame % 37 < 8, slot: 1, jumpId: Math.floor(frame / 160), reloadId: Math.floor(frame / 300) }));
    } };
}

if (repro) {
  const results = [];
  for (const kind of ['join-object-name', 'buy-object-weapon']) {
    const w = await worker(); let client;
    try {
      client = await peer(w.ready.port, kind.startsWith('buy') ? { room: 'REPRO1', bots: 0 } : null);
      await delay(70);
      client.socket.send(JSON.stringify(kind.startsWith('join')
        ? { type: 'join', name: { toString: null }, bots: 0 }
        : { type: 'buy', weapon: { toString: null } }));
      await delay(350);
      const outcome = { kind, exited: w.exited || null, messages: client.messages, closes: client.closes, stderr: w.stderr };
      results.push(outcome); console.log(kind + ': ' + (outcome.exited ? 'process exited ' + outcome.exited.code : 'process survived'));
    } finally { client?.socket.terminate(); await w.stop().catch(() => { w.child.kill(); }); }
  }
  fs.writeFileSync(reportPath, JSON.stringify({ results }, null, 2));
} else {
  const w = await worker(), clients = [], samples = [], report = { ready: w.ready, samples };
  let inputs;
  try {
    samples.push(await w.request('sample', { label: 'startup', gc: true }));
    for (let room = 0; room < roomCount; room++) for (let human = 0; human < humanCount; human++) {
      clients.push(await peer(w.ready.port, { room: 'LOAD' + room, team: human ? 'CT' : 'T', bots: botCount }));
    }
    await delay(300); let frame = 0;
    inputs = setInterval(() => { frame++; clients.forEach((client, index) => client.sendInput(index, frame)); }, 1000 / 30);
    samples.push(await w.request('sample', { label: `${roomCount}rooms-${roomCount*humanCount}humans-${roomCount*botCount}bots-start` }));
    for (let elapsed = 0; elapsed < realSeconds; elapsed += 10) {
      await delay(Math.min(10, realSeconds - elapsed) * 1000);
      const result = await w.request('sample', { label: `bots-${Math.min(realSeconds, elapsed + 10)}s` });
      samples.push(result); console.log(`${result.label}: RSS ${(result.memory.rss / 1048576).toFixed(1)} MiB, heap ${(result.memory.heapUsed / 1048576).toFixed(1)} MiB, CPU ${result.cpuPercentOfOneCore.toFixed(1)}%, room tick p95 ${result.workMs.tick.p95.toFixed(2)}ms, cadence p95 ${result.tickIntervalMs.p95.toFixed(2)}ms`);
    }
    if(!args.includes('--skip-human-load')){
      for (let room = 0; room < roomCount; room++) for (let extra = 0; extra < 10-humanCount; extra++) clients.push(await peer(w.ready.port, { room: 'LOAD' + room, team: 'auto' }));
      await delay(300); samples.push(await w.request('sample', { label: `${roomCount}rooms-${roomCount*10}humans-start` }));
      await delay(15000); samples.push(await w.request('sample', { label: `${roomCount}rooms-${roomCount*10}humans-15s` }));
    }
    report.clients = clients.map(c => ({ snapshots: c.snapshots, bytes: c.bytes, readyStateBeforeCleanup: c.socket.readyState,
      errors: [...c.errors], closes: [...c.closes],
      protocolErrors: c.messages.filter(m => m.type === 'error') }));
    clearInterval(inputs); inputs = null;
    clients.forEach(c => c.socket.terminate()); await delay(400);
    report.intentionalCleanupCloses = clients.flatMap(c => c.closes);
    samples.push(await w.request('sample', { label: 'after-disconnect-before-gc' }));
    samples.push(await w.request('sample', { label: 'after-disconnect-gc', gc: true }));
    if (soakSeconds > 0) report.soak = await w.request('soak', { seconds: soakSeconds }, Math.max(300000, soakSeconds * 1000));
    samples.push(await w.request('sample', { label: 'after-soak-gc', gc: true }));
    report.stderr = w.stderr;
  } finally {
    if (inputs) clearInterval(inputs); clients.forEach(c => c.socket.terminate());
    await w.stop().catch(() => w.child.kill());
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  }
  console.log('Report: ' + reportPath);
}
