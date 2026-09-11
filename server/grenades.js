import {getWeapon} from '../shared/weapons.js';
import { EQUIPMENT, UTILITY_IDS } from '../shared/equipment.js';

const xyz = point => ({ x: point.x, y: point.y, z: point.z });
const distance = (a, b) => Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
export function segmentIntersectsSmoke(a, b, smoke) {
  const dx=b.x-a.x,dy=b.y-a.y,dz=b.z-a.z,length=dx*dx+dy*dy+dz*dz;
  const t=length?Math.max(0,Math.min(1,((smoke.x-a.x)*dx+(smoke.y-a.y)*dy+(smoke.z-a.z)*dz)/length)):0;
  return Math.hypot(a.x+t*dx-smoke.x,a.y+t*dy-smoke.y,a.z+t*dz-smoke.z)<smoke.radius;
}

/** Server-owned projectiles, bounded surface fire and smoke. Browser approximation. */
export class GrenadeSimulation {
  constructor({clock=()=>Date.now(),raycastWorld=()=>null,raycastContact=null,emit=()=>{},onExplosion=()=>{},onFlash=()=>{},onFire=()=>{}}={}){
    Object.assign(this,{clock,raycastWorld,raycastContact,emit,onExplosion,onFlash,onFire});
    this.projectiles=[];this.smokes=[];this.fires=[];this.decoys=[];this.serial=0;
  }
  clear(){this.projectiles.length=this.smokes.length=this.fires.length=this.decoys.length=0;}
  clearSight(a,b){const length=distance(a,b);if(length<.01)return true;const hit=this.raycastWorld(a,{x:(b.x-a.x)/length,y:(b.y-a.y)/length,z:(b.z-a.z)/length},length);return hit===null||hit>=length-.03;}
  blocksSight(a,b){const now=this.clock();return this.smokes.some(s=>s.expiresAt>now&&segmentIntersectsSmoke(a,b,s));}
  contact(origin,dir,length){
    if(this.raycastContact)return this.raycastContact(origin,dir,length);
    const hit=this.raycastWorld(origin,dir,length);if(hit===null)return null;
    // Compatibility for distance-only test worlds. Production supplies the BVH normal.
    const normal={};for(const axis of ['x','y','z']){const h=this.raycastWorld({...origin,[axis]:origin[axis]+.0001},dir,length+.01);normal[axis]=h===null?0:(h-hit)/.0001;}
    const n=Math.hypot(normal.x,normal.y,normal.z);if(n>.01)for(const axis of ['x','y','z'])normal[axis]/=n;else for(const axis of ['x','y','z'])normal[axis]=-dir[axis];
    return {distance:hit,normal};
  }
  sweep(origin,dir,length){
    let best=null;const radius=.06;
    for(const offset of [{x:0,y:0,z:0},{x:radius,y:0,z:0},{x:-radius,y:0,z:0},{x:0,y:radius,z:0},{x:0,y:-radius,z:0},{x:0,y:0,z:radius},{x:0,y:0,z:-radius}]){
      const h=this.contact({x:origin.x+offset.x,y:origin.y+offset.y,z:origin.z+offset.z},dir,length+radius);if(!h)continue;
      const center=offset.x===0&&offset.y===0&&offset.z===0,closing=-(dir.x*h.normal.x+dir.y*h.normal.y+dir.z*h.normal.z);
      if(closing<.00001)continue;
      const d=Math.max(0,h.distance-(center?radius/closing:0));
      if(d<=length&&(!best||d<best.distance))best={...h,distance:d};
    }
    return best;
  }
  throwGrenade(player,weapon,input){
    if(!UTILITY_IDS.includes(weapon)||this.projectiles.length>=40)return false;
    const config=EQUIPMENT[weapon],rawPitch=Math.max(-1.48,Math.min(1.48,input.pitch)),pitch=rawPitch+(Math.PI/18)*(1-Math.abs(rawPitch)/(Math.PI/2)),c=Math.cos(pitch);
    const direction={x:-Math.sin(input.yaw)*c,y:Math.sin(pitch),z:-Math.cos(input.yaw)*c};
    const strength=Number.isFinite(input.throwStrength)?Math.max(0,Math.min(1,input.throwStrength)):1;
    const throwMode=input.throwMode==='drop'?'drop':input.throwMode==='lob'?'lob':'full';
    const speed=config.throwSpeed*.9*(.3+.7*strength);
    const origin={x:player.x,y:player.y+(player.crouch?.95:1.62)-(1-strength)*.3,z:player.z};
    const blocked=this.sweep(origin,direction,.4),offset=blocked?Math.max(0,blocked.distance-.01):.35;
    const grenade={id:`grenade_${++this.serial}`,weapon,ownerId:player.id,team:player.team,decoyWeapon:Object.keys(player.inventory||{}).find(id=>getWeapon(id).slot===1)||Object.keys(player.inventory||{}).find(id=>getWeapon(id).slot===2)||player.loadoutPrimary||'ak47',
      x:origin.x+direction.x*offset,y:origin.y+direction.y*offset,z:origin.z+direction.z*offset,
      vx:direction.x*speed+(player.vx||0)*1.25,vy:direction.y*speed+(player.vy||0)*1.25,vz:direction.z*speed+(player.vz||0)*1.25,throwMode,throwStrength:strength,
      bornAt:this.clock(),detonateAt:this.clock()+config.fuse*1000};
    this.projectiles.push(grenade);this.emit('grenade_thrown',{grenadeId:grenade.id,shooterId:player.id,weapon,mode:throwMode,strength,origin:xyz(grenade)});return true;
  }
  advance(g,dt){
    if(g.resting)return;const config=EQUIPMENT[g.weapon];g.vy-=config.gravity*dt*.5;
    let remaining=dt;
    for(let bounce=0;bounce<4&&remaining>1e-6;bounce++){
      const speed=Math.hypot(g.vx,g.vy,g.vz);if(speed<1e-6)break;
      const dir={x:g.vx/speed,y:g.vy/speed,z:g.vz/speed},travel=speed*remaining,hit=this.sweep(g,dir,travel);
      if(!hit){g.x+=dir.x*travel;g.y+=dir.y*travel;g.z+=dir.z*travel;break;}
      const n=hit.normal;g.x+=dir.x*hit.distance+n.x*.002;g.y+=dir.y*hit.distance+n.y*.002;g.z+=dir.z*hit.distance+n.z*.002;
      if(n.y>.7&&config.effect==='fire'){g.ignite=true;g.vx=g.vy=g.vz=0;return;}
      const dot=g.vx*n.x+g.vy*n.y+g.vz*n.z;
      for(const axis of ['x','y','z'])g['v'+axis]=(g['v'+axis]-2*dot*n[axis])*config.bounce;
      if(Math.abs(dot)>1&&this.clock()-(g.lastBounceAt||-1000)>90){g.lastBounceAt=this.clock();this.emit('grenade_bounce',{grenadeId:g.id,weapon:g.weapon,origin:xyz(g)});}
      if(n.y>.7&&Math.hypot(g.vx,g.vy,g.vz)<1.2){g.vx=g.vy=g.vz=0;g.resting=true;return;}
      remaining*=Math.max(0,1-hit.distance/Math.max(travel,.001));
    }
    g.vy-=config.gravity*dt*.5;
  }
  ignite(g,config){
    const cells=[];
    for(let x=-config.radius;x<=config.radius;x+=.8)for(let z=-config.radius;z<=config.radius;z+=.8){
      if(x*x+z*z>config.radius*config.radius||cells.length>=60)continue;
      const from={x:g.x+x,y:g.y+.45,z:g.z+z},floor=this.contact(from,{x:0,y:-1,z:0},1.3);
      if(!floor||floor.normal.y<.7)continue;
      const cell={x:from.x,y:from.y-floor.distance+.025,z:from.z};
      if(this.clearSight({x:g.x,y:g.y+.25,z:g.z},{...cell,y:cell.y+.25}))cells.push(cell);
    }
    if(!cells.length)return;
    const fire={id:g.id,ownerId:g.ownerId,team:g.team,weapon:g.weapon,...xyz(g),cells,createdAt:this.clock(),expiresAt:this.clock()+config.duration*1000,nextDamageAt:this.clock()};
    this.fires.push(fire);if(this.fires.length>12)this.fires.shift();this.extinguish();
    if(fire.cells.length)this.emit('fire_started',{grenadeId:g.id,weapon:g.weapon,origin:xyz(g),duration:config.duration});
  }
  extinguish(){
    const now=this.clock();for(const fire of this.fires){const before=fire.cells.length;fire.cells=fire.cells.filter(c=>!this.smokes.some(s=>s.expiresAt>now&&distance({...c,y:c.y+.4},s)<s.radius));if(before&&!fire.cells.length)this.emit('fire_extinguished',{grenadeId:fire.id,origin:xyz(fire)});}
    this.fires=this.fires.filter(f=>f.cells.length&&f.expiresAt>now);
  }
  detonate(g){
    const config=EQUIPMENT[g.weapon],origin=xyz(g),now=this.clock();
    if(g.weapon==='smokegrenade'){
      const smoke={id:g.id,ownerId:g.ownerId,team:g.team,...origin,y:origin.y+1.3,radius:config.radius,createdAt:now,expiresAt:now+config.duration*1000};
      this.smokes.push(smoke);if(this.smokes.length>40)this.smokes.shift();this.extinguish();
      this.emit('smoke',{grenadeId:g.id,ownerId:g.ownerId,origin:xyz(smoke),radius:config.radius,duration:config.duration});
    }else if(g.weapon==='flashbang')this.onFlash(g,config);
    else if(config.effect==='fire'){if(g.ignite)this.ignite(g,config);else this.emit('fire_failed',{grenadeId:g.id,weapon:g.weapon,origin});}
    else if(config.effect==='decoy'){this.decoys.push({...g,createdAt:now,expiresAt:now+config.duration*1000,nextSoundAt:now});if(this.decoys.length>20)this.decoys.shift();}
    else {this.emit('explosion',{grenadeId:g.id,ownerId:g.ownerId,weapon:g.weapon,origin,radius:config.radius});this.onExplosion(g,config);}
  }
  tick(dt){
    const now=this.clock();this.smokes=this.smokes.filter(s=>s.expiresAt>now);this.extinguish();
    for(const f of this.fires)if(now>=f.nextDamageAt){f.nextDamageAt=now+200;this.onFire(f,EQUIPMENT[f.weapon]);}
    for(let i=this.decoys.length-1;i>=0;i--){const d=this.decoys[i];if(now>=d.expiresAt){this.emit('explosion',{grenadeId:d.id,weapon:'decoy',origin:xyz(d),radius:2});this.onExplosion(d,EQUIPMENT.decoy);this.decoys.splice(i,1);}else if(now>=d.nextSoundAt){d.nextSoundAt=now+900;this.emit('decoy_pulse',{grenadeId:d.id,weapon:d.decoyWeapon,origin:xyz(d)});}}
    for(let i=this.projectiles.length-1;i>=0;i--){
      const g=this.projectiles[i];let remaining=Math.max(0,Math.min(.25,dt));
      while(remaining>1e-8&&!g.ignite){const step=Math.min(1/120,remaining);this.advance(g,step);remaining-=step;}
      if(!Number.isFinite(g.x+g.y+g.z)||g.y< -250){this.projectiles.splice(i,1);continue;}
      const delayed=['smokegrenade','decoy'].includes(g.weapon),settled=g.resting;
      if(g.ignite||now>=g.detonateAt&&(!delayed||settled)){this.detonate(g);this.projectiles.splice(i,1);}else if(now-g.bornAt>12000)this.projectiles.splice(i,1);
    }
  }
  snapshot(){const now=this.clock();return {grenades:this.projectiles.map(({id,weapon,ownerId,team,x,y,z,vx,vy,vz})=>({id,weapon,ownerId,team,x,y,z,vx,vy,vz})),smokes:this.smokes.map(s=>({...s,remaining:Math.max(0,(s.expiresAt-now)/1000)})),fires:this.fires.map(({nextDamageAt,...f})=>({...f,remaining:Math.max(0,(f.expiresAt-now)/1000)})),decoys:this.decoys.map(d=>({id:d.id,weapon:'decoy',...xyz(d),remaining:Math.max(0,(d.expiresAt-now)/1000)}))};}
}
