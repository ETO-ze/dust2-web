import fs from 'node:fs';
import assert from 'node:assert/strict';
import {GameRoom} from '../server/game.js';
import {MAP} from '../shared/map-data.js';
import {initPhysics,isHullClear,floorHeight} from '../shared/physics.js';
import {eyePosition} from '../shared/aim.js';
import {lookAt} from '../server/bot-perception.js';
initPhysics(JSON.parse(fs.readFileSync('public/assets/map/collision.json','utf8')).positions);
let seed=19291;Math.random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/2**32);
const range=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z),results=[];
const point=n=>({x:n.x,y:n.y,z:n.z});
for(const site of ['A','B']){
 let now=100000;const r=new GameRoom('RADAR',{bots:0,clock:()=>now}),other=site==='A'?'B':'A';
 const safe=site=>r.nav.filter(n=>range(n,MAP.sites[site])<14).map(n=>({...n,y:floorHeight(n.x,n.z,n.y+.45,1.8)})).filter(n=>n.y!==null&&isHullClear({...n,y:n.y+.015}));
 const stands=safe(site);
 let pair;
 for(const a of stands){const b=stands.find(b=>range(a,b)>7&&range(a,b)<12&&r.visibleToBot(eyePosition(a),eyePosition(b)));if(b){pair=[a,b];break;}}
 assert.ok(pair,'visible real-map observer pair '+site);
 const observer=r.makePlayer('human','CT observer','CT',false),enemy=r.makePlayer('attacker','Visible carrier','T',false),bot=r.makePlayer('b_1','Remote anchor','CT',true);
 for(const p of [observer,enemy,bot]){r.players.set(p.id,p);p.protectionUntil=0;p.health=100000;}
 Object.assign(observer,point(pair[0]));Object.assign(enemy,point(pair[1]));enemy.hasBomb=true;
 const remote=safe(other).sort((a,b)=>range(a,MAP.sites[other])-range(b,MAP.sites[other]))[0];
 assert.ok(remote);Object.assign(bot,point(remote));bot.botAI.defenseRole='anchor-'+other.toLowerCase();
 Object.assign(observer,lookAt(eyePosition(observer),eyePosition(enemy)));Object.assign(observer.input,{yaw:observer.yaw,pitch:observer.pitch});
 r.round={number:1,phase:'live',phaseEndsAt:now+120000,liveStartedAt:now};r.bomb={...r.emptyBomb(),state:'carried',carrierId:enemy.id};
 const initial=range(bot,MAP.sites[site]),ticks=[];let firstRotation=null,firstEngagement=null,travel=0,last={...bot},best=initial;
 for(let i=0;i<600;i++){
  now+=1000/30;observer.inputAt=enemy.inputAt=now;
  Object.assign(observer.input,lookAt(eyePosition(observer),eyePosition(enemy)));
  const began=performance.now();r.tick();ticks.push(performance.now()-began);r.events.length=0;
  if(bot.botAI.phase==='rotate'&&firstRotation===null)firstRotation=(now-100000)/1000;
  if(bot.botAI.engaging&&firstEngagement===null)firstEngagement=(now-100000)/1000;
  travel+=range(bot,last);last={...bot};best=Math.min(best,range(bot,MAP.sites[site]));
  if(process.env.DUST_QA_TRACE&&i%60===0)console.log(JSON.stringify({site,t:i/30,pos:point(bot),phase:bot.botAI.phase,action:bot.botAI.action,path:bot.botAI.path.slice(0,2),recoveries:bot.botAI.recoveries}));
 }
 assert.equal(r.bomb.state,'carried');assert.ok(firstRotation!==null&&firstRotation<6,site+': delayed until plant');
 assert.ok(initial-best>10,site+': remote defender failed to leave its post and approach '+JSON.stringify({initial,best,travel,phase:bot.botAI.phase,goal:bot.botAI.goal,pos:point(bot)}));
 assert.ok(firstEngagement===null||firstEngagement>firstRotation,'remote defender saw the enemy before shared intel');
 assert.equal(bot.botAI.phase,'rotate','reinforcement must not turn home during a brief fight');
 ticks.sort((a,b)=>a-b);results.push({site,firstRotationSeconds:+firstRotation.toFixed(2),firstEngagementSeconds:firstEngagement===null?null:+firstEngagement.toFixed(2),distanceReducedMetres:+(initial-best).toFixed(2),travelMetres:+travel.toFixed(2),bomb:r.bomb.state,tickP95Ms:+ticks[Math.floor(ticks.length*.95)].toFixed(2)});
}
fs.mkdirSync('artifacts/team-intel',{recursive:true});fs.writeFileSync('artifacts/team-intel/real-map-rotation.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
