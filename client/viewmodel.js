import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { UTILITY_IDS } from '../shared/equipment.js';
import { WEAPONS, getWeapon } from '../shared/weapons.js';
import { DEFAULT_SKINS, getSkin } from '../shared/skins.js';
import { loadedSkin, requestSkin, retainSkin, releaseSkin } from './skin-assets.js';
import { disposeInstanceAnimation, disposeInstanceSkeletons } from './resource-lifecycle.js';
import {DEFAULT_AGENT_IDS,getAgent} from '../shared/agents.js';
import {loadAgentArms,loadedAgentArms,requestAgentArms,retainAgentArms,releaseAgentArms} from './agent-arms.js';

const loader = new GLTFLoader();
let animationSource;
const weaponSources = {};
const sourceBasisInverse = new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion(-.5, -.5, -.5, .5)).invert();
const weaponKeys = { ak47:'rifle', m4a1:'m4a1', awp:'sniper', pistol:'pistol', usp:'usp', knife:'knife' };

export async function loadViewModels(library) {
  Object.assign(weaponSources, library);
  const results=await Promise.all([loader.loadAsync('assets/viewmodel/animations.glb'),loadAgentArms('ct-sas'),loadAgentArms('t-phoenix')]);
  animationSource=results[0];
}

/** The original CS2 viewmodel skeleton and .vnmclip poses, in metres.
 * Source 2 Viewer exports the arm and weapon skeletons independently. The
 * weapon is attached to the animated `wpn` joint, cancelling the duplicate
 * Source-to-glTF basis. Skin inverse bind matrices and authored local tracks
 * remain intact: hands, fingers, magazine, slide and bolt share the same pose.
 */
export class ViewWeapon {
  constructor(camera) {
    this.camera = camera;
    camera.fov = 68;
    camera.updateProjectionMatrix();
    this.group = new THREE.Group();
    camera.add(this.group);
    this.rig = new THREE.Group();
    this.rig.rotation.y = Math.PI; // glTF weapon forward +Z -> camera forward -Z.
    this.group.add(this.rig);
    this.clock = 0;
    this.id = '';
    this.cache = new Map();
    this.inverseRig = new THREE.Matrix4();
    this.attachmentMatrix = new THREE.Matrix4();
    this.flashTime = 0;
    this.slash = 0;
    this.reloadActive = false;
    if (!animationSource) throw new Error('The original CS2 viewmodel assets have not loaded.');

  }

  build(id,skinId,agentId) {
    const source = loadedSkin(skinId)||weaponSources[weaponKeys[id]];
    if (!source) throw new Error(`Missing original viewmodel weapon: ${id}`);
    const armSource=loadedAgentArms(agentId);
    if(!armSource)throw new Error(`Missing original first-person agent arms: ${agentId}`);
    const root = new THREE.Group(), arms = clone(armSource.scene), weapon = clone(source.scene), mount = new THREE.Group();
    // World models have a convenience wrapper. First-person animation needs
    // the unmodified authored coordinates inside it, never a Box3 recenter.
    const normalization = weapon.getObjectByName('normalization');
    if (normalization) {
      normalization.matrixAutoUpdate = true;
      normalization.position.set(0,0,0);
      normalization.quaternion.identity();
      normalization.scale.set(1,1,1);
      normalization.updateMatrix();
    }
    root.add(arms, mount); mount.add(weapon);
    const names = new Set();
    root.traverse(o => {
      names.add(o.name);
      if (o.isMesh) {
        o.frustumCulled = false;
        o.castShadow = false;
        o.receiveShadow = false;
        for (const material of [].concat(o.material)) {
          if (material.map) material.map.anisotropy = 4;
        }
      }
    });
    const mixer = new THREE.AnimationMixer(root), actions = {};
    for (const original of animationSource.animations) {
      if (!original.name.startsWith(`${id}/`)) continue;
      const clip = original.clone();
      clip.tracks = clip.tracks.filter(track => names.has(THREE.PropertyBinding.parseTrackName(track.name).nodeName));
      // Authored static idle poses have a single frame; Three's repeat loop
      // requires a positive duration, otherwise modulo zero produces NaN.
      clip.duration = Math.max(.1, clip.duration);
      actions[original.name.split('/')[1]] = mixer.clipAction(clip);
    }
    const wpn = arms.getObjectByName('wpn');
    retainSkin(skinId);retainAgentArms(agentId);
    const item = { root, arms, weapon, mount, mixer, actions, wpn, current:null, actionName:'',skinId,agentId };
    mixer.addEventListener('finished', event => {
      if (item.current !== event.action) return;
      if(item.actionName==='pullpin'&&this.utilityPrimed){this.playOn(item,this.utilityHoldName(),.055);return;}
      this.playOn(item, 'idle', .055);
    });

    // The flash lives on the weapon's original bone so it follows recoil and
    // equip motion. It adds no substitute geometry to the real arms or gun.
    weapon.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(weapon), size = bounds.getSize(new THREE.Vector3());
    const muzzle = new THREE.Vector3((bounds.min.x+bounds.max.x)*.5, bounds.min.y+size.y*.70, bounds.max.z+.025);
    const anchor = weapon.getObjectByName('weapon') || weapon;
    anchor.worldToLocal(muzzle);
    const flash = new THREE.Mesh(new THREE.ConeGeometry(.014,.075,7), new THREE.MeshBasicMaterial({color:0xffd99a,transparent:true,opacity:.9,depthWrite:false}));
    flash.position.copy(muzzle); flash.rotation.z = -Math.PI/2; flash.visible = false;
    anchor.add(flash);
    const light = new THREE.PointLight(0xffbf78,0,1.5); light.position.copy(muzzle); anchor.add(light);
    Object.assign(item,{flash,light});
    this.playOn(item,'idle',0);
    mixer.update(0);
    return item;
  }

  playOn(item, name, fade=.035, duration=0) {
    const action = item.actions[name] || item.actions.idle;
    if (!action) return;
    const previous = item.current;
    if (previous && previous !== action) previous.fadeOut(fade);
    action.reset().setEffectiveTimeScale(duration > 0 ? action.getClip().duration / duration : 1).setEffectiveWeight(1);
    const looping=name==='idle'||name.startsWith('hold');
    action.setLoop(looping ? THREE.LoopRepeat : THREE.LoopOnce, looping ? Infinity : 1);
    action.clampWhenFinished = !looping;
    if (fade && previous !== action) action.fadeIn(fade);
    action.play(); item.current=action; item.actionName=name;
  }

  set(id,skinId,agentId=this.agentId||'ct-sas') {
    if (!WEAPONS[id]&&!UTILITY_IDS.includes(id)) {this.group.visible=false;return;}
    if(UTILITY_IDS.includes(id))skinId=id;else if(getSkin(skinId)?.weapon!==id)skinId=DEFAULT_SKINS[id];
    if(!getAgent(agentId))agentId='ct-sas';requestAgentArms(agentId);
    const fallback=DEFAULT_AGENT_IDS[getAgent(agentId).team];requestAgentArms(fallback);
    const visibleAgent=loadedAgentArms(agentId)?agentId:fallback;
    requestSkin(skinId);const visibleSkin=loadedSkin(skinId)?skinId:UTILITY_IDS.includes(id)?id:DEFAULT_SKINS[id],cacheKey=id+':'+visibleSkin+':'+visibleAgent;
    if(!loadedSkin(visibleSkin)||!loadedAgentArms(visibleAgent)){this.waiting=true;return;}this.waiting=false;
    if (id === this.id && this.skinId===visibleSkin && this.agentId===visibleAgent) return;
    if (this.active) { this.rig.remove(this.active.root); this.active.flash.visible=false; this.active.light.intensity=0; }
    this.id=id;this.skinId=visibleSkin;this.agentId=visibleAgent;
    if (!this.cache.has(cacheKey)) this.cache.set(cacheKey,this.build(id,visibleSkin,visibleAgent));
    this.active=this.cache.get(cacheKey); this.rig.add(this.active.root);
    this.cache.delete(cacheKey);this.cache.set(cacheKey,this.active);
    while(this.cache.size>4){const key=this.cache.keys().next().value,item=this.cache.get(key);this.cache.delete(key);disposeInstanceAnimation(item.mixer,item.root);disposeInstanceSkeletons(item.root);item.flash.geometry.dispose();item.flash.material.dispose();item.root.removeFromParent();releaseSkin(item.skinId);releaseAgentArms(item.agentId);}
    this.active.mixer.stopAllAction();
    this.playOn(this.active,'draw',0);
    this.active.mixer.update(0);
    this.flashTime=0; this.reloadActive=false;this.utilityPrimed=false;this.utilityReleased=false;
    this.syncAttachment();
  }

  shoot(options={}) {
    if (!this.active) return;
    const heavy=options === true || options?.heavy;
    const mode=options?.mode||this.utilityMode;
    const name=UTILITY_IDS.includes(this.id)?(['underhand','under','low','drop'].includes(mode)?'throwUnderhand':'throw'):this.id==='knife' ? (heavy ? 'heavy' : (this.slash++%2 ? 'shoot2':'shoot')) : this.id==='elite' ? (this.slash++%2?'shoot2':'shoot') : 'shoot';
    this.utilityPrimed=false;this.utilityReleased=UTILITY_IDS.includes(this.id);
    this.playOn(this.active,name,.025,getWeapon(this.id).unzoomsAfterShot?getWeapon(this.id).fireInterval:0);
    this.flashTime=UTILITY_IDS.includes(this.id)||this.id==='knife'||this.id==='m4a1'||this.id==='usp' ? 0 : .045;
  }

  inspect() {
    if (this.active && !this.reloadActive&&!this.utilityPrimed) this.playOn(this.active,'inspect',.08);
  }

  primeUtility(state){
    if(state?.state!=='primed')this.utilityReleased=false;
    const primed=!this.utilityReleased&&UTILITY_IDS.includes(this.id)&&state?.state==='primed'&&(!state.weapon||state.weapon===this.id);
    const changedMode=this.utilityMode!==state?.mode;this.utilityMode=state?.mode;
    if(primed&&!this.utilityPrimed)this.playOn(this.active,'pullpin',.04);
    else if(primed&&changedMode&&this.active?.actionName.startsWith('hold'))this.playOn(this.active,this.utilityHoldName(),.07);
    if(!primed&&this.utilityPrimed&&(this.active?.actionName==='pullpin'||this.active?.actionName.startsWith('hold')))this.playOn(this.active,'idle',.05);
    this.utilityPrimed=primed;
  }

  utilityHoldName(){return this.utilityMode==='drop'?'holdLow':this.utilityMode==='lob'?'holdMid':'holdHigh';}

  getMuzzleWorldPosition(target=new THREE.Vector3(),worldCamera=this.camera){
    if(!this.active||this.waiting)return null;
    this.syncAttachment();this.active.flash.getWorldPosition(target);
    // The weapon scene has its own origin. Map its camera-space muzzle into
    // the supplied gameplay camera's world, including spectator orientation.
    this.camera.worldToLocal(target);worldCamera.localToWorld(target);return target;
  }

  syncAttachment() {
    const item=this.active;
    if (!item?.wpn) return;
    this.rig.updateWorldMatrix(true,true);
    this.inverseRig.copy(item.root.matrixWorld).invert();
    this.attachmentMatrix.copy(this.inverseRig).multiply(item.wpn.matrixWorld).multiply(sourceBasisInverse);
    this.attachmentMatrix.decompose(item.mount.position,item.mount.quaternion,item.mount.scale);
    item.mount.updateWorldMatrix(false,true);
  }

  update(dt,p,scoped) {
    dt=Math.min(.1,Math.max(0,dt||0));this.clock+=dt;
    if(p?.weapon)this.set(p.weapon,p.skinId,p.agentId||DEFAULT_AGENT_IDS[p.team]||'ct-sas');
    this.group.visible=Boolean(p?.alive&&!scoped&&!this.waiting&&this.id===p?.weapon);
    if(!p||!this.active)return;
    this.primeUtility(p.grenadeState);
    const reloading=p.reloadRemaining>0;
    if(reloading&&(!this.reloadActive||getWeapon(p.weapon).reloadStyle==='shell'&&p.reloadRemaining>this.lastReload+.1))this.playOn(this.active,'reload',.06,p.reloadRemaining);
    else if(!reloading&&this.reloadActive&&this.active.actionName==='reload')this.playOn(this.active,'idle',.06);
    this.reloadActive=reloading;this.lastReload=p.reloadRemaining;
    this.active.mixer.update(dt);
    const moving=Math.min(1,Math.hypot(p.vx||0,p.vz||0)/5),narrow=Math.max(0,1.35-(this.camera.aspect||1));
    // A subtle locomotion layer leaves the authored wrist/finger poses intact.
    this.group.position.set(Math.sin(this.clock*9)*.0025*moving-narrow*.045,Math.abs(Math.cos(this.clock*9))*.003*moving,-narrow*.10);
    this.group.rotation.set(0,Math.sin(this.clock*4.5)*.0015*moving,Math.sin(this.clock*9)*.002*moving);
    this.syncAttachment();
    this.flashTime=Math.max(0,this.flashTime-dt);
    this.active.flash.visible=this.group.visible&&this.flashTime>0;
    this.active.light.intensity=this.active.flash.visible?1.4:0;
  }

  dispose() {
    this.camera.remove(this.group);
    const skeletons=new Set();
    for(const item of this.cache.values()){
      disposeInstanceAnimation(item.mixer,item.root);
      disposeInstanceSkeletons(item.root,skeletons);
      item.flash.geometry.dispose();item.flash.material.dispose();
      item.root.removeFromParent();
      releaseSkin(item.skinId);
      releaseAgentArms(item.agentId);
    }
    this.cache.clear();
    this.group.clear();this.rig.clear();this.active=null;
  }
}
