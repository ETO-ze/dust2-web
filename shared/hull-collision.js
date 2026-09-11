import {Vector3} from 'three';

/** Triangle/AABB separating-axis contact. A flat sole stays supported at ledges;
 * the rounded end of the old capsule could slide off and alternate grounded. */
export class HullContact {
 constructor(){this.axes=Array.from({length:13},()=>new Vector3());this.center=new Vector3();this.half=new Vector3();this.edges=Array.from({length:3},()=>new Vector3());this.surface=new Vector3();}
 sweepDown(tri,box,maxDrop){
  box.getCenter(this.center);box.getSize(this.half).multiplyScalar(.5);
  const {a,b,c}=tri,axes=this.axes,edges=this.edges;tri.getNormal(this.surface);
  axes[0].copy(this.surface);axes[1].set(0,1,0);axes[2].set(1,0,0);axes[3].set(0,0,1);
  edges[0].subVectors(b,a);edges[1].subVectors(c,b);edges[2].subVectors(a,c);
  for(let i=0;i<3;i++){const e=edges[i];axes[4+i*3].set(0,e.z,-e.y);axes[5+i*3].set(-e.z,0,e.x);axes[6+i*3].set(e.y,-e.x,0);}
  let enter=-Infinity,exit=1,normalY=0;
  for(const n of axes){
   const length=n.length();if(length<1e-10)continue;n.multiplyScalar(1/length);
   const center=n.dot(this.center),radius=Math.abs(n.x)*this.half.x+Math.abs(n.y)*this.half.y+Math.abs(n.z)*this.half.z;
   const lo=Math.min(n.dot(a),n.dot(b),n.dot(c))-radius-center,hi=Math.max(n.dot(a),n.dot(b),n.dot(c))+radius-center,speed=-maxDrop*n.y;
   if(Math.abs(speed)<1e-10){if(lo>=-1e-8||hi<=1e-8)return null;continue;}
   const first=Math.min(lo/speed,hi/speed),last=Math.max(lo/speed,hi/speed);
   if(first>enter){enter=first;normalY=speed<0?n.y:-n.y;}
   exit=Math.min(exit,last);if(enter>exit+1e-8)return null;
  }
  if(enter<-.00001||enter>1||exit<0)return null;
  return {distance:Math.max(0,enter)*maxDrop,walkable:Math.abs(this.surface.y)>=.7&&normalY>=.7};
 }
 intersect(tri,box){
  box.getCenter(this.center);box.getSize(this.half).multiplyScalar(.5);
  const {a,b,c}=tri,axes=this.axes,edges=this.edges;tri.getNormal(this.surface);
  axes[0].copy(this.surface);axes[1].set(0,1,0);axes[2].set(1,0,0);axes[3].set(0,0,1);
  edges[0].subVectors(b,a);edges[1].subVectors(c,b);edges[2].subVectors(a,c);
  for(let i=0;i<3;i++){const e=edges[i];axes[4+i*3].set(0,e.z,-e.y);axes[5+i*3].set(-e.z,0,e.x);axes[6+i*3].set(e.y,-e.x,0);}
  let depth=Infinity,best=null,sign=1;
  for(const n of axes){
   const length=n.length();if(length<1e-10)continue;n.multiplyScalar(1/length);
   const center=n.dot(this.center),radius=Math.abs(n.x)*this.half.x+Math.abs(n.y)*this.half.y+Math.abs(n.z)*this.half.z;
   const pa=n.dot(a),pb=n.dot(b),pc=n.dot(c),min=Math.min(pa,pb,pc),max=Math.max(pa,pb,pc);
   const positive=max-center+radius,negative=center+radius-min;
   if(positive<=1e-8||negative<=1e-8)return null;
   const overlap=Math.min(positive,negative);
   // Stable ties keep the face plane ahead of internal triangulation edges.
   if(overlap<depth-1e-7){depth=overlap;best=n;sign=positive<negative?1:-1;}
  }
  if(!best||!Number.isFinite(depth))return null;
  const normal=best.clone().multiplyScalar(sign),surface=this.surface.clone();if(surface.dot(normal)<0)surface.negate();
  return {normal,surface,depth,walkable:surface.y>=.7&&normal.y>=.7};
 }
}
