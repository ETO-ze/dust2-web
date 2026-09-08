import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { once } from 'node:events';
import { syncBuiltinESMExports } from 'node:module';
import { randomBytes } from 'node:crypto';
import { connect as connectTcp } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { WebSocket } from 'ws';
import { startGameServer } from '../server/index.js';

async function peer(port) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`), messages = [], listeners = new Set();
  socket.on('error', () => {});
  socket.on('message', data => { messages.push(JSON.parse(data.toString())); for (const check of listeners) check(); });
  await once(socket, 'open');
  return { socket, send: value => socket.send(JSON.stringify(value)),
    waitFor(predicate) { return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { listeners.delete(check); reject(Error('Resilience response timeout')); }, 3000);
      function check() {
        const index = messages.findIndex(predicate); if (index < 0) return;
        clearTimeout(timer); listeners.delete(check); resolve(messages.splice(index, 1)[0]);
      }
      listeners.add(check); check();
    }); } };
}

test('bad protocol input, disappearing assets and overflow handshakes cannot kill the server', { timeout: 15000 }, async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dust2-resilience-'));
  const previous = process.env.MAX_ROOMS;
  let app;
  process.env.MAX_ROOMS = '1';
  try { app = await startGameServer({ port: 0, host: '127.0.0.1', staticDir: directory }); }
  finally { if (previous === undefined) delete process.env.MAX_ROOMS; else process.env.MAX_ROOMS = previous; }
  const clients = [];
  t.after(async () => {
    clients.forEach(client => client.socket.terminate()); await app.close();
    for (const name of await fs.readdir(directory)) await fs.unlink(path.join(directory, name));
    await fs.rmdir(directory);
  });
  const client = await peer(app.port); clients.push(client);

  await t.test('join rejects non-string names and room codes while keeping the connection usable', async () => {
    for (const fields of [{ name: { toString: null } }, { room: { toString: null } }, { name: [] }, { room: 42 }]) {
      client.send({ type: 'join', bots: 0, ...fields });
      assert.equal((await client.waitFor(message => message.type === 'error')).code, 'BAD_JOIN');
      client.send({ type: 'ping', time: 711 });
      assert.equal((await client.waitFor(message => message.type === 'pong')).time, 711);
    }
    client.send({ type: 'join', room: 'SAFE01', name: 'Valid player', bots: 0 });
    assert.equal((await client.waitFor(message => message.type === 'welcome')).room, 'SAFE01');
  });

  await t.test('an object-valued buy weapon is rejected and later valid purchases still work', async () => {
    client.send({ type: 'buy', weapon: { toString: null } });
    assert.equal((await client.waitFor(message => message.type === 'error')).code, 'BUY_REJECTED');
    client.send({ type: 'ping', time: 712 });
    assert.equal((await client.waitFor(message => message.type === 'pong')).time, 712);
    await delay(270);
    client.send({ type: 'buy', weapon: 'awp' });
    assert.equal((await client.waitFor(message => message.type === 'purchase')).weapon, 'awp');
  });

  await t.test('a file removed immediately after lookup closes only its response, not the HTTP server', async () => {
    const file = path.join(directory, 'replaced-asset.txt');
    await fs.writeFile(file, 'Test asset being replaced during lookup.');
    const originalStat = fs.stat; let removed = false;
    // Deterministic filesystem race: the first successful stat returns real
    // metadata, but the file disappears before the HTTP handler resumes.
    fs.stat = async (...args) => {
      const metadata = await originalStat(...args);
      if (args[0] === file && !removed) { await fs.unlink(file); removed = true; }
      return metadata;
    };
    syncBuiltinESMExports();
    try {
      await fetch(`http://127.0.0.1:${app.port}/replaced-asset.txt`, { signal: AbortSignal.timeout(1500) })
        .then(response => response.arrayBuffer()).catch(() => {});
      assert.equal(removed, true, 'fixture must exercise the exact post-lookup race');
    } finally { fs.stat = originalStat; syncBuiltinESMExports(); }
    const health = await fetch(`http://127.0.0.1:${app.port}/health`);
    assert.equal((await health.json()).ok, true);
    const missing = await fetch(`http://127.0.0.1:${app.port}/replaced-asset.txt`);
    assert.equal(missing.status, 404);
  });

  await t.test('outbound congestion closes only the slow recipient with the documented reason', async () => {
    const slow = await peer(app.port); clients.push(slow);
    slow.send({ type: 'join', room: 'SAFE01', name: 'Slow receiver', bots: 0 });
    const welcome = await slow.waitFor(message => message.type === 'welcome');
    const serverSide = app.rooms.get('SAFE01').clients.get(welcome.id);
    const clientClosed = once(slow.socket, 'close'), serverClosed = once(serverSide, 'close');
    // Keep an actual outbound write queued. This exercises ws.bufferedAmount
    // and the real close handshake without requiring a slow remote network.
    serverSide._socket.cork();
    serverSide.send(JSON.stringify({ type: 'audit-congestion', payload: 'x'.repeat(1024 * 1024 + 1) }));
    assert.ok(serverSide.bufferedAmount > 1024 * 1024);
    for (let i = 0; i < 20 && serverSide.readyState === WebSocket.OPEN; i++) await delay(20);
    assert.equal(serverSide.readyState, WebSocket.CLOSING);
    serverSide._socket.uncork();
    const [code, reason] = await clientClosed; await serverClosed;
    assert.equal(code, 1008); assert.equal(reason.toString(), 'Client too slow');
    client.send({ type: 'ping', time: 714 });
    assert.equal((await client.waitFor(message => message.type === 'pong')).time, 714);
    assert.equal(app.rooms.get('SAFE01').humanCount, 1);
  });

  await t.test('a rejected over-capacity socket tolerates malformed frames while its close handshake is pending', async () => {
    while (app.wss.clients.size < 30) clients.push(await peer(app.port));
    const raw = connectTcp({ host: '127.0.0.1', port: app.port });
    raw.on('error', () => {});
    let bytes = Buffer.alloc(0), upgraded = false;
    raw.on('data', chunk => {
      bytes = Buffer.concat([bytes, chunk]);
      if (!upgraded && bytes.includes(Buffer.from('\r\n\r\n'))) {
        upgraded = true;
        // RSV1 set with compression disabled. A valid mask/zero-length payload
        // still yields a receiver protocol error on this server connection.
        raw.write(Buffer.from([0xc1, 0x80, 0, 0, 0, 0]));
      }
    });
    try {
      await once(raw, 'connect');
      raw.write(`GET /ws HTTP/1.1\r\nHost: 127.0.0.1:${app.port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: ${randomBytes(16).toString('base64')}\r\n\r\n`);
      await delay(150);
      assert.equal(upgraded, true); assert.ok(bytes.includes(Buffer.from('Server busy')));
      client.send({ type: 'ping', time: 713 });
      assert.equal((await client.waitFor(message => message.type === 'pong')).time, 713);
      assert.equal((await (await fetch(`http://127.0.0.1:${app.port}/health`)).json()).ok, true);
    } finally { raw.destroy(); }
  });
});
