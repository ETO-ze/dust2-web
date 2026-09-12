import {MAP} from '../shared/map-data.js';
import {smoothBotAim} from './bot-aim.js';
const point=p=>({x:p.x,y:p.y,z:p.z});
const range=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
const raw={long:{x:40,y:0,z:-31},short:{x:7,y:2.5,z:-48},mid:{x:-11,y:0,z:-31},doors:{x:-11,y:-1,z:-48},tunnels:{x:-43,y:0,z:-27},bEntry:{x:-42,y:0,z:-53}};
function at(room,id){return point(room.nearestNav(raw[id]||MAP.sites[id])||raw[id]||MAP.sites[id]);}
function team(room,p){return [...room.players.values()].filter(q=>q.alive&&q.team===p.team).sort((a,b)=>a.seat-b.seat);}
function hold(room,p,site){
 const center=MAP.sites[site]||room.bomb,angle=(p.seat+1)*1.256;
 return point(room.nearestNav({x:center.x+Math.cos(angle)*5,y:center.y,z:center.z+Math.sin(angle)*5})||center);
}
/** Dust2 defaults: long/short A split or tunnels/mid B split. Information is
 * shared only after a teammate has seen an opponent; it expires after 6 s. */
export function tacticalGoal(room,p){
 const now=room.clock(),ai=p.botAI,b=room.bomb,allies=team(room,p),report=room.teamIntel?.[p.team];
 if(b.state==='planted'){
  if(p.team==='T'){ai.role='postplant';return hold(room,p,b.site);}
  const active=allies.find(q=>q.id===b.actorId&&b.action==='defuse');
  const defuser=active||[...allies.filter(q=>q.bot)].sort((a,c)=>Number(c.defuseKit)-Number(a.defuseKit)||range(a,b)-range(c,b))[0];
  ai.role=defuser?.id===p.id?'defuser':'retake-cover';return ai.role==='defuser'?point(b):hold(room,p,b.site);
 }
 if(p.team==='T'){
  if(b.state==='dropped'&&[...allies].sort((a,c)=>range(a,b)-range(c,b))[0]?.id===p.id){ai.role='recover-bomb';return point(b);}
  const humanCarrier=allies.find(q=>!q.bot&&q.hasBomb);
  if(humanCarrier&&humanCarrier.z<0&&(humanCarrier.x<-28||humanCarrier.x>10))room.botAttackSite=humanCarrier.x<0?'B':'A';
  const site=room.botAttackSite||(room.round.number%3===2?'B':'A'),split=p.seat%3===2;
  const route=site==='A'?(split?['mid','short','A']:['long','A']):(split?['mid','doors','B']:['tunnels','bEntry','B']);
  const key=room.round.number+':'+route.join('-');
  if(ai.routeKey!==key){ai.routeKey=key;ai.routeIndex=0;}
  ai.role=p.hasBomb?'carrier':split?'split':'entry';ai.site=site;
  while(ai.routeIndex<route.length-1&&range(p,at(room,route[ai.routeIndex]))<3)ai.routeIndex++;
  if(p.hasBomb&&room.siteAt(p))return point(p);
  if(ai.routeIndex===route.length-1&&!p.hasBomb)return hold(room,p,site);
  return at(room,route[ai.routeIndex]);
 }
 const roles=['anchor-b','anchor-a','short','mid','rotator'];ai.role=roles[Math.max(0,allies.filter(q=>q.bot).findIndex(q=>q.id===p.id))%5];
 if(report&&now-report.at<6000){
  const site=range(report,MAP.sites.A)<range(report,MAP.sites.B)?'A':'B';
  if(ai.role==='rotator'||ai.role==='mid'||(site==='A'&&ai.role==='anchor-a')||(site==='B'&&ai.role==='anchor-b'))return hold(room,p,site);
 }
 return at(room,({'anchor-b':'B','anchor-a':'A',short:'short',mid:'doors',rotator:'short'})[ai.role]);
}
export function shareSighting(room,p,enemy){
 (room.teamIntel||={})[p.team]={...point(enemy),at:room.clock(),observer:p.id};
}
export function botUtility(room,p,input,dt){
 const ai=p.botAI,now=room.clock();
 if(room.mode!=='defuse'||room.round.phase!=='live'||p.objectiveLocked)return input;
 if(!ai.utility&&now>=(ai.utilityAfter||0)&&!input.interact&&now>=p.nextShotAt){
  const report=ai.lastKnown&&now-ai.lastSeenAt<1200?ai.lastKnown:null;
  const waypoint=ai.path[Math.min(4,ai.path.length-1)];
  const target=report||waypoint,d=target?range(p,target):0;
  const weapon=report?['hegrenade',p.team==='T'?'molotov':'incgrenade','flashbang'].find(id=>p.inventory[id]?.ammo):(p.inventory.smokegrenade?.ammo?'smokegrenade':null);
  if(weapon&&d>9&&d<23&&room.visibleToBot({x:p.x,y:p.y+1.5,z:p.z},{x:target.x,y:target.y+1,z:target.z})&&!team(room,p).some(q=>q!==p&&range(q,target)<5)){
   // Low arc on the same authoritative throw physics, never spawn utility at a goal.
   const yaw=Math.atan2(-(target.x-p.x),-(target.z-p.z));
   const pitch=Math.max(-.35,Math.min(.48,Math.asin(Math.min(.9,8.128*d/17.145**2))/2-.175));
   ai.utility={weapon,yaw,pitch,releaseAt:now+800,expiresAt:now+2000};ai.utilityAfter=now+12000;
  }
 }
 const u=ai.utility;if(!u)return input;
 if(now>u.expiresAt||!p.inventory[u.weapon]?.ammo){ai.utility=null;return input;}
 const aim=smoothBotAim({yaw:p.yaw,pitch:p.pitch},u,dt);
 Object.assign(input,{slot:4,utilityId:u.weapon,yaw:aim.yaw,pitch:aim.pitch,fire:now<u.releaseAt,fire2:false,reload:false,jump:false,forward:0,right:0});
 return input;
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
