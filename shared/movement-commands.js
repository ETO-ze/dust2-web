import {stepPlayer} from './physics.js';
export const MOVEMENT_HZ=60, MOVEMENT_DT=1/MOVEMENT_HZ, MAX_MOVE_BATCH=8, MAX_MOVE_QUEUE=32;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const fields=['x','y','z','vx','vy','vz','yaw','pitch','grounded','objectiveLocked','crouch','height','lastJump','lastJumpId','jumpBufferRemaining','stepDistance','outOfWorld'];
export const movementState=p=>Object.fromEntries(fields.map(key=>[key,p[key]]));
export function sanitizeMoves(raw){
 if(!Array.isArray(raw)||raw.length>MAX_MOVE_BATCH)return [];
 return raw.filter(m=>m&&Number.isSafeInteger(m.id)&&m.id>0&&m.id<=2147483647&&Number.isSafeInteger(m.lifeId)&&m.lifeId>0&&['forward','right','yaw','pitch','speedScale'].every(k=>typeof m[k]==='number'&&Number.isFinite(m[k]))).map(m=>({id:m.id,lifeId:m.lifeId,forward:clamp(m.forward,-1,1),right:clamp(m.right,-1,1),yaw:((m.yaw+Math.PI)%(2*Math.PI)+2*Math.PI)%(2*Math.PI)-Math.PI,pitch:clamp(m.pitch,-1.48,1.48),speedScale:clamp(m.speedScale,.1,1.2),jump:m.jump===true,crouch:m.crouch===true,walk:m.walk===true,jumpId:Number.isSafeInteger(m.jumpId)&&m.jumpId>=0?Math.min(m.jumpId,2147483647):0}));
}
export function simulateMove(p,move,{canMove=true,speedLimit=1.2}={}){
 const input={...move,speedScale:Math.min(move.speedScale,speedLimit)};
 if(!canMove){Object.assign(input,{forward:0,right:0,jump:false});p.lastJumpId=Math.max(p.lastJumpId||0,move.jumpId||0);p.jumpBufferRemaining=0;}
 stepPlayer(p,input,MOVEMENT_DT);
}
/** Server-time budget: even forged batches cannot create extra simulation time. */
export class MovementStream{
 constructor(lifeId){this.reset(lifeId);}
 reset(lifeId){this.lifeId=lifeId;this.queue=[];this.ack=0;this.received=0;this.credit=0;}
 receive(moves){for(const move of moves){if(move.lifeId!==this.lifeId||move.id<=this.received)continue;if(this.queue.length>=MAX_MOVE_QUEUE)break;this.queue.push(move);this.received=move.id;}}
 advance(p,dt,options,throughId=Infinity){
  this.credit=Math.min(MAX_MOVE_BATCH,this.credit+Math.min(MAX_MOVE_BATCH/MOVEMENT_HZ,Math.max(0,dt))*MOVEMENT_HZ);
  let count=0;while(this.queue.length&&this.queue[0].id<=throughId&&this.credit>=1-1e-8){const move=this.queue.shift();simulateMove(p,move,options);this.ack=move.id;this.credit=Math.max(0,this.credit-1);count++;}return count;
 }
}
