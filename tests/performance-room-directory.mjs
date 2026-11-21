import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {WebSocket} from 'ws';

const repo = fileURLToPath(new URL('../', import.meta.url));
const packs = process.env.PERF_MAP_ROOT || path.join(repo, 'artifacts/performance-maps/maps-v1');
const installed = ['de_mirage','de_dust2'].every(id => existsSync(path.join(packs, id, 'compiled/map.json')));

test('directory follows real map workers and shared graphics rooms', {skip:!installed, timeout:120000}, async t => {
  const gateway = spawn(process.execPath, ['server/performance-maps.js'], {
    cwd:repo, env:{...process.env, PORT:'0', PERF_MAP_ROOT:packs}, stdio:['ignore','pipe','inherit','ipc'], windowsHide:true
  });
  const exited = once(gateway, 'exit'), sockets = new Set();
  t.after(async () => {
    for (const socket of sockets) socket.terminate();
    if (gateway.connected) gateway.disconnect();
    await exited;
  });
  let log = '', origin;
  while (!origin) {
    const [chunk] = await once(gateway.stdout, 'data', {signal:AbortSignal.timeout(20000)});
    log += chunk;
    origin = log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
  }
  async function get(url) {
    const response = await fetch(origin + url, {signal:AbortSignal.timeout(75000)});
    assert.equal(response.status,200,url);
    if (url === '/perf/rooms.json') assert.equal(response.headers.get('cache-control'),'no-store');
    return response.json();
  }
  const directory = () => get('/perf/rooms.json');
  async function waitRooms(expected) {
    const until = Date.now() + 3500;
    do {
      const {rooms} = await directory();
      if (expected(rooms)) return rooms;
      await delay(50);
    } while (Date.now() < until);
    assert.fail('Live roster did not update in time');
  }
  const configs = new Map();
  async function join(base, options, expected = 'welcome') {
    if (!configs.has(base)) configs.set(base, await get(base + 'private-map.json'));
    const config = configs.get(base);
    const socket = new WebSocket(origin.replace('http:', 'ws:') + base + 'ws');
    sockets.add(socket);
    await once(socket,'open',{signal:AbortSignal.timeout(5000)});
    const next = once(socket,'message',{signal:AbortSignal.timeout(5000)});
    socket.send(JSON.stringify({type:'join',mapId:config.id,mapSignature:config.mapSignature,bots:0,room:'SAMECODE',...options}));
    const [data] = await next, reply = JSON.parse(data);
    assert.equal(reply.type,expected,JSON.stringify(reply));
    return {socket,reply};
  }
  async function leave(socket) {
    const closed = once(socket, 'close', {signal:AbortSignal.timeout(5000)});
    socket.close();
    await closed;
    sockets.delete(socket);
  }

  assert.deepEqual(await directory(), {rooms:[]});
  assert.deepEqual((await get('/perf/health')).workers, []);
  const {maps} = await get('/perf/graphics.json');
  const mirage = maps.find(map => map.id === 'de_mirage'), dust = maps.find(map => map.id === 'de_dust2');
  const host = await join(mirage.performanceURL, {name:'<FPS>',mode:'deathmatch',bots:2});
  const guest = await join(mirage.qualityURL || mirage.performanceURL, {name:'Guest',existing:true});
  assert.equal(guest.reply.room, host.reply.room);
  const other = await join(dust.performanceURL, {name:'Second map',mode:'defuse'});
  const rows = await waitRooms(rows => rows.length === 2 && rows.some(row => row.humans === 2));
  const shared = rows.find(row => row.mapId === mirage.id);
  assert.deepEqual(shared, {
    id:'de_mirage:SAMECODE',mapId:'de_mirage',mapName:'Mirage',mapNameZh:'荒漠迷城',qualityAvailable:!!mirage.qualityURL,
    code:'SAMECODE',mode:'deathmatch',humans:2,bots:2,players:['FPS','Guest'],capacity:10,joinable:true,
    full:false,phase:'live',scores:{CT:0,T:0},botDifficulty:'normal'
  });
  assert.deepEqual(rows.find(row => row.id === 'de_dust2:SAMECODE').players,['Second map']);
  await t.test('high quality and high FPS players share one authoritative listing', {skip:!mirage.qualityURL && 'Original quality pack unavailable'}, () => {
    assert.notEqual(mirage.qualityURL, mirage.performanceURL);
    assert.equal(configs.get(mirage.qualityURL).mapSignature, configs.get(mirage.performanceURL).mapSignature);
    assert.equal(rows.filter(row => row.id === shared.id).length,1);
  });

  const seats = [];
  for (let i=2; i<10; i++) seats.push((await join(mirage.performanceURL, {name:'Seat '+i,existing:true})).socket);
  const full = (await waitRooms(rows => rows.some(row => row.full))).find(row => row.id === shared.id);
  assert.equal(full.humans,10);
  assert.equal(full.bots,0);
  assert.equal(full.joinable,false);
  const rejected = await join(mirage.performanceURL, {name:'Extra',existing:true}, 'error');
  assert.equal(rejected.reply.code,'ROOM_UNAVAILABLE');
  await leave(rejected.socket);
  await Promise.all([guest.socket,...seats].map(leave));
  const reopened = (await waitRooms(rows => rows.some(row => row.id === shared.id && row.humans === 1))).find(row => row.id === shared.id);
  assert.deepEqual(reopened.players,['FPS']);
  assert.equal(reopened.joinable,true);
  assert.equal(reopened.bots,2);
  await leave(other.socket);
  await waitRooms(rows => rows.length === 1 && rows[0].id === shared.id);
  const hidden = await join(dust.performanceURL, {name:'Invite only',room:'SECRET',visibility:'private'});
  assert.deepEqual((await directory()).rooms.map(row=>row.id), [shared.id]);
  const invited = await join(dust.performanceURL, {name:'Invited',room:'SECRET',existing:true,visibility:'public'});
  assert.deepEqual((await directory()).rooms.map(row=>row.id), [shared.id]);
  await Promise.all([host.socket,hidden.socket,invited.socket].map(leave));
  await waitRooms(rows => rows.length === 0);
  assert.deepEqual((await get('/perf/health')).workers.map(worker => worker.id).sort(), ['de_dust2','de_mirage']);
  const stale = await join(mirage.performanceURL, {name:'Late',existing:true}, 'error');
  assert.equal(stale.reply.code,'ROOM_GONE');
  await leave(stale.socket);
  assert.deepEqual(await directory(), {rooms:[]});
});
