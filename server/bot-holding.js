import {getWeapon} from '../shared/weapons.js';
import {eyePosition} from '../shared/aim.js';
const range=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
const point=p=>({x:p.x,y:p.y,z:p.z});
export function patrolHold(room,p,base){
  const ai=p.botAI,now=room.clock(),key=`${room.round.number}:${ai.role}:${base.x.toFixed(1)}:${base.z.toFixed(1)}`;
  if(!room.nav?.length)return base;
  if(ai.holdPatrol?.key!==key)ai.holdPatrol={key,goal:point(base),began:now,moveAt:0,previous:null};
  const patrol=ai.holdPatrol;
  if(ai.engaging||ai.utility||p.objectiveLocked)return patrol.goal;
  const arrived=range(p,patrol.goal)<1.3;
  if(arrived&&!patrol.moveAt)patrol.moveAt=now+3500+Math.random()*4500;
  const shot=ai.lastSniperShotAt||0;
  if(arrived&&shot>patrol.began)patrol.moveAt=Math.min(patrol.moveAt,now+100);
  if(!arrived&&now-patrol.began<12000||arrived&&now<patrol.moveAt)return patrol.goal;
  const scoped=getWeapon(p.weapon).zoomStyle==='scope',checks=ai.watchPoints||[];
  const candidates=room.nav.filter(n=>range(n,base)<6&&range(n,p)>1.5&&Math.abs(n.y-base.y)<1.1&&(!patrol.previous||range(n,patrol.previous)>1)&&
    ![...room.players.values()].some(q=>q!==p&&q.alive&&q.team===p.team&&range(q,n)<1.2)&&
    checks.some(to=>range(n,to)>(scoped?9:3)&&room.visibleToBot({...n,y:n.y+1.62},to)));
  for(let i=0;i<Math.min(8,candidates.length);i++){
    const index=Math.floor(Math.random()*candidates.length),candidate=candidates.splice(index,1)[0],path=room.planPath(p,candidate);
    if(!path.length||path.length>40)continue;
    const routeLength=path.reduce((sum,n,j)=>sum+range(j?path[j-1]:p,n),0);if(routeLength>15)continue;
    patrol.previous=patrol.goal;patrol.goal=point(candidate);patrol.began=now;patrol.moveAt=0;ai.holdMoves=(ai.holdMoves||0)+1;return patrol.goal;
  }
  patrol.began=now;patrol.moveAt=now+2500;return patrol.goal;
}
export function sniperHolding(room,p,input,watch,engaging){
  if(getWeapon(p.weapon).zoomStyle!=='scope')return;
  const ai=p.botAI,now=room.clock(),speed=Math.hypot(p.vx||0,p.vz||0);
  const recentShot=now-(ai.lastSniperShotAt||-Infinity)<650;
  if(recentShot){input.zoomLevel=0;input.fire=false;}
  else if(p.grounded&&speed<.45&&watch&&range(p,watch)>9&&room.visibleToBot(eyePosition(p),watch)){
    input.zoomLevel=range(p,watch)>48?2:1;
    if(engaging&&p.zoomLevel!==input.zoomLevel)input.fire=false;
  }else{input.zoomLevel=0;if(engaging&&range(p,watch||p)>8)input.fire=false;}
  if(speed>.45)input.fire=false;
  if(!engaging&&ai.holdPatrol&&range(p,ai.holdPatrol.goal)>1.3)input.zoomLevel=0;
}
