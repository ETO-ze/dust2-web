import test from 'node:test';
import assert from 'node:assert/strict';
import {loadoutRows} from '../client/hud-loadout.js';

test('HUD follows authoritative inventory after purchase, pickup, drop and switch',()=>{
 const p={inventory:['awp','usp','knife'],weapon:'awp',utilityCounts:{flashbang:2,smokegrenade:1},defuseKit:true};
 let rows=loadoutRows(p);assert.deepEqual(rows.map(r=>r.id),['awp','usp','knife','flashbang','smokegrenade','defusekit']);
 assert.deepEqual(rows.filter(r=>r.active).map(r=>r.id),['awp']);assert.equal(rows.find(r=>r.id==='flashbang').count,2);
 p.inventory=['m4a1','usp','knife'];p.weapon='m4a1';rows=loadoutRows(p);assert.equal(rows.some(r=>r.id==='awp'),false);assert.equal(rows[0].active,true);
 p.inventory=['usp','knife'];p.weapon='knife';assert.equal(loadoutRows(p).some(r=>r.slot===1),false);
});
test('C4, kit and depleted utility disappear; unknown IDs never create phantom guns',()=>{
 const p={inventory:['garbage','knife','c4'],weapon:'c4',hasBomb:true,utilityCounts:{flashbang:0,molotov:-2}};
 assert.deepEqual(loadoutRows(p).map(r=>r.id),['knife','c4']);assert.equal(loadoutRows(p).at(-1).active,true);
 p.hasBomb=false;assert.deepEqual(loadoutRows(p).map(r=>r.id),['knife']);assert.deepEqual(loadoutRows({}),[]);
});
