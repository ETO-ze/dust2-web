import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { readFile, stat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';

const TYPES = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.mjs':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json', '.webmanifest':'application/manifest+json', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp', '.svg':'image/svg+xml', '.glb':'model/gltf-binary', '.gltf':'model/gltf+json', '.wasm':'application/wasm', '.mp3':'audio/mpeg', '.ogg':'audio/ogg', '.wav':'audio/wav', '.ico':'image/x-icon' };
const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function startPortable({ root = appRoot, mode = 'online', port = mode === 'offline' ? 27195 : 27185, attempts = 10 } = {}) {
  if (!['online', 'offline'].includes(mode)) throw new Error('Invalid play mode');
  const dist = await realpath(path.join(root, 'dist'));
  const originalHTML = await readFile(path.join(dist, 'index.html'), 'utf8');
  const instance = createHash('sha256').update(root + mode + originalHTML).digest('hex');
  let game = null, address = null;
  const config = () => ({mode, socketURL: mode === 'online' ? 'wss://cs2.duskrain.cn/ws' : game ? `ws://127.0.0.1:${game.port}/ws` : null});
  const server = createServer((req, res) => {
    handle(req, res).catch(() => { if (!res.headersSent) res.writeHead(500); res.end('Local resource error.'); });
  });
  async function handle(req, res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (![ `127.0.0.1:${server.address().port}`, `localhost:${server.address().port}` ].includes(req.headers.host)) { res.writeHead(403); res.end(); return; }
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch { res.writeHead(400); res.end(); return; }
    if (pathname === '/portable-health') {
      res.writeHead(200, {'Content-Type':'application/json', 'Cache-Control':'no-store'});
      res.end(JSON.stringify({ service:'dust2-portable', mode, instance, ready: mode === 'online' || !!game, socketURL: config().socketURL })); return;
    }
    if (pathname === '/' || pathname === '/index.html') {
      if (mode === 'offline' && !game) { res.writeHead(503); res.end('Starting local match server.'); return; }
      const label = mode === 'online' ? '本地客户端 · 在线联机' : '本地客户端 · 离线练习';
      const note = mode === 'online' ? '资源已在本机。创建房间后把房间码发给朋友；好友选择在线联机并输入同一个房间码。' : '离线机器人练习：房间在这台电脑运行。与异地朋友对战请关闭此窗口并使用“在线联机”入口。';
      const html = originalHTML.replace('<head>', `<head><script>globalThis.__DUST2_PORTABLE__=${JSON.stringify(config())};</script>`)
        .replace('<span>在线大厅</span>', `<span>${label}</span>`)
        .replace('创建房间后，将邀请链接发送给朋友即可一起游玩。', note);
      res.writeHead(200, {'Content-Type':TYPES['.html'], 'Cache-Control':'no-store', 'Content-Length':Buffer.byteLength(html)});
      res.end(req.method === 'HEAD' ? undefined : html); return;
    }
    if (pathname.includes('\0') || pathname.includes('\\')) { res.writeHead(400); res.end(); return; }
    const target = path.resolve(dist, '.' + pathname);
    if (!target.startsWith(dist + path.sep)) { res.writeHead(403); res.end(); return; }
    let file, info;
    try { file = await realpath(target); if (!file.startsWith(dist + path.sep)) throw new Error(); info = await stat(file); if (!info.isFile()) throw new Error(); }
    catch { res.writeHead(404); res.end(); return; }
    const headers = {'Content-Type':TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Content-Length':info.size, 'Accept-Ranges':'bytes', 'Cache-Control':path.basename(file) === 'sw.js' || file.endsWith('asset-manifest.json') ? 'no-cache' : 'public, max-age=3600'};
    let start = 0, end = info.size - 1, status = 200;
    if (req.headers.range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
      if (match && (match[1] || match[2])) {
        start = match[1] ? Number(match[1]) : Math.max(0, info.size - Number(match[2]));
        end = match[1] && match[2] ? Math.min(info.size - 1, Number(match[2])) : info.size - 1;
      } else start = -1;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= info.size) { res.writeHead(416, {'Content-Range':`bytes */${info.size}`}); res.end(); return; }
      status = 206; headers['Content-Length'] = end - start + 1; headers['Content-Range'] = `bytes ${start}-${end}/${info.size}`;
    }
    res.writeHead(status, headers);
    if (req.method === 'HEAD' || !info.size) res.end();
    else { const stream = createReadStream(file, {start, end}); stream.on('error', () => res.destroy()); res.on('close', () => stream.destroy()); stream.pipe(res); }
  }
  let bound = false;
  for (let n = 0; n < attempts; n++) {
    try {
      await new Promise((resolve, reject) => {server.once('error', reject); server.listen(port ? port + n : 0, '127.0.0.1', () => {server.off('error', reject); resolve();});});
      bound = true; break;
    } catch (e) {
      if (e.code !== 'EADDRINUSE') throw e;
      try {
        const existing = await fetch(`http://127.0.0.1:${port + n}/portable-health`, {signal:AbortSignal.timeout(700)}).then(r => r.json());
        if (existing.instance === instance && existing.ready) return {url:`http://127.0.0.1:${port + n}/`, mode, reused:true, close:async()=>{}};
      } catch { /* An unrelated service keeps its port. */ }
    }
  }
  if (!bound) throw new Error('本地端口忙，请关闭旧游戏启动窗口后重试。');
  try { if (mode === 'offline') {const {startGameServer} = await import(pathToFileURL(path.join(root, 'server/index.js'))); game = await startGameServer({port:0, host:'127.0.0.1', staticDir:dist});} }
  catch (e) { await new Promise(resolve => server.close(resolve)); throw e; }
  address = `http://127.0.0.1:${server.address().port}/`;
  let closed = false;
  return {url:address, mode, reused:false, close:async()=>{if(closed)return;closed=true;await game?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};
}

function openBrowser(url) {
  // URL is generated from a loopback address and numeric port, never user text.
  const child = spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], {detached:true, stdio:'ignore', windowsHide:true});
  child.on('error', () => console.log('请在 Edge 或 Chrome 中打开上方地址。')); child.unref();
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const mode = process.argv.includes('--offline') ? 'offline' : 'online';
  startPortable({mode}).then(app => {
    console.log(`\nDUST II — ${mode === 'online' ? '在线联机' : '离线机器人'}\n\n${app.url}\n\n${app.reused ? '已打开正在运行的客户端。' : '游戏运行期间请保留此窗口；结束后关闭窗口或按 Ctrl+C。'}\n`);
    if (!process.argv.includes('--no-browser')) openBrowser(app.url);
    if (!app.reused) { const stop = () => app.close().then(()=>process.exit(0)); process.once('SIGINT',stop); process.once('SIGTERM',stop); }
  }).catch(e => { console.error('启动失败：', e.message); process.exitCode = 1; });
}
