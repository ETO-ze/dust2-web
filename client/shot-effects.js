import * as THREE from 'three';
import {WEAPON_BALLISTICS} from '../shared/weapon-ballistics.js';
const up=new THREE.Vector3(0,1,0);
/** Bounded reusable geometry; events use the server's real collision endpoints. */
export class Effects{
 constructor(scene){this.scene=scene;this.items=[];this.counts=new Map();this.pool=[];this.geometry=new THREE.CylinderGeometry(1,1,1,4);this.impactGeo=new THREE.SphereGeometry(.025,5,4);}
 spawn(a,b,{impact=false,sniper=false}={}){
  if(this.items.length>=96)this.recycle(this.items.shift());
  let item=this.pool.pop();if(!item){const material=new THREE.MeshBasicMaterial({color:0xffe3a5,transparent:true,depthWrite:false,toneMapped:false});item={obj:new THREE.Mesh(this.geometry,material)};item.obj.frustumCulled=false;}
  const length=a.distanceTo(b);item.obj.geometry=impact?this.impactGeo:this.geometry;item.obj.position.copy(a).lerp(b,.5);
  item.obj.scale.set(impact?1:sniper?.009:.006,impact?1:Math.max(.001,length),impact?1:sniper?.009:.006);
  if(!impact)item.obj.quaternion.setFromUnitVectors(up,b.clone().sub(a).normalize());else item.obj.quaternion.identity();
  item.life=item.max=impact?.12:sniper?.16:.085;item.obj.material.opacity=impact?.95:.8;this.scene.add(item.obj);this.items.push(item);
 }
 shot(origin,end,own=false,{weapon='ak47',shooterId='local',muzzle=null,hitWorld=false,segments=[]}={}){
  const now=performance.now(),previous=this.counts.get(shooterId),count=!previous||now-previous.time>350?0:previous.count+1;
  this.counts.set(shooterId,{count,time:now});if(this.counts.size>24)this.counts.delete(this.counts.keys().next().value);
  const frequency=WEAPON_BALLISTICS[weapon]?.tracerFrequency||0,b=new THREE.Vector3(end.x,end.y,end.z);
  if(frequency&&count%frequency===0){const a=muzzle?.clone?.()||new THREE.Vector3(origin.x,origin.y,origin.z);if(own&&!muzzle)a.addScaledVector(b.clone().sub(a).normalize(),.55);this.spawn(a,b,{sniper:['awp','ssg08','scar20'].includes(weapon)});}
  if(hitWorld)this.spawn(b,b,{impact:true});
  for(const segment of segments.slice(0,4)){const p=new THREE.Vector3(segment.exit.x,segment.exit.y,segment.exit.z);this.spawn(p,p,{impact:true});}
 }
 recycle(item){item.obj.removeFromParent();this.pool.push(item);}
 update(dt){for(let i=this.items.length-1;i>=0;i--){const e=this.items[i];e.life-=dt;if(e.life<=0){this.items.splice(i,1);this.recycle(e);}else e.obj.material.opacity=.8*e.life/e.max;}}
 clear(){for(const e of this.items)this.recycle(e);this.items.length=0;this.counts.clear();}
 dispose(){this.clear();for(const e of this.pool)e.obj.material.dispose();this.pool.length=0;this.geometry.dispose();this.impactGeo.dispose();}
}
