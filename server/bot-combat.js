import {floorHeight} from '../shared/physics.js';
import {getWeapon} from '../shared/weapons.js';
export function combatMovement(room,p,target,input){
 const ai=p.botAI,now=room.clock(),weapon=getWeapon(p.weapon);
 if(weapon.slot>=3||!p.grounded||p.objectiveLocked)return;
 if(weapon.zoomFovs.length>1&&Math.hypot(target.x-p.x,target.z-p.z)>12)input.zoomLevel=1;
 const cover=now<(ai.coverUntil||0)&&ai.path[0];
 if(cover){const dx=cover.x-p.x,dz=cover.z-p.z,d=Math.max(.01,Math.hypot(dx,dz));input.forward=(-Math.sin(input.yaw)*dx-Math.cos(input.yaw)*dz)/d;input.right=(Math.cos(input.yaw)*dx-Math.sin(input.yaw)*dz)/d;input.fire=false;return;}
 // A short sidestep during the existing burst pause, then settle before firing.
 if(!input.fire&&Math.floor(now/150)%7>=5&&Math.hypot(target.x-p.x,target.z-p.z)>5){
  const sign=ai.strafe||1,x=p.x+Math.cos(input.yaw)*sign*.8,z=p.z-Math.sin(input.yaw)*sign*.8;
  const ground=floorHeight(x,z,p.y+.5,1.2),a={x:p.x,y:p.y+.4,z:p.z},b={x,y:p.y+.4,z};
  if(ground!==null&&Math.abs(ground-p.y)<.55&&room.visibleToBot(a,b)){input.right=sign*.5;input.walk=true;}
  else ai.strafe=-sign;
 }
 if(input.fire&&Math.hypot(p.vx||0,p.vz||0)>.7)input.fire=false;
}
