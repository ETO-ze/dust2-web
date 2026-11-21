import test from 'node:test';
import assert from 'node:assert/strict';
import {directoryJoinPath, consumeDirectoryJoin, mountRoomDirectory} from '../scripts/maps/mode-ui/room-directory.js';

const room = {mapId:'de_mirage', mapNameZh:'荒漠迷城', code:'ABCD', mode:'deathmatch',
  humans:1, bots:9, players:['<img onerror=alert(1)>'], joinable:true, capacity:10, qualityAvailable:true};

test('cross-map links preserve the graphics preference and only start the chosen existing room once', () => {
  for (const [graphics, qualityAvailable, prefix] of [
    ['quality', true, '/perf/quality/'], ['performance', true, '/perf/'], ['quality', false, '/perf/'],
  ]) {
    const url = new URL(directoryJoinPath({...room, qualityAvailable}, graphics), 'https://game.test');
    assert.equal(url.pathname, prefix + 'play/de_mirage/');
    const changes = [], replace = value => changes.push(value.href);
    assert.deepEqual(consumeDirectoryJoin(url, replace), {code:'ABCD', mode:'deathmatch'});
    assert.equal(changes.length, 1);
    assert.equal(url.search, '?room=ABCD');
    assert.equal(consumeDirectoryJoin(url, replace), null);
    assert.equal(changes.length, 1);
  }
  assert.equal(directoryJoinPath({...room, mapId:'../maps'}, 'quality'), null);
  assert.equal(directoryJoinPath({...room, code:'A&B'}, 'quality'), null);
});

class Element extends EventTarget {
  constructor(tag) { super(); this.tag = tag; this.children = []; this.attributes = {}; this.dataset = {}; }
  append(...items) { this.children.push(...items); }
  replaceChildren(...items) { this.children = items; }
  setAttribute(key, value) { this.attributes[key] = value; }
}

function browser(t) {
  const document = new EventTarget(), window = new EventTarget();
  document.createElement = tag => new Element(tag);
  const requests = [], timers = new Map();
  let timer = 0;
  t.mock.method(globalThis, 'setTimeout', (callback, ms) => {
    timers.set(++timer, {callback, ms});
    return timer;
  });
  t.mock.method(globalThis, 'clearTimeout', id => timers.delete(id));
  t.mock.method(globalThis, 'fetch', (path, options) => new Promise(resolve => requests.push({
    path, options, respond:data => resolve({ok:true, json:async () => data}), fail:() => resolve({ok:false}),
  })));
  const previous = Object.fromEntries(['window', 'document'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  Object.assign(globalThis, {document, window});
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value) Object.defineProperty(globalThis, key, value);
      else delete globalThis[key];
    }
  });
  return {requests, document, window, timers, section:new Element('section')};
}
const flush = () => new Promise(resolve => setImmediate(resolve));

test('all human rooms show map, mode, names, replaceable bot seats and map-specific joins', async t => {
  const {section, requests} = browser(t);
  let graphics = 'quality';
  const directory = mountRoomDirectory(section, {graphics:() => graphics,
    lastSession:() => ({mapId:'de_nuke', room:room.code})});
  assert.equal(requests[0].path, '/perf/rooms.json');
  assert.equal(requests[0].options.cache, 'no-store');
  requests[0].respond({rooms:[
    room, {...room, mapId:'de_nuke', mapNameZh:'核子危机', qualityAvailable:false},
    {...room, code:'FULL', humans:5, capacity:5, bots:5, joinable:false}, {...room, humans:0},
  ]});
  await flush();
  const [, status, list] = section.children;
  assert.equal(status.textContent, '3 个房间 · 7 名玩家在线');
  const [mirage,nuke,full] = list.children;
  assert.match(mirage.children[0].children[0].textContent, /荒漠迷城 · 团队死斗/);
  assert.match(mirage.children[0].children[1].textContent, /9 名人机 · 可加入 9 人/);
  assert.equal(mirage.children[0].children[2].textContent, '在线玩家　' + room.players[0]);
  assert.match(mirage.children[1].href, /^\/perf\/quality\//);
  assert.equal(nuke.children[1].textContent, '重新加入 · 高帧率');
  assert.match(nuke.children[1].href, /^\/perf\/play\/de_nuke\//);
  assert.equal(full.children[1].tag, 'span');
  assert.equal(full.children[1].textContent, '已满员');
  graphics = 'performance';
  directory.render();
  assert.match(list.children[0].children[1].href, /^\/perf\/play\//);
  directory.dispose();
});

test('visible polling expires, aborts on hide and disposal, ignores stale data and resumes after BFCache', async t => {
  const {section, requests, document, window, timers} = browser(t);
  const directory = mountRoomDirectory(section, {graphics:() => 'performance'});
  const [,status,list] = section.children;
  directory.refresh();
  assert.equal(requests.length, 1);
  document.hidden = true;
  document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(requests[0].options.signal.aborted, true);
  assert.equal(timers.size, 0);
  document.hidden = false;
  document.dispatchEvent(new Event('visibilitychange'));
  requests[1].respond({rooms:[], partial:true});
  await flush();
  assert.match(status.textContent, /部分地图暂未响应/);
  requests[0].respond({rooms:[room]});
  await flush();
  assert.equal(list.children.length, 0);
  directory.refresh();
  requests[2].fail();
  await flush();
  assert.match(status.textContent, /暂时无法获取/);
  const [timerId, next] = [...timers].find(([,value]) => value.ms === 5000);
  timers.delete(timerId);
  next.callback();
  requests[3].respond({rooms:[]});
  await flush();
  assert.match(status.textContent, /均无玩家在线/);
  window.dispatchEvent(new Event('pagehide'));
  assert.equal(timers.size, 0);
  window.dispatchEvent(new Event('pageshow'));
  assert.equal(requests.length, 5);
  directory.dispose();
  assert.equal(requests[4].options.signal.aborted, true);
  document.dispatchEvent(new Event('visibilitychange'));
  window.dispatchEvent(new Event('pageshow'));
  assert.equal(requests.length, 5);
  assert.equal(timers.size, 0);
});
