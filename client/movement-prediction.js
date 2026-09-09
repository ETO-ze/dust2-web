import {movementState,simulateMove,MOVEMENT_DT,MAX_MOVE_BATCH} from '../shared/movement-commands.js';
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
export class MovementPrediction{
 constructor(){this.reset();}
 reset(p){this.history=[];this.unsent=[];this.nextId=0;this.ack=0;this.previous=p?movementState(p):null;this.offset={x:0,y:0,z:0};this.corrections=0;this.maxCorrection=0;}
 step(p,input,canMove=true){
  this.previous=movementState(p);
  const move={id:++this.nextId,lifeId:p.lifeId,forward:input.forward,right:input.right,yaw:input.yaw,pitch:input.pitch,speedScale:input.speedScale||1,jump:input.jump,jumpId:input.jumpId,crouch:input.crouch,walk:input.walk};
  simulateMove(p,move,{canMove});this.history.push({move,canMove});this.unsent.push(move);
  if(this.history.length>64)this.history.shift();if(this.unsent.length>32)this.unsent.shift();
 }
 packet(){return this.unsent.splice(0,MAX_MOVE_BATCH);}
 reconcile(p,authoritative){
  if(!authoritative.movementState)return false;
  const ack=authoritative.movementAck||0;if(ack<this.ack)return true;
  this.ack=ack;this.history=this.history.filter(h=>h.move.id>ack);this.unsent=this.unsent.filter(m=>m.id>ack);
  const old={x:p.x,y:p.y,z:p.z},oldPrevious=this.previous;
  Object.assign(p,authoritative.movementState);
  let previous=movementState(p);
  for(const h of this.history){previous=movementState(p);simulateMove(p,h.move,{canMove:h.canMove});}
  this.previous=previous;
  const error=distance(old,p);this.maxCorrection=Math.max(this.maxCorrection,error);
  if(error>.002)this.corrections++;
  if(error>1){this.offset={x:0,y:0,z:0};this.previous=movementState(p);}
  else{
   for(const key of ['x','y','z'])this.offset[key]+=old[key]-p[key];
   // Small quantization differences should never animate a stationary camera.
   if(error<.00001&&oldPrevious)this.previous=oldPrevious;
  }
  return true;
 }
 render(p,alpha,dt){
  const before=this.previous||p,t=Math.max(0,Math.min(1,alpha)),decay=Math.exp(-18*dt),result={};
  for(const key of ['x','y','z']){this.offset[key]*=decay;if(Math.abs(this.offset[key])<.0001)this.offset[key]=0;result[key]=before[key]+(p[key]-before[key])*t+this.offset[key];}
  return result;
 }
 status(){return {pending:this.history.length,unsent:this.unsent.length,ack:this.ack,nextId:this.nextId,corrections:this.corrections,maxCorrection:this.maxCorrection,offset:{...this.offset},stepMs:MOVEMENT_DT*1000};}
}
