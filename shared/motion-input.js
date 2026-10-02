import {Quaternion,Vector3,Euler} from 'three';
const RAD=Math.PI/180;
const finite=(n,f,min,max)=>Number.isFinite(Number(n))?Math.max(min,Math.min(max,Number(n))):f;
export const MOTION_KEY='dust2.motion.v1';
export function normalizeMotion(v={}){return {mode:['off','scope'].includes(v.mode)?v.mode:'always',horizontal:finite(v.horizontal??1,1,.1,4),vertical:finite(v.vertical??1,1,.1,4),scope:finite(v.scope??1,1,.1,2),invertX:!!v.invertX,invertY:!!v.invertY,assist:['off','low'].includes(v.assist)?v.assist:'standard'};}
export function browserQuaternion(alpha,beta,gamma){return new Quaternion().setFromEuler(new Euler(beta*RAD,gamma*RAD,alpha*RAD,'ZXY')).toArray();}
export function screenRotation(vector,angle=0){const a=angle*RAD,c=Math.cos(a),s=Math.sin(a);return {yaw:-s*vector.x+c*vector.y,pitch:c*vector.x+s*vector.y};}
/** Relative local rotations avoid absolute heading jumps and magnetic north. */
export class MotionInput{
 constructor(){this.reset();}
 reset(){this.previous=null;this.at=null;this.rotation=null;this.pending={yaw:0,pitch:0};this.velocity={yaw:0,pitch:0};}
 push({quaternion,rate,time,rotation=0}){
  if(!Number.isFinite(time)||!Number.isFinite(rotation))return false;
  let current=null;
  if(quaternion){if(quaternion.length!==4||!quaternion.every(Number.isFinite))return false;current=new Quaternion(...quaternion);if(current.lengthSq()<.5||current.lengthSq()>1.5)return false;current.normalize();}
  else if(!rate||![rate.x,rate.y,rate.z].every(Number.isFinite))return false;
  const dt=this.at===null?0:(time-this.at)/1000;
  if(dt<0||dt===0&&this.at!==null)return false;
  if(this.at===null||dt>.2||rotation!==this.rotation){this.reset();this.previous=current;this.at=time;this.rotation=rotation;return false;}
  let vector;
  if(current){if(!this.previous){this.previous=current;this.at=time;return false;}const delta=this.previous.clone().invert().multiply(current).normalize();if(delta.w<0)delta.set(-delta.x,-delta.y,-delta.z,-delta.w);const size=Math.hypot(delta.x,delta.y,delta.z),angle=2*Math.atan2(size,Math.max(0,delta.w));vector=size>1e-9?new Vector3(delta.x,delta.y,delta.z).multiplyScalar(angle/size):new Vector3();}
  else vector=new Vector3(rate.x,rate.y,rate.z).multiplyScalar(dt);
  this.at=time;this.rotation=rotation;this.previous=current;
  if(vector.length()/dt>15){this.velocity={yaw:0,pitch:0};return false;}
  // Integrate measured angles directly: filtering angular velocity would lose
  // the start/end of a gesture and violate the default one-degree mapping.
  const motion=screenRotation(vector,rotation);
  for(const axis of ['yaw','pitch'])this.pending[axis]+=motion[axis];
  return true;
 }
 consume(settings,fov=90,zoom=0){const d=this.pending;this.pending={yaw:0,pitch:0};if(settings.mode==='off'||settings.mode==='scope'&&!zoom)return {yaw:0,pitch:0};const scale=zoom?Math.tan(fov*RAD/2)*settings.scope:1;return {yaw:d.yaw*settings.horizontal*scale*(settings.invertX?-1:1),pitch:d.pitch*settings.vertical*scale*(settings.invertY?-1:1)};}
}
