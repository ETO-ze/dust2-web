import test from 'node:test';
import assert from 'node:assert/strict';
import { describeDeath } from '../client/death-screen.js';

const self = { id: 'me', team: 'T', alive: false, deaths: 1, respawnIn: 2.8 };
const opponent = { id: 'other', name: '对手', team: 'CT', alive: true };
const teammate = { id: 'friend', name: '队友', team: 'T', alive: true };
const snapshot = { room: 'TEST', mode: 'deathmatch', players: [self, opponent, teammate], round: { phase: 'live', timeLeft: 80 } };
const event = { type: 'kill', victimId: 'me', killerId: 'other', killerName: '对手', weapon: 'awp', headshot: true };

test('death card counts down from authoritative respawn time and never invents a respawn', () => {
  const initial = describeDeath(snapshot, self, { event, elapsed: 0.5 });
  assert.equal(initial.killerName, '对手'); assert.equal(initial.weaponName, 'AWP'); assert.equal(initial.headshot, true);
  assert.equal(initial.clock, '3'); assert.equal(initial.statusTitle, '自动重生');
  const late = describeDeath(snapshot, self, { event, elapsed: 8 });
  assert.equal(late.visible, true); assert.equal(late.clock, '…'); assert.equal(late.statusTitle, '正在重生');
  assert.equal(describeDeath(snapshot, { ...self, alive: true }, { event }).visible, false);
});

test('explosion/environmental deaths never fall back to a Glock label', () => {
  const state = describeDeath(snapshot, self, { event: { ...event, killerId: null, killerName: '环境', weapon: 'world', headshot: false } });
  assert.equal(state.killerName, '环境'); assert.equal(state.weaponName, '环境伤害'); assert.equal(state.headshot, false);
  assert.equal(describeDeath(snapshot, self, { event: { ...event, weapon: 'bomb' } }).weaponName, 'C4 爆炸');
});

test('missing or unrelated kill does not identify an invented killer', () => {
  const state = describeDeath(snapshot, self, { event: { ...event, victimId: 'someone-else' } });
  assert.equal(state.hasKill, false); assert.equal(state.killerName, '你已阵亡'); assert.equal(state.weaponName, '');
  const disconnected = describeDeath({ ...snapshot, players: [self] }, self, { event });
  assert.equal(disconnected.killerName, '对手');
});

test('defuse waits for the round, reports teammates and only describes allied living spectators', () => {
  const match = { ...snapshot, mode: 'defuse' };
  const state = describeDeath(match, self, { event, spectating: teammate });
  assert.equal(state.clock, ''); assert.equal(state.statusTitle, '正在观战 队友'); assert.equal(state.teamAlive, 1);
  assert.equal(describeDeath(match, self, { spectating: opponent }).observedName, '');
  assert.equal(describeDeath(match, self, { spectating: { ...teammate, alive: false } }).observedName, '');
  const ended = describeDeath({ ...match, round: { phase: 'ended', winner: 'CT', timeLeft: 4.6 } }, self, { elapsed: 1.8 });
  assert.equal(ended.clock, '3'); assert.equal(ended.statusTitle, '下一回合即将开始'); assert.equal(ended.statusDetail, '防守方 CT 获胜');
});
