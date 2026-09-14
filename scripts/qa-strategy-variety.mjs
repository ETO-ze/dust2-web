import fs from 'node:fs';
import assert from 'node:assert/strict';
import {initPhysics} from '../shared/physics.js';
import {GameRoom} from '../server/game.js';
import {ATTACK_STRATEGIES} from '../server/bot-strategies.js';
initPhysics(JSON.parse(fs.readFileSync('public/assets/map/collision.json','utf8')).positions);
let seed=281991;Math.random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/2**32);
const results=[];
for(const strategy of ATTACK_STRATEGIES){
  let now=1000000;
  const room=new GameRoom('VARIETY',{mode:'defuse',bots:9,botDifficulty:'hard',clock:()=>now});
  room.addHuman({}, {name:'QA observer',team:'CT'});room.ensureBots();
  for(const p of room.players.values())p.money=16000;
  room.startRound();room.round.phase='live';room.round.liveStartedAt=now;room.round.phaseEndsAt=now+120000;
  room.attackPlan={...strategy,round:room.round.number,coordinated:true,startAt:now,offset:0,holdOffset:1,decisionAt:now+12000,fakeUntil:now+24000,committedSite:strategy.site};
  const metrics=new Map([...room.players.values()].filter(p=>p.bot&&p.team==='T').map(p=>[p.id,{id:p.id,travel:0,lanes:new Set(),phases:new Set(),cells:new Set(),last:{x:p.x,z:p.z}}]));
  const events={},times=[];let seconds=0;
  for(let tick=0;tick<2700;tick++){
    now+=1000/30;const began=performance.now();room.tick();times.push(performance.now()-began);seconds=(tick+1)/30;
    for(const e of room.events.splice(0))events[e.type]=(events[e.type]||0)+1;
    if(tick%30===0)for(const [id,m]of metrics){const p=room.players.get(id);assert.ok(Number.isFinite(p.x+p.y+p.z));if(!p.alive)continue;m.travel+=Math.hypot(p.x-m.last.x,p.z-m.last.z);m.last={x:p.x,z:p.z};m.lanes.add(p.botAI.lane);m.phases.add(p.botAI.phase);m.cells.add(`${Math.round(p.x/5)},${Math.round(p.z/5)}`);}
    if(room.round.phase==='ended')break;
  }
  times.sort((a,b)=>a-b);
  const players=[...metrics.values()].map(m=>({id:m.id,travel:Math.round(m.travel),lanes:[...m.lanes],phases:[...m.phases],cells:m.cells.size}));
  assert.ok(players.every(p=>p.travel>10),`${strategy.id}: opening stalled`);
  assert.ok(events.shot,`${strategy.id}: no encounter`);
  results.push({strategy:strategy.id,seconds,events,tickP95:times[Math.floor(times.length*.95)],players});
}
fs.mkdirSync('artifacts/qa',{recursive:true});fs.writeFileSync('artifacts/qa/strategy-variety.json',JSON.stringify(results,null,2));
console.log(JSON.stringify(results.map(r=>({strategy:r.strategy,seconds:r.seconds,shots:r.events.shot,throws:r.events.grenade_thrown||0,tickP95:r.tickP95,travel:r.players.map(p=>p.travel)}))));
