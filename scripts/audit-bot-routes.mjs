import fs from 'node:fs';
import {initPhysics} from '../shared/physics.js';
import {GameRoom} from '../server/game.js';
const bytes=fs.readFileSync('public/assets/map/positions.f32');initPhysics(new Float32Array(bytes.buffer,bytes.byteOffset,bytes.byteLength/4));
let seed=19721972;Math.random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
const rows=[],summaries=[];
for(const round of [1,2,3]){
 let now=1000000;const room=new GameRoom('ROUTE'+round,{bots:9,botDifficulty:process.argv[2]||'normal',clock:()=>now});
 room.addHuman({},{name:'Route observer',team:'CT'});for(const p of room.players.values())p.money=16000;room.rules.bombSeconds=500;room.round.number=round-1;room.startRound();room.round.phase='live';room.round.phaseEndsAt=now+115000;
 // Navigation audit isolates path following; combat aim is tested separately.
 room.visibleToBot=()=>false;const stats={lineups:{},ticks:[]};
 for(let tick=0;tick<3300;tick++){
  now+=1000/30;const started=performance.now();room.tick(1/30);stats.ticks.push(performance.now()-started);for(const e of room.events)if(e.type==='bot_utility_validated')stats.lineups[e.lineup]=(stats.lineups[e.lineup]||0)+1;room.events.length=0;
  if(tick%300===299)for(const p of room.players.values())if(p.bot&&p.team==='T')rows.push({round,t:Math.round(tick/30),id:p.id,alive:p.alive,x:+p.x.toFixed(2),y:+p.y.toFixed(2),z:+p.z.toFixed(2),phase:p.botAI.phase,route:p.botAI.routeIndex,goal:p.botAI.goal,path:p.botAI.path[0],utility:p.botAI.utility?.phase,recoveries:p.botAI.recoveries||0});
 }
 stats.ticks.sort((a,b)=>a-b);summaries.push({round,lineups:stats.lineups,utility:room.botUtilityStats,p95Ms:stats.ticks[Math.floor(stats.ticks.length*.95)],maxMs:stats.ticks.at(-1),recoveries:[...room.players.values()].filter(p=>p.bot).map(p=>({id:p.id,count:p.botAI.recoveries}))});
}
const label=process.argv[3]||'current';fs.mkdirSync('artifacts/qa',{recursive:true});fs.writeFileSync(`artifacts/qa/bot-routes-${label}.json`,JSON.stringify(rows,null,2));
fs.writeFileSync(`artifacts/qa/bot-summary-${label}.json`,JSON.stringify(summaries,null,2));console.log(JSON.stringify(summaries,null,2));
