import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { PRIMARY_WEAPONS } from '../shared/weapons.js';
import { normalizeSkinLoadout } from '../shared/skins.js';
import { normalizeAgentLoadout } from '../shared/agents.js';
import { botCount } from '../shared/match-rules.js';
import { initPhysics } from '../shared/physics.js';
import { GameRoom, TICK_RATE, SNAPSHOT_RATE } from './game.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.webmanifest': 'application/manifest+json; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.wasm': 'application/wasm', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8' };
let physicsReady = null;

async function loadPhysics() {
  if (!physicsReady) physicsReady = readFile(path.join(ROOT, 'public/assets/map/collision.json'), 'utf8').then(async source => {
    const { positions } = JSON.parse(source);
    if (!Array.isArray(positions) || positions.length < 9 || positions.length % 9) throw new Error('Invalid Dust2 collision geometry');
    const materials=await readFile(path.join(ROOT,'public/assets/map/penetration-materials.u8'));
    if(materials.length!==positions.length/9)throw new Error('Invalid Dust2 penetration material count');
    return initPhysics(positions,new Uint8Array(materials));
  }).catch(error => { physicsReady = null; throw error; });
  return physicsReady;
}

function send(socket, value) {
  if (socket.readyState === WebSocket.OPEN && socket.bufferedAmount < 1024 * 1024) socket.send(JSON.stringify(value));
}

function error(socket, code, message) { send(socket, { type: 'error', code, message }); }

function joinSettings(msg) {
  // JSON objects can override toString/valueOf; do not coerce protocol fields.
  if (msg.name !== undefined && typeof msg.name !== 'string') return { error: '玩家名称必须是文字。' };
  if (msg.room !== undefined && typeof msg.room !== 'string') return { error: '房间码必须是文字。' };
  const name = (msg.name || 'Player').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 20) || 'Player';
  const room = (msg.room || '').trim().toUpperCase();
  if (room && !/^[A-Z0-9]{4,12}$/.test(room)) return { error: '房间码应为 4–12 位英文字母或数字。' };
  const mode = msg.mode === 'deathmatch' ? 'deathmatch' : 'defuse';
  const team = ['T', 'CT'].includes(msg.team) ? msg.team : 'auto';
  if(msg.bots!==undefined&&(!Number.isInteger(msg.bots)||msg.bots<0||msg.bots>9))return {error:'机器人数量必须为 0–9 的整数。'};
  const bots = botCount(msg.bots);
  const primary = PRIMARY_WEAPONS.includes(msg.primary) ? msg.primary : 'auto';
  return { name, room, mode, team, bots, primary, skins:normalizeSkinLoadout(msg.skins),agents:normalizeAgentLoadout(msg.agents) };
}

/** Start the authoritative server after loading collision geometry. No external services. */
export async function startGameServer({ port = Number(process.env.PORT || 3000), host = process.env.HOST || '0.0.0.0', staticDir = path.join(ROOT, 'dist'), rules = {} } = {}) {
  await loadPhysics();
  const rooms = new Map();
  const maxRooms = Math.max(1, Math.min(100, Number(process.env.MAX_ROOMS) || 12));
  const startedAt = Date.now();
  const publicDir = path.join(ROOT, 'public');
  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
    let requestPath;
    try { requestPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
    catch { res.writeHead(400); res.end('Bad URL'); return; }
    if (requestPath === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      const memory = process.memoryUsage();
      res.end(JSON.stringify({ ok: true, service: 'dust2-web', release: process.env.DUST2_RELEASE || 'local', protocol: 1, tickRate: TICK_RATE, uptime: Math.round((Date.now() - startedAt) / 1000), rooms: rooms.size, humans: [...rooms.values()].reduce((n, r) => n + r.humanCount, 0), players: [...rooms.values()].reduce((n, r) => n + r.players.size, 0), memory: { rssMiB: Math.round(memory.rss / 1048576), heapMiB: Math.round(memory.heapUsed / 1048576) } })); return;
    }
    if (requestPath.includes('\0') || requestPath.includes('\\')) { res.writeHead(400); res.end('Bad path'); return; }
    let found = null, info = null;
    for (const directory of [staticDir, publicDir]) {
      const base = path.resolve(directory), candidate = path.resolve(base, `.${requestPath === '/' ? '/index.html' : requestPath}`);
      if (!candidate.startsWith(base + path.sep)) continue;
      try { const candidateInfo = await stat(candidate); if (candidateInfo.isFile()) { found = candidate; info = candidateInfo; break; } } catch { /* Try the next permitted static root. */ }
    }
    if (!found && !path.extname(requestPath) && !requestPath.startsWith('/assets')) {
      const index = path.join(staticDir, 'index.html');
      try { const candidateInfo = await stat(index); if (candidateInfo.isFile()) { found = index; info = candidateInfo; } } catch { /* The frontend has not been built yet. */ }
    }
    if (!found) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('文件不存在。请先运行 npm run build，然后打开游戏首页。'); return; }
    // Reuse the lookup's metadata. A second awaited stat could reject outside
    // the lookup's catch if an asset is replaced/deleted during deployment.
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(found).toLowerCase()] || 'application/octet-stream', 'Content-Length': info.size, 'Cache-Control': path.extname(found) === '.html' ? 'no-cache' : 'public, max-age=3600' });
    if (req.method === 'HEAD') res.end(); else { const stream = createReadStream(found); stream.on('error', () => res.destroy()); stream.pipe(res); }
  });
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096, perMessageDeflate: false });
  wss.on('connection', socket => {
    // Rejected connections can still receive invalid frames while closing.
    socket.on('error', () => {});
    if (wss.clients.size > maxRooms * 10 + 20) { socket.close(1013, 'Server busy'); return; }
    socket.isAlive = true; socket.playerId = null; socket.roomCode = null;
    socket.tokens = 150; socket.tokensAt = Date.now(); socket.strikes = 0; socket.connectedAt = Date.now(); socket.buyAt = 0;
    socket.on('pong', () => { socket.isAlive = true; });
    socket.on('message', (data, binary) => {
      const now = Date.now();
      socket.tokens = Math.min(150, socket.tokens + (now - socket.tokensAt) * 0.09); socket.tokensAt = now;
      if (socket.tokens < 1) { error(socket, 'RATE_LIMIT', '请求过于频繁。'); socket.close(1008, 'Rate limit'); return; }
      socket.tokens--;
      let msg;
      try { if (binary) throw new Error('binary'); msg = JSON.parse(data.toString()); if (!msg || typeof msg !== 'object' || Array.isArray(msg)) throw new Error('object'); }
      catch { error(socket, 'BAD_MESSAGE', '消息格式无效。'); if (++socket.strikes > 5) socket.close(1008, 'Bad messages'); return; }
      if (msg.type === 'ping') { send(socket, { type: 'pong', time: typeof msg.time === 'number' ? msg.time : null, serverTime: now }); return; }
      if (msg.type === 'join') {
        if (socket.playerId) { error(socket, 'ALREADY_JOINED', '当前连接已经加入房间。'); return; }
        const settings = joinSettings(msg);
        if (settings.error) { error(socket, 'BAD_JOIN', settings.error); return; }
        if (!settings.room) { do { settings.room = randomBytes(3).toString('hex').toUpperCase(); } while (rooms.has(settings.room)); }
        let room = rooms.get(settings.room), created = false;
        if (!room) {
          if (rooms.size >= maxRooms) { error(socket, 'SERVER_FULL', '服务器当前房间数量已达上限。'); return; }
          room = new GameRoom(settings.room, { mode: settings.mode, bots: settings.bots, rules }); rooms.set(settings.room, room); created = true;
        }
        try {
          const player = room.addHuman(socket, settings); socket.playerId = player.id; socket.roomCode = room.code;
          send(socket, { type: 'welcome', id: player.id, room: room.code, mode: room.mode, team: player.team,teamId:player.teamId,hostId:room.hostId,desiredBots:room.desiredBots,botCount:room.botCount,match:room.matchSnapshot(), tickRate: TICK_RATE, snapshotRate: SNAPSHOT_RATE, serverTime: now, protocol: 1 });
          send(socket, room.snapshot({ drainEvents: false }));
        } catch (e) { if (created) rooms.delete(room.code); error(socket, 'JOIN_FAILED', e.message); }
        return;
      }
      const room = rooms.get(socket.roomCode);
      if (!room || !socket.playerId) { error(socket, 'NOT_JOINED', '请先加入一个房间。'); return; }
      if (msg.type === 'input') {
        if (!room.receiveInput(socket.playerId, msg)) { if (++socket.strikes > 100) socket.close(1008, 'Invalid input'); }
      } else if(msg.type==='setBots'){
        if(now-(socket.setBotsAt||0)<250){error(socket,'BOTS_RATE','设置过于频繁，请稍后重试。');return;}
        socket.setBotsAt=now;const result=room.setBots(socket.playerId,msg.bots);
        if(!result.ok)error(socket,'BOTS_REJECTED',result.message);else send(socket,{type:'botsUpdated',...result});
      } else if(msg.type==='dropWeapon'){
        if(now-(socket.dropWeaponAt||0)<250){error(socket,'DROP_RATE','丢弃过于频繁，请稍后重试。');return;}
        socket.dropWeaponAt=now;const result=room.dropWeapon(socket.playerId);
        if(!result.ok)error(socket,'DROP_REJECTED',result.message);else send(socket,{type:'weaponDropped',...result});
      } else if(msg.type==='equipSkin'){
        if(now-(socket.equipSkinAt||0)<250){error(socket,'SKIN_RATE','更换过于频繁，请稍后重试。');return;}
        socket.equipSkinAt=now;const result=room.equipSkin(socket.playerId,msg.weapon,msg.skin);
        if(!result.ok)error(socket,'SKIN_REJECTED',result.message);else send(socket,{type:'skinEquipped',...result});
      } else if(msg.type==='equipAgent'){
        if(now-(socket.equipAgentAt||0)<250){error(socket,'AGENT_RATE','更换过于频繁，请稍后重试。');return;}
        socket.equipAgentAt=now;const result=room.equipAgent(socket.playerId,msg.agent);
        if(!result.ok)error(socket,'AGENT_REJECTED',result.message);else send(socket,{type:'agentEquipped',...result});
      } else if (msg.type === 'buy') {
        if (now - socket.buyAt < 250) { error(socket, 'BUY_RATE', '购买操作过于频繁。'); return; }
        socket.buyAt = now;
        const result = room.buy(socket.playerId, msg.weapon);
        if (!result.ok) error(socket, 'BUY_REJECTED', result.message); else send(socket, { type: 'purchase', ...result });
      } else error(socket, 'UNKNOWN_MESSAGE', '不支持的消息类型。');
    });
    socket.on('close', () => {
      const room = rooms.get(socket.roomCode); if (!room) return;
      room.removePlayer(socket.playerId);
      if (!room.humanCount) rooms.delete(room.code); else { room.ensureBots(); room.maybeStart(); }
    });
  });
  let tickNumber = 0;
  const tickTimer = setInterval(() => {
    tickNumber++;
    for (const room of rooms.values()) {
      try {
        room.tick(1 / TICK_RATE);
        if (tickNumber % (TICK_RATE / SNAPSHOT_RATE) === 0) {
          const serialized = JSON.stringify(room.snapshot());
          for (const socket of room.clients.values()) {
            if (socket.readyState === WebSocket.OPEN) { if (socket.bufferedAmount > 1024 * 1024) socket.close(1008, 'Client too slow'); else socket.send(serialized); }
          }
        }
      } catch (e) { console.error(`[room ${room.code}]`, e); for (const socket of room.clients.values()) error(socket, 'SIMULATION_ERROR', '房间模拟出现错误，请重新加入。'); }
    }
  }, 1000 / TICK_RATE);
  const heartbeatTimer = setInterval(() => {
    for (const socket of wss.clients) {
      if (!socket.isAlive || (!socket.playerId && Date.now() - socket.connectedAt > 20000)) { socket.terminate(); continue; }
      socket.isAlive = false; socket.ping();
    }
  }, 10000);
  try { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, () => { server.off('error', reject); resolve(); }); }); }
  catch (e) { clearInterval(tickTimer); clearInterval(heartbeatTimer); wss.close(); throw e; }
  const actualPort = server.address().port;
  let closed = false;
  const close = async () => {
    if (closed) return; closed = true; clearInterval(tickTimer); clearInterval(heartbeatTimer);
    for (const socket of wss.clients) socket.terminate();
    await Promise.all([new Promise(resolve => wss.close(resolve)), new Promise(resolve => server.close(resolve))]); rooms.clear();
  };
  return { server, wss, rooms, port: actualPort, close };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  startGameServer().then(app => {
    console.log(`Dust2 Web ready: http://localhost:${app.port} | WebSocket /ws | Health /health`);
    const stop = () => app.close().then(() => process.exit(0));
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
  }).catch(e => { console.error('Dust2 Web failed to start:', e); process.exitCode = 1; });
}
