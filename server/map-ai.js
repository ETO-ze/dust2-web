/** Private server-side map rehearsal. Observation is evidence, never a live enemy feed. */
import {MapTacticalGraph} from './map-tactical-graph.js';
import {GrenadeSimulation} from './grenades.js';
import {usefulThrow,teammateRisk} from './bot-trajectory.js';
import {smoothBotAim} from './bot-aim.js';
import {stepPlayer} from '../shared/physics.js';

const pos=p=>({x:p.x,y:p.y,z:p.z});
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
const automated=p=>p.bot&&!p.controllerId&&!p.controlledBy&&p.alive!==false;
const angle=(a,b)=>Math.atan2(Math.sin(a-b),Math.cos(a-b));
const eye=p=>({x:p.x,y:p.y+(p.crouch?.95:1.62),z:p.z});
const facing=(a,b)=>Math.atan2(-(b.x-a.x),-(b.z-a.z));
const releaseState=p=>({...pos(p),vx:p.vx||0,vy:p.vy||0,vz:p.vz||0,crouch:!!p.crouch,grounded:!!p.grounded,height:p.height||(p.crouch?1.1:1.8)});
function sameReleaseState(p,trial){
 const before=trial.releaseState;if(!before||distance(p,before)>.12||before.crouch!==!!p.crouch||before.grounded!==!!p.grounded||Math.abs(before.height-(p.height||(p.crouch?1.1:1.8)))>.02)return false;
 return Math.hypot((p.vx||0)-before.vx,(p.vy||0)-before.vy,(p.vz||0)-before.vz)<=.08;
}
function releaseAligned(p,trial){return Math.hypot(angle(p.yaw||0,trial.input.yaw),(p.pitch||0)-trial.input.pitch)<.003;}

export function visibleFireSolution(observer,enemy,perception){
 const report=perception.observe(observer,enemy);if(!report)return null;
 const from=eye(observer),point=report.point,desired={yaw:facing(from,point),pitch:Math.atan2(point.y-from.y,Math.hypot(point.x-from.x,point.z-from.z))};
 if(Math.hypot(angle(desired.yaw,observer.yaw||0),desired.pitch-(observer.pitch||0))>.035)return null;
 return {point:{...point},enemyId:enemy.id,yaw:observer.yaw,pitch:observer.pitch};
}

export class MapPerception {
 constructor({clock,clearSight=()=>false,smokeBlocked=()=>false,horizontalFov=Math.PI*.8,verticalFov=Math.PI*.6}={}){Object.assign(this,{clock,clearSight,smokeBlocked,horizontalFov,verticalFov});this.reports={T:[],CT:[]};this.serial=0;}
 publish(team,report){if(!this.reports[team])return;const now=this.clock();this.prune();const items=this.reports[team];
  const prior=items.find(r=>r.kind===report.kind&&(report.enemyId?r.enemyId===report.enemyId:distance(r.point,report.point)<4));
  if(prior){Object.assign(prior,report,{at:now,expiresAt:now+report.ttl});return prior;}
  const result={id:++this.serial,...report,firstAt:now,at:now,expiresAt:now+report.ttl};items.push(result);if(items.length>48)items.shift();return result;
 }
 prune(){const now=this.clock();for(const team of ['T','CT'])this.reports[team]=this.reports[team].filter(r=>r.expiresAt>now);}
 gunshot(shooter,players,{suppressed=false}={}){
  const origin=eye(shooter),range=suppressed?22:48,now=this.clock(),heard=[];
  for(const p of players){if(p.alive===false||p.team===shooter.team||!this.reports[p.team])continue;
   const d=distance(eye(p),origin),blocked=!this.clearSight(eye(p),origin),effective=range*(blocked?.58:1);
   if(d>=effective)continue;const strength=Math.max(0,1-d/effective);if(strength<.12)continue;
   // The frozen quantized location conveys an uncertain noise, no target identity.
   const cell=blocked?6:3,point={x:Math.round(origin.x/cell)*cell,y:Math.round(origin.y/2)*2,z:Math.round(origin.z/cell)*cell};
   this.publish(p.team,{kind:'sound',point,confidence:Math.min(.72,.3+strength*.45),uncertainty:cell,listenerId:p.id,ttl:3500,enemyId:null});heard.push(p.id);
  }return {kind:'gunshot',at:now,heardBy:heard};
 }
 observe(observer,enemy){
  if(observer.alive===false||enemy.alive===false||observer.team===enemy.team||this.clock()<(observer.flashBlindUntil||0))return null;
  const from=eye(observer),target={x:enemy.x,y:enemy.y+(enemy.crouch?.72:1.2),z:enemy.z};
  const pitch=Math.atan2(target.y-from.y,Math.hypot(target.x-from.x,target.z-from.z));
  if(distance(from,target)>70||Math.abs(angle(facing(from,target),observer.yaw||0))>this.horizontalFov/2||Math.abs(pitch-(observer.pitch||0))>this.verticalFov/2||!this.clearSight(from,target)||this.smokeBlocked(from,target))return null;
  return this.publish(observer.team,{kind:'visual',point:pos(target),enemyId:enemy.id,confidence:1,uncertainty:.3,listenerId:observer.id,ttl:2200});
 }
 casualty(player){if(this.reports[player.team])this.publish(player.team,{kind:'casualty',point:pos(player),confidence:.6,uncertainty:3,listenerId:player.id,ttl:6000});}
 snapshot(team){this.prune();return(this.reports[team]||[]).map(({ttl,listenerId,...r})=>({...r,point:{...r.point},confidence:r.confidence*Math.max(0,(r.expiresAt-this.clock())/(r.expiresAt-r.at))}));}
}

/** Role ownership excludes real players and taken-over bots. Weak noise rotates
 * one available support player, while the far site's anchor remains assigned. */
export class MapSquadDirector {
 constructor(graph,{clock=()=>0,perception}={}){Object.assign(this,{graph,clock,perception});this.orders=new Map();this.nextReview=0;this.events=[];}
 begin(players,{round=1,site=round%2?'A':'B'}={}){
  this.orders.clear();this.site=site;this.round=round;
  for(const team of ['T','CT']){
   const bots=players.filter(p=>automated(p)&&p.team===team);
   const lanes=team==='T'&&bots.length?this.graph.alternatives(bots[0],this.graph.map.sites[site],3):[];
   bots.forEach((p,i)=>{
    const hold=team==='CT'?(i%2?'B':'A'):site,role=team==='T'?['entry','trade','utility','carrier','flank'][i%5]:i<2?'anchor':'rotator';
    const guard=team==='CT'?this.graph.guards(hold,round,5)[Math.floor(i/2)]:null;
    const goal=guard||this.graph.map.sites[hold];let route=this.graph.route(p,goal),lane=0;
    if(team==='T'&&lanes.length){lane=((round-1)+(role==='flank'&&lanes.length>1?1:0))%lanes.length;const ingress=this.graph.route(p,lanes[lane][0]);if(ingress)route=[...ingress,...lanes[lane].slice(1)];}
    this.orders.set(p.id,{playerId:p.id,team,role,site:hold,home:hold,lane,goal:pos(goal),route:route||[],revision:1,state:route?'advance':'await-valid-route',buddyId:role==='trade'?bots[0]?.id:null});
   });
  }return this.orders;
 }
 update(players){
  for(const [id,o]of this.orders){const p=players.find(p=>p.id===id);if(!p||!automated(p)){this.orders.delete(id);this.events.push({kind:'control-released',playerId:id,t:this.clock()});}}
  if(this.clock()<this.nextReview)return;this.nextReview=this.clock()+900;
  const reports=this.perception.snapshot('CT'),bySite={A:[],B:[]};
  for(const r of reports){const a=distance(r.point,this.graph.map.sites.A),b=distance(r.point,this.graph.map.sites.B);if(Math.min(a,b)<28)bySite[a<b?'A':'B'].push(r);}
  const threat=Object.entries(bySite).map(([site,items])=>({site,items,score:items.reduce((s,r)=>s+r.confidence*(r.kind==='visual'?3:1),0)})).sort((a,b)=>b.score-a.score)[0];
  if(!threat?.items.length)return;
  const soundOnly=threat.items.every(r=>r.kind==='sound');
  if(soundOnly&&threat.items.every(r=>this.clock()-r.firstAt<1800))return;
  const strong=threat.items.filter(r=>r.kind==='visual').length>=2;
  const living=players.filter(p=>p.alive!==false&&p.team==='CT');
  // Actual human positions count as support, never as a fabricated A assignment.
  const near=living.filter(p=>distance(p,this.graph.map.sites[threat.site])<22).length;
  const budget=Math.max(0,(strong?4:3)-near);
  const candidates=living.filter(automated).map(p=>({p,o:this.orders.get(p.id)})).filter(v=>v.o&&v.o.site!==threat.site&&v.o.role==='rotator'&&!(v.o.commitUntil>this.clock()));
  candidates.sort((a,b)=>distance(a.p,this.graph.map.sites[threat.site])-distance(b.p,this.graph.map.sites[threat.site]));
  for(const {p,o}of candidates.slice(0,Math.min(strong?2:1,budget))){const route=this.graph.route(p,this.graph.map.sites[threat.site]);if(!route)continue;Object.assign(o,{site:threat.site,goal:pos(this.graph.map.sites[threat.site]),route,revision:o.revision+1,state:'rotate',commitUntil:this.clock()+7000});this.events.push({kind:'rotation',playerId:p.id,site:threat.site,evidence:soundOnly?'heard-gunfire':'team-contact',t:this.clock()});}
 }
}

/** Move controllers consume exactly the same edge plans validated by the map
 * movement probe. They cannot teleport over a missing or failed connection. */
export class MapRouteFollower {
 constructor(graph,{clock=()=>0,createMovement,stepMovement,stepIdle=(p,dt)=>stepPlayer(p,{yaw:p.yaw,pitch:p.pitch,crouch:p.crouch},dt),edgePlans=new Map()}={}){Object.assign(this,{graph,clock,createMovement,stepMovement,stepIdle,edgePlans});this.states=new Map();this.failures=[];}
 routeAround(p,goal,blocked){const graph=new MapTacticalGraph(this.graph.map,[...this.graph.nodes.values()],{standAllowed:this.graph.standAllowed,edgeAllowed:(a,b)=>this.graph.edgeAllowed(a,b)&&!blocked.has(`${a.id}>${b.id}`)});return graph.route(p,goal);}
 tick(p,order,dt,{hold=false,lookAt=null}={}){
  if(!automated(p)||!order)return null;let s=this.states.get(p.id);
  if(!s||s.revision!==order.revision){s={revision:order.revision,path:order.route,index:0,controller:null,blocked:new Set(),state:order.state,replans:0};this.states.set(p.id,s);}
  const aimAt=target=>{if(!target)return;const from=eye(p);Object.assign(p,smoothBotAim(p,{yaw:facing(from,target),pitch:Math.atan2(target.y-from.y,Math.hypot(target.x-from.x,target.z-from.z))},dt));};
  const idle=state=>{s.state=state;this.stepIdle(p,dt);aimAt(lookAt);return s;};
  if(!s.path.length)return idle('await-valid-route');
  if(hold)return idle('trade-spacing');
  if(s.index>=s.path.length-1)return idle('holding');
  const a=s.path[s.index],b=s.path[s.index+1],key=`${a.id}>${b.id}`,plan=this.edgePlans.get(key);
  if(!s.controller){if(!plan)return idle('await-edge-validation');s.controller=this.createMovement(a,b,plan,p);}
  const result=this.stepMovement(p,s.controller,dt);
  s.state=order.state==='rotate'?'rotating':plan.mode==='walk'?'advancing':'jump-link';
  if(result.done){s.index++;s.controller=null;}
  if(result.failed){s.blocked.add(key);s.replans++;s.path=this.routeAround(p,order.goal,s.blocked)||[];this.failures.push({playerId:p.id,key,at:this.clock(),reason:result.reason||'blocked',replanned:s.path.length>0,replacementNodes:s.path.length});s.index=0;s.controller=null;s.state=s.path.length?'replan':'await-valid-route';}
  const goal=lookAt||s.path[Math.min(s.index+1,s.path.length-1)];if(goal){const from=eye(p),target=lookAt||{...goal,y:goal.y+1.2};const aim=smoothBotAim(p,{yaw:facing(from,target),pitch:Math.atan2(target.y-from.y,Math.hypot(target.x-from.x,target.z-from.z))},dt);p.yaw=aim.yaw;p.pitch=aim.pitch;}
  return s;
 }
}

/** Validate from the real release state with the production throw/bounce/fuse
 * implementation. A source guide alone can never produce a passed result. */
export function validateMapThrow({world,player,weapon,input,target,sourceSha256,physicsSha256,players=[],sight=null}){
 let now=0,result=null;const trajectory=[],events=[];
 const finish=(g,kind)=>{result={kind,point:pos(g),seconds:now/1000,cells:sim.fires[0]?.cells||[]};};
 const sim=new GrenadeSimulation({clock:()=>now,raycastWorld:world.raycastWorld,raycastContact:world.raycastContact,onFlash:g=>finish(g,'flash'),onExplosion:g=>finish(g,'he'),emit:(kind,e)=>{events.push({kind,at:now});if(kind==='smoke')finish(e.origin,'smoke');if(kind==='fire_started')finish(e.origin,'fire');if(kind==='fire_failed')finish(e.origin,'failed');}});
 if(!sourceSha256||!physicsSha256||!sim.throwGrenade(player,weapon,input))return{weapon,passed:false,reason:'missing-source-or-invalid-throw',trajectory};
 for(let tick=1;tick<=360&&!result;tick++){now=tick*1000/30;sim.tick(1/30);if(sim.projectiles[0]&&tick%2===0)trajectory.push(pos(sim.projectiles[0]));}
 const spec={weapon,target,sight},useful=usefulThrow(result,spec,world);
 const projected=players.map(p=>({...p,x:p.x+(p.vx||0)*.5,z:p.z+(p.vz||0)*.5}));
 const risk=useful&&(teammateRisk(world,player,result,players,weapon)||teammateRisk(world,player,result,projected,weapon));
 return{weapon,trajectoryPassed:!!useful,passed:!!useful&&!risk,reason:!useful?'trajectory-missed-or-unresolved':risk?'friendly-risk':'physics-validated',release:pos(player),releaseState:releaseState(player),playerId:player.id,team:player.team,input:{...input},target:pos(target),sight:sight?.map(pos)||null,impact:result?.point||null,result,trajectory,events,validation:{sourceSha256,physicsSha256,passed:!!useful&&!risk,scope:'same-physics-private-probe',releaseTolerance:.12,velocityTolerance:.08}};
}

export class MapUtilityCoordinator {
 constructor({clock=()=>0,world,sourceSha256,physicsSha256}={}){Object.assign(this,{clock,world,sourceSha256,physicsSha256});this.claims=new Map();this.events=[];this.flashPlans=new Map();}
 canPrepareFlash(p,trial,players){
  if(!trial.trajectoryPassed||trial.weapon!=='flashbang')return false;
  const predicted=players.filter(q=>q.team===p.team&&q.alive!==false).map(q=>({...q}));
  for(let i=0;i<Math.ceil(trial.result.seconds*30);i++)for(const q of predicted){if(!automated(q))continue;const target={yaw:facing(eye(q),trial.impact)+Math.PI,pitch:0};Object.assign(q,smoothBotAim(q,target,1/30));stepPlayer(q,{yaw:q.yaw,pitch:q.pitch,crouch:q.crouch},1/30);}
  // This is only a proposed maneuver. It does not mark a trial safe or permit
  // release; actual teammates must turn before flashSafe passes at release.
  return !teammateRisk(this.world,p,trial.result,predicted,'flashbang');
 }
 prepareFlash(p,trial,players){
  if(!automated(p)||trial.weapon!=='flashbang'||!trial.trajectoryPassed||trial.validation?.sourceSha256!==this.sourceSha256||trial.validation?.physicsSha256!==this.physicsSha256||!this.canPrepareFlash(p,trial,players))return null;
  const friends=players.filter(q=>q.team===p.team&&q.alive!==false);
  // No scripted instruction can control a human or a taken-over bot. Such a
  // teammate must already be safe, and is still checked just before release.
  if(teammateRisk(this.world,p,trial.result,friends.filter(q=>!automated(q)),trial.weapon))return null;
  const plan={ownerId:p.id,team:p.team,trial,createdAt:this.clock(),until:this.clock()+5000,releasedAt:null,turns:new Map(friends.filter(automated).map(q=>[q.id,{yaw:facing(eye(q),trial.impact)+Math.PI,pitch:0}]))};
  this.flashPlans.set(p.team,plan);this.events.push({kind:'flash-turn-away-warning',playerId:p.id,at:this.clock()});return plan;
 }
 turnInstruction(p){const plan=this.flashPlans.get(p.team);if(!automated(p)||!plan||plan.until<this.clock()||!plan.turns.has(p.id)||plan.ownerId===p.id&&plan.releasedAt===null)return null;return plan.turns.get(p.id);}
 flashSafe(p,trial,players){
  const plan=this.flashPlans.get(p.team);if(!plan||plan.ownerId!==p.id||plan.trial!==trial||plan.until<this.clock())return false;
  const friends=players.filter(q=>q.team===p.team&&q.alive!==false);
  if(teammateRisk(this.world,p,trial.result,friends.filter(q=>q.id!==p.id),'flashbang'))return false;
  // Rehearse bounded turning plus real neutral movement for the fuse time.
  // The same commands are required by turnInstruction after the real release.
  const predicted=friends.map(q=>({...q}));
  for(let i=0;i<Math.ceil(trial.result.seconds*30);i++)for(const q of predicted){const turn=automated(q)&&plan.turns.get(q.id);if(!turn)continue;Object.assign(q,smoothBotAim(q,turn,1/30));stepPlayer(q,{yaw:q.yaw,pitch:q.pitch,crouch:q.crouch},1/30);}
  return !teammateRisk(this.world,p,trial.result,predicted,'flashbang');
 }
 reserve(p,trial,{players,site,secondsLeft=60}={}){
  const safeFlash=trial.weapon==='flashbang'&&trial.trajectoryPassed&&this.flashSafe(p,trial,players);
  if(!automated(p)||trial.playerId!==p.id||trial.team!==p.team||!trial.passed&&!safeFlash||trial.validation?.sourceSha256!==this.sourceSha256||trial.validation?.physicsSha256!==this.physicsSha256||!sameReleaseState(p,trial)||!releaseAligned(p,trial))return{accepted:false,reason:'invalid-evidence-or-release'};
  if(trial.weapon==='smokegrenade'&&!trial.sight)return{accepted:false,reason:'unvalidated-cover-lane'};
  if(p.hasBomb&&(secondsLeft<35||!players.some(q=>q.id!==p.id&&q.team===p.team&&q.alive!==false&&distance(p,q)<10)))return{accepted:false,reason:'carrier-priority'};
  const key=`${p.team}:${site}:${trial.weapon}`,prior=this.claims.get(key);if(prior&&prior.until>this.clock())return{accepted:false,reason:'already-claimed'};
  if(!safeFlash&&teammateRisk(this.world,p,trial.result,players,trial.weapon))return{accepted:false,reason:'friendly-risk'};
  const cover=this.claims.get(`${p.team}:${site}:smokegrenade`);
  if(trial.weapon==='flashbang'&&(!cover?.releasedAt||this.clock()<cover.readyAt))return{accepted:false,reason:'wait-for-cover'};
  const claim={key,playerId:p.id,team:p.team,site,weapon:trial.weapon,trial,until:this.clock()+6000};this.claims.set(key,claim);return{accepted:true,claim};
 }
 release(p,claim,players,grenades){
  const safeFlash=claim.weapon==='flashbang'&&this.flashSafe(p,claim.trial,players);
  if(this.claims.get(claim.key)!==claim||claim.playerId!==p.id||claim.team!==p.team||claim.until<=this.clock()||!automated(p)||!sameReleaseState(p,claim.trial)||!releaseAligned(p,claim.trial)||!safeFlash&&teammateRisk(this.world,p,claim.trial.result,players,claim.weapon))return false;
  if(!grenades.throwGrenade(p,claim.weapon,claim.trial.input))return false;
  claim.releasedAt=this.clock()||.001;claim.readyAt=this.clock()+claim.trial.result.seconds*1000;claim.until=claim.readyAt+8000;
  if(safeFlash){const plan=this.flashPlans.get(p.team);plan.releasedAt=this.clock();plan.until=claim.readyAt+300;}
  this.events.push({kind:'coordinated-utility',playerId:p.id,weapon:claim.weapon,site:claim.site,at:this.clock(),readyAt:claim.readyAt});return true;
 }
 entryReady(team,site){const items=[...this.claims.values()].filter(c=>c.team===team&&c.site===site&&c.releasedAt&&c.until>this.clock());return items.some(c=>c.weapon==='smokegrenade'&&c.readyAt<=this.clock())&&items.some(c=>c.weapon==='flashbang'&&c.readyAt<=this.clock());}
}
