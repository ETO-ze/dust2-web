/** compileAsync prepares programs, but does not upload the original map's
 * textures/vertex buffers. Complete that work under the loading screen before
 * opening WSS, so a cold GPU upload cannot consume the socket heartbeat budget. */
export async function warmPrivateMap({renderer,scene,camera,gunScene,gunCamera,signal,onProgress=()=>{},yieldFrame,now=()=>performance.now()}){
 const started=now(),textures=new Set();
 const check=()=>{signal?.throwIfAborted();if(renderer.getContext().isContextLost())throw Error('显卡在准备原始地图时中断，请关闭其他 3D 页面后重试');};
 for(const root of [scene,gunScene]){
  for(const texture of [root.background,root.environment])if(texture?.isTexture)textures.add(texture);
  root.traverseVisible(object=>{for(const material of [].concat(object.material||[])){if(!material.visible)continue;for(const value of Object.values(material))if(value?.isTexture)textures.add(value);}});
 }
 let count=0,batch=now(),maxUploadMs=0;
 for(const texture of textures){
  check();const before=now();renderer.initTexture(texture);maxUploadMs=Math.max(maxUploadMs,now()-before);count++;
  if(now()-batch>=12||count===textures.size){onProgress(`上传原版材质到显卡 ${count} / ${textures.size}`,{phase:'gpu-upload',complete:count,count:textures.size});await yieldFrame();check();batch=now();}
 }
 const rotation=camera.rotation.clone(),autoClear=renderer.autoClear;let maxRenderMs=0;
 try{
  // Four views prepare the immediate spawn surroundings without changing any
  // source geometry, texture resolution or the player's eventual view.
  for(let view=0;view<4;view++){
   check();camera.rotation.copy(rotation);camera.rotation.y+=view*Math.PI/2;camera.updateMatrixWorld();
   onProgress(`准备出生点画面 ${view+1} / 4`,{phase:'gpu-frames',complete:view,count:4});await yieldFrame();check();
   const before=now();renderer.autoClear=true;renderer.render(scene,camera);renderer.autoClear=false;renderer.clearDepth();renderer.render(gunScene,gunCamera);maxRenderMs=Math.max(maxRenderMs,now()-before);
   await yieldFrame();check();
  }
 }finally{camera.rotation.copy(rotation);camera.updateMatrixWorld();renderer.autoClear=autoClear;renderer.info.reset();}
 return {textures:count,durationMs:Math.round(now()-started),maxUploadMs:Math.round(maxUploadMs),maxRenderMs:Math.round(maxRenderMs)};
}
