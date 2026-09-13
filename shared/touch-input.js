const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
export function joystickVector(dx,dy,radius=52,deadzone=.12){
 const length=Math.hypot(dx,dy),strength=clamp((length/radius-deadzone)/(1-deadzone),0,1);
 return length?{right:dx/length*strength,forward:-dy/length*strength}:{right:0,forward:0};
}
export function touchLookDelta(dx,dy,shortSide,sensitivity=1,fov=90){
 const scale=Math.PI*.8/Math.max(240,shortSide)*sensitivity*Math.max(.06,Math.min(1,fov/90));
 return {yaw:-dx*scale,pitch:-dy*scale};
}
/** Pointer identity, not one global touch: movement, aim and fire can coexist. */
export class TouchInput {
 constructor({onAction=()=>{},onLook=()=>{},onCancel=()=>{}}={}){Object.assign(this,{onAction,onLook,onCancel});this.pointers=new Map();this.axes={forward:0,right:0};}
 begin(id,kind,x,y,{actions=[],radius=52,center=null}={}){
  if(this.pointers.has(id)||kind==='move'&&[...this.pointers.values()].some(p=>p.kind==='move'))return false;
  this.pointers.set(id,{kind,x,y,startX:center?.x??x,startY:center?.y??y,radius,actions});
  for(const action of actions)this.onAction(action,true,id);
  if(kind==='move')this.move(id,x,y);
  return true;
 }
 move(id,x,y){const p=this.pointers.get(id);if(!p)return;
  if(p.kind==='move')this.axes=joystickVector(x-p.startX,y-p.startY,p.radius);
  if(p.kind==='look'||p.kind==='fire')this.onLook(x-p.x,y-p.y);
  p.x=x;p.y=y;
 }
 end(id,cancelled=false){const p=this.pointers.get(id);if(!p)return;
  if(cancelled){this.clear();return;}
  this.pointers.delete(id);if(p.kind==='move')this.axes={forward:0,right:0};
  for(const action of p.actions)this.onAction(action,false,id);
 }
 clear(){const had=this.pointers.size;this.pointers.clear();this.axes={forward:0,right:0};if(had)this.onCancel();}
}
export function normalizeTouch(value={}){
 return {mode:['on','off'].includes(value.mode)?value.mode:'auto',sensitivity:clamp(Number(value.sensitivity)||1,.4,2.5),size:clamp(Number(value.size)||1,.85,1.15)};
}
