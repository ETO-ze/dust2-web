import {GrenadeSimulation,segmentIntersectsSmoke} from './grenades.js';
import {EQUIPMENT} from '../shared/equipment.js';
import {eyePosition} from '../shared/aim.js';

/** Isolated instance of the SAME production throw, sweep, bounce, fuse and
 * fire-spread simulation. Advance a few ticks per frame during live play. */
export function createThrowProbe(world,player,weapon,input){
  let now=0,result=null,ticks=0,bounces=0;
  const finish=(g,kind)=>{result={kind,point:{x:g.x,y:g.y,z:g.z},seconds:now/1000,bounces,cells:sim.fires[0]?.cells||[]};};
  const sim=new GrenadeSimulation({clock:()=>now,raycastWorld:world.raycastWorld,raycastContact:world.raycastContact,
    onFlash:g=>finish(g,'flash'),onExplosion:g=>finish(g,'he'),
    emit:(type,e)=>{if(type==='grenade_bounce')bounces++;if(type==='smoke')finish(e.origin,'smoke');if(type==='fire_started')finish(e.origin,'fire');if(type==='fire_failed')finish(e.origin,'failed');}});
  sim.throwGrenade({...player,inventory:{}},weapon,input);
  return {step(count=2){for(let i=0;i<count&&!result&&ticks<360;i++){ticks++;now=ticks*1000/30;sim.tick(1/30);}if(!result&&ticks>=360)result={kind:'failed',seconds:12};return result;},get result(){return result;}};
}
export function simulateThrow(world,player,weapon,input){const probe=createThrowProbe(world,player,weapon,input);while(!probe.result)probe.step(60);return probe.result;}
export function usefulThrow(result,spec,world){
  if(!result?.point||result.kind==='failed')return false;
  const a=result.point,b=spec.target,d=Math.hypot(a.x-b.x,a.z-b.z);
  if(spec.weapon==='smokegrenade')return result.kind==='smoke'&&d<=1.6&&Math.abs(a.y-(b.y+1.3))<1.6&&(!spec.sight||segmentIntersectsSmoke(...spec.sight,{...a,radius:EQUIPMENT.smokegrenade.radius}));
  if(['molotov','incgrenade'].includes(spec.weapon))return result.kind==='fire'&&result.cells.some(c=>Math.hypot(c.x-b.x,c.z-b.z)<1.4&&Math.abs(c.y-b.y)<1.4);
  return d<(spec.weapon==='flashbang'?3.5:2.5)&&Math.abs(a.y-b.y)<3&&world.clearSight(a,{...b,y:b.y+1.3});
}
export function teammateRisk(world,p,result,players,weapon){
  if(!result?.point)return true;
  for(const q of players){if(!q.alive||q.team!==p.team)continue;
    const from=eyePosition(q),g=result.point,d=Math.hypot(from.x-g.x,from.y-g.y,from.z-g.z);
    if(weapon==='flashbang'){
      if(d>24||!world.clearSight(from,g))continue;
      const dot=d?(-Math.sin(q.yaw||0)*Math.cos(q.pitch||0)*(g.x-from.x)+Math.sin(q.pitch||0)*(g.y-from.y)-Math.cos(q.yaw||0)*Math.cos(q.pitch||0)*(g.z-from.z))/d:1;
      if(d<6||dot>-.2)return true;
    }else if(['molotov','incgrenade'].includes(weapon)){
      if(result.cells.some(c=>Math.hypot(c.x-q.x,c.z-q.z)<2.2&&Math.abs(c.y-q.y)<1.5))return true;
    }else if(weapon==='hegrenade'&&d<7&&world.clearSight(from,g))return true;
  }
  return false;
}
