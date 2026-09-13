import fs from 'node:fs';import {initPhysics} from '../shared/physics.js';import {GameRoom} from '../server/game.js';import {BOT_LINEUPS} from '../server/bot-lineups.js';import {usefulThrow} from '../server/bot-trajectory.js';
initPhysics(JSON.parse(fs.readFileSync('public/assets/map/collision.json','utf8')).positions);
fs.mkdirSync('artifacts/bot-rework',{recursive:true});
const reports=[];
for(const initial of [19721972,731,2048]){
 let now=1000000,seed=initial;Math.random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 const room=new GameRoom('TACTIC',{mode:'defuse',bots:9,clock:()=>now});room.addHuman({}, {name:'Observer',team:'CT'});for(const p of room.players.values())p.money=16000;room.startRound();
 const counts={},times=[],actions=new Set(),validated=new Map(),throws=new Map(),outcomes=[];
 for(let tick=0;tick<7200;tick++){now+=1000/30;const start=performance.now();room.tick();times.push(performance.now()-start);for(const p of room.players.values())if(p.bot)actions.add(p.botAI.action);
 for(const e of room.events.splice(0)){
  counts[e.type]=(counts[e.type]||0)+1;
  if(e.type==='bot_utility_validated')validated.set(e.playerId,e);
  if(e.type==='grenade_thrown'){const v=validated.get(e.shooterId);if(v){throws.set(e.grenadeId,v);validated.delete(e.shooterId);}}
  if(['smoke','explosion','flash','fire_started','fire_failed'].includes(e.type)&&throws.has(e.grenadeId)){
   const v=throws.get(e.grenadeId),spec=BOT_LINEUPS.find(s=>s.id===v.lineup),result={kind:({smoke:'smoke',explosion:'he',flash:'flash',fire_started:'fire',fire_failed:'failed'})[e.type],point:e.origin,cells:room.grenades.fires.find(f=>f.id===e.grenadeId)?.cells||[]};
   outcomes.push({lineup:v.lineup,angleError:v.angleError,predictionError:Math.hypot(e.origin.x-v.predicted.x,e.origin.y-v.predicted.y,e.origin.z-v.predicted.z),useful:usefulThrow(result,spec,room.grenades)});throws.delete(e.grenadeId);
  }
 }
 }
 times.sort((a,b)=>a-b);const report={seed:initial,seconds:240,counts,actions:[...actions],tickP95:times[Math.floor(times.length*.95)],tickMax:times.at(-1),utilityStats:room.botUtilityStats,outcomes,finite:[...room.players.values()].every(p=>Number.isFinite(p.x+p.y+p.z))};reports.push(report);console.log(JSON.stringify(report));
}
fs.writeFileSync('artifacts/bot-rework/soak.json',JSON.stringify(reports,null,2));
if(reports.some(r=>!r.finite||!r.counts.shot)||!reports.some(r=>r.outcomes.length)||reports.some(r=>r.outcomes.some(o=>!o.useful||o.predictionError>.6)))process.exitCode=1;
