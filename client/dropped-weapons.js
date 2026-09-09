import * as THREE from 'three';
import {clone} from 'three/addons/utils/SkeletonUtils.js';
import {loadedSkin,loadSkin,retainSkin,releaseSkin} from './skin-assets.js';
import {getWeapon} from '../shared/weapons.js';
import {getSkin} from '../shared/skins.js';
import {disposeInstanceSkeletons} from './resource-lifecycle.js';
import {raycastWorld} from '../shared/physics.js';
export class DroppedWeapons{
 constructor(scene){this.scene=scene;this.items=new Map();this.pending=new Map();this.retry=new Map();this.drops=[];this.hint=document.createElement('div');this.hint.id='pickup-prompt';this.hint.hidden=true;this.hint.style.cssText='position:fixed;left:50%;top:60%;transform:translateX(-50%);padding:10px 18px;background:#111b24c9;color:#ecf2f4;border-bottom:2px solid #cbd8df;font:15px sans-serif;pointer-events:none;z-index:8';document.body.append(this.hint);}
 sync(snapshot){this.drops=snapshot.droppedWeapons||[];}
 update(player,camera,active,binding='E'){
  const nearby=this.drops.map(d=>({d,distance:Math.hypot(d.x-camera.position.x,d.y-camera.position.y,d.z-camera.position.z)})).filter(o=>o.distance<28).sort((a,b)=>a.distance-b.distance).slice(0,12),keep=new Set(nearby.map(o=>o.d.id));
  for(const [id,item]of this.items)if(!keep.has(id)){item.group.removeFromParent();disposeInstanceSkeletons(item.group);releaseSkin(item.skinId);this.items.delete(id);}
  let candidate=null;const eye=player?new THREE.Vector3(player.x,player.y+(player.crouch?.95:1.6),player.z):camera.position.clone(),cos=Math.cos(player?.pitch||0),facing=new THREE.Vector3(-Math.sin(player?.yaw||0)*cos,Math.sin(player?.pitch||0),-Math.cos(player?.yaw||0)*cos);
  for(const {d,distance}of nearby){
   let item=this.items.get(d.id);if(!item&&getSkin(d.skinId)){
    // Distant drops never download cosmetics; only the closest few are loaded.
    const source=loadedSkin(d.skinId);
    if(!source&&distance<12&&this.pending.size<2&&!this.pending.has(d.skinId)&&(this.retry.get(d.skinId)||0)<=performance.now()){
      this.retry.set(d.skinId,performance.now()+30000);const task=loadSkin(d.skinId).catch(()=>{}).finally(()=>this.pending.delete(d.skinId));this.pending.set(d.skinId,task);
    }
    if(source&&this.items.size<12){
      const content=clone(source.scene),group=new THREE.Group();content.updateMatrixWorld(true);
      content.traverse(o=>{if(o.isSkinnedMesh){o.skeleton.update();o.computeBoundingBox();}});
      const box=new THREE.Box3().setFromObject(content);content.position.sub(box.getCenter(new THREE.Vector3()));
      // Exported weapon geometry is already in metres. Lay its authored +Y
      // thickness sideways, retaining actual rifle/pistol dimensions.
      group.add(content);group.rotation.set(0,0,Math.PI/2);group.updateMatrixWorld(true);const laid=new THREE.Box3().setFromObject(group),height=laid.getSize(new THREE.Vector3()).y;
      this.scene.add(group);retainSkin(d.skinId);item={group,skinId:d.skinId,heightOffset:height*.5-.08+.006};this.items.set(d.id,item);
    }
   }
   // Follow every authoritative physics snapshot. Previously the visual was
   // stuck at its first airborne position while the actual item fell away.
   if(item){item.group.position.set(d.x,d.y+item.heightOffset,d.z);item.group.rotation.set(0,d.yaw||0,Math.PI/2);}
   const delta=new THREE.Vector3(d.x,d.y,d.z).sub(eye),pickupDistance=delta.length(),aim=delta.clone().normalize().dot(facing),horizontal=player?Math.hypot(d.x-player.x,d.z-player.z):Infinity;
   // Match server/dropped-weapons.js: nearest reachable item within 2.8 m,
   // with a facing check only outside the 0.9 m area directly at your feet.
   if(active&&player?.alive&&pickupDistance<=2.8&&(horizontal<=.9||aim>=.55)&&(d.remaining===undefined||d.remaining>0)&&(!candidate||pickupDistance<candidate.distance)){
    const obstruction=raycastWorld(eye,delta,pickupDistance);if(obstruction===null||obstruction>=pickupDistance-.12)candidate={d,distance:pickupDistance};
   }
  }
  this.hint.hidden=!candidate;
  if(candidate)this.hint.textContent=`[${binding}] 拾取 ${getWeapon(candidate.d.weaponId).name} · ${getSkin(candidate.d.skinId)?.name||''} · ${candidate.d.ammo} / ${candidate.d.reserve}`;
 }
 clear(){for(const item of this.items.values()){item.group.removeFromParent();disposeInstanceSkeletons(item.group);releaseSkin(item.skinId);}this.items.clear();this.drops=[];this.hint.hidden=true;}
 dispose(){this.clear();this.hint.remove();}
}
