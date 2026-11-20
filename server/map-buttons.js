import {eyePosition} from '../shared/aim.js';
import {raycastWorld} from '../shared/physics.js';

// Ray versus the exported func_button volume, bounded by ordinary Source use reach.
function buttonDistance(origin,dir,bounds,reach) {
  let enter=0,leave=reach;
  for(const [i,key] of ['x','y','z'].entries()){
    if(Math.abs(dir[key])<1e-7){
      if(origin[key]<bounds.min[i]||origin[key]>bounds.max[i])return null;
      continue;
    }
    const a=(bounds.min[i]-origin[key])/dir[key],b=(bounds.max[i]-origin[key])/dir[key];
    enter=Math.max(enter,Math.min(a,b));leave=Math.min(leave,Math.max(a,b));
    if(enter>leave)return null;
  }
  return enter;
}
export function useMapButton(room,player,input,now){
  const state=room.mapBreakables;
  if(!state)return false;
  for(const def of state.definitions){
    if(!def.button||state.broken.has(def.id))continue;
    const origin=eyePosition(player),cos=Math.cos(input.pitch);
    const dir={x:-Math.sin(input.yaw)*cos,y:Math.sin(input.pitch),z:-Math.cos(input.yaw)*cos};
    const distance=buttonDistance(origin,dir,def.button,64*.0254);
    if(distance===null||raycastWorld(origin,dir,Math.max(0,distance-.03))!==null)continue;
    state.toggle(def.id,now);return true;
  }
  return false;
}
