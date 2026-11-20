import * as THREE from 'three';

// The distributed C4 mesh is in its ground-model bind space. The original
// first-person clip puts the weapon joint at its origin. Remove the VMDL
// weapon bind translation, in Source inches, permuted into glTF metres.
const weaponBindInches = [-.196636796, -4.000021458, 3.049481869];
export function alignC4Viewmodel(weapon){
  const [x,y,z]=weaponBindInches;
  weapon.position.set(-y,-z,-x).multiplyScalar(.0254);
}

// Normalized key-contact frames in the shipped plant_c4.vnmclip (120 intervals).
const keyframes = [20, 29, 37, 44, 50, 59, 65];
export function c4KeypadText(progress){
  const frame=progress*120;
  return '7355608'.slice(0,keyframes.filter(key=>frame>=key).length);
}

// Reuse the authored, skinned LCD surface. Only its UVs and material belong to
// this instance; the original weapon body and shared asset stay untouched.
export function c4Display(root){
  let surface;root.traverse(o=>{if(o.isMesh&&o.name.endsWith('c4_screen'))surface=o;});if(!surface)return null;
  const geometry=surface.geometry.clone(),uv=geometry.getAttribute('uv');
  for(let i=0;i<uv.count;i++)uv.setXY(i,i<4?(uv.getX(i)-.0170293)/(.3152562-.0170293):0,i<4?(uv.getY(i)-.00384533)/(.06280709-.00384533):1);
  const original=surface.material;geometry.clearGroups();geometry.addGroup(0,6,0);geometry.addGroup(6,geometry.index.count-6,1);
  surface.geometry=geometry;const canvas=document.createElement('canvas');canvas.width=512;canvas.height=96;
  const ctx=canvas.getContext('2d'),texture=new THREE.CanvasTexture(canvas);texture.flipY=false;texture.colorSpace=THREE.SRGBColorSpace;
  const material=new THREE.MeshBasicMaterial({map:texture});surface.material=[material,original];let previous;
  const update=text=>{if(text===previous)return;previous=text;ctx.fillStyle='#68704c';ctx.fillRect(0,0,512,96);ctx.fillStyle='#152718';ctx.font='bold 76px monospace';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,256,52);texture.needsUpdate=true;};update('');
  return {update,dispose(){texture.dispose();material.dispose();geometry.dispose();}};
}
