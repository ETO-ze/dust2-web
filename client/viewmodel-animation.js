import * as THREE from 'three';

// Keep the outgoing pose alive while a new inspect starts. Reusing that same
// AnimationAction would reset its time before the crossfade had completed.
export function playWeaponAction(item, name, fade=.035, duration=0) {
  let action=item.actions[name]||item.actions.idle;
  if(!action)return false;
  if(name==='inspect'){
    if(item.actionName==='inspect')return false;
    if(!item.inspectActions){
      item.inspectActions=[action,item.mixer.clipAction(action.getClip().clone())];
    }
    action=item.inspectActions.find(a=>!a.isScheduled()||a.getEffectiveWeight()===0)
      ||item.inspectActions.reduce((a,b)=>a.getEffectiveWeight()<b.getEffectiveWeight()?a:b);
  }
  const previous=item.current;
  if(previous&&previous!==action){
    const weight=previous.getEffectiveWeight();
    previous.stopFading().setEffectiveWeight(weight);
    if(fade)previous.fadeOut(fade);else previous.stop();
  }
  action.reset().setEffectiveTimeScale(duration>0?action.getClip().duration/duration:1).setEffectiveWeight(1);
  const looping=name==='idle'||name==='aimIdle'||name.startsWith('hold');
  action.setLoop(looping?THREE.LoopRepeat:THREE.LoopOnce,looping?Infinity:1);
  action.clampWhenFinished=!looping;
  if(fade&&previous!==action)action.fadeIn(fade);
  action.play();item.current=action;item.actionName=name;
  return true;
}

export function beginWeaponInspect(item,{blocked=false}={}){
  if(!item?.actions.inspect||blocked)return false;
  return playWeaponAction(item,'inspect',.08);
}

export function cancelWeaponInspect(item,{optic=false}={}){
  if(item?.actionName!=='inspect')return false;
  return playWeaponAction(item,optic&&item.actions.aimIdle?'aimIdle':'idle',.08);
}
