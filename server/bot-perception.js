import {eyePosition} from '../shared/aim.js';
import {angleDifference} from './bot-aim.js';

export function lookAt(from,to){return {yaw:Math.atan2(-(to.x-from.x),-(to.z-from.z)),pitch:Math.atan2(to.y-from.y,Math.hypot(to.x-from.x,to.z-from.z))};}
export function hearGunshot(room,shooter){
  for(const p of room.players.values()){
    if(!p.bot||!p.alive||p.team===shooter.team||Math.hypot(p.x-shooter.x,p.y-shooter.y,p.z-shooter.z)>35)continue;
    // An approximate sound direction invites a visual check. It never grants
    // a target lock, exact enemy tracking, or permission to shoot through cover.
    p.botAI.heardPoint={x:Math.round(shooter.x/2)*2,y:shooter.y+1.3,z:Math.round(shooter.z/2)*2};
    p.botAI.heardAt=room.clock();
  }
}
// Acquisition has a field of view. Tracking never bypasses walls or smoke.
export function visibleAimPoint(room,p,enemy,{acquire=false}={}){
  const from=eyePosition(p),height=enemy.crouch?1.1:1.8;
  if(acquire&&Math.hypot(enemy.x-p.x,enemy.z-p.z)>2.5&&Math.abs(angleDifference(lookAt(from,eyePosition(enemy)).yaw,p.yaw||0))>Math.PI*.4)return null;
  // Test the point that will actually be aimed at, not an unrelated eye ray.
  for(const offset of [height*.67,height-.18,height*.43]){
    const to={x:enemy.x,y:enemy.y+offset,z:enemy.z};
    if(room.visibleToBot(from,to))return to;
  }
  return null;
}

export function observationPoint(room,p,waypoint){
  const ai=p.botAI,now=room.clock(),from=eyePosition(p);
  if(ai.lastKnown&&now-ai.lastSeenAt<1800){const to={...ai.lastKnown,y:ai.lastKnown.y+1.3};if(room.visibleToBot(from,to))return to;}
  if(ai.heardPoint&&now-ai.heardAt<2400)return ai.heardPoint;
  const checks=ai.watchPoints||[];
  const usable=checks.filter(to=>{const d=Math.hypot(to.x-p.x,to.z-p.z);return d>2&&d<32&&room.visibleToBot(from,to);});
  if(usable.length){
    // Hold one angle for a beat instead of sweeping every frame.
    if(now>=(ai.watchUntil||0)||!ai.watchPoint||!usable.some(to=>Math.hypot(to.x-ai.watchPoint.x,to.y-ai.watchPoint.y,to.z-ai.watchPoint.z)<.1)){ai.watchIndex=((ai.watchIndex??-1)+1)%usable.length;ai.watchPoint=usable[ai.watchIndex];ai.watchUntil=now+1100+(p.seat||0)*100;}
    return ai.watchPoint;
  }
  // Look farther along the route, at standing head height, while feet follow
  // the immediate waypoint independently. Never stare into a nearby corner.
  for(const n of (ai.path||[]).slice(0,12).reverse()){
    const to={...n,y:n.y+1.45};if(Math.hypot(n.x-p.x,n.z-p.z)>2&&room.visibleToBot(from,to))return to;
  }
  return waypoint?{...waypoint,y:waypoint.y+1.45}:null;
}
