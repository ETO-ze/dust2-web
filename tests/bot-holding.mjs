import test from 'node:test';import assert from 'node:assert/strict';
import {patrolHold,sniperHolding} from '../server/bot-holding.js';import {beginAimDuel,visibleAimPoint} from '../server/bot-perception.js';
test('holding waits then moves to a visible nearby angle, without moving the goal every think',()=>{
 let now=10000;const base={x:0,y:0,z:0},p={...base,id:'b_1',team:'CT',weapon:'m4a1',botAI:{role:'anchor-a',watchPoints:[{x:0,y:1.62,z:-20}]}};const room={clock:()=>now,round:{number:1},nav:[{x:3,y:0,z:0},{x:-3,y:0,z:0}],players:new Map([[p.id,p]]),visibleToBot:()=>true,planPath:(_,n)=>[n]};
 assert.deepEqual(patrolHold(room,p,base),base);now+=10000;const moved=patrolHold(room,p,base);assert.ok(Math.abs(moved.x)===3);now+=100;assert.deepEqual(patrolHold(room,p,base),moved);assert.equal(p.botAI.holdMoves,1);
});
test('sniper scopes an actually visible lane before contact, settles, and unscopes after firing',()=>{
 let now=100000;const room={clock:()=>now,visibleToBot:()=>true};const p={x:0,y:0,z:0,weapon:'awp',grounded:true,vx:0,vz:0,zoomLevel:0,botAI:{}};
 const watch={x:0,y:1.2,z:-55},input={fire:true};sniperHolding(room,p,input,watch,true);assert.equal(input.zoomLevel,2);assert.equal(input.fire,false);p.zoomLevel=2;input.fire=true;sniperHolding(room,p,input,watch,true);assert.equal(input.fire,true);p.botAI.lastSniperShotAt=now;sniperHolding(room,p,input,watch,true);assert.equal(input.zoomLevel,0);assert.equal(input.fire,false);
});
test('head intention varies by difficulty/weapon and cannot bypass cover or force a hit result',()=>{
 const enemy={id:'e',x:0,y:0,z:-20};const p={x:0,y:0,z:0,weapon:'ak47',botAI:{}};const room={aimRandom:()=>.5,botDifficulty:'normal',visibleToBot:()=>true};beginAimDuel(room,p,enemy);assert.equal(p.botAI.headIntent,false);room.botDifficulty='hard';beginAimDuel(room,p,enemy);assert.equal(p.botAI.headIntent,true);assert.equal(visibleAimPoint(room,p,enemy).y,1.62);room.visibleToBot=(_,to)=>to.y<1.5;assert.ok(visibleAimPoint(room,p,enemy).y<1.5);p.weapon='awp';beginAimDuel(room,p,enemy);assert.equal(p.botAI.headIntent,false);room.visibleToBot=()=>false;assert.equal(visibleAimPoint(room,p,enemy),null);
});
