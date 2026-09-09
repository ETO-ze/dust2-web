export const INTERPOLATION_DELAY_MS=80;
export const MAX_REWIND_MS=200;
const lerp=(a,b,t)=>a+(b-a)*t;
const angle=(a,b,t)=>a+Math.atan2(Math.sin(b-a),Math.cos(b-a))*t;
export function interpolatePlayer(a,b,t){
 if(!a||a.alive!==b.alive||a.lifeId!==b.lifeId||a.team!==b.team||Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z)>4)return {...b};
 return {...b,x:lerp(a.x,b.x,t),y:lerp(a.y,b.y,t),z:lerp(a.z,b.z,t),yaw:angle(a.yaw||0,b.yaw||0,t),pitch:lerp(a.pitch||0,b.pitch||0,t),crouch:t<.5?a.crouch:b.crouch};
}
/** Bounded pose-only history shared by render interpolation and hit rewind. */
export class PlayerTimeline{
 constructor(limit=16){this.limit=limit;this.frames=[];}
 clear(){this.frames.length=0;}
 push(time,players){
  if(!Number.isFinite(time))return;
  const last=this.frames.at(-1);if(last&&time<last.time)return;
  const frame={time,players:players.map(p=>({...p}))};
  if(last?.time===time)this.frames[this.frames.length-1]=frame;else this.frames.push(frame);
  if(this.frames.length>this.limit)this.frames.shift();
 }
 sample(time){
  if(!this.frames.length)return [];
  if(time<=this.frames[0].time)return this.frames[0].players;
  for(let i=1;i<this.frames.length;i++)if(time<=this.frames[i].time){
   const a=this.frames[i-1],b=this.frames[i],t=(time-a.time)/(b.time-a.time),before=new Map(a.players.map(p=>[p.id,p]));
   return b.players.map(p=>interpolatePlayer(before.get(p.id),p,t));
  }
  return this.frames.at(-1).players;
 }
}
