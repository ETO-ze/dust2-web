import test from 'node:test';
import assert from 'node:assert/strict';
import {ATTACK_STRATEGIES,attackPlan,defensePlan} from '../server/bot-strategies.js';
import {tacticalGoal,shareSighting} from '../server/bot-tactics.js';
function fixture(){let now=100000,seed=19271;const players=Array.from({length:10},(_,seat)=>({id:'p'+seat,seat:seat%5,bot:true,alive:true,team:seat<5?'T':'CT',hasBomb:seat===2,x:0,y:0,z:20,inventory:{ak47:{ammo:30}},botAI:{}}));
 const room={code:'TEST',botDifficulty:'hard',strategyRandom:()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/2**32),clock:()=>now,round:{number:1,phase:'live'},bomb:{state:'carried'},players:new Map(players.map(p=>[p.id,p])),nearestNav:p=>p,siteAt:()=>null};
 return {room,players,advance:ms=>now+=ms};}
test('attack and defense selection avoids the previous two calls, varies roles, and retains bounded history',()=>{
 const {room,players}=fixture(),attacks=[],defenses=[],roles=new Set();for(let i=0;i<60;i++){
  room.round.number=i+1;const a=attackPlan(room),d=defensePlan(room);assert.ok(!attacks.slice(-2).includes(a.id));assert.ok(!defenses.slice(-2).includes(d.id));attacks.push(a.id);defenses.push(d.id);
  players.forEach(p=>p.botAI={});players.filter(p=>p.team==='CT').forEach(p=>{tacticalGoal(room,p);roles.add(p.id+':'+p.botAI.role)});
 }
 assert.equal(new Set(attacks).size,8);assert.equal(new Set(defenses).size,4);assert.ok(roles.size>12);assert.ok(room.strategyHistory.length<=6);assert.ok(room.defenseHistory.length<=4);
});
test('every tactical family produces finite goals and stable assignments after a teammate dies',()=>{
 for(const strategy of ATTACK_STRATEGIES){const {room,players}=fixture();room.attackPlan={...strategy,round:1,offset:0,holdOffset:0,committedSite:strategy.site,decisionAt:110000,fakeUntil:125000};
  const ts=players.slice(0,5);for(const p of ts){const goal=tacticalGoal(room,p);assert.ok(Number.isFinite(goal.x+goal.y+goal.z),strategy.id);}
  const lanes=ts.map(p=>p.botAI.lane);ts[0].alive=false;ts.slice(1).forEach((p,i)=>{tacticalGoal(room,p);assert.equal(p.botAI.lane,lanes[i+1],strategy.id);});
 }
});
test('default reacts only to fresh observed contacts and commits to a route instead of oscillating',()=>{
 const {room,players,advance}=fixture();room.attackPlan={...ATTACK_STRATEGIES.find(p=>p.id==='map-default'),round:1,offset:0,holdOffset:0,decisionAt:101000};
 shareSighting(room,players[0],{id:'seen-A',x:30,y:3,z:-66});advance(1001);tacticalGoal(room,players[1]);assert.equal(room.attackPlan.committedSite,'B');
 shareSighting(room,players[0],{id:'seen-B',x:-40,y:1,z:-68});tacticalGoal(room,players[1]);assert.equal(room.attackPlan.committedSite,'B');
});
test('the A diversion has a deadline and rejoins B without taking the bomb to the fake',()=>{
 const {room,players,advance}=fixture();room.attackPlan={...ATTACK_STRATEGIES.find(p=>p.id==='fake-a-b'),round:1,offset:0,holdOffset:0,committedSite:'B',fakeUntil:121000};
 players.slice(0,5).forEach(p=>tacticalGoal(room,p));assert.equal(players[2].botAI.site,'B');assert.equal(players[3].botAI.phase,'feint');assert.equal(players[4].botAI.site,'A');
 advance(21001);players.slice(0,5).forEach(p=>tacticalGoal(room,p));assert.ok(players.slice(0,5).every(p=>p.botAI.site==='B'));assert.ok(players.slice(0,5).every(p=>['tunnels','mid'].includes(p.botAI.lane)));
});
