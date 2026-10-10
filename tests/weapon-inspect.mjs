import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import {playWeaponAction,beginWeaponInspect,cancelWeaponInspect} from '../client/viewmodel-animation.js';

function rig(){
 const root=new THREE.Object3D(),mixer=new THREE.AnimationMixer(root),actions={};
 for(const [name,duration,to]of [['idle',1,0],['inspect',3,2],['shoot',.2,-1],['reload',2,1],['draw',1,.5]]){
  const clip=new THREE.AnimationClip(name,duration,[new THREE.NumberKeyframeTrack('.rotation[z]',[0,duration],[0,to])]);
  actions[name]=mixer.clipAction(clip);
 }
 const item={root,mixer,actions,current:null,actionName:''};
 mixer.addEventListener('finished',e=>{if(item.current===e.action)playWeaponAction(item,'idle',.055);});
 playWeaponAction(item,'idle',0);mixer.update(0);return item;
}
test('repeated F keeps the current inspect time and pose',()=>{
 const item=rig();assert(beginWeaponInspect(item));item.mixer.update(.6);
 const action=item.current,time=action.time,pose=item.root.rotation.z;
 for(let n=0;n<5;n++)assert.equal(beginWeaponInspect(item),false);
 item.mixer.update(0);assert.equal(item.current,action);assert.equal(action.time,time);assert.equal(item.root.rotation.z,pose);
 item.mixer.update(.1);assert(action.time>time);
});
test('R cancels even without a possible reload and immediate F crossfades from the outgoing pose',()=>{
 const item=rig();beginWeaponInspect(item);item.mixer.update(.6);
 const outgoing=item.current,pose=item.root.rotation.z;
 assert(cancelWeaponInspect(item));item.mixer.update(0);assert.equal(item.actionName,'idle');assert.equal(item.root.rotation.z,pose);
 assert(beginWeaponInspect(item));assert.notEqual(item.current,outgoing);item.mixer.update(0);
 assert.equal(item.root.rotation.z,pose,'F must not reset the still-visible outgoing clip');
 item.mixer.update(.04);assert(Number.isFinite(item.root.rotation.z));assert(item.root.rotation.z>0);
 item.mixer.update(.05);assert.equal(outgoing.getEffectiveWeight(),0);
});
test('rapid F/R has bounded actions and never replaces reload, fire or draw with an R cancellation',()=>{
 const item=rig();
 for(let n=0;n<80;n++){
  beginWeaponInspect(item);item.mixer.update(.04);cancelWeaponInspect(item);item.mixer.update(.04);
  assert(Number.isFinite(item.root.rotation.z));
 }
 assert.equal(item.inspectActions.length,2);assert.equal(item.mixer.stats.actions.total,6);
 for(const name of ['shoot','reload','draw']){playWeaponAction(item,name,.03);assert.equal(cancelWeaponInspect(item),false);assert.equal(item.actionName,name);}
});
test('reload, primed utility and planting block inspect; completed inspect returns to idle',()=>{
 const item=rig();assert.equal(beginWeaponInspect(item,{blocked:true}),false);assert.equal(item.actionName,'idle');
 beginWeaponInspect(item);item.mixer.update(3.1);assert.equal(item.actionName,'idle');
 assert(beginWeaponInspect(item));playWeaponAction(item,'reload',.06);assert.equal(item.actionName,'reload');
});
test('all selectable knife types retain original authored inspect rotation tracks',()=>{
 for(const [path,prefix]of [['assets/viewmodel/animations.glb','knife'],['assets/weapons/optional/m9-animations.glb','m9'],['assets/weapons/optional/butterfly-animations.glb','butterfly']]){
  const b=fs.readFileSync(new URL('../public/'+path,import.meta.url)),doc=JSON.parse(b.toString('utf8',20,20+b.readUInt32LE(12)));
  const clip=doc.animations.find(a=>a.name===prefix+'/inspect');assert(clip,prefix);
  assert(clip.channels.some(c=>c.target.path==='rotation'),prefix+' original spin/hand animation');
 }
});
