// Original browser implementation: a short swept volume instead of a bullet ray.
// Scale follows the map (metres per Source unit); not a Source 2 engine port.
export const KNIFE = Object.freeze({slashRange:48*.0254,stabRange:32*.0254,hullRadius:16*.0254,slashInterval:.5,stabInterval:1,firstSlash:40,repeatSlash:25,stabDamage:65,backSlash:90,backStab:180,armorScale:.85});
export const knifeInterval = heavy => heavy ? KNIFE.stabInterval : KNIFE.slashInterval;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function segmentBox(origin,dir,lo,hi,range){
 let enter=0,exit=range;
 for(const axis of ['x','y','z']){
  if(Math.abs(dir[axis])<1e-8){if(origin[axis]<lo[axis]||origin[axis]>hi[axis])return null;continue;}
  const a=(lo[axis]-origin[axis])/dir[axis],b=(hi[axis]-origin[axis])/dir[axis];
  enter=Math.max(enter,Math.min(a,b));exit=Math.min(exit,Math.max(a,b));if(enter>exit)return null;
 }
 return enter;
}
export function traceKnife({origin,direction,shooter,players,heavy=false,now=0,raycastWorld}){
 const range=heavy?KNIFE.stabRange:KNIFE.slashRange,radius=KNIFE.hullRadius;
 const wall=raycastWorld(origin,direction,range);let nearest=wall??range,target=null,contact=null;
 for(const p of players){
  if(!p.alive||p.id===shooter.id||p.team===shooter.team||now<(p.protectionUntil||0))continue;
  // The sweep broadens aim forgiveness, but cannot hit somebody behind us.
  if((p.x-origin.x)*direction.x+(p.z-origin.z)*direction.z<=.02)continue;
  const lo={x:p.x-.28,y:p.y+.06,z:p.z-.28},hi={x:p.x+.28,y:p.y+(p.crouch?1.1:1.8),z:p.z+.28};
  const expandedLo={},expandedHi={};for(const axis of ['x','y','z']){expandedLo[axis]=lo[axis]-radius;expandedHi[axis]=hi[axis]+radius;}
  const distance=segmentBox(origin,direction,expandedLo,expandedHi,range);
  if(distance===null||distance>nearest)continue;
  const direct=segmentBox(origin,direction,lo,hi,range+radius*2),point={};
  for(const axis of ['x','y','z'])point[axis]=direct===null?clamp(origin[axis]+direction[axis]*distance,lo[axis],hi[axis]):origin[axis]+direction[axis]*direct;
  const d=Math.hypot(point.x-origin.x,point.y-origin.y,point.z-origin.z);
  if(d>.0001){const sight={x:(point.x-origin.x)/d,y:(point.y-origin.y)/d,z:(point.z-origin.z)/d},obstacle=raycastWorld(origin,sight,d);if(obstacle!==null&&obstacle<d-.002)continue;}
  nearest=distance;target=p;contact=point;
 }
 const end=contact||{x:origin.x+direction.x*nearest,y:origin.y+direction.y*nearest,z:origin.z+direction.z*nearest};
 if(!target)return{end,hitId:null,hitWorld:wall!==null,backstab:false,distance:nearest};
 const dx=target.x-shooter.x,dz=target.z-shooter.z,length=Math.hypot(dx,dz),backstab=length>0&&(-Math.sin(target.yaw)*dx-Math.cos(target.yaw)*dz)/length>.475;
 return{end,hitId:target.id,hitWorld:false,backstab,distance:nearest};
}
export function knifeDamage({heavy=false,backstab=false,first=true,armor=0}={}){
 const raw=backstab?(heavy?KNIFE.backStab:KNIFE.backSlash):heavy?KNIFE.stabDamage:first?KNIFE.firstSlash:KNIFE.repeatSlash;
 return Math.floor(raw*(armor>0?KNIFE.armorScale:1));
}
