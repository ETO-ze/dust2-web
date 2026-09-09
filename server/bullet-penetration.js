import {raycastWorldSurfaces} from '../shared/physics.js';
import {WEAPON_BALLISTICS} from '../shared/weapon-ballistics.js';

// Browser adaptation, not a claim to reproduce Source 2's unpublished solver.
// A real entry AND exit are required; unmatched surfaces always stop a shot.
export const SURFACE_RULES=Object.freeze({
  0:{name:'concrete',depth:.09,loss:.48},
  1:{name:'wood',depth:.70,loss:.14},
  2:{name:'metal',depth:.14,loss:.34},
  3:{name:'glass',depth:.90,loss:.08},
});
const at=(o,d,t)=>({x:o.x+d.x*t,y:o.y+d.y*t,z:o.z+d.z*t});
const dot=(a,b)=>a.x*b.x+a.y*b.y+a.z*b.z;
export function traceBullet({origin,direction,weapon,shooter,players,now,rayHitPlayer,surfaces}){
  const range=weapon.range||200,power=WEAPON_BALLISTICS[weapon.id]?.penetration||0;
  const crossings=surfaces||raycastWorldSurfaces(origin,direction,range);
  const targets=players.filter(p=>p.id!==shooter.id&&p.alive&&p.team!==shooter.team&&!(p.protectionUntil>now)).map(p=>({p,hit:rayHitPlayer(origin,direction,p,range)})).filter(t=>t.hit).sort((a,b)=>a.hit.distance-b.hit.distance);
  let scale=1,wallbang=false,penetrations=0,stop=range,hitWorld=false;
  const hits=[],segments=[];
  let targetIndex=0;
  const hitTargets=until=>{
    while(targetIndex<targets.length&&targets[targetIndex].hit.distance<until){
      const {p,hit}=targets[targetIndex++];hits.push({playerId:p.id,distance:hit.distance,headshot:hit.headshot,damageScale:scale,wallbang,penetrations});
      // Player penetration is bounded too, avoiding a full-damage line of kills.
      scale*=.55;if(hits.length>=4||scale*weapon.damage<1){stop=hit.distance;return false;}
    }return true;
  };
  for(let i=0;i<crossings.length;i++){
    const entry=crossings[i];if(entry.distance>range)break;
    if(!hitTargets(entry.distance))break;
    const material=entry.material||0,rule=SURFACE_RULES[material]||SURFACE_RULES[0],exit=crossings[i+1];
    const thickness=exit?exit.distance-entry.distance:Infinity,maxDepth=rule.depth*power;
    const validExit=exit&&dot(entry.normal,direction)<-.01&&dot(exit.normal,direction)>.01&&(exit.material||0)===material&&thickness>.002;
    if(!power||penetrations>=4||!validExit||thickness>maxDepth){stop=entry.distance;hitWorld=true;break;}
    const remaining=scale*(1-rule.loss)-thickness/Math.max(.01,maxDepth)*.42;
    if(remaining*weapon.damage<1){stop=entry.distance;hitWorld=true;break;}
    segments.push({entry:at(origin,direction,entry.distance),exit:at(origin,direction,exit.distance),material:rule.name,thickness});
    scale=remaining;wallbang=true;penetrations++;i++;
    // A player behind a surface must be reached after its far face.
    while(targetIndex<targets.length&&targets[targetIndex].hit.distance<exit.distance)targetIndex++;
  }
  if(!hitWorld&&stop===range)hitTargets(range);
  if(!hitWorld&&hits.length)stop=Math.min(stop,hits.at(-1).distance+.15);
  return {end:at(origin,direction,stop),hitWorld,hits,wallbang,penetrations,segments};
}
