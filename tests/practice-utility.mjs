import test from 'node:test';
import assert from 'node:assert/strict';
import { BoxGeometry } from 'three';
import { initPhysics } from '../shared/physics.js';
import { GameRoom } from '../server/game.js';
import { isUtilityMode, isSandboxMode } from '../shared/match-rules.js';
import { sanitizePracticeName, serializePracticeExport, parsePracticeImport, practiceExportFilename } from '../shared/practice-throws.js';
import { loadBuiltInPracticePacks } from '../shared/practice-packs.js';
import { bumpPracticeDummyHud, practiceDummyHudSnapshot, startPracticeThrowTape, samplePracticeThrowTape, finalizePracticeThrowTape, capturePracticeThrow, stepPracticeReplay } from '../server/practice-utility.js';

function flat() {
  const g = new BoxGeometry(500, 1, 500).toNonIndexed();
  g.translate(0, -0.5, 0);
  initPhysics(g.attributes.position.array);
  g.dispose();
}

test('utility mode is sandbox and practice-capable', () => {
  assert.equal(isUtilityMode('utility'), true);
  assert.equal(isSandboxMode('utility'), true);
  assert.equal(sanitizePracticeName(' mid flash '), 'mid-flash');
  assert.equal(practiceExportFilename(20), 'practice-20.json');
  assert.equal(practiceExportFilename(3, { packId: 'Seed' }), 'seed-3.json');
});

test('built-in seed pack loads into utility rooms', () => {
  flat();
  const packs = loadBuiltInPracticePacks({ force: true });
  assert.ok(packs.some((p) => p.id === 'seed'));
  const seed = packs.find((p) => p.id === 'seed');
  assert.ok(seed.throws.length >= 20);
  const room = new GameRoom('UTIL0', { mode: 'utility', bots: 0 });
  assert.ok(room.practice.throws.has('T方中门烟1'));
  assert.equal(room.practice.throws.get('T方中门烟1').packId, 'seed');
  const listed = room.handleChatCommand(room.addHuman({}, { team: 'T', name: 'Coach' }), { name: 'list', args: 'seed' });
  assert.equal(listed.clientCommand, 'practice_list');
  assert.match(listed.reply, /T方中门烟1/);
  const all = room.handleChatCommand([...room.players.values()][0], { name: 'list', args: 'all' });
  assert.equal(all.clientCommand, 'practice_list');
  assert.match(all.args, /#7ec8e3|#e8b86d|#9ddea3|#d4a5ff|#f09595|#a8c5ff|#f0d878|#8fd4c8/);
});

test('practice record / remake / out and dummy set', () => {
  flat();
  const room = new GameRoom('UTIL1', { mode: 'utility', bots: 0 });
  const human = room.addHuman({}, { team: 'T', name: 'Coach' });
  Object.assign(human, { x: 1, y: 0, z: 2, yaw: 0.5, pitch: -0.1, grounded: true });

  const set = room.handleChatCommand(human, { name: 'set', args: 'CT' });
  assert.match(set.reply, /假人/);
  const dummy = [...room.players.values()].find((p) => p.practiceDummy);
  assert.ok(dummy);
  assert.equal(dummy.team, 'CT');
  assert.equal(dummy.holdPoint.x, 1);

  // Stand behind dummy looking along -Z so crosshair hits the body, then /remove.
  Object.assign(dummy, { x: 1, y: 0, z: 2 });
  Object.assign(human, { x: 1, y: 0, z: 5, yaw: 0, pitch: 0 });
  const removed = room.handleChatCommand(human, { name: 'remove', args: '' });
  assert.match(removed.reply, /已移除/);
  assert.equal([...room.players.values()].some((p) => p.practiceDummy), false);

  room.handleChatCommand(human, { name: 'set', args: 'CT' });
  const dummy2 = [...room.players.values()].find((p) => p.practiceDummy);
  assert.ok(dummy2);

  room.practice.lastByPlayer.set(human.id, {
    name: null,
    weapon: 'flashbang',
    team: 'T',
    stand: { x: 1, y: 0, z: 2 },
    yaw: 0.5,
    pitch: -0.1,
    throwMode: 'full',
    throwStrength: 1,
    jumpThrow: false,
    crouch: false,
    velocity: { x: 0, y: 0, z: 0 },
    impacts: [],
    recordedAt: room.clock(),
  });

  const rec = room.handleChatCommand(human, { name: 'record', args: 'mid-flash' });
  assert.match(rec.reply, /已记录/);
  assert.equal(room.practice.throws.get('mid-flash').packId, 'session');
  const renamed = room.handleChatCommand(human, { name: 'remake', args: 'mid-flash mid-pop' });
  assert.match(renamed.reply, /改名/);
  const out = room.handleChatCommand(human, { name: 'out', args: 'mid-pop' });
  assert.equal(out.clientCommand, 'practice_export');
  const payload = JSON.parse(out.args);
  assert.equal(payload.throws[0].name, 'mid-pop');
  assert.equal(payload.throws[0].weapon, 'flashbang');

  const exported = serializePracticeExport(payload.throws, { room: 'UTIL1' });
  assert.equal(exported.type, 'dust2-practice-throws');
  assert.equal(exported.count, 1);

  const dup = room.handleChatCommand(human, { name: 'record', args: 'mid-pop' });
  assert.match(dup.reply, /已存在|改名|覆盖/);
  assert.equal(dup.clientCommand, 'practice_toast');
});

test('practice JSON import can restore exported throws for /show', () => {
  flat();
  const room = new GameRoom('UTIL5', { mode: 'utility', bots: 0 });
  const human = room.addHuman({}, { team: 'T', name: 'Coach' });
  const sample = {
    type: 'dust2-practice-throws',
    version: 1,
    throws: [{
      name: '自定义烟点',
      weapon: 'smokegrenade',
      team: 'T',
      stand: { x: -12, y: 4, z: 26 },
      yaw: -0.05,
      pitch: 0.3,
      throwMode: 'full',
      throwStrength: 1,
      jumpThrow: true,
      crouch: false,
      velocity: { x: 0, y: 5.2, z: 0 },
      impacts: [],
      recordedAt: 1,
    }],
  };
  const parsed = parsePracticeImport(sample);
  assert.equal(parsed.ok, true);
  const imported = room.importPractice(human.id, { throws: parsed.throws, packId: 'custom' });
  assert.equal(imported.ok, true);
  assert.equal(imported.added, 1);
  assert.equal(room.practice.throws.get('自定义烟点').packId, 'custom');
  const again = room.importPractice(human.id, { throws: parsed.throws, packId: 'custom' });
  assert.equal(again.ok, false);
  assert.equal(again.skipped, 1);
  const forced = room.importPractice(human.id, { throws: parsed.throws, force: true, packId: 'custom' });
  assert.equal(forced.ok, true);
  assert.equal(forced.replaced, 1);
  const pick = room.handleChatCommand(human, { name: 'in', args: '' });
  assert.equal(pick.clientCommand, 'practice_import_pick');
  const cleared = room.handleChatCommand(human, { name: 'clear', args: 'all' });
  assert.match(cleared.reply, /内置/);
  assert.ok(room.practice.throws.has('T方中门烟1'));
  assert.equal(room.practice.throws.has('自定义烟点'), false);
});

test('region commands rejected outside debug', () => {
  flat();
  const room = new GameRoom('UTIL2', { mode: 'utility', bots: 0 });
  const human = room.addHuman({}, { team: 'T' });
  const result = room.handleChatCommand(human, { name: 'region', args: '' });
  assert.match(result.reply, /调试模式/);
});

test('utility practice kit has four infinite nades and no guns', () => {
  flat();
  const room = new GameRoom('UTIL4', { mode: 'utility', bots: 0 });
  const human = room.addHuman({}, { team: 'T', name: 'Coach' });
  assert.ok(human.inventory.hegrenade?.ammo > 0);
  assert.ok(human.inventory.flashbang?.ammo > 0);
  assert.ok(human.inventory.smokegrenade?.ammo > 0);
  assert.ok(human.inventory.molotov?.ammo > 0);
  assert.equal(human.weapon, 'hegrenade');
  assert.equal(human.slot, 4);
  assert.equal(!!human.inventory.knife, false);
  assert.equal(!!human.inventory.ak47, false);
  assert.equal(!!human.inventory.pistol, false);
  const buy = room.buyStatus(human);
  assert.equal(buy.buyAllowed, false);
});

test('/fly toggles flight through walls', () => {
  flat();
  const room = new GameRoom('UTIL3', { mode: 'utility', bots: 0 });
  const human = room.addHuman({}, { team: 'T' });
  const on = room.handleChatCommand(human, { name: 'fly', args: '' });
  assert.match(on.reply, /fly on/);
  assert.equal(human.noclip, true);
  assert.equal(human.fly, true);
  const off = room.handleChatCommand(human, { name: 'fly', args: '' });
  assert.match(off.reply, /fly off/);
  assert.equal(human.noclip, false);
  assert.equal(human.fly, false);
});

test('/fly works the same in debug mode', () => {
  flat();
  const room = new GameRoom('DBG1', { mode: 'debug', bots: 0 });
  const human = room.addHuman({}, { team: 'CT' });
  const on = room.handleChatCommand(human, { name: 'fly', args: '' });
  assert.match(on.reply, /fly on/);
  assert.equal(human.noclip, true);
  assert.equal(human.fly, true);
  const old = room.handleChatCommand(human, { name: 'noclip', args: '' });
  assert.match(old.reply, /\/fly/);
  assert.equal(human.noclip, true);
  assert.equal(human.fly, true);
});

test('debug uses /rlist /rshow separate from utility /list /show', () => {
  flat();
  const debug = new GameRoom('DBG2', { mode: 'debug', bots: 0 });
  const d = debug.addHuman({}, { team: 'CT' });
  const legacy = debug.handleChatCommand(d, { name: 'list', args: '' });
  assert.match(legacy.reply, /rlist/);
  const rlist = debug.handleChatCommand(d, { name: 'rlist', args: '' });
  assert.equal(rlist.clientCommand, 'region_list');
  const rshow = debug.handleChatCommand(d, { name: 'rshow', args: 'temp' });
  assert.equal(rshow.clientCommand, 'region_show');

  const util = new GameRoom('UTIL8', { mode: 'utility', bots: 0 });
  const u = util.addHuman({}, { team: 'T' });
  const practiceList = util.handleChatCommand(u, { name: 'list', args: '' });
  assert.notEqual(practiceList.clientCommand, 'region_list');
  assert.match(practiceList.reply, /道具包|暂无/);
});

test('/help lists mode commands with purposes', () => {
  flat();
  const util = new GameRoom('UTIL9', { mode: 'utility', bots: 0 });
  const u = util.addHuman({}, { team: 'T' });
  const uh = util.handleChatCommand(u, { name: 'help', args: '' });
  assert.equal(uh.clientCommand, 'mode_help');
  assert.match(uh.reply, /\/set T\|CT/);
  assert.match(uh.reply, /\/record/);
  assert.match(uh.reply, /practice-\{条数\}/);

  const debug = new GameRoom('DBG3', { mode: 'debug', bots: 0 });
  const d = debug.addHuman({}, { team: 'CT' });
  const dh = debug.handleChatCommand(d, { name: 'help', args: '' });
  assert.equal(dh.clientCommand, 'mode_help');
  assert.match(dh.reply, /\/rlist/);
  assert.match(dh.reply, /\/rshow temp/);
  assert.match(dh.reply, /map-callouts\.json/);
});

test('practice throw tape records press-to-release and /show replays it', () => {
  flat();
  const room = new GameRoom('UTIL10', { mode: 'utility', bots: 0 });
  const human = room.addHuman({}, { team: 'T', name: 'Coach' });
  Object.assign(human, { x: 0, y: 0, z: 0, yaw: 0.2, pitch: -0.1, grounded: true, vx: 0, vy: 0, vz: 0 });
  human.inventory.smokegrenade = { ammo: 99, reserve: 0 };
  human.weapon = 'smokegrenade';
  human.slot = 4;

  startPracticeThrowTape(room, human, { forward: 1, walk: true, fire: true, yaw: 0.2, pitch: -0.1, jumpId: 0 });
  Object.assign(human, { x: 0.4, z: 0.1, vx: 1.2 });
  samplePracticeThrowTape(room, human, { forward: 1, walk: true, fire: true, yaw: 0.2, pitch: -0.05, jumpId: 0 });
  // Simulate time passing for distinct frame timestamps.
  const started = human.practiceTape.startedAt;
  human.practiceTape.startedAt = started - 120;
  Object.assign(human, { x: 0.8, y: 0.2, z: 0.2, vy: 4.5, grounded: false });
  samplePracticeThrowTape(room, human, { forward: 0, jump: true, fire: true, fire2: true, yaw: 0.21, pitch: -0.04, jumpId: 3 });
  const tape = finalizePracticeThrowTape(human);
  assert.ok(tape);
  assert.ok(tape.frames.length >= 2);
  assert.equal(tape.frames[0].walk, true);
  assert.equal(tape.frames.at(-1).jump, true);

  capturePracticeThrow(room, human, {
    weapon: 'smokegrenade',
    stand: { x: 0.8, y: 0.2, z: 0.2 },
    yaw: 0.21,
    pitch: -0.04,
    throwMode: 'lob',
    throwStrength: 0.65,
    jumpThrow: true,
    crouch: false,
    vx: 1.2,
    vy: 4.5,
    vz: 0,
    tape,
  });
  const last = room.practice.lastByPlayer.get(human.id);
  assert.ok(last.tape?.frames?.length >= 2);
  room.practice.throws.set('walk-jump-lob', { ...last, name: 'walk-jump-lob' });

  const show = room.handleChatCommand(human, { name: 'show', args: 'walk-jump-lob' });
  assert.match(show.reply, /回放蓄力过程/);
  assert.ok(human.practiceReplay);
  assert.equal(human.practiceReplay.thrown, false);
  // Advance past tape duration to force throw.
  human.practiceReplay.startedAt = room.clock() - human.practiceReplay.durationMs - 10;
  const phase = stepPracticeReplay(room, human);
  assert.equal(phase, 'observe');
  assert.equal(human.practiceReplay.thrown, true);
  assert.ok(room.grenades.projectiles.some((g) => g.ownerId === human.id));
});

test('utility mode refills player HP instead of dying', () => {
  flat();
  const room = new GameRoom('UTIL6', { mode: 'utility', bots: 0 });
  const human = room.addHuman({}, { team: 'T', name: 'Coach' });
  human.health = 20;
  room.damagePlayer(human, null, 50, 'hegrenade');
  assert.equal(human.alive, true);
  assert.equal(human.health, 100);
});

test('practice dummy hud refreshes on each new utility hit', () => {
  flat();
  const room = new GameRoom('UTIL7', { mode: 'utility', bots: 0 });
  const human = room.addHuman({}, { team: 'T', name: 'Coach' });
  Object.assign(human, { x: 0, y: 0, z: 0 });
  room.handleChatCommand(human, { name: 'set', args: 'CT' });
  const dummy = [...room.players.values()].find((p) => p.practiceDummy);
  assert.ok(dummy);
  room.damagePlayer(dummy, human, 40, 'hegrenade');
  room.damagePlayer(dummy, human, 12, 'molotov', false, 1, true);
  bumpPracticeDummyHud(dummy, { type: 'flash', exposure: 0.8, duration: 2.5 });
  let hud = practiceDummyHudSnapshot(dummy);
  // HE is armor-reduced (~20 from 40); fire bypasses armor like burn ticks.
  assert.ok(hud.he >= 15);
  assert.ok(hud.fire >= 10);
  assert.equal(hud.flashPct, 80);
  assert.equal(hud.flashSec, 2.5);
  // Weaker follow-up flash must replace, not keep the historical max.
  bumpPracticeDummyHud(dummy, { type: 'flash', exposure: 0.35, duration: 0.8 });
  hud = practiceDummyHudSnapshot(dummy);
  assert.equal(hud.flashPct, 35);
  assert.equal(hud.flashSec, 0.8);
  const snap = room.snapshot({ drainEvents: false }).players.find((p) => p.id === dummy.id);
  assert.equal(snap.practiceDummy, true);
  assert.ok(snap.practiceHud);
  assert.equal(snap.practiceHud.flashPct, 35);
});
