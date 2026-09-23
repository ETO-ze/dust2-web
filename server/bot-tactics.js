import {floorHeight} from '../shared/physics.js';
import {getWeapon} from '../shared/weapons.js';
import {attackPlan,defensePlan,attackLane} from './bot-strategies.js';
import {saveGoal} from './bot-economy.js';
import {patrolHold} from './bot-holding.js';
export {attackPlan} from './bot-strategies.js';
import {MAP} from '../shared/map-data.js';
import {smoothBotAim} from './bot-aim.js';
import {chooseHoldPost} from './bot-posts.js';
import {reportSiteThreat,rotationSite} from './bot-alerts.js';
export {botUtility} from './bot-utility.js';
const point=p=>({x:p.x,y:p.y,z:p.z});
const range=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
const raw={long:{x:40,y:0,z:-31},catwalk:{x:7,y:0,z:-31},short:{x:8,y:2.5,z:-51},mid:{x:-11,y:0,z:-31},doors:{x:-11,y:-1,z:-48},tunnels:{x:-43,y:0,z:-27},bEntry:{x:-42,y:0,z:-53}};
function at(room,id){return point(room.nearestNav(raw[id]||MAP.sites[id])||raw[id]||MAP.sites[id]);}
function team(room,p){return [...room.players.values()].filter(q=>q.alive&&q.team===p.team).sort((a,b)=>a.seat-b.seat);}
function hold(room,p,site,reposition=false){
 const setup=p.team==='T'?attackPlan(room):defensePlan(room),selected=chooseHoldPost(room,p,site,setup.holdOffset||0);
 return reposition?patrolHold(room,p,selected):selected;
}
/** Dust2 defaults: long/short A split or tunnels/mid B split. Information is
 * shared only after a teammate has seen an opponent; it expires after 6 s. */
export function tacticalGoal(room,p){
 const now=room.clock(),ai=p.botAI,b=room.bomb,allies=team(room,p),report=room.teamIntel?.[p.team];
 if(room.round.phase==='ended'){ai.phase='recover';ai.role='recover';return hold(room,p,ai.site||'A');}
 if(ai.utility?.phase==='approach')return point(ai.utility.stand);
 if(b.state==='planted'){
  const saving=saveGoal(room,p);if(saving){ai.role='save';ai.phase='save';ai.watchPoints=[];return saving;}
  ai.site=b.site;ai.phase='postplant';ai.watchPoints=watchPoints(p,b.site);
  if(p.team==='T'){ai.role='postplant';return hold(room,p,b.site,true);}
  const active=allies.find(q=>q.id===b.actorId&&b.action==='defuse');
  const defuser=active||[...allies.filter(q=>q.bot)].sort((a,c)=>Number(c.defuseKit)-Number(a.defuseKit)||range(a,b)-range(c,b))[0];
  ai.role=defuser?.id===p.id?'defuser':'retake-cover';return ai.role==='defuser'?point(b):hold(room,p,b.site);
 }
 if(p.team==='T'){
  if(b.state==='dropped'&&[...allies].sort((a,c)=>range(a,b)-range(c,b))[0]?.id===p.id){ai.role='recover-bomb';return point(b);}
  const humanCarrier=allies.find(q=>!q.bot&&q.hasBomb);
  if(humanCarrier&&humanCarrier.z<0&&(humanCarrier.x<-28||humanCarrier.x>10))room.botAttackSite=humanCarrier.x<0?'B':'A';
  const plan=attackPlan(room);
  if(!plan.committedSite&&now>=plan.decisionAt){
   // Decide once from reports actually observed this round; no hidden positions.
   const seen=[...(room.teamSightings?.T?.values()||[])].filter(v=>now-v.at<6000);
   const a=seen.filter(v=>range(v,MAP.sites.A)<25).length,b=seen.filter(v=>range(v,MAP.sites.B)<25).length;
   plan.committedSite=a>b?'B':b>a?'A':(plan.holdOffset%2?'B':'A');
  }
  let site=room.botAttackSite||plan.committedSite||'A';
  // Keep approach assignments stable when a teammate dies; otherwise survivors
  // can reset their route index and walk back to an already-cleared waypoint.
  const roster=[...room.players.values()].filter(q=>q.team===p.team).sort((a,b)=>a.seat-b.seat);
  const rank=Math.max(0,roster.findIndex(q=>q===p));
  let lane=attackLane(plan,rank,p.hasBomb),diversion=plan.tempo==='fake'&&['long','short'].includes(lane)&&!p.hasBomb&&now<plan.fakeUntil&&!room.botAttackSite;
  if(diversion)site='A';
  const probing=plan.tempo==='default'&&!plan.committedSite&&!room.botAttackSite;
  if(!probing&&!diversion){
   if(site==='A'&&!['long','short'].includes(lane))lane=rank%2?'short':'long';
   if(site==='B'&&!['tunnels','mid'].includes(lane))lane=rank%2?'mid':'tunnels';
  }
  if((ai.routeVariant||0)%2)lane=site==='A'?(lane==='short'?'long':'short'):(lane==='tunnels'?'mid':'tunnels');
  const split=lane==='mid'||site==='A'&&lane==='short'&&plan.id!=='a-short';
  const route=site==='A'?(lane==='short'?['catwalk','short','A']:['long','A']):(lane==='mid'?['mid','doors','B']:['tunnels','bEntry','B']);
  if(probing){ai.role=p.hasBomb?'carrier':'map-control';ai.phase='probe';ai.lane=lane;ai.site=lane==='tunnels'?'B':'A';ai.execute=plan.id;ai.watchPoints=watchPoints(p,ai.site);const support=supportGoal(room,p,allies,report);if(support){ai.phase='support';return support;}return at(room,lane==='short'?'catwalk':lane);}
  const key=room.round.number+':'+route.join('-');
  if(ai.routeKey!==key){ai.routeKey=key;ai.routeIndex=0;}
  const fighters=allies.filter(q=>!q.hasBomb),order=fighters.indexOf(p);
  ai.role=p.hasBomb?'carrier':split?'split':order===0?'entry':order===1?'trade':'utility-support';ai.site=site;ai.lane=lane;ai.execute=plan.id;ai.watchPoints=watchPoints(p,site);ai.phase=diversion?'feint':plan.tempo==='contact'&&now<plan.decisionAt&&!report?'contact':'advance';ai.stagingIndex=route.length-2;
  const support=supportGoal(room,p,allies,report);if(support){ai.phase='support';return support;}
  if(diversion&&ai.routeIndex>=route.length-2&&range(p,at(room,route[ai.routeIndex]))<3){ai.phase='feint';return point(p);}
  while(ai.routeIndex<route.length-1&&range(p,at(room,route[ai.routeIndex]))<3){
   if(ai.routeIndex===route.length-2&&!readyToEnter(room,p,allies,site)){ai.phase='gather';return point(p);}
   ai.routeIndex++;ai.routeFailures=0;
  }
  if(p.hasBomb&&room.siteAt(p))return point(p);
  if(ai.routeIndex===route.length-1&&!p.hasBomb)return hold(room,p,site);
  return at(room,route[ai.routeIndex]);
 }
 const setup=defensePlan(room),roles=setup.roles;
 const roster=[...room.players.values()].filter(q=>q.bot&&q.team===p.team).sort((a,b)=>a.seat-b.seat);
 ai.defenseRole||=(getWeapon(p.weapon).zoomStyle==='scope'?(room.round.number%2?'sniper-a':'sniper-b'):roster.length===1?'rotator':roles[(Math.max(0,roster.findIndex(q=>q.id===p.id))+setup.offset)%Math.max(1,roster.length)]);ai.role=ai.defenseRole;
 ai.site=ai.role.endsWith('-b')?'B':'A';ai.phase='hold';ai.watchPoints=watchPoints(p,ai.site);
 if(ai.role==='mid'){ai.watchPoints=['mid','catwalk','tunnels'].map(id=>{const n=at(room,id);return {...n,y:n.y+1.62};});}
 const support=supportGoal(room,p,allies,report);if(support&&(!ai.role.startsWith('anchor')||range(report,MAP.sites[ai.site])<16)){ai.phase='support';return support;}
 const rotation=rotationSite(room,p);
 if(rotation){ai.site=rotation;ai.watchPoints=watchPoints(p,rotation);ai.phase='rotate';return hold(room,p,rotation,true);}
 if(ai.role==='long'&&now>setup.pressureUntil){ai.phase='fallback';return hold(room,p,'A',true);}
 return ['anchor-b','anchor-a','sniper-a','sniper-b'].includes(ai.role)?hold(room,p,ai.site,true):patrolHold(room,p,at(room,({short:'short',mid:setup.id==='mid-pressure'&&now<setup.pressureUntil?'mid':'doors',rotator:setup.holdOffset%2?'long':'short',long:'long'})[ai.role]));
}
export function shareSighting(room,p,enemy){
 reportSiteThreat(room,p.team,enemy,'contact');
 const report={...point(enemy),at:room.clock(),observer:p.id};
 (room.teamIntel||={})[p.team]=report;const sightings=(room.teamSightings||={})[p.team]||=new Map();sightings.set(enemy.id,report);for(const [id,r]of sightings)if(room.clock()-r.at>12000)sightings.delete(id);
}
function supportGoal(room,p,allies,report){
 if(!report||room.clock()-report.at>1700||report.observer===p.id||p.hasBomb||p.botAI.engaging)return null;
 const contact=allies.find(q=>q.id===report.observer);if(!contact||range(p,contact)<3||range(p,contact)>14)return null;
 const helper=allies.filter(q=>q.bot&&q!==contact&&!q.hasBomb&&!q.botAI.engaging).sort((a,b)=>range(a,contact)-range(b,contact))[0];
 if(helper!==p)return null;
 const dx=contact.x-report.x,dz=contact.z-report.z,d=Math.max(1,Math.hypot(dx,dz));
 const behind={x:contact.x+dx/d*2.3,y:contact.y,z:contact.z+dz/d*2.3};
 return point(room.nearestNav(behind)||behind);
}
export function separateTeammates(room,p,input){
  if(input.interact||p.grenadeState)return;
 for(const fire of room.grenades.fires){for(const cell of fire.cells){const d=range(p,cell);if(d<.05||d>2.2||Math.abs(p.y-cell.y)>1.4)continue;const x=(p.x-cell.x)/d,z=(p.z-cell.z)/d;input.forward=(-Math.sin(input.yaw)*x-Math.cos(input.yaw)*z);input.right=(Math.cos(input.yaw)*x-Math.sin(input.yaw)*z);return;}}
 for(const q of room.players.values()){
  if(q===p||!q.alive||q.team!==p.team||Math.abs(q.y-p.y)>1.5)continue;
  const d=range(p,q);if(d<.05||d>1.25)continue;
  const x=(p.x-q.x)/d,z=(p.z-q.z)/d,strength=(1.25-d)*.75;
  input.forward+=(-Math.sin(input.yaw)*x-Math.cos(input.yaw)*z)*strength;
  input.right+=(Math.cos(input.yaw)*x-Math.sin(input.yaw)*z)*strength;
 }
 input.forward=Math.max(-1,Math.min(1,input.forward));input.right=Math.max(-1,Math.min(1,input.right));
}

function watchPoints(p,site){
 const positions=site==='A'?(p.team==='T'?[[28,3,-68],[35,3,-64],[18,0,-57]]:[[39,1.6,-40],[8,4,-53],[15,2,-59]]):(p.team==='T'?[[-46,2,-69],[-30,3,-66],[-28,1,-56]]:[[-43,1.5,-57],[-30,3,-66],[-28,1,-56]]);
 return positions.map(([x,y,z])=>{const floor=floorHeight(x,z,y+.25,5);return {x,y:floor===null?y:floor+(getWeapon(p.weapon).zoomStyle==='scope'?1.2:1.62),z};});
}
function readyToEnter(room,p,allies,site){
 const now=room.clock(),ai=p.botAI,strategy=attackPlan(room),key=site+':'+(strategy.coordinated?strategy.id:ai.lane);
 const plans=room.botExecutions||=new Map();let plan=plans.get(key);
 if(!plan){plan={at:now,releaseAt:0};plans.set(key,plan);}
 const mates=allies.filter(q=>q!==p&&q.botAI?.lane===ai.lane);
 const near=mates.some(q=>range(q,p)<8),support=mates.find(q=>q.botAI?.utility&&!q.botAI.utility.released||(q.botAI?.utilityFollowupUntil||0)>now);
 const deadline=strategy.tempo==='fast'?1800:strategy.coordinated?6500:4200;
 const otherLanes=allies.filter(q=>q.bot&&q.botAI?.site===site&&q.botAI?.lane!==ai.lane&&q.botAI.phase!=='feint');
 const splitReady=!strategy.coordinated||!otherLanes.length||otherLanes.some(q=>q.botAI.routeIndex>=q.botAI.stagingIndex);
 if(strategy.tempo==='fake'&&site==='B'&&now<strategy.fakeUntil&&allies.some(q=>q.botAI?.phase==='feint'))return false;
 if(!plan.releaseAt&&((near&&splitReady&&!support&&now-plan.at>700)||now-plan.at>deadline))plan.releaseAt=now;
 if(!plan.releaseAt)return false;
 // Entry first, trading partner next, bomb carrier last. A bounded delay never
 // leaves survivors waiting forever for a dead or distant teammate.
 const order=[...allies.filter(q=>q.botAI?.lane===ai.lane)].sort((a,b)=>Number(a.hasBomb)-Number(b.hasBomb)||a.seat-b.seat);
 return now>=plan.releaseAt+Math.max(0,order.indexOf(p))*350;
}

/** Nearby teammates can turn away from their own announced flash. No enemy
 * positions are involved, and the same bounded aim controller is used. */
export function coordinateFlash(room,p,input,dt){
 const ai=p.botAI,now=room.clock();
 if(ai.engaging||ai.utility||input.interact||p.objectiveLocked)return;
 const flasher=[...room.players.values()].find(q=>q!==p&&q.alive&&q.team===p.team&&q.botAI?.lane===ai.lane&&range(p,q)<12&&q.botAI.utility?.weapon==='flashbang'&&['ready','prime','released'].includes(q.botAI.utility.phase));
 const u=flasher?.botAI.utility||(room.botFlashes||[]).find(f=>f.team===p.team&&f.lane===ai.lane&&f.until>now&&range(f.stand,p)<12);
 if(!u||u.releasedAt&&now>u.releasedAt+(u.expected?.seconds||1.5)*1000+300)return;
 const target=u.target,aim=smoothBotAim({yaw:p.yaw,pitch:p.pitch},{yaw:Math.atan2(target.x-p.x,target.z-p.z),pitch:0},dt);
 input.yaw=aim.yaw;input.pitch=aim.pitch;input.forward=input.right=0;input.jump=input.fire=false;ai.action='avoid-team-flash';
}
