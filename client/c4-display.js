import * as THREE from 'three';

// Reuse the authored, skinned LCD surface. Only its UVs and material belong to
// this instance; the original weapon body and shared asset stay untouched.
export function c4Display(root){
  let surface;root.traverse(o=>{if(o.isMesh&&o.name.endsWith('c4_screen'))surface=o;});if(!surface)return null;
  const geometry=surface.geometry.clone(),uv=geometry.getAttribute('uv');
  for(let i=0;i<uv.count;i++)uv.setXY(i,i<4?(uv.getX(i)-.0170293)/(.3152562-.0170293):0,i<4?(uv.getY(i)-.00384533)/(.06280709-.00384533):1);
  surface.geometry=geometry;const canvas=document.createElement('canvas');canvas.width=512;canvas.height=96;
  const ctx=canvas.getContext('2d'),texture=new THREE.CanvasTexture(canvas);texture.flipY=false;texture.colorSpace=THREE.SRGBColorSpace;
  const material=new THREE.MeshBasicMaterial({map:texture});surface.material=material;let previous;
  const update=text=>{if(text===previous)return;previous=text;ctx.fillStyle='#68704c';ctx.fillRect(0,0,512,96);ctx.fillStyle='#152718';ctx.font='bold 76px monospace';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,256,52);texture.needsUpdate=true;};update('');
  return {update,dispose(){texture.dispose();material.dispose();geometry.dispose();}};
}
