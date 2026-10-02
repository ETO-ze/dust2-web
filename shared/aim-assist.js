const RAD=Math.PI/180,clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const angle=n=>Math.atan2(Math.sin(n),Math.cos(n));
export function smokeOccludes(from,to,smokes=[]){return smokes.some(s=>{if(s.remaining!==undefined&&s.remaining<=0)return false;const d={x:to.x-from.x,y:to.y-from.y,z:to.z-from.z},length=d.x*d.x+d.y*d.y+d.z*d.z,t=length?clamp(((s.x-from.x)*d.x+(s.y-from.y)*d.y+(s.z-from.z)*d.z)/length,0,1):0;return Math.hypot(from.x+t*d.x-s.x,from.y+t*d.y-s.y,from.z+t*d.z-s.z)<s.radius;});}
export class AimAssist{
 constructor(){this.reset();}
 reset(){this.targetId=null;this.releaseUntil=0;}
 step({now,dt,yaw,pitch,origin,self,players=[],weapon,zoom=0,fov=90,level='standard',active=false,intent=false,blind=false,snapshotAge=Infinity,manual={yaw:0,pitch:0},firing=false,recoil=0,visible=()=>false}){
  const none={yaw:0,pitch:0};
  if(!active||!intent||!self?.alive||blind||!Number.isFinite(snapshotAge)||snapshotAge>250||level==='off'||!weapon||weapon.slot>2||weapon.zoomStyle==='scope'&&!zoom){this.reset();return none;}
  if(now<this.releaseUntil)return none;
  const scale=Math.min(1,Math.tan(fov*RAD/2)),acquire=2.5*RAD*scale,release=3.5*RAD*scale;
  const candidates=[];
  for(const p of players){
   if(!p.alive||p.id===self.id||p.team===self.team||p.spawnProtectionRemaining>0)continue;
   const height=p.crouch?1.1:1.8;
   for(const h of [height*.67,height*.43]){
    const point={x:p.x,y:p.y+h,z:p.z},dx=point.x-origin.x,dy=point.y-origin.y,dz=point.z-origin.z,distance=Math.hypot(dx,dy,dz);
    if(distance<.5||distance>110)continue;
    const error={yaw:angle(Math.atan2(-dx,-dz)-yaw),pitch:Math.atan2(dy,Math.hypot(dx,dz))-pitch};
    const gap=Math.hypot(error.yaw,error.pitch),limit=p.id===this.targetId?release:acquire;
    if(gap>limit||!visible(origin,point))continue;
    candidates.push({id:p.id,error,gap});break;
   }
  }
  candidates.sort((a,b)=>a.gap-b.gap);const target=candidates.find(p=>p.id===this.targetId)||candidates[0];
  if(!target){this.targetId=null;return none;}
  // Intentional movement away always wins; no sticky aim fighting the player.
  if(manual.yaw*target.error.yaw+manual.pitch*target.error.pitch< -1e-7){this.targetId=null;this.releaseUntil=now+250;return none;}
  this.targetId=target.id;
  const strength=(level==='low'?.5:1)*(weapon.zoomStyle==='scope'?.5:1),delta=clamp(dt,0,.05),gain=1-Math.exp(-2*strength*delta),max=5*RAD*scale*strength*delta;
  let x=target.error.yaw*gain,y=firing||recoil>1e-5?0:target.error.pitch*gain;
  const length=Math.hypot(x,y);if(length>max){x*=max/length;y*=max/length;}
  return {yaw:x,pitch:y};
 }
}
