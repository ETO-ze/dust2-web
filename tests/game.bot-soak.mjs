import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { initPhysics } from '../shared/physics.js';
import { GameRoom } from '../server/game.js';

test('bots navigate Dust2 for two simulated minutes and engage visible opponents', { timeout: 30000 }, async () => {
  initPhysics(JSON.parse(await readFile(new URL('../public/assets/map/collision.json', import.meta.url), 'utf8')).positions);
  const originalRandom = Math.random;
  let seed = 19721972;
  Math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  try {
    let now = 1000000;
    const room = new GameRoom('BOTQA1', { mode: 'deathmatch', bots: 8, clock: () => now });
    room.addHuman({}, { name: 'Observer', team: 'T' });
    const start = performance.now(), counts = { shots: 0, hits: 0, kills: 0, spawns: 0 };
    for (let tick = 0; tick < 3600; tick++) {
      now += 1000 / 30; room.tick(1 / 30);
      for (const event of room.events.splice(0)) {
        if (event.type === 'shot') counts.shots++;
        if (event.type === 'hit') counts.hits++;
        if (event.type === 'kill') counts.kills++;
        if (event.type === 'spawn') counts.spawns++;
      }
    }
    console.log(`120s bot simulation in ${Math.round(performance.now() - start)}ms: ${JSON.stringify(counts)}`);
    assert.ok(counts.shots > 10, 'AI should find a line of sight and shoot');
    assert.ok(counts.hits > 0, 'AI should be capable of hitting a visible opponent');
    assert.ok(counts.kills > 0, 'AI encounters should complete a kill/respawn loop');
    assert.ok([...room.players.values()].every(p => Number.isFinite(p.x + p.y + p.z)), 'Physics state stays finite');
  } finally { Math.random = originalRandom; }
});
