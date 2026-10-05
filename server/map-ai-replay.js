/** Offline private rehearsal generator. It uses the authoritative movement and
 * grenade implementations, and is deliberately not an online GameRoom. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {BufferGeometry,Float32BufferAttribute,Ray,DoubleSide} from 'three';
import {MeshBVH,CENTER} from 'three-mesh-bvh';
import {initPhysics,createPlayerState,stepPlayer} from '../shared/physics.js';
import {createEdgeController,edgeMovementInput,probeNavEdge} from '../scripts/maps/navigation-movement.mjs';
import {loadPrivatePhysics} from '../scripts/maps/load-private-physics.mjs';
import {MapTacticalGraph} from './map-tactical-graph.js';
import {MapPerception,MapSquadDirector,MapRouteFollower,MapUtilityCoordinator,validateMapThrow,visibleFireSolution} from './map-ai.js';
import {GrenadeSimulation} from './grenades.js';
import {teammateRisk} from './bot-trajectory.js';
import {smoothBotAim} from './bot-aim.js';
import {EQUIPMENT} from '../shared/equipment.js';

const xyz=p=>({x:p.x,y:p.y,z:p.z}),dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
const round=n=>Math.round(n*1000)/1000,compact=p=>({x:round(p.x),y:round(p.y),z:round(p.z)});
const aligned=(p,input)=>Math.hypot(Math.atan2(Math.sin(p.yaw-input.yaw),Math.cos(p.yaw-input.yaw)),p.pitch-input.pitch)<.003;
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));

function collisionWorld(positions){
 const geometry=new BufferGeometry();geometry.setAttribute('position',new Float32BufferAttribute(positions,3));
 const bvh=new MeshBVH(geometry,{strategy:CENTER,targetLeafSize:16,maxDepth:48}),ray=new Ray();
 const hit=(o,d,length)=>{ray.origin.set(o.x,o.y,o.z);ray.direction.set(d.x,d.y,d.z).normalize();const h=bvh.raycastFirst(ray,DoubleSide);return h&&h.distance<=length?h:null;};
 const raycastWorld=(o,d,l)=>hit(o,d,l)?.distance??null;
 const raycastContact=(o,d,l)=>{const h=hit(o,d,l);if(!h)return null;const n=h.face.normal.clone();if(n.dot(ray.direction)>0)n.negate();return{distance:h.distance,normal:xyz(n)};};
 const clearSight=(a,b)=>{const length=dist(a,b);return length<.01||raycastWorld(a,{x:(b.x-a.x)/length,y:(b.y-a.y)/length,z:(b.z-a.z)/length},length-.03)===null;};
 return{positions,raycastWorld,raycastContact,clearSight,dispose:()=>geometry.dispose()};
}

export function generateMapReplay(report,{duration=55,site='A'}={}){
 const dir=report.directory,compiled=path.join(dir,'compiled'),map=read(path.join(compiled,'map.json')),nav=read(path.join(compiled,'nav.json')),auditBytes=fs.readFileSync(path.join(dir,'navigation-audit.json')),audit=JSON.parse(auditBytes);
 if(audit.schemaVersion!==2||audit.sourceSha256!==report.sourceSha256)throw Error('Matching physical navigation audit v2 required');
 const bytes=fs.readFileSync(path.join(compiled,'physics.f32')),mask=fs.readFileSync(path.join(compiled,'physics-mask.u8')),physicsSha256=sha(bytes);
 if(audit.physicsSha256!==physicsSha256||audit.maskSha256!==sha(mask)||audit.navigationSha256!==sha(fs.readFileSync(path.join(compiled,'nav.json'))))throw Error('Navigation evidence does not match collision/NAV');
 const playerPhysics=loadPrivatePhysics(dir,1);if(audit.policySha256!==playerPhysics.policySha256)throw Error('Navigation entity policy mismatch');
 const utilityPhysicsSha256=sha(Buffer.from([physicsSha256,audit.maskSha256,playerPhysics.policySha256].join(':')));
 initPhysics(playerPhysics.positions,null,{mapPatches:false});
 const world=collisionWorld(loadPrivatePhysics(dir,4).positions),vision=collisionWorld(loadPrivatePhysics(dir,2).positions),stands=new Map(audit.standPoints.map(p=>[p.id,p]));
 const nodes=nav.map(a=>({...a,...stands.get(a.id)})),plans=new Map(audit.edgePlans.map(p=>[p.key,p])),allowed=new Set(audit.acceptedEdges);
 const graph=new MapTacticalGraph(map,nodes,{standAllowed:a=>stands.has(a.id),edgeAllowed:(a,b)=>allowed.has(`${a.id}>${b.id}`)});
 let now=0;const clock=()=>now,frames=[],events=[],trials=[],players=[],shotAfter=new Map(),seenAfter=new Map();
 const grenades=new GrenadeSimulation({clock,raycastWorld:world.raycastWorld,raycastContact:world.raycastContact,emit:(kind,e)=>events.push({kind,t:now/1000,...e}),onFlash:g=>{
  const owner=players.find(p=>p.id===g.ownerId),risk=teammateRisk(world,owner,{point:xyz(g),cells:[]},players,'flashbang');
  const config=EQUIPMENT.flashbang,affected=[];
  for(const p of players){if(p.alive===false)continue;const from={x:p.x,y:p.y+(p.crouch?.95:1.62),z:p.z},d=dist(from,g);if(d>=config.radius||!world.clearSight(from,g))continue;
   const direction={x:-Math.sin(p.yaw)*Math.cos(p.pitch),y:Math.sin(p.pitch),z:-Math.cos(p.yaw)*Math.cos(p.pitch)},dot=d<.01?1:(direction.x*(g.x-from.x)+direction.y*(g.y-from.y)+direction.z*(g.z-from.z))/d;
   const exposure=Math.max(0,Math.min(1,(.25+.75*Math.max(0,dot))*(1-d/config.radius))),duration=config.duration*exposure;
   p.flashBlindUntil=Math.max(p.flashBlindUntil||0,now+duration*1000);affected.push({playerId:p.id,team:p.team,exposure,duration});
  }
  events.push({kind:'flash-detonated',t:now/1000,ownerId:g.ownerId,origin:xyz(g),friendlyRisk:risk,affected});
  const trial=trials.findLast(t=>t.playerId===g.ownerId&&t.weapon==='flashbang');if(trial){trial.actualFriendlySafe=!risk;trial.actualImpact=xyz(g);trial.actualDetonatedAt=now/1000;}
 }});
 const perception=new MapPerception({clock,clearSight:vision.clearSight,smokeBlocked:(a,b)=>grenades.blocksSight(a,b)});
 const director=new MapSquadDirector(graph,{clock,perception}),coordinator=new MapUtilityCoordinator({clock,world,sourceSha256:report.sourceSha256,physicsSha256:utilityPhysicsSha256});
 for(const team of ['T','CT']){
  const chosen=[];for(const spawn of map.spawns[team]){if(chosen.some(p=>dist(p,spawn)<.7))continue;chosen.push(spawn);if(chosen.length===5)break;}
  chosen.forEach((spawn,i)=>{const p={...createPlayerState({...spawn,y:spawn.y+.15}),id:`${team}${i+1}`,team,bot:true,alive:true,hasBomb:team==='T'&&i===3,inventory:{},nextShotAt:0};for(let k=0;k<25;k++)stepPlayer(p,{},1/30);players.push(p);});
 }
 director.begin(players,{site,round:1});
 const initialFailures=[],usedGoals=[];
 // Every starting connector is probed from that particular spawn state; the
 // later replay starts there and repeats ordinary inputs, never the probe end.
 for(const p of players){const o=director.orders.get(p.id),sample=audit.routes.find(r=>r.team===p.team&&r.site===o.site&&r.passed);if(!sample){o.route=[];o.state='await-valid-route';continue;}
  const route=o.route.length?o.route:sample.nodes.map(id=>graph.nodes.get(id)),first=route[0],start={...xyz(p),id:-players.indexOf(p)-1,crouch:p.crouch};o.usedFallbackRoute=!o.route.length;
  const probe=probeNavEdge(start,first,{initialState:p});if(!probe.passed){o.route=[];o.state='spawn-link-blocked';initialFailures.push({playerId:p.id,reason:'spawn-link-blocked'});continue;}
  const key=`${start.id}>${first.id}`;plans.set(key,{...probe,key});o.route=[start,...route];o.goal=xyz(route.at(-1));
  const last=route.at(-1),candidates=nodes.filter(n=>stands.has(n.id)&&dist(n,last)>1&&dist(n,last)<6&&Math.abs(n.y-last.y)<1.2&&usedGoals.every(q=>dist(q,n)>1.2)).sort((a,b)=>dist(a,last)-dist(b,last));
  if(!o.usedFallbackRoute){usedGoals.push(last);continue;}
  for(const goal of candidates.slice(0,16)){
   const end={...createPlayerState(sample.final),grounded:true,crouch:!!sample.final.crouch};const connector=probeNavEdge(last,goal,{initialState:end});if(!connector.passed)continue;
   const edgeKey=`${last.id}>${goal.id}`;plans.set(edgeKey,{...connector,key:edgeKey});allowed.add(edgeKey);o.route.push(goal);o.goal=xyz(goal);usedGoals.push(goal);break;
  }
 }
 const follower=new MapRouteFollower(graph,{clock,edgePlans:plans,createMovement:(a,b,plan)=>createEdgeController(a,b,plan),stepMovement:(p,control,dt)=>{
  const input=edgeMovementInput(control,p);if(!input)return{done:true};const yaw=p.yaw,pitch=p.pitch;stepPlayer(p,input,dt);p.yaw=yaw;p.pitch=pitch;
  return{failed:control.ticks>270||control.stalled>45||p.outOfWorld||p.y<Math.min(control.a.y,control.b.y)-1.6,reason:'movement-blocked'};
 }});
 const utilityState=new Map(),patrolAt=new Map(),recoveryCount=new Map();let utilityAttempts=0;
 function tryUtility(p,o,weapon){
  const state=follower.states.get(p.id),route=state?.path||o.route;
  const options=route.slice(state?.index||0).filter(n=>dist(p,n)>8&&dist(p,n)<(weapon==='flashbang'?26:18)).filter((_,i)=>i%(weapon==='flashbang'?2:4)===0).slice(0,weapon==='flashbang'?7:4).map(n=>weapon==='flashbang'?{...n,y:n.y+2}:n);
  const attempts=[];
  for(const target of options)for(const pitch of [-.35,-.15,0,.15,.3,.5])for(const strength of [.2,.35,.5,.65,.8,1]){
   // The intended cover point is a future exposed route cell, not necessarily
   // visible from the thrower around a corner. Pin a defender-to-entry ray.
   const sight=weapon==='smokegrenade'?[{...o.goal,y:o.goal.y+1.4},{...target,y:target.y+1.4}]:null;
   const trial=validateMapThrow({world,player:p,weapon,input:{yaw:Math.atan2(-(target.x-p.x),-(target.z-p.z)),pitch,throwStrength:strength},target,sourceSha256:report.sourceSha256,physicsSha256:utilityPhysicsSha256,players,sight});utilityAttempts++;
   attempts.push(trial);if(weapon==='flashbang'?coordinator.canPrepareFlash(p,trial,players):trial.passed){trials.push({...trial,at:now/1000,playerId:p.id,purpose:weapon==='smokegrenade'?'cover-entry-sightline':'flash-entry-lane',professionalLineupValidated:false});return trial;}
  }
  const last=attempts.at(-1)||{weapon,passed:false,reason:'no-nearby-validated-route-target',trajectory:[]};trials.push({...last,at:now/1000,playerId:p.id,attempts:attempts.length});return null;
 }
 for(let tick=0;tick<=duration*30;tick++){
  now=tick*1000/30;director.update(players);
  for(const p of players){
   const o=director.orders.get(p.id);if(!o)continue;
   const visible=players.filter(e=>e.team!==p.team).map(e=>({enemy:e,report:perception.observe(p,e)})).filter(r=>r.report).sort((a,b)=>dist(p,a.enemy)-dist(p,b.enemy))[0];
   const report=visible?.report||perception.snapshot(p.team).sort((a,b)=>b.at-a.at)[0],lookAt=report?.point;
   const buddy=o.buddyId&&players.find(q=>q.id===o.buddyId),state=follower.states.get(p.id);
   let hold=!!buddy&&(dist(p,buddy)<1.8||dist(p,buddy)>5&&state?.index>follower.states.get(buddy.id)?.index);
   const utility=utilityState.get(p.id);
   if(p.team==='T'&&o.role==='utility'&&!visible&&dist(p,o.goal)<30&&dist(p,o.goal)>12&&!utility&&Math.hypot(p.vx,p.vz)<.04){
    const trial=tryUtility(p,o,'smokegrenade');utilityState.set(p.id,{phase:trial?'ready':'unavailable',trial,at:now});
   }
   if(p.team==='T'&&o.role==='utility'&&dist(p,o.goal)<30&&dist(p,o.goal)>12&&!utilityState.has(p.id))hold=true;
   const u=utilityState.get(p.id);
   if(visible&&u&&['ready','flash-ready'].includes(u.phase)){u.phase='cancelled-contact';coordinator.flashPlans.delete(p.team);events.push({kind:'utility-cancelled',playerId:p.id,reason:'visible-contact',t:now/1000});}
   if(u?.phase==='ready'){
    hold=true;const want={yaw:u.trial.input.yaw,pitch:u.trial.input.pitch},aim=smoothBotAim(p,want,1/30);p.yaw=aim.yaw;p.pitch=aim.pitch;
    if(aligned(p,u.trial.input)){const claim=coordinator.reserve(p,u.trial,{players,site:o.site,secondsLeft:duration-now/1000});if(claim.accepted&&coordinator.release(p,claim.claim,players,grenades)){u.phase='smoke-flight';u.readyAt=claim.claim.readyAt;}else{u.phase='unavailable';events.push({kind:'utility-cancelled',playerId:p.id,reason:claim.reason,t:now/1000});}}
   }else if(u?.phase==='smoke-flight'){
    hold=true;if(now>u.readyAt+100){const trial=tryUtility(p,o,'flashbang');u.trial=trial;u.phase=trial&&coordinator.prepareFlash(p,trial,players)?'flash-ready':'completed-without-flash';u.flashWaitAt=now;}
   }else if(u?.phase==='flash-ready'){
    hold=true;const aim=smoothBotAim(p,u.trial.input,1/30);p.yaw=aim.yaw;p.pitch=aim.pitch;
    if(aligned(p,u.trial.input)&&now-u.flashWaitAt>750){const claim=coordinator.reserve(p,u.trial,{players,site:o.site,secondsLeft:duration-now/1000});if(claim.accepted&&coordinator.release(p,claim.claim,players,grenades))u.phase='done';else if(now-u.flashWaitAt>2300){u.phase='completed-without-flash';coordinator.flashPlans.delete(p.team);events.push({kind:'utility-cancelled',playerId:p.id,reason:claim.reason,t:now/1000});}}
   }
   const squadUtility=players.find(q=>q.team===p.team&&director.orders.get(q.id)?.role==='utility'),su=squadUtility&&utilityState.get(squadUtility.id);
   if(['entry','trade'].includes(o.role)&&su&&['ready','smoke-flight','flash-ready'].includes(su.phase)&&dist(p,squadUtility)<12&&now-su.at<7000)hold=true;
   const turn=coordinator.turnInstruction(p);if(turn){hold=true;Object.assign(p,smoothBotAim(p,turn,1/30));}
   const next=follower.tick(p,o,1/30,{hold,lookAt:turn||['ready','flash-ready'].includes(u?.phase)?null:visible?.report.point||lookAt});
   if(next?.state==='await-valid-route'&&next.replans>0&&(recoveryCount.get(p.id)||0)<2&&dist(p,o.goal)<8){
    recoveryCount.set(p.id,(recoveryCount.get(p.id)||0)+1);const start={...xyz(p),id:-1000-players.indexOf(p),crouch:p.crouch},goal=graph.nearest(o.goal),proof=goal&&probeNavEdge(start,goal,{initialState:p});
    if(proof?.passed){const key=`${start.id}>${goal.id}`;plans.set(key,{...proof,key});o.route=[start,goal];o.revision++;events.push({kind:'route-recovered',playerId:p.id,t:now/1000});}
   }
   // A stationary anchor checks a physically validated short edge and comes
   // back later; no direct line or invisible target is used as a movement goal.
   if(next?.state==='holding'&&p.team==='CT'&&!visible&&now>(patrolAt.get(p.id)||0)){
    patrolAt.set(p.id,now+5000);const from=graph.nearest(p),candidate=from?.neighbors.map(id=>graph.nodes.get(id)).find(n=>n&&stands.has(n.id)&&dist(p,n)>1&&dist(p,n)<5);
    if(candidate){const proof=probeNavEdge(from,candidate,{initialState:p});if(proof.passed){const key=`${from.id}>${candidate.id}`;allowed.add(key);plans.set(key,{...proof,key});o.route=[from,candidate];o.revision++;o.goal=xyz(candidate);events.push({kind:'anchor-reposition',playerId:p.id,t:now/1000});}}
   }
   if(visible&&!seenAfter.has(p.id)){seenAfter.set(p.id,now);events.push({kind:'first-visual-contact',playerId:p.id,t:now/1000});}
   if(!turn&&visible&&now>=(shotAfter.get(p.id)||0)&&now-(seenAfter.get(p.id)||0)>300&&visibleFireSolution(p,visible.enemy,perception)){
    shotAfter.set(p.id,now+160);const heard=perception.gunshot(p,players);events.push({kind:'gunshot',shooterId:p.id,t:now/1000,heardBy:heard.heardBy,flashBlindUntil:p.flashBlindUntil||0,direction:{yaw:p.yaw,pitch:p.pitch}});
   }
  }
  grenades.tick(1/30);
  if(tick%6===0){const pending=[...events.filter(e=>e.t>=now/1000-.2),...director.events.filter(e=>e.t>=now-200).map(e=>({...e,t:e.t/1000})),...coordinator.events.filter(e=>e.at>=now-200).map(e=>({...e,t:e.at/1000}))];frames.push({t:round(now/1000),players:players.map(p=>{const o=director.orders.get(p.id),s=follower.states.get(p.id);return{id:p.id,team:p.team,role:o?.role,...compact(p),yaw:round(p.yaw),pitch:round(p.pitch),flashBlindUntil:p.flashBlindUntil||0,state:s?.state||o?.state,site:o?.site,route:(s?.path||o?.route||[]).slice(s?.index||0).map(compact),utilityState:utilityState.get(p.id)?.phase||null};}),radar:{T:perception.snapshot('T'),CT:perception.snapshot('CT')},events:pending,grenades:grenades.snapshot()});}
 }
 const result={schemaVersion:1,map:map.id,sourceSha256:report.sourceSha256,physicsSha256,utilityPhysicsSha256,maskSha256:sha(mask),policySha256:playerPhysics.policySha256,navigationSha256:audit.navigationSha256,auditSha256:sha(auditBytes),kind:'server-physics-replay',public:false,liveMatchValidated:false,stepHz:30,snapshotHz:5,duration,
  scope:'Private movement/perception/utility rehearsal; no damage/economy/full match or player-body collision acceptance',limitations:['Source 2 visual parity and P60 not accepted','Procedural utility probes are not verified professional lineups','Gunfire is an observation exercise without damage or score'],
  summary:{players:players.length,spawnConnectorsPassed:players.length-initialFailures.length,spawnConnectorFailures:initialFailures,shots:events.filter(e=>e.kind==='gunshot').length,heardShots:events.filter(e=>e.kind==='gunshot'&&e.heardBy?.length).length,visualContacts:events.filter(e=>e.kind==='first-visual-contact').length,rotations:director.events.filter(e=>e.kind==='rotation').length,anchorRepositions:events.filter(e=>e.kind==='anchor-reposition').length,routeFailures:follower.failures.length,utilityAttempts,utilityTrialsPassed:trials.filter(t=>t.passed||t.actualFriendlySafe===true).length,utilityReleased:coordinator.events.filter(e=>e.kind==='coordinated-utility').length,utilityEffects:events.filter(e=>['smoke','fire_started','flash-detonated'].includes(e.kind)).length,friendlyFlashIncidents:events.filter(e=>e.kind==='flash-detonated'&&e.friendlyRisk).length,routeRecoveries:events.filter(e=>e.kind==='route-recovered').length,routeReplans:follower.failures.filter(e=>e.replanned).length,blindGunshots:events.filter(e=>e.kind==='gunshot'&&e.t*1000<e.flashBlindUntil).length,attackLanes:new Set([...director.orders.values()].filter(o=>o.team==='T').map(o=>o.lane)).size,distinctAttackRoutes:new Set([...director.orders.values()].filter(o=>o.team==='T').map(o=>o.route.map(n=>n.id).filter(id=>id>0).join(','))).size,utilityStates:Object.fromEntries([...utilityState].map(([id,u])=>[id,u.phase])),pathEnds:players.map(p=>({id:p.id,state:follower.states.get(p.id)?.state||'no-route',position:compact(p)}))},frames,utilityTrials:trials,failures:follower.failures};
 world.dispose();vision.dispose();return result;
}

if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1'))){
 const root=process.env.DUSTII_MAP_LIBRARY||'E:/CodexBuilds/dust2-map-library',selected=process.argv.slice(2),reports=read(path.join(root,'exports.json'));
 for(const report of reports.filter(r=>selected.length?selected.includes(r.id):['de_dust2','de_mirage','de_inferno'].includes(r.id))){const result=generateMapReplay(report),target=path.join(report.directory,'ai-replay.json'),temporary=target+'.tmp';fs.writeFileSync(temporary,JSON.stringify(result));fs.renameSync(temporary,target);console.log(JSON.stringify({map:report.id,frames:result.frames.length,summary:{...result.summary,utilityStates:undefined,pathEnds:undefined}}));}
}
