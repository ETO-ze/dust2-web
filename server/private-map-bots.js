import {MapPerception,MapSquadDirector} from './map-ai.js';
import {MapTacticalGraph} from './map-tactical-graph.js';
import {createEdgeController,edgeMovementInput,probeNavEdge} from '../scripts/maps/navigation-movement.mjs';
import {smoothBotAim,BOT_AIM,angleDifference} from './bot-aim.js';
import {effectiveBotSkill} from './bot-adaptation.js';
import {beginAimDuel,visibleAimPoint,lookAt} from './bot-perception.js';
import {combatSlot} from './bot-utility.js';
import {createThrowProbe,usefulThrow,teammateRisk} from './bot-trajectory.js';
import {eyePosition} from '../shared/aim.js';
import {getWeapon} from '../shared/weapons.js';
import {selectPrivateRoute} from './private-map-navigation.js';
import {createJumpLinkController,jumpLinkInput} from '../shared/private-map-jump-links.js';
import {raycastWorldHit} from '../shared/physics.js';

const point=p=>({x:p.x,y:p.y,z:p.z}),distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
const automated=p=>p.bot&&!p.controllerId&&!p.controlledBy&&p.alive;
const neutral=p=>({yaw:p.yaw||0,pitch:p.pitch||0,forward:0,right:0,fire:false,fire2:false,jump:false,crouch:p.crouch,interact:false,reload:false,slot:combatSlot(p),zoomLevel:0});

/** Adapter produces only ordinary GameRoom inputs. It never applies damage,
 * teleports a character, advances physics, grants equipment or ends a round. */
export class PrivateMapBots {
 constructor(room,{graph,plans,world}){
  Object.assign(this,{room,graph,plans,world});this.states=new Map();this.roundKey=null;this.reviewAt=0;this.utilityOwner=null;
  this.perception=new MapPerception({clock:room.clock,clearSight:world.clearSight,smokeBlocked:(a,b)=>room.grenades.blocksSight(a,b)});
  this.director=new MapSquadDirector(graph,{clock:room.clock,perception:this.perception});
  this.stats={shots:0,hits:0,kills:0,plants:0,defuses:0,throws:0,routeFailures:0,utilityRejected:0,alternateRoutes:0,jumpLinksStarted:0,jumpLinksCompleted:0};
 }
 onEvent(type,fields){
  if(type==='shot'){const shooter=this.room.players.get(fields.shooterId);if(shooter&&fields.weapon!=='knife'){this.perception.gunshot(shooter,[...this.room.players.values()],{suppressed:['usp','m4a1'].includes(shooter.weapon)});this.stats.shots++;}}
  if(type==='kill'){const victim=this.room.players.get(fields.victimId);if(victim)this.perception.casualty(victim);this.stats.kills++;}
  for(const [event,key]of [['hit','hits'],['bomb_planted','plants'],['bomb_defused','defuses'],['grenade_thrown','throws']])if(type===event)this.stats[key]++;
 }
 refresh(){
  const room=this.room,now=room.clock(),players=[...room.players.values()];
  const key=room.round.number+':'+players.filter(p=>p.bot).map(p=>`${p.id}:${p.team}:${p.lifeId}:${p.controllerId||''}`).join(',');
  if(key!==this.roundKey){this.roundKey=key;this.states.clear();this.utilityOwner=null;this.perception.reports={T:[],CT:[]};this.director.begin(players,{round:room.round.number||1});}
  if(now<this.reviewAt)return;this.reviewAt=now+200;
  if(this.utilityOwner&&!automated(room.players.get(this.utilityOwner)||{}))this.utilityOwner=null;
  for(const observer of players.filter(p=>p.alive))for(const enemy of players.filter(p=>p.alive&&p.team!==observer.team&&now>=(p.protectionUntil||0)))this.perception.observe(observer,enemy);
  this.director.update(players);
 }
 state(p){
  let s=this.states.get(p.id);if(!s){s={revision:0,index:0,path:[],controller:null,blocked:new Set(),target:null,reactionAt:0,alignedFor:0,thinkAt:0,patrolAt:0,utilityAfter:this.room.clock()+9000+(p.seat||0)*600};this.states.set(p.id,s);}return s;
 }
 route(p,s,goal,preferred=null){
  const graph=s.blocked.size?new MapTacticalGraph(this.graph.map,[...this.graph.nodes.values()],{standAllowed:this.graph.standAllowed,edgeAllowed:(a,b)=>this.graph.edgeAllowed(a,b)&&!s.blocked.has(`${a.id}>${b.id}`)}):this.graph;
  const order=this.director.orders.get(p.id),urgent=this.room.bomb.state==='planted'&&this.room.bomb.explodesAt-this.room.clock()<15000;
  const choice=selectPrivateRoute(graph,p,goal,{preferred,teammates:[...this.room.players.values()].filter(q=>q.team===p.team&&q.id!==p.id),reports:this.perception.snapshot(p.team),round:this.room.round.number,seat:p.seat||0,role:order?.role,urgent}),path=choice.path;
  s.routeVariant=choice.variant;s.routeReason=choice.reason;if(choice.variant>0)this.stats.alternateRoutes++;
  s.goal=point(goal);s.path=path||[];s.index=0;s.controller=null;s.jumpControl=null;s.jumpExit=false;s.breakingSince=0;s.retryAt=this.room.clock()+2500;
  if(!path?.length)return;
  if(distance(p,path[0])>.22){
   const start={...point(p),id:`start-${p.id}`,crouch:p.crouch};
   const probe=probeNavEdge(start,path[0],{initialState:p,maxTicks:150});
   if(!probe.passed){s.path=[];this.stats.routeFailures++;return;}
   s.connector={key:`${start.id}>${path[0].id}`,...probe};s.path=[start,...path];
  }
 }
 movement(p,s,dt=1/30){
  if(s.index>=s.path.length-1)return null;
  const a=s.path[s.index],b=s.path[s.index+1],key=`${a.id}>${b.id}`,plan=s.connector?.key===key?s.connector:this.plans.get(key);
  if(!plan){s.path=[];this.stats.routeFailures++;return null;}
  if(plan.link?.requiresBroken&&!this.room.mapBreakables?.broken.has(plan.link.requiresBroken))return {needsBreakable:true};
  if(plan.mode==='scripted-jump'&&!s.jumpExit){
   if(!s.jumpControl){s.jumpControl=createJumpLinkController(plan.link);this.stats.jumpLinksStarted++;}
   const move=jumpLinkInput(s.jumpControl,p,dt,{broken:id=>this.room.mapBreakables?.broken.has(id),controlled:!automated(p)});
   if(s.jumpControl.failed){s.blocked.add(key);this.stats.routeFailures++;this.route(p,s,s.goal);return null;}
   if(!s.jumpControl.done)return {...move,knife:true,scriptedJump:true};
   this.stats.jumpLinksCompleted++;s.jumpControl=null;s.jumpExit=true;
   // The validated landing is an area, not one exact coordinate. Probe the
   // remaining NAV connector from the actual state, preserving all momentum.
   const probe=probeNavEdge({...point(p),crouch:p.crouch},b,{initialState:p,maxTicks:150});
   if(!probe.passed){s.blocked.add(key);this.stats.routeFailures++;this.route(p,s,s.goal);return null;}
   s.controller=createEdgeController({...point(p),crouch:p.crouch},b,probe);
  }
  s.controller||=createEdgeController(a,b,plan);
  const move=edgeMovementInput(s.controller,p);
  if(!move){s.index++;s.controller=null;s.jumpExit=false;return this.movement(p,s,dt);}
  if(s.controller.stalled>55||s.controller.ticks>420||p.y<Math.min(a.y,b.y)-1.8){s.blocked.add(key);this.stats.routeFailures++;this.route(p,s,s.goal);return null;}
  return {...move,knife:plan.mode.startsWith('jump')};
 }
 prepareJumpBreakable(p,s,input,dt){
  const a=s.path[s.index],b=s.path[s.index+1],plan=a&&b&&this.plans.get(`${a.id}>${b.id}`),id=plan?.link?.requiresBroken;
  if(!id||this.room.mapBreakables?.broken.has(id))return null;
  const object=this.room.mapBreakables?.byId.get(id);if(!object)return null;
  s.breakingSince||=this.room.clock();
  if(this.room.clock()-s.breakingSince>4000){s.blocked.add(`${a.id}>${b.id}`);this.stats.routeFailures++;this.route(p,s,s.goal);return input;}
  const target=Object.fromEntries(['x','y','z'].map(axis=>[axis,(object.bounds.min[axis]+object.bounds.max[axis])/2])),origin=eyePosition(p),aim=smoothBotAim(p,lookAt(origin,target),dt);
  input.yaw=aim.yaw;input.pitch=aim.pitch;input.slot=combatSlot(p);input.forward=input.right=0;input.jump=false;
  const d=distance(origin,target),direction={x:(target.x-origin.x)/d,y:(target.y-origin.y)/d,z:(target.z-origin.z)/d},hit=raycastWorldHit(origin,direction,d+.1);
  const weapon=getWeapon(p.weapon),ammo=p.inventory[p.weapon];
  if(ammo&&weapon.magazine&&ammo.ammo===0)input.reload=true;
  input.fire=aim.aligned&&this.room.mapBreakables.atTriangle(2,hit?.triangle)?.id===id&&(weapon.slot!==3||d<1.15);
  return input;
 }
 objective(p,order){
  const room=this.room,bomb=room.bomb,players=[...room.players.values()];
  if(room.mode!=='defuse')return order.goal;
  if(p.team==='CT'&&bomb.state==='planted')return bomb;
  if(p.team==='T'&&bomb.state==='dropped'){
   const nearest=players.filter(q=>automated(q)&&q.team==='T').sort((a,b)=>distance(a,bomb)-distance(b,bomb))[0];
   if(nearest?.id===p.id)return bomb;
  }
  if(p.hasBomb)return this.graph.map.sites[order.site]||this.graph.map.sites.A;
  if(p.team==='T'&&bomb.state==='planted'){
   // Spread post-plant cover across validated nearby NAV instead of stacking
   // all attackers on the planter's coordinates.
   const guards=this.postPlantGuards?.site===bomb.site?this.postPlantGuards.nodes:this.graph.guards(bomb.site,this.room.round.number,5);
   this.postPlantGuards={site:bomb.site,nodes:guards};return guards[(p.seat||0)%Math.max(1,guards.length)]||order.goal;
  }
  return order.goal;
 }
 utility(p,s,input,order,report,engaging,dt){
  const room=this.room,now=room.clock();
  if(s.utility&&(!automated(p)||room.round.phase!=='live'||engaging||now<(p.flashBlindUntil||0))){s.utility=null;this.utilityOwner=null;input.cancelGrenade=true;}
  if(!s.utility){
   if(now<s.utilityAfter||this.utilityOwner||engaging||!p.grounded||p.hasBomb||room.round.phase!=='live'||order.role==='entry'||order.role==='trade')return input;
   const target=report?.point||(s.path.slice(s.index).find(n=>distance(p,n)>9&&distance(p,n)<16));
   const weapon=report&&p.inventory.hegrenade?.ammo?'hegrenade':p.inventory.smokegrenade?.ammo?'smokegrenade':null;
   s.utilityAfter=now+10000;if(!target||!weapon||distance(p,target)<8||distance(p,target)>22)return input;
   s.utility={target:point(target),weapon,phase:'settle',candidate:0,createdAt:now};this.utilityOwner=p.id;
  }
  const u=s.utility;input.forward=input.right=0;input.jump=false;input.crouch=p.crouch;input.fire=input.fire2=false;input.zoomLevel=0;
  const cancel=()=>{s.utility=null;this.utilityOwner=null;s.utilityAfter=now+10000;input.cancelGrenade=true;return input;};
  if(now-u.createdAt>6500)return cancel();
  if(Math.hypot(p.vx,p.vy,p.vz)>.06||!p.grounded)return input;
  const candidates=[{pitch:.15,strength:1},{pitch:.4,strength:.5},{pitch:.6,strength:1},{pitch:.15,strength:.5}];
  if(u.phase==='settle'||u.phase==='probe'){
   const candidate=candidates[u.candidate];if(!candidate){this.stats.utilityRejected++;return cancel();}
   u.input={yaw:lookAt(eyePosition(p),u.target).yaw,pitch:candidate.pitch,throwStrength:candidate.strength};
   u.origin||={...point(p),crouch:p.crouch};
   u.probe||=createThrowProbe(this.world,p,u.weapon,u.input);u.phase='probe';
   // Only one player owns a probe; a fixed four simulation steps per room tick.
   const result=u.probe.step(4);if(!result)return input;
   const sight=u.weapon==='smokegrenade'?[{...order.goal,y:order.goal.y+1.4},{...u.target,y:u.target.y+1.4}]:null;
   if(!usefulThrow(result,{weapon:u.weapon,target:u.target,sight},this.world)||teammateRisk(this.world,p,result,[...room.players.values()],u.weapon)){u.candidate++;u.probe=null;return input;}
   u.result=result;u.phase='aim';
  }
  if(distance(p,u.origin)>.06||p.crouch!==u.origin.crouch||teammateRisk(this.world,p,u.result,[...room.players.values()],u.weapon))return cancel();
  const aim=smoothBotAim(p,u.input,dt);input.yaw=aim.yaw;input.pitch=aim.pitch;input.slot=4;input.utilityId=u.weapon;
  if(Math.hypot(angleDifference(aim.yaw,u.input.yaw),aim.pitch-u.input.pitch)>.003)return input;
  if(u.phase==='aim'){u.phase='prime';u.primeAt=now;}
  if(u.phase==='prime'){input.fire=true;input.fire2=u.input.throwStrength===.5;if(now-u.primeAt>Math.max(450,(p.equipReadyAt||0)-u.primeAt+250))u.phase='release';return input;}
  if(u.phase==='release'){input.fire=input.fire2=false;u.phase='finish';u.finishAt=now;return input;}
  if(now-u.finishAt>500){s.utility=null;this.utilityOwner=null;s.utilityAfter=now+12000;}
  return input;
 }
 input(p,dt){
  const room=this.room,now=room.clock(),input=neutral(p);if(!automated(p))return input;
  this.refresh();const s=this.state(p),order=this.director.orders.get(p.id);if(!order||!p.grounded&&s.path.length===0||room.round.phase==='freeze')return input;
  if(room.round.phase==='live'&&room.bomb.actorId===p.id&&room.bomb.action){input.interact=true;input.crouch=true;return input;}
  const skill=effectiveBotSkill(room,p),goal=this.objective(p,order);
  if(s.revision!==order.revision||!s.goal||distance(s.goal,goal)>.75||!s.path.length&&now>=s.retryAt){s.revision=order.revision;this.route(p,s,goal,s.goal?null:order.route);}
  const candidates=[...room.players.values()].filter(e=>e.alive&&e.team!==p.team&&now>=(e.protectionUntil||0));
  if(now>=s.thinkAt){s.thinkAt=now+180;const visible=candidates.filter(e=>this.perception.observe(p,e)).sort((a,b)=>distance(p,a)-distance(p,b));const target=visible.find(e=>e.id===s.target)||visible[0];
   if(target?.id!==s.target){s.target=target?.id||null;s.alignedFor=0;s.reactionAt=now+skill.reactionMinMs+Math.random()*skill.reactionRangeMs;if(target)beginAimDuel(room,p,target);}
  }
  const enemy=room.players.get(s.target),visible=enemy&&this.perception.observe(p,enemy),aimPoint=visible?visibleAimPoint(room,p,enemy):null;
  const report=this.perception.snapshot(p.team).sort((a,b)=>b.at-a.at)[0],engaging=!!aimPoint;
  if(!engaging&&!s.jumpControl){const breaking=this.prepareJumpBreakable(p,s,input,dt);if(breaking)return breaking;}
  const move=s.jumpControl||!engaging&&!s.utility?this.movement(p,s,dt):null;
  if(move?.needsBreakable)return this.prepareJumpBreakable(p,s,input,dt)||input;
  let desired={yaw:p.yaw,pitch:0};
  if(move){desired.yaw=move.yaw;input.crouch=move.crouch;input.jump=move.jump;if(move.knife)input.slot=3;}
  else if(report)desired=lookAt(eyePosition(p),report.point);
  else if(s.path.length&&s.index>=s.path.length-1){
   // Watch reachable entry angles at head height, never a random world origin.
   if(now>=s.patrolAt){s.patrolAt=now+4500+(p.seat||0)*250;const options=[...this.graph.nodes.values()].filter(n=>distance(p,n)>6&&distance(p,n)<16&&Math.abs(n.y-p.y)<1.5&&this.world.clearSight(eyePosition(p),{...n,y:n.y+1.25}));s.watch=options[(room.round.number+(p.seat||0)+Math.floor(now/5000))%Math.max(1,options.length)];
    if(order.role==='anchor'&&now>(room.round.liveStartedAt||0)+12000){const guards=this.graph.guards(order.site,room.round.number+Math.floor(now/16000),3),next=guards.find(n=>distance(p,n)>2&&distance(p,n)<8);if(next){order.goal=point(next);order.revision++;}}
   }if(s.watch)desired=lookAt(eyePosition(p),{...s.watch,y:s.watch.y+1.25});
  }
  if(aimPoint){const aimError=(.013+distance(p,enemy)/12000)*skill.aimErrorScale;desired=lookAt(eyePosition(p),aimPoint);desired.yaw+=Math.sin(now/440+(p.seat||0))*aimError;desired.pitch+=Math.cos(now/630)*aimError;}
  const aim=smoothBotAim(p,desired,dt);input.yaw=aim.yaw;input.pitch=aim.pitch;
  if(move){const difference=move.yaw-input.yaw,f=move.forward||0,r=move.right||0;input.forward=f*Math.cos(difference)+r*Math.sin(difference);input.right=-f*Math.sin(difference)+r*Math.cos(difference);}
  s.alignedFor=engaging&&aim.aligned?s.alignedFor+dt:0;
  const weapon=getWeapon(p.weapon);if(engaging&&!move?.scriptedJump){input.crouch=false;input.fire=now>=s.reactionAt&&s.alignedFor>=BOT_AIM.settleSeconds&&Math.floor(now/150)%7<5;if(weapon.zoomFovs.length>1)input.zoomLevel=1;if(weapon.slot===3)input.forward=1;}
  const ammo=p.inventory[p.weapon];if(ammo&&weapon.slot<3&&ammo.ammo<3)input.reload=true;
  const plant=p.hasBomb&&room.siteAt(p),defuse=p.team==='CT'&&room.bomb.state==='planted'&&distance(p,room.bomb)<2.65;
  if(room.mode==='defuse'&&room.round.phase==='live'&&(plant||defuse)&&(!engaging||room.bomb.actorId===p.id||room.round.phaseEndsAt-now<6000)){
   if(defuse){const closest=[...room.players.values()].filter(q=>automated(q)&&q.team==='CT').sort((a,b)=>distance(a,room.bomb)-distance(b,room.bomb))[0];if(closest?.id!==p.id)return input;}
   input.forward=input.right=0;input.fire=input.fire2=input.jump=false;input.interact=true;input.crouch=true;return input;
  }
  p.botAI.role=order.role;p.botAI.action=engaging?'engage':order.state;p.botAI.engaging=engaging;p.botAI.path=s.path.slice(s.index);p.botAI.goal=goal;p.botAI.aimPoint=aimPoint||report?.point;p.botAI.wantMove=!!move;
  return move?.scriptedJump?input:this.utility(p,s,input,order,report,engaging,dt);
 }
}
