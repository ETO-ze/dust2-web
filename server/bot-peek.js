import {standingAimPoint} from './bot-perception.js';
import {floorHeight,isHullClear,createPlayerState,stepPlayer} from '../shared/physics.js';
import {angleDifference} from './bot-aim.js';
const distance=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
function lane(room,stand,watch){return room.visibleToBot({...stand,y:stand.y+1.62},watch);}
function sideStep(room,p,sign,yaw){
 const to={x:p.x+Math.cos(yaw)*sign*1.15,z:p.z-Math.sin(yaw)*sign*1.15};to.y=floorHeight(to.x,to.z,p.y+.45,1.1);
 if(to.y===null||Math.abs(to.y-p.y)>.35||!isHullClear({...to,y:to.y+.015}))return null;
 // Check the actual movement hull along the strafe, not just two clear points.
 const q={...createPlayerState(p),grounded:true};for(let i=0;i<8;i++)stepPlayer(q,{right:sign,yaw},1/30);
 if(distance(q,to)>.55||Math.abs(q.y-p.y)>.4)return null;
 return to;
}
export function botPeek(room,p,input,watch,engaging){
 const ai=p.botAI,now=room.clock();
 if(!p.grounded||p.objectiveLocked||ai.utility||ai.lootId||input.interact||room.round.phase!=='live'||now<(ai.coverUntil||0)){ai.peek=null;return false;}
 if(!ai.peek&&now>=(ai.nextPeekAt||0)){
  ai.nextPeekAt=now+3000+Math.random()*2000;
  // A remembered contact or authored entry angle can motivate a peek. Unknown
  // enemy coordinates are never consulted to select the cover/exposure pair.
  const target=watch||(ai.watchPoints||[]).map(n=>standingAimPoint(room,n)).filter(Boolean).find(n=>distance(p,n)>7&&distance(p,n)<35&&Math.abs(angleDifference(Math.atan2(-(n.x-p.x),-(n.z-p.z)),p.yaw))<1.1);
  if(!target||distance(p,target)<7||distance(p,target)>45)return false;
  const yaw=Math.atan2(-(target.x-p.x),-(target.z-p.z)),visible=lane(room,p,target);
  for(const sign of [ai.strafe||1,-(ai.strafe||1)]){const side=sideStep(room,p,sign,yaw);if(!side||lane(room,side,target)===visible)continue;
   const here={x:p.x,y:p.y,z:p.z};ai.peek={home:visible?side:here,out:visible?here:side,phase:visible?'back':'wait',until:now+700+Math.random()*500,expires:now+6500,watch:target};ai.peekCount=(ai.peekCount||0)+1;break;}
 }
 const peek=ai.peek;if(!peek)return false;
 if(now>peek.expires){ai.peek=null;ai.nextPeekAt=now+3000;return false;}
 input.jump=false;input.crouch=false;input.forward=input.right=0;
 const move=to=>{const dx=to.x-p.x,dz=to.z-p.z,d=Math.hypot(dx,dz);if(d<.12)return true;input.forward=(-Math.sin(input.yaw)*dx-Math.cos(input.yaw)*dz)/Math.max(.5,d);input.right=(Math.cos(input.yaw)*dx-Math.sin(input.yaw)*dz)/Math.max(.5,d);return false;};
 if(peek.phase==='back'){input.fire=false;if(move(peek.home)){peek.phase='wait';peek.until=now+650+Math.random()*600;}}
 else if(peek.phase==='wait'){input.fire=false;if(now>=peek.until){peek.phase='out';}}
 else if(peek.phase==='out'){input.fire=false;if(move(peek.out)){peek.phase='settle';peek.until=now+180;}}
 else if(peek.phase==='settle'){input.fire=false;if(now>=peek.until&&Math.hypot(p.vx,p.vz)<.45){peek.phase='shoot';peek.until=now+(engaging?650:330);}}
 else if(peek.phase==='shoot'){if(now>=peek.until){peek.phase='return';input.fire=false;}}
 else {input.fire=false;if(move(peek.home)){ai.peek=null;ai.peekCompleted=(ai.peekCompleted||0)+1;ai.nextPeekAt=now+4500;}}
 ai.action='peek-'+peek.phase;return true;
}
