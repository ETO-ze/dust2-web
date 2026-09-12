import fs from 'node:fs';
import {initPhysics} from '../shared/physics.js';
import {GameRoom} from '../server/game.js';
initPhysics(JSON.parse(fs.readFileSync('public/assets/map/collision.json','utf8')).positions);
let now=1000000,seed=19721972;Math.random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
const room=new GameRoom('TACTIC',{mode:'defuse',bots:9,clock:()=>now});room.addHuman({}, {name:'Observer',team:'CT'});room.ensureBots();
// Inspect a full-buy round so utility decisions are exercised immediately.
for(const p of room.players.values())p.money=16000;room.startRound();const counts={},times=[],roles=new Set();
for(let tick=0;tick<5400;tick++){now+=1000/30;const t=performance.now();room.tick();times.push(performance.now()-t);for(const e of room.events.splice(0))counts[e.type]=(counts[e.type]||0)+1;for(const p of room.players.values())if(p.bot)roles.add(p.botAI.role);}
times.sort((a,b)=>a-b);const proof={seconds:180,counts,roles:[...roles],tickP95:times[Math.floor(times.length*.95)],tickMax:times.at(-1),round:room.round.number,players:[...room.players.values()].map(p=>({team:p.team,bot:p.bot,role:p.botAI.role,x:p.x,y:p.y,z:p.z,kills:p.kills}))};
fs.writeFileSync('artifacts/optional-extras/tactics-soak.json',JSON.stringify(proof,null,2));console.log(JSON.stringify(proof));
if(!counts.shot||!counts.grenade_thrown||!proof.players.every(p=>Number.isFinite(p.x+p.y+p.z)))process.exitCode=1;
