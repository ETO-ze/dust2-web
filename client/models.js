import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { loadPlayerAssets, choosePlayerAnimation, loadedPlayerAsset } from './player-assets.js';
import { loadViewModels } from './viewmodel.js';
import { UTILITY_IDS } from '../shared/equipment.js';
import { getWeapon, WEAPONS } from '../shared/weapons.js';
import { DEFAULT_SKINS, getSkin } from '../shared/skins.js';
import { registerDefaultSkin, loadedSkin, requestSkin, retainSkin, releaseSkin } from './skin-assets.js';
import { disposeInstanceAnimation, disposeInstanceSkeletons } from './resource-lifecycle.js';
export { ViewWeapon } from './viewmodel.js';

const loader=new GLTFLoader();
const library={};
export async function loadModels(options={}){
  const agents=await loadPlayerAssets(loader);library.swat=agents.CT;library.hoodie=agents.T;
  await loadViewModels(library);
}

function box(w,h,d,color){return new THREE.Mesh(new THREE.BoxGeometry(w,h,d),new THREE.MeshStandardMaterial({color,roughness:.8}));}

export class PlayerModel{
  constructor(team,scene,agentId){
    this.group=new THREE.Group();this.team=team;scene.add(this.group);this.current='';this.dead=false;this.ownedResources=new Set();this.disposed=false;
    this.agentId=agentId||(team==='CT'?'ct-sas':'t-phoenix');const source=loadedPlayerAsset(this.agentId)||library[team==='CT'?'swat':'hoodie'];
    if(source){this.model=clone(source.scene);this.nativeAgent=!!source.scene.userData.cs2DefaultAgent;this.model.rotation.y=Math.PI;this.group.add(this.model);this.mixer=new THREE.AnimationMixer(this.model);this.actions={};source.animations.forEach(a=>this.actions[a.name]=this.mixer.clipAction(a));this.model.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}if(/pistol/i.test(o.name))o.visible=false;});this.animate(this.nativeAgent?'rifle/idle':'Idle_Gun_Pointing');}
    else{this.model=new THREE.Group();this.group.add(this.model);const torso=box(.55,.7,.33,team==='CT'?0x3c5662:0x967746);torso.position.y=1.04;this.model.add(torso);const head=new THREE.Mesh(new THREE.SphereGeometry(.2,12,10),new THREE.MeshStandardMaterial({color:0xa78b70}));head.position.y=1.61;this.model.add(head);for(const x of [-.15,.15]){const leg=box(.2,.7,.2,0x344036);leg.position.set(x,.35,0);this.model.add(leg);}this.model.traverse(o=>{if(o.isMesh){this.ownedResources.add(o.geometry);for(const material of [].concat(o.material))this.ownedResources.add(material);}});}
    const ring=new THREE.Mesh(new THREE.RingGeometry(.32,.37,24),new THREE.MeshBasicMaterial({color:team==='CT'?0x82bac9:0xdcbf77,side:THREE.DoubleSide,transparent:true,opacity:.45,depthWrite:false}));ring.rotation.x=-Math.PI/2;ring.position.y=.025;this.group.add(ring);this.ring=ring;this.ownedResources.add(ring.geometry);this.ownedResources.add(ring.material);
    this.gun=new THREE.Group();this.group.add(this.gun);this.weaponCache=new Map();this.weaponId='';
    this.arms={};const bones=new Map();this.model.traverse(o=>{if(o.isBone){const name=o.name.replace(/[^a-z0-9]/gi,'').toLowerCase();bones.set(name,o);for(const side of ['L','R'])for(const key of ['UpperArm','LowerArm','Wrist'])if(name===(key+side).toLowerCase()||name===({UpperArm:'armupper',LowerArm:'armlower',Wrist:'hand'}[key]+side).toLowerCase()){this.arms[side]??={};this.arms[side][key]=o;}}});
    this.supportFingers=[];for(const [name,bone] of bones){if(/^(index|middle|ring|pinky|thumb)\dr$/.test(name)){const left=bones.get(name.slice(0,-1)+'l');if(left)this.supportFingers.push([left,bone]);}}
    // The original pistol aiming pose provides a stable hand orientation. Arm IK is applied after each animation update.
    this.mixer?.update(.2);this.group.updateMatrixWorld(true);this.handReference={};
    if(this.arms.R?.Wrist){const q=this.arms.R.Wrist.getWorldQuaternion(new THREE.Quaternion());this.handReference.R=q;this.handReference.L=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),Math.PI).multiply(q);}
    this.setWeapon(team==='CT'?'m4a1':'ak47');
  }
  setWeapon(id,skinId){
    id=WEAPONS[id]||UTILITY_IDS.includes(id)?id:'knife';
    if(UTILITY_IDS.includes(id))skinId=id;else if(getSkin(skinId)?.weapon!==id)skinId=DEFAULT_SKINS[id];
    requestSkin(skinId);const visibleSkin=loadedSkin(skinId)?skinId:UTILITY_IDS.includes(id)?id:DEFAULT_SKINS[id],cacheKey=id+':'+visibleSkin;
    if(!loadedSkin(visibleSkin)){this.gun.visible=false;return;}
    if(id===this.weaponId&&this.skinId===visibleSkin)return;this.weaponId=id;this.skinId=visibleSkin;this.gun.clear();
    if(!this.weaponCache.has(cacheKey)){
      const spec={ak47:{key:'rifle',length:.72,grip:[0,-.065,.125],support:[0,.090,-.235]},m4a1:{key:'m4a1',length:.75,grip:[0,-.067,.18],support:[0,.085,-.255]},awp:{key:'sniper',length:1,grip:[0,-.045,.22],support:[0,.025,-.28]},pistol:{key:'pistol',length:.23,grip:[0,-.045,.08]},usp:{key:'usp',length:.36,grip:[0,-.045,.085]},knife:{key:'knife',length:.24,grip:[0,0,.065]}}[id]||{key:id,length:getWeapon(id).slot===4?.13:getWeapon(id).slot===2?.25:getWeapon(id).category==='mid'?.6:.88,grip:[0,-.05,.12],...(getWeapon(id).slot===1?{support:[0,.055,-.24]}:{})};
      const visual=new THREE.Group(),resources=[];const source=loadedSkin(visibleSkin)||library[spec.key];
      if(source){const content=clone(source.scene);content.updateMatrixWorld(true);const bounds=new THREE.Box3().setFromObject(content),size=bounds.getSize(new THREE.Vector3());content.position.sub(bounds.getCenter(new THREE.Vector3()));const normalized=new THREE.Group();normalized.add(content);normalized.scale.setScalar(spec.length/Math.max(.001,size.z));visual.add(normalized);}
      else{
        const part=(w,h,d,color,x,y,z)=>{const m=box(w,h,d,color);m.position.set(x,y,z);resources.push(m.geometry,m.material);visual.add(m);};
        if(id==='knife'){part(.033,.014,.19,0xb8bfb5,0,0,-.045);part(.045,.032,.09,0x30392e,0,0,.095);part(.085,.021,.015,0x65705b,0,0,.045);}
        else{part(.055,.065,spec.length*.48,0x31382f,0,0,.01);part(.022,.022,spec.length*.36,0x222923,0,.017,-spec.length*.32);part(.035,.10,.045,0x383d31,...spec.grip);}
      }
      visual.position.set(...spec.grip).multiplyScalar(-1);visual.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});retainSkin(visibleSkin);this.weaponCache.set(cacheKey,{...spec,visual,resources,skinId:visibleSkin});
    }
    this.weaponSpec=this.weaponCache.get(cacheKey);this.gun.add(this.weaponSpec.visual);
    this.weaponCache.delete(cacheKey);this.weaponCache.set(cacheKey,this.weaponSpec);
    while(this.weaponCache.size>4){const key=this.weaponCache.keys().next().value,item=this.weaponCache.get(key);this.weaponCache.delete(key);disposeInstanceSkeletons(item.visual);item.visual.removeFromParent();item.resources.forEach(r=>r.dispose());releaseSkin(item.skinId);}
  }
  solveArm(side,target,handQuaternion){
    const arm=this.arms[side];if(!arm?.UpperArm||!arm.LowerArm||!arm.Wrist)return;
    const upper=arm.UpperArm,lower=arm.LowerArm,wrist=arm.Wrist;
    const a=upper.getWorldPosition(new THREE.Vector3()),b=lower.getWorldPosition(new THREE.Vector3()),c=wrist.getWorldPosition(new THREE.Vector3());
    const l1=a.distanceTo(b),l2=b.distanceTo(c);if(l1<.001||l2<.001)return;
    const direction=target.clone().sub(a),distance=THREE.MathUtils.clamp(direction.length(),Math.abs(l1-l2)+.001,l1+l2-.001);direction.normalize();
    const bend=new THREE.Vector3(side==='R'?.75:-.75,-1,.20).applyQuaternion(this.group.getWorldQuaternion(new THREE.Quaternion()));bend.addScaledVector(direction,-bend.dot(direction)).normalize();
    const along=(l1*l1+distance*distance-l2*l2)/(2*distance),height=Math.sqrt(Math.max(0,l1*l1-along*along));
    const elbow=a.clone().addScaledVector(direction,along).addScaledVector(bend,height),end=a.clone().addScaledVector(direction,distance);
    const rotate=(bone,from,to)=>{const correction=new THREE.Quaternion().setFromUnitVectors(from.normalize(),to.normalize()),world=bone.getWorldQuaternion(new THREE.Quaternion()).premultiply(correction);bone.quaternion.copy(bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(world));bone.updateWorldMatrix(false,true);};
    rotate(upper,b.clone().sub(a),elbow.clone().sub(a));
    const actualElbow=lower.getWorldPosition(new THREE.Vector3()),actualHand=wrist.getWorldPosition(new THREE.Vector3());rotate(lower,actualHand.sub(actualElbow),end.sub(actualElbow));
    if(handQuaternion)wrist.quaternion.copy(wrist.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(handQuaternion));wrist.updateWorldMatrix(false,true);
  }
  updateWeapon(p){
    this.gun.visible=Boolean(p.alive);if(!p.alive)return;this.setWeapon(p.weapon||'ak47',p.skinId);if(!this.gun.visible||!this.weaponSpec)return;
    const pitch=Number.isFinite(p.pitch)?p.pitch:0,aim=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),pitch);this.gun.quaternion.copy(aim);
    const scale=this.nativeAgent?(p.crouch?.66:1):this.model.scale.y,pistol=getWeapon(this.weaponId).slot===2,knife=this.weaponId==='knife',pivot=new THREE.Vector3(0,1.35*scale,0);
    const grip=new THREE.Vector3(knife?.18:pistol?.15:.10,(knife?1.06:pistol?1.36:1.30)*scale,knife?-.18:pistol?-.46:-.13).sub(pivot).applyQuaternion(aim).add(pivot);
    this.group.updateMatrixWorld(true);
    if(this.handReference.R&&this.arms.R?.Wrist){
      const groupQuaternion=this.group.getWorldQuaternion(new THREE.Quaternion()),rightQ=groupQuaternion.clone().multiply(aim).multiply(this.handReference.R),palm=new THREE.Vector3(0,.07,0).applyQuaternion(rightQ);
      const worldGrip=this.group.localToWorld(grip.clone());this.solveArm('R',worldGrip.sub(palm),rightQ);
      this.gun.position.copy(this.group.worldToLocal(this.arms.R.Wrist.getWorldPosition(new THREE.Vector3()).add(palm)));
      this.gun.updateWorldMatrix(false,true);
      if(this.weaponSpec.support&&this.arms.L?.Wrist){for(const [left,right] of this.supportFingers){const q=right.quaternion;left.quaternion.set(q.x,-q.y,-q.z,q.w);}const leftQ=groupQuaternion.multiply(aim).multiply(this.handReference.L),leftPalm=new THREE.Vector3(0,.07,0).applyQuaternion(leftQ);const support=this.gun.localToWorld(new THREE.Vector3(...this.weaponSpec.support));this.solveArm('L',support.sub(leftPalm),leftQ);}
    }else this.gun.position.copy(grip);
  }
  animate(name){if(!this.actions||this.current===name)return;const action=this.actions[name]||this.actions.Idle_Gun||Object.values(this.actions)[0];if(!action)return;for(const a of Object.values(this.actions))if(a!==action)a.fadeOut(.16);action.reset().fadeIn(.16);if(name==='Death'||name==='death'){action.setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;}else action.setLoop(THREE.LoopRepeat,Infinity);action.play();this.current=name;}
  update(p,dt){
    const target=new THREE.Vector3(p.x,p.y,p.z);if(!this.placed||this.group.position.distanceTo(target)>9){this.group.position.copy(target);this.placed=true;}else this.group.position.lerp(target,Math.min(1,dt*15));
    let delta=p.yaw-this.group.rotation.y;delta=Math.atan2(Math.sin(delta),Math.cos(delta));this.group.rotation.y+=delta*Math.min(1,dt*18);
    this.dead=!p.alive;const moving=Math.hypot(p.vx,p.vz)>.7;this.animate(this.nativeAgent?choosePlayerAnimation(p,getWeapon(p.weapon)):!p.alive?'Death':moving?(p.weapon==='knife'?'Run':'Run_Shoot'):(p.weapon==='knife'?'Idle_Sword':'Idle_Gun_Pointing'));if(this.mixer)this.mixer.update(dt);
    if(!this.nativeAgent)this.model.scale.y=THREE.MathUtils.lerp(this.model.scale.y,p.crouch?.66:1,Math.min(1,dt*16));
    this.ring.visible=p.alive;this.updateWeapon(p);
  }
  dispose(){
    if(this.disposed)return;this.disposed=true;this.group.removeFromParent();
    disposeInstanceAnimation(this.mixer,this.model);
    const skeletons=disposeInstanceSkeletons(this.model);
    for(const item of this.weaponCache.values()){
      disposeInstanceSkeletons(item.visual,skeletons);
      for(const resource of item.resources)resource.dispose();
      item.visual.removeFromParent();
      releaseSkin(item.skinId);
    }
    for(const resource of this.ownedResources)resource.dispose();
    this.ownedResources.clear();this.weaponCache.clear();this.group.clear();this.gun.clear();
    this.actions={};this.arms={};this.supportFingers=[];this.weaponSpec=null;this.mixer=null;
  }
}

export class Effects{
  constructor(scene){this.scene=scene;this.items=[];this.impactGeo=new THREE.SphereGeometry(.018,5,4);}
  shot(origin,end,own=false){const a=new THREE.Vector3(origin.x,origin.y,origin.z),b=new THREE.Vector3(end.x,end.y,end.z);const delta=b.clone().sub(a);if(own)a.addScaledVector(delta.clone().normalize(),.6);const geom=new THREE.BufferGeometry().setFromPoints([a,b]);const material=new THREE.LineBasicMaterial({color:0xffdfa1,transparent:true,opacity:.38});const line=new THREE.Line(geom,material);this.scene.add(line);this.items.push({obj:line,life:.07,max:.07,dispose:true});const hit=new THREE.Mesh(this.impactGeo,new THREE.MeshBasicMaterial({color:0xffd39a}));hit.position.copy(b);this.scene.add(hit);this.items.push({obj:hit,life:.16,max:.16,dispose:false});}
  update(dt){for(let i=this.items.length-1;i>=0;i--){const e=this.items[i];e.life-=dt;if(e.life<=0){this.scene.remove(e.obj);if(e.dispose)e.obj.geometry.dispose();e.obj.material.dispose();this.items.splice(i,1);}else if(e.obj.material.transparent)e.obj.material.opacity=.4*e.life/e.max;}}
  clear(){for(const e of this.items){e.obj.removeFromParent();if(e.dispose)e.obj.geometry.dispose();e.obj.material.dispose();}this.items.length=0;}
  dispose(){this.clear();this.impactGeo.dispose();}
}
