// Read-only asset checks and a short, ordinary two-player game session.
// No arguments only prints the plan. Use --run after the release is activated.
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import tls from 'node:tls';
import WebSocket from 'ws';
import { SKINS, DEFAULT_SKINS } from '../shared/skins.js';
import { AGENT_CATALOG, DEFAULT_AGENT_IDS } from '../shared/agents.js';
import { AGENT_ASSETS } from '../shared/agent-assets.js';
import { UTILITY_ASSETS } from '../shared/utility-assets.js';
import { TEAM_LOADOUTS, canTeamUseWeapon, getWeapon } from '../shared/weapons.js';

const base = new URL('https://cs2.duskrain.cn/');
const args = process.argv.slice(2);
const live = args.includes('--run');
const selfTest = args.includes('--self-test');
const expectedRelease = args.find(v => v.startsWith('--release='))?.slice(10);
const unknown = args.filter(v => !['--run', '--plan', '--self-test'].includes(v) && !v.startsWith('--release='));
assert.equal(unknown.length, 0, `Unknown arguments: ${unknown.join(', ')}`);
assert.ok(!(live && selfTest), 'Choose --run or --self-test');
const assets = [
  ...SKINS.map(s => ({ kind: 'skin', id: s.id, ...s })),
  ...Object.entries(UTILITY_ASSETS).map(([id, a]) => ({ kind: 'utility', id, ...a })),
  ...AGENT_CATALOG.map(a => ({ kind: 'agent', id: a.id, ...AGENT_ASSETS[a.id] })),
];
const report = {
  base: base.href, startedAt: new Date().toISOString(), expectedRelease,
  mode: selfTest ? 'local-protocol' : 'public', checks: [], assets: [], peers: [],
};
const peers = [];
let localServer;
const playerIn = (message, id) => message.players?.find(p => p.id === id);
const check = (name, details = {}) => { report.checks.push({ name, ...details }); console.log(`PASS ${name}`); };

function validateCatalog() {
  assert.equal(SKINS.length, 37, 'Expected all 37 skin models');
  assert.equal(Object.keys(UTILITY_ASSETS).length, 3);
  assert.equal(AGENT_CATALOG.length, 4);
  assert.equal(new Set(assets.map(a => a.model)).size, assets.length, 'Model paths must be unique');
  for (const a of assets) {
    assert.match(a.model ?? '', /^assets\/[a-zA-Z0-9_./-]+\.glb$/, `${a.id}: model path`);
    assert.ok(!a.model.includes('..'), `${a.id}: model path traversal`);
    assert.match(a.sha256 ?? '', /^[a-f0-9]{64}$/, `${a.id}: SHA-256`);
    assert.ok(Number.isSafeInteger(a.bytes) && a.bytes > 12, `${a.id}: byte length`);
  }
}

async function get(url, options = {}) {
  return fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(90000), ...options });
}

async function health() {
  const response = await get(new URL('health', base));
  assert.equal(response.status, 200, 'Public health status');
  assert.match(response.headers.get('content-type') ?? '', /application\/json/);
  const result = await response.json();
  assert.equal(result.ok, true);
  assert.equal(result.service, 'dust2-web');
  assert.equal(result.release, expectedRelease, 'Live server must be the requested release');
  return result;
}

async function verifyWeb() {
  const http = new URL(base); http.protocol = 'http:';
  const redirect = await get(http, { redirect: 'manual' });
  assert.ok([301, 302, 307, 308].includes(redirect.status), 'HTTP must redirect to HTTPS');
  assert.equal(new URL(redirect.headers.get('location'), http).href, base.href);
  await redirect.body?.cancel();
  check('HTTP redirects to HTTPS', { status: redirect.status });

  report.tls = await new Promise((resolve, reject) => {
    const socket = tls.connect({ host: base.hostname, port: 443, servername: base.hostname, rejectUnauthorized: true });
    socket.setTimeout(15000, () => socket.destroy(new Error('TLS verification timeout')));
    socket.once('error', reject);
    socket.once('secureConnect', () => {
      try {
        assert.equal(socket.authorized, true);
        const cert = socket.getPeerCertificate();
        assert.ok(new Date(cert.valid_to).getTime() > Date.now(), 'TLS certificate has expired');
        resolve({ authorized: socket.authorized, protocol: socket.getProtocol(), subjectAltName: cert.subjectaltname, validTo: cert.valid_to, issuer: cert.issuer?.O });
      } catch (error) { reject(error); }
      finally { socket.end(); }
    });
  });
  check('TLS certificate and host validation');
  const page = await get(base);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type') ?? '', /text\/html/);
  const html = await page.text();
  assert.match(html, /DUST/i);
  const bundles = [...html.matchAll(/(?:src|href)="([^"\s]+\.(?:js|css))"/g)].map(m => m[1]);
  assert.ok(bundles.length >= 2, 'Built JS and CSS links');
  for (const path of [...bundles, 'sw.js', 'manifest.webmanifest', 'icons/icon-192.png']) {
    const url = new URL(path, base);
    assert.equal(url.origin, base.origin);
    const response = await get(url, { method: 'HEAD' });
    assert.equal(response.status, 200, path);
    assert.doesNotMatch(response.headers.get('content-type') ?? '', /text\/html/i, path);
  }
  check('Page, built bundles and PWA files');
  report.healthBefore = await health();
  check('Health identifies the activated release', { release: report.healthBefore.release });
}

async function verifyAssets() {
  let cursor = 0;
  async function worker() {
    while (cursor < assets.length) {
      const asset = assets[cursor++];
      const row = { kind: asset.kind, id: asset.id, model: asset.model, expectedBytes: asset.bytes, expectedSha256: asset.sha256 };
      report.assets.push(row);
      try {
        const url = new URL(asset.model, base); url.searchParams.set('v', asset.sha256.slice(0, 12));
        const response = await get(url);
        row.status = response.status; row.contentType = response.headers.get('content-type');
        assert.equal(response.status, 200, asset.model);
        assert.match(row.contentType ?? '', /^(?:application\/octet-stream|application\/gltf-buffer|model\/gltf-binary)(?:;|$)/i, asset.model);
        const hash = createHash('sha256'); let bytes = 0; let header = Buffer.alloc(0);
        for await (const chunk of response.body) {
          const buffer = Buffer.from(chunk); bytes += buffer.length; hash.update(buffer);
          if (header.length < 12) header = Buffer.concat([header, buffer.subarray(0, 12 - header.length)]);
          assert.ok(bytes <= asset.bytes, `${asset.model}: response exceeds expected length`);
        }
        row.bytes = bytes; row.sha256 = hash.digest('hex');
        assert.equal(bytes, asset.bytes, `${asset.model}: bytes`);
        assert.equal(row.sha256, asset.sha256, `${asset.model}: SHA-256`);
        assert.equal(header.subarray(0, 4).toString('ascii'), 'glTF', `${asset.model}: GLB magic`);
        assert.equal(header.readUInt32LE(4), 2, `${asset.model}: GLB version`);
        assert.equal(header.readUInt32LE(8), bytes, `${asset.model}: GLB declared size`);
        row.ok = true;
      } catch (error) { row.ok = false; row.error = error.message; }
      if (report.assets.filter(a => a.ok).length % 8 === 0) console.log(`Models verified ${report.assets.filter(a => a.ok).length}/${assets.length}`);
    }
  }
  await Promise.all([worker(), worker()]);
  const failures = report.assets.filter(a => !a.ok);
  assert.equal(failures.length, 0, failures.map(a => `${a.id}: ${a.error}`).join('\n'));
  check('Every skin, utility and agent model has exact bytes and SHA-256', {
    skins: SKINS.length, utilities: Object.keys(UTILITY_ASSETS).length, agents: AGENT_CATALOG.length,
    models: report.assets.length, bytes: report.assets.reduce((sum, a) => sum + a.bytes, 0), parallelDownloads: 2,
  });
}

async function connect(url, origin, team, room) {
  const socket = new WebSocket(url, { origin, perMessageDeflate: false });
  const messages = [], listeners = new Set(); let number = 0, failure;
  const p = {
    socket, team, seq: 0, jumpId: 0, lastBuy: 0, lastAgent: 0,
    mark: () => number,
    send(value) { assert.equal(socket.readyState, WebSocket.OPEN, `${team} socket is open`); socket.send(JSON.stringify(value)); },
    input(values = {}) { p.send({ type: 'input', seq: ++p.seq, forward: 0, right: 0, yaw: p.yaw ?? 0, pitch: 0, jump: false, jumpId: p.jumpId, crouch: false, walk: false, fire: false, reload: false, slot: 1, interact: false, ...values }); },
    wait(predicate, after = 0, label = 'WebSocket response', timeout = 15000) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => finish(new Error(`${team}: timed out waiting for ${label}`)), timeout);
        function finish(error, value) { clearTimeout(timer); listeners.delete(poll); error ? reject(error) : resolve(value); }
        function poll() {
          const found = messages.find(m => m.number > after && predicate(m.value));
          if (found) finish(null, found.value); else if (failure) finish(failure);
        }
        listeners.add(poll); poll();
      });
    },
  };
  peers.push(p);
  socket.on('message', raw => {
    try { messages.push({ number: ++number, value: JSON.parse(raw) }); if (messages.length > 1800) messages.splice(0, 600); }
    catch (error) { failure = error; }
    for (const listener of [...listeners]) listener();
  });
  socket.on('error', error => { failure = error; for (const listener of [...listeners]) listener(); });
  socket.on('close', (code, reason) => { p.closed = { code, reason: reason.toString() }; failure ??= new Error(`${team} socket closed (${code})`); for (const listener of [...listeners]) listener(); });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.terminate(); reject(new Error(`${team} connection timeout`)); }, 15000);
    socket.once('open', () => { clearTimeout(timer); resolve(); });
    socket.once('error', error => { clearTimeout(timer); reject(error); });
  });
  p.send({ type: 'join', name: `Release QA ${team}`, room, mode: 'deathmatch', bots: 0, team, primary: 'awp', skins: DEFAULT_SKINS, agents: { CT: 'ct-ava', T: 't-miami' } });
  p.welcome = await p.wait(m => m.type === 'welcome', 0, 'welcome');
  assert.equal(p.welcome.team, team); assert.equal(p.welcome.room, room);
  report.peers.push({ team, id: p.welcome.id });
  return p;
}

async function waitPlayer(observer, owner, predicate, after = observer.mark(), label = 'player state') {
  const message = await observer.wait(m => m.type === 'snapshot' && playerIn(m, owner.welcome.id) && predicate(playerIn(m, owner.welcome.id)), after, label);
  return playerIn(message, owner.welcome.id);
}

async function purchase(owner, observer, weapon, accepted = true) {
  await delay(Math.max(0, owner.lastBuy + 320 - Date.now()));
  const ownMark = owner.mark(), otherMark = observer.mark(); owner.lastBuy = Date.now();
  owner.send({ type: 'buy', weapon });
  const response = await owner.wait(m => m.type === 'purchase' || m.type === 'error', ownMark, `purchase ${weapon}`);
  if (!accepted) { assert.equal(response.type, 'error'); assert.equal(response.code, 'BUY_REJECTED'); return response; }
  assert.equal(response.type, 'purchase', JSON.stringify(response)); assert.equal(response.ok, true); assert.equal(response.weapon, weapon);
  const state = await waitPlayer(observer, owner, p => p.weapon === weapon && p.inventory.includes(weapon), otherMark, `observer purchase ${weapon}`);
  assert.equal(state.ammo, getWeapon(weapon).magazine);
  return state;
}

async function equipAgent(owner, observer, agent) {
  await delay(Math.max(0, owner.lastAgent + 320 - Date.now()));
  const ownMark = owner.mark(), otherMark = observer.mark(); owner.lastAgent = Date.now();
  owner.send({ type: 'equipAgent', agent });
  const ack = await owner.wait(m => m.type === 'agentEquipped' || m.type === 'error', ownMark, `agent ACK ${agent}`);
  assert.equal(ack.type, 'agentEquipped', JSON.stringify(ack)); assert.equal(ack.agent, agent); assert.equal(ack.team, owner.team);
  return waitPlayer(observer, owner, p => p.agentId === agent, otherMark, `observer agent ${agent}`);
}

async function closePeer(p) {
  if (p.socket.readyState === WebSocket.CLOSED) return;
  await new Promise(resolve => {
    const timer = setTimeout(() => { p.socket.terminate(); resolve(); }, 4000);
    p.socket.once('close', () => { clearTimeout(timer); resolve(); });
    if (p.socket.readyState === WebSocket.OPEN) p.socket.close(1000, 'Release verification complete'); else p.socket.terminate();
  });
}

async function verifyProtocol(url, origin) {
  const room = `Q${randomBytes(4).toString('hex')}`.toUpperCase(); report.room = room;
  const t = await connect(url, origin, 'T', room), ct = await connect(url, origin, 'CT', room);
  assert.notEqual(t.welcome.id, ct.welcome.id);
  for (const [observer, owner, agent] of [[t, ct, 'ct-ava'], [ct, t, 't-miami']]) {
    const snapshot = await observer.wait(m => m.type === 'snapshot' && m.players?.length === 2 && m.players.every(p => !p.bot) && playerIn(m, owner.welcome.id)?.agentId === agent, 0, 'two opposing humans with selected agents');
    const state = playerIn(snapshot, owner.welcome.id); owner.yaw = state.yaw;
    assert.equal(state.team, owner.team); assert.equal(state.weapon, 'awp');
    assert.ok(state.inventory.includes(owner.team === 'CT' ? 'usp' : 'pistol'));
    assert.ok(state.inventory.includes('knife'));
  }
  check('Two real WSS players join opposing sides with Ava / Miami, no bots');

  report.purchases = {};
  await Promise.all([[t, ct], [ct, t]].map(async ([owner, observer]) => {
    const guns = Object.values(TEAM_LOADOUTS[owner.team]).flat(); assert.equal(guns.length, 15);
    report.purchases[owner.team] = [];
    for (const weapon of guns) {
      assert.equal(canTeamUseWeapon(owner.team, weapon), true);
      const state = await purchase(owner, observer, weapon);
      report.purchases[owner.team].push({ weapon, price: getWeapon(weapon).price, observedAmmo: state.ammo });
    }
  }));
  check('All 15 CT and all 15 T loadout purchases receive ACK and observer snapshots', { purchases: 30 });
  await Promise.all([purchase(t, ct, 'm4a4', false), purchase(ct, t, 'ak47', false)]);
  for (const [owner, observer] of [[t, ct], [ct, t]]) await waitPlayer(observer, owner, p => p.weapon === 'awp' && !p.inventory.includes(owner.team === 'CT' ? 'ak47' : 'm4a4'));
  check('Opposing-team guns are rejected without altering equipped AWP');

  const beforeShot = await waitPlayer(ct, t, p => p.alive && p.weapon === 'awp');
  await delay(450);
  const shotMark = ct.mark(); t.input({ fire: true, pitch: 1.45 });
  const shot = await ct.wait(m => m.type === 'snapshot' && m.events?.some(e => e.type === 'shot' && e.shooterId === t.welcome.id && e.weapon === 'awp'), shotMark, 'observer shot event');
  t.input({ fire: false, pitch: 1.45 });
  const afterShot = await waitPlayer(ct, t, p => p.ammo === beforeShot.ammo - 1, shotMark, 'observer ammunition decrement');
  check('AWP fire event and one-round ammo use reach the second client', { before: beforeShot.ammo, after: afterShot.ammo, event: shot.events.find(e => e.type === 'shot' && e.shooterId === t.welcome.id).id });

  const skin = SKINS.find(s => s.weapon === 'awp' && !s.isDefault); assert.ok(skin);
  const skinMark = t.mark(), skinObserverMark = ct.mark();
  t.send({ type: 'equipSkin', weapon: 'awp', skin: skin.id });
  const skinAck = await t.wait(m => m.type === 'skinEquipped' || m.type === 'error', skinMark, 'skin ACK');
  assert.equal(skinAck.type, 'skinEquipped', JSON.stringify(skinAck)); assert.equal(skinAck.skin, skin.id);
  await waitPlayer(ct, t, p => p.skinId === skin.id, skinObserverMark, 'observer skin change');
  check('On-demand skin selection is acknowledged and replicated', { skin: skin.id });

  for (const [owner, observer] of [[t, ct], [ct, t]]) {
    const before = await waitPlayer(observer, owner, p => p.alive);
    const after = await equipAgent(owner, observer, DEFAULT_AGENT_IDS[owner.team]);
    for (const key of ['team', 'health', 'armor', 'helmet', 'money', 'ammo', 'kills', 'deaths']) assert.deepEqual(after[key], before[key], `Agent cosmetics preserve ${key}`);
    assert.deepEqual(after.inventory, before.inventory);
    await equipAgent(owner, observer, owner.team === 'CT' ? 'ct-ava' : 't-miami');
  }
  check('Both teams change agent and restore selection with ACK, observer replication and unchanged combat state');

  const grounded = await waitPlayer(ct, t, p => p.grounded && p.alive);
  const jumpMark = ct.mark(); ++t.jumpId; t.input({ jump: false, pitch: 1.45 });
  const airborne = await waitPlayer(ct, t, p => !p.grounded && p.y > grounded.y + 0.1, jumpMark, 'observer released jump pulse');
  await waitPlayer(ct, t, p => p.grounded && p.y <= airborne.y, ct.mark(), 'landing after jump');
  check('Short released jump input takes off and lands on the observer', { sampledRiseMetres: Math.round((airborne.y - grounded.y) * 1000) / 1000 });
  const now = Date.now(), pingMark = t.mark(); t.send({ type: 'ping', time: now });
  await t.wait(m => m.type === 'pong' && m.time === now, pingMark, 'pong');
  report.roundTripMs = Date.now() - now;

  const leaveMark = t.mark(); await closePeer(ct);
  await t.wait(m => m.type === 'snapshot' && m.players?.length === 1 && !playerIn(m, ct.welcome.id), leaveMark, 'peer departure');
  await closePeer(t);
  assert.equal(ct.closed?.code, 1000); assert.equal(t.closed?.code, 1000);
  check('Both clients close cleanly and the remaining client observes departure');
}

if (!live && !selfTest) {
  console.log(JSON.stringify({
    networkRequests: 0, base: base.href,
    commandAfterActivation: 'node deploy/verify-public.mjs --run --release=RELEASE_STAMP',
    localProtocolCheck: 'node deploy/verify-public.mjs --self-test',
    counts: { skins: SKINS.length, utilities: Object.keys(UTILITY_ASSETS).length, agents: AGENT_CATALOG.length },
    missingMetadata: assets.filter(a => !a.model || !a.sha256 || !a.bytes).map(a => a.id),
  }, null, 2));
} else {
  try {
    if (selfTest) {
      const { startGameServer } = await import('../server/index.js');
      localServer = await startGameServer({ port: 0, host: '127.0.0.1' });
      report.base = `http://127.0.0.1:${localServer.port}/`;
      await verifyProtocol(`ws://127.0.0.1:${localServer.port}/ws`, `http://127.0.0.1:${localServer.port}`);
    } else {
      assert.match(expectedRelease ?? '', /^\d{8}T\d{6}Z$/, 'Supply --release=YYYYMMDDTHHMMSSZ after activation');
      validateCatalog();
      await verifyWeb();
      await verifyAssets();
      await verifyProtocol(new URL('wss://cs2.duskrain.cn/ws'), base.origin);
      report.healthAfter = await health();
    }
    report.ok = true;
  } catch (error) {
    report.ok = false; report.error = { message: error.message, stack: error.stack }; process.exitCode = 1;
    console.error(error.stack);
  } finally {
    await Promise.all(peers.map(closePeer));
    for (const row of report.peers) row.close = peers.find(p => p.welcome?.id === row.id)?.closed;
    await localServer?.close();
    report.finishedAt = new Date().toISOString();
    report.assets.sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
    const output = new URL(`../artifacts/deploy/${selfTest ? 'public-verifier-local-test' : 'public-verification'}.json`, import.meta.url);
    await fs.mkdir(new URL('./', output), { recursive: true });
    await fs.writeFile(output, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ ok: report.ok, checks: report.checks.length, models: report.assets.length, report: output.pathname }, null, 2));
  }
}
