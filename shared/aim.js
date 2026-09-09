import {WEAPON_ACCURACY} from './weapon-accuracy-data.js';
export const STANDING_EYE_HEIGHT=1.62;
export const CROUCH_EYE_HEIGHT=.95;
export const aimPitch=(look,punch=0)=>Math.max(-1.48,Math.min(1.48,look+punch));
export function eyePosition(player){return {x:player.x,y:player.y+(player.crouch?CROUCH_EYE_HEIGHT:STANDING_EYE_HEIGHT),z:player.z};}
export function accuracyForShot(weapon,player,zoomLevel=0){
 const source=WEAPON_ACCURACY[weapon.id];if(!source)return {spread:0,inaccuracy:0,total:0,moving:0};
 const index=(weapon.zoomFovs.length>1&&zoomLevel>0)||['m4a1','usp'].includes(weapon.id)?1:0;
 const speed=Math.hypot(player.vx||0,player.vz||0),maxSpeed=(zoomLevel>0?weapon.scopedMaxSpeed:weapon.maxSpeed)||6;
 // Browser approximation: gradual velocity penalty, never the old full-cone
 // jump at 0.8 m/s. Retain the original per-stance and per-mode accuracy arrays.
 const moving=Math.max(0,Math.min(1,(speed/maxSpeed-.34)/(.95-.34)));
 const air=player.grounded?0:Math.min(1,Math.abs(player.vy||0)/5.5);
 const inaccuracy=source[player.crouch?'crouch':'stand'][index]+source.move[index]*moving**2+source.jump[index]*air;
 const spread=source.spread[index];return {spread,inaccuracy,total:spread+inaccuracy,moving};
}
export function sampleShotDirection(yaw,pitch,accuracy,random=Math.random){
 const radiusA=random()*accuracy.inaccuracy,angleA=random()*Math.PI*2;
 const radiusB=random()*accuracy.spread,angleB=random()*Math.PI*2;
 const x=Math.cos(angleA)*radiusA+Math.cos(angleB)*radiusB,y=Math.sin(angleA)*radiusA+Math.sin(angleB)*radiusB;
 const cy=Math.cos(yaw),sy=Math.sin(yaw),cp=Math.cos(pitch),sp=Math.sin(pitch);
 // Offsets lie on the camera's right/up plane, not independent yaw/pitch
 // squares whose cone narrows vertically when looking up or down.
 const dx=-sy*cp+cy*x+sy*sp*y,dy=sp+cp*y,dz=-cy*cp-sy*x+cy*sp*y,length=Math.hypot(dx,dy,dz);
 return {x:dx/length,y:dy/length,z:dz/length};
}
