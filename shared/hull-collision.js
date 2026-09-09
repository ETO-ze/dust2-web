import {Vector3} from 'three';

/** Triangle/AABB separating-axis contact. A flat sole stays supported at ledges;
 * the rounded end of the old capsule could slide off and alternate grounded. */
export class HullContact {
 constructor(){this.axes=Array.from({length:13},()=>new Vector3());this.center=new Vector3();this.half=new Vector3();this.edges=Array.from({length:3},()=>new Vector3());this.surface=new Vector3();}
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
