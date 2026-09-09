import { EQUIPMENT, UTILITY_IDS } from '../shared/equipment.js';

const xyz = point => ({ x: point.x, y: point.y, z: point.z });
const distance = (a, b) => Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
export function segmentIntersectsSmoke(a, b, smoke) {
  const dx=b.x-a.x,dy=b.y-a.y,dz=b.z-a.z,length=dx*dx+dy*dy+dz*dz;
  const t=length?Math.max(0,Math.min(1,((smoke.x-a.x)*dx+(smoke.y-a.y)*dy+(smoke.z-a.z)*dz)/length)):0;
  return Math.hypot(a.x+t*dx-smoke.x,a.y+t*dy-smoke.y,a.z+t*dz-smoke.z)<smoke.radius;
}

/** Server-owned projectiles. Axis sweeps/bounces and spherical smoke are a
 * lightweight approximation; this does not claim Source 2 volumetric smoke. */
export class GrenadeSimulation {
  constructor({ clock=()=>Date.now(), raycastWorld=()=>null, emit=()=>{}, onExplosion=()=>{}, onFlash=()=>{} }={}) {
    this.clock=clock;this.raycastWorld=raycastWorld;this.emit=emit;this.onExplosion=onExplosion;this.onFlash=onFlash;
    this.projectiles=[];this.smokes=[];this.serial=0;
  }
  clear(){this.projectiles.length=0;this.smokes.length=0;}
  clearSight(a,b){const length=distance(a,b);if(length<.01)return true;const hit=this.raycastWorld(a,{x:(b.x-a.x)/length,y:(b.y-a.y)/length,z:(b.z-a.z)/length},length);return hit===null||hit>=length-.03;}
  blocksSight(a,b){const now=this.clock();return this.smokes.some(smoke=>smoke.expiresAt>now&&segmentIntersectsSmoke(a,b,smoke));}
  throwGrenade(player,weapon,input){
    if(!UTILITY_IDS.includes(weapon)||this.projectiles.length>=40)return false;
    const config=EQUIPMENT[weapon],pitch=Math.max(-1.48,Math.min(1.48,input.pitch+.12)),c=Math.cos(pitch);
    const direction={x:-Math.sin(input.yaw)*c,y:Math.sin(pitch),z:-Math.cos(input.yaw)*c};
    const strength=Number.isFinite(input.throwStrength)?Math.max(0,Math.min(1,input.throwStrength)):1;
    const throwMode=input.throwMode==='drop'?'drop':input.throwMode==='lob'?'lob':'full';
    const speed=config.throwSpeed*(.3+.7*strength);
    const origin={x:player.x,y:player.y+(player.crouch?.95:1.6)-(1-strength)*.3,z:player.z};
    const blocked=this.raycastWorld(origin,direction,.35),offset=blocked===null?.30:Math.max(0,blocked-.08);
    const grenade={id:`grenade_${++this.serial}`,weapon,ownerId:player.id,team:player.team,
      x:origin.x+direction.x*offset,y:origin.y+direction.y*offset,z:origin.z+direction.z*offset,
      vx:direction.x*speed+(player.vx||0),vy:direction.y*speed+(player.vy||0),vz:direction.z*speed+(player.vz||0),throwMode,throwStrength:strength,
      bornAt:this.clock(),detonateAt:this.clock()+config.fuse*1000};
    this.projectiles.push(grenade);this.emit('grenade_thrown',{grenadeId:grenade.id,shooterId:player.id,weapon,mode:throwMode,strength,origin:xyz(grenade)});return true;
  }
  advance(grenade,dt){
    const config=EQUIPMENT[grenade.weapon];grenade.vy-=config.gravity*dt;
    for(const axis of ['x','y','z']){
      const velocity='v'+axis,travel=grenade[velocity]*dt;if(Math.abs(travel)<1e-7)continue;
      const dir={x:0,y:0,z:0};dir[axis]=Math.sign(travel);
      const hit=this.raycastWorld(grenade,dir,Math.abs(travel)+.065);
      if(hit!==null&&hit<=Math.abs(travel)+.065){
        grenade[axis]+=Math.sign(travel)*Math.max(0,hit-.07);grenade[velocity]*=-config.bounce;
        if(axis==='y'){grenade.vx*=.78;grenade.vz*=.78;if(Math.abs(grenade.vy)<.35)grenade.vy=0;}
      }else grenade[axis]+=travel;
    }
  }
  detonate(grenade){
    const config=EQUIPMENT[grenade.weapon],origin=xyz(grenade);
    if(grenade.weapon==='smokegrenade'){
      const smoke={id:grenade.id,ownerId:grenade.ownerId,team:grenade.team,...origin,y:origin.y+1.3,radius:config.radius,createdAt:this.clock(),expiresAt:this.clock()+config.duration*1000};
      this.smokes.push(smoke);if(this.smokes.length>40)this.smokes.shift();
      this.emit('smoke',{grenadeId:grenade.id,ownerId:grenade.ownerId,origin:xyz(smoke),radius:config.radius,duration:config.duration});
    }else if(grenade.weapon==='flashbang')this.onFlash(grenade,config);
    else {this.emit('explosion',{grenadeId:grenade.id,ownerId:grenade.ownerId,weapon:grenade.weapon,origin,radius:config.radius});this.onExplosion(grenade,config);}
  }
  tick(dt){
    const now=this.clock();this.smokes=this.smokes.filter(smoke=>smoke.expiresAt>now);
    for(let i=this.projectiles.length-1;i>=0;i--){
      const grenade=this.projectiles[i];if(!grenade)continue;let remaining=Math.max(0,Math.min(.25,dt));
      while(remaining>1e-8){const step=Math.min(1/120,remaining);this.advance(grenade,step);remaining-=step;}
      if(!Number.isFinite(grenade.x+grenade.y+grenade.z)||grenade.y< -250){this.projectiles.splice(i,1);continue;}
      const settled=Math.hypot(grenade.vx,grenade.vy,grenade.vz)<.5;
      if(now>=grenade.detonateAt&&(grenade.weapon!=='smokegrenade'||settled||now-grenade.bornAt>=3000)){this.detonate(grenade);this.projectiles.splice(i,1);}
    }
  }
  snapshot(){const now=this.clock();return {grenades:this.projectiles.map(({id,weapon,ownerId,team,x,y,z,vx,vy,vz})=>({id,weapon,ownerId,team,x,y,z,vx,vy,vz})),smokes:this.smokes.map(smoke=>({...smoke,remaining:Math.max(0,(smoke.expiresAt-now)/1000)}))};}
}
