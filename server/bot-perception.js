import {floorHeight,isHullClear} from '../shared/physics.js';
import {eyePosition} from '../shared/aim.js';
import {angleDifference} from './bot-aim.js';
import {getWeapon} from '../shared/weapons.js';

export function beginAimDuel(room,p,enemy){
  const sniper=getWeapon(p.weapon).zoomStyle==='scope';
  // Choose an aiming intention once per acquisition; never force a hit result.
  const probability=sniper?(p.weapon==='awp'?.10:.38):(room.botDifficulty==='hard'?.56:.38);
  p.botAI.headIntent=(room.aimRandom||Math.random)()<probability;p.botAI.aimEnemy=enemy.id;
}

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
  const head=height-.18,chest=height*.67;
  for(const offset of p.botAI?.headIntent?[head,chest,height*.43]:[chest,head,height*.43]){
    const to={x:enemy.x,y:enemy.y+offset,z:enemy.z};
    if(room.visibleToBot(from,to))return to;
  }
  return null;
}

export function standingAimPoint(room,raw,height=1.62){
  if(!room.nav?.length)return raw;
  // Author/map points recur every tick. Cache the nearest-node lookup too,
  // not just its hull test; the static map cannot change under this room.
  const anchors=room.botAnchorCache||=new Map(),anchorKey=`${raw.x}:${raw.y-height}:${raw.z}`;
  let node=anchors.get(anchorKey);
  if(!anchors.has(anchorKey)){node=room.nearestNav({...raw,y:raw.y-height});if(!node||Math.hypot(node.x-raw.x,node.z-raw.z)>4)node=null;if(anchors.size>=1024)anchors.delete(anchors.keys().next().value);anchors.set(anchorKey,node);}
  if(!node)return null;
  const cache=room.botStandCache||=new Map(),key=node.id??`${node.x}:${node.z}`;
  if(!cache.has(key)){const y=floorHeight(node.x,node.z,node.y+.45,1.8);cache.set(key,y!==null&&isHullClear({x:node.x,y:y+.015,z:node.z})?{x:node.x,y,z:node.z}:null);}
  const stand=cache.get(key);return stand?{...stand,y:stand.y+height}:null;
}
export function observationPoint(room,p,waypoint){
  const ai=p.botAI,now=room.clock(),from=eyePosition(p),scoped=getWeapon(p.weapon).zoomStyle==='scope';
  if(ai.lastKnown&&now-ai.lastSeenAt<1800){const to={...ai.lastKnown,y:ai.lastKnown.y+(ai.lastKnown.crouch?.92:1.62)};if(room.visibleToBot(from,to))return to;}
  const route=(ai.path||[]).slice(0,18),ahead=[...route].reverse().find(n=>Math.hypot(n.x-p.x,n.z-p.z)>4)||waypoint;
  const moving=!!ahead&&Math.hypot(ahead.x-p.x,ahead.z-p.z)>1.5,heading=moving?lookAt(from,ahead).yaw:p.yaw||0;
  const eligible=to=>{const d=Math.hypot(to.x-p.x,to.z-p.z),angle=Math.abs(angleDifference(lookAt(from,to).yaw,heading));return d>3&&d<(scoped?75:45)&&(!moving||angle<1.15)&&Math.abs(lookAt(from,to).pitch)<.48&&room.visibleToBot(from,to);};
  const source=(ai.watchPoints||[]).map(n=>standingAimPoint(room,n,scoped?1.2:1.62)).filter(Boolean);
  let usable=source.filter(eligible);
  // Nearby nav ground points are plausible player positions, not wall centers
  // or the next footstep. Search only when the authored angles do not fit travel.
  if(!usable.length&&room.nav?.length&&now>=(ai.scanAnglesAt||0)){
    ai.scanAnglesAt=now+700;const nodes=room.nav.filter(n=>{const d=Math.hypot(n.x-p.x,n.z-p.z);return d>5&&d<24&&Math.abs(angleDifference(lookAt(from,n).yaw,heading))<.9;}).sort((a,b)=>Math.abs(angleDifference(lookAt(from,a).yaw,heading))-Math.abs(angleDifference(lookAt(from,b).yaw,heading)));
    ai.localAngles=nodes.slice(0,20).map(n=>standingAimPoint(room,{...n,y:n.y+(scoped?1.2:1.62)},scoped?1.2:1.62)).filter(n=>n&&eligible(n)).slice(0,5);
  }
  if(!usable.length)usable=(ai.localAngles||[]).filter(eligible);
  if(usable.length){
    if(now>=(ai.watchUntil||0)||!ai.watchPoint||!usable.some(n=>Math.hypot(n.x-ai.watchPoint.x,n.y-ai.watchPoint.y,n.z-ai.watchPoint.z)<.1)){
      usable.sort((a,b)=>Math.abs(angleDifference(lookAt(from,a).yaw,heading))-Math.abs(angleDifference(lookAt(from,b).yaw,heading)));
      const previous=ai.watchPoint;ai.watchPoint=usable.find(n=>!previous||Math.hypot(n.x-previous.x,n.z-previous.z)>.8)||usable[0];ai.watchUntil=now+2200+(p.seat||0)*170;
    }return ai.watchPoint;
  }
  for(const n of [...route].reverse()){
    if(Math.hypot(n.x-p.x,n.z-p.z)<3)continue;const to=standingAimPoint(room,{...n,y:n.y+(scoped?1.2:1.62)},scoped?1.2:1.62);if(to&&eligible(to))return to;
  }
  return null;
}
