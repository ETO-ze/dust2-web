import {BOT_LINEUPS} from './bot-lineups.js';
import {createThrowProbe,usefulThrow,teammateRisk} from './bot-trajectory.js';
import {smoothBotAim,angleDifference} from './bot-aim.js';
import {getWeapon} from '../shared/weapons.js';
const distance=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
export function combatSlot(p){return [1,2,3].find(slot=>Object.keys(p.inventory).some(id=>getWeapon(id).slot===slot&&(slot===3||p.inventory[id].ammo+p.inventory[id].reserve>0)))||3;}
function cancel(room,p,input,reason){
 const u=p.botAI.utility;if(u){room.botUtilityStats||={};room.botUtilityStats[reason]=(room.botUtilityStats[reason]||0)+1;if(!u.released)room.utilityClaims?.delete(u.key);}
 p.botAI.utility=null;p.botAI.utilityAfter=room.clock()+2500;p.botAI.goal=null;p.botAI.path=[];
 room.cancelGrenade(p,'bot-'+reason);input.cancelGrenade=true;input.slot=combatSlot(p);input.fire=false;input.fire2=false;
 return input;
}
function choose(room,p){
 const ai=p.botAI,now=room.clock();room.utilityClaims||=new Map();
 const choices=BOT_LINEUPS.filter(s=>s.team===p.team&&(s.site==='*'||s.site===ai.site)&&(p.team==='CT'?s.lane===ai.role:s.lane===ai.lane)&&p.inventory[s.weapon]?.ammo&&distance(p,s.stand)<9&&!room.utilityClaims.has(p.team+':'+s.id));
 for(const s of choices){
  if(s.weapon==='hegrenade'&&(!ai.lastKnown||now-ai.lastSeenAt>3000||distance(ai.lastKnown,s.target)>5))continue;
  if(s.weapon==='smokegrenade'&&room.grenades.smokes.some(c=>distance(c,s.target)<5))continue;
  if(teammateRisk(room.grenades,p,s.expected,[...room.players.values()],s.weapon))continue;
  const path=room.planPath(p,s.stand);if(!path.length||distance(path.at(-1),s.stand)>.5)continue;
  const key=p.team+':'+s.id;room.utilityClaims.set(key,p.id);return {...s,key,expiresAt:now+10000,phase:'approach',plannedAt:now};
 }
 return null;
}
export function botUtility(room,p,input,dt){
 const ai=p.botAI,now=room.clock();
 const interrupted=room.mode!=='defuse'||room.round.phase!=='live'||ai.engaging||input.interact||p.objectiveLocked||now<(p.flashBlindUntil||0)||now-(ai.hurtAt||-Infinity)<1000;
 if(interrupted)return ai.utility?cancel(room,p,input,'interrupted'):input;
 if(!ai.utility&&now>=(ai.utilityAfter||0)&&!p.hasBomb&&now-ai.lastSeenAt>1400){
  ai.utilityAfter=now+1500+(p.seat||0)*75;ai.utility=choose(room,p);
  if(ai.utility){ai.goal=ai.utility.stand;ai.path=room.planPath(p,ai.goal);}
 }
 const u=ai.utility;if(!u)return input;
 ai.action='utility-'+u.phase;
 if(!p.inventory[u.weapon]?.ammo){ai.utility=null;ai.utilityAfter=now+10000;ai.goal=null;ai.path=[];input.slot=combatSlot(p);return input;}
 if(now>u.expiresAt)return cancel(room,p,input,'timeout');
 const gap=distance(p,u.stand);
 if(u.phase==='approach'&&gap>.10){
  // Keep route navigation around walls; the last metre uses a slow position
  // controller, not a teleport, so the authored stand point is actually reached.
  if(gap<1.2){const dx=u.stand.x-p.x,dz=u.stand.z-p.z,k=Math.min(1,gap*2)/Math.max(.01,gap);input.forward=(-Math.sin(input.yaw)*dx-Math.cos(input.yaw)*dz)*k;input.right=(Math.cos(input.yaw)*dx-Math.sin(input.yaw)*dz)*k;input.walk=true;}
  input.fire=false;input.reload=false;return input;
 }
 input.forward=input.right=0;input.jump=input.crouch=input.reload=false;
 const aim=smoothBotAim({yaw:p.yaw,pitch:p.pitch},u,dt);input.yaw=aim.yaw;input.pitch=aim.pitch;
 input.slot=4;input.utilityId=u.weapon;input.fire=input.fire2=false;
 const still=!p.crouch&&p.grounded&&Math.hypot(p.vx||0,p.vy||0,p.vz||0)<.08;
 if(!still){if(u.phase==='prime')return cancel(room,p,input,'moved');u.stillAt=0;return input;}
 u.stillAt||=now;
 if(u.phase==='approach'&&now-u.stillAt>150){
  u.phase='validate';u.origin={x:p.x,y:p.y,z:p.z};u.probe=createThrowProbe(room.grenades,p,u.weapon,u);u.startedAt=now;
 }
 if(u.origin&&(distance(p,u.origin)>.12||Math.abs(p.y-u.origin.y)>.12))return cancel(room,p,input,'moved');
 if(u.phase==='validate'){
  // At most four probe ticks per ROOM tick, shared across all bot planners.
  if(room.botProbeAt!==now){room.botProbeAt=now;const result=u.probe.step(4);if(result){
   if(!usefulThrow(result,u,room.grenades))return cancel(room,p,input,'bad-trajectory');
   u.result=result;u.phase='ready';u.probe=null;
  }}
  return input;
 }
 const aligned=Math.hypot(angleDifference(u.yaw,aim.yaw),u.pitch-aim.pitch)<.003;
 u.alignedSince=aligned?(u.alignedSince||now):0;
 if(u.phase==='ready'){
  if(!aligned||now-u.alignedSince<180||now<p.nextShotAt)return input;
  if(teammateRisk(room.grenades,p,u.result,[...room.players.values()],u.weapon))return cancel(room,p,input,'team-risk');
  u.phase='prime';u.primedAt=now;
 }
 if(u.phase==='prime'){
  const chord=u.throwMode==='lob',under=u.throwMode==='drop';input.fire=!under;input.fire2=under||chord;
  if(!aligned)return cancel(room,p,input,'aim-drift');
  if(p.grenadeState&&now-u.primedAt>=350&&now>=p.grenadeState.readyAt){
   if(teammateRisk(room.grenades,p,u.result,[...room.players.values()],u.weapon))return cancel(room,p,input,'team-risk');
   input.fire=input.fire2=false;u.released=true;u.phase='released';
   room.botUtilityStats||={};room.botUtilityStats.validated=(room.botUtilityStats.validated||0)+1;
   room.emit('bot_utility_validated',{playerId:p.id,lineup:u.id,target:u.target,predicted:u.result.point,angleError:Math.hypot(angleDifference(u.yaw,aim.yaw),u.pitch-aim.pitch)});
  }
 }
 return input;
}
