/** Per-room/tab state. Original geometry never changes; BVH queries consult
 * this table using the decoder's exact source-triangle mapping. */
export class PrivateMapBreakables {
 constructor(definitions=[],sourceTrianglesByChannel={}){
  this.definitions=definitions;this.byId=new Map();this.owners={};this.broken=new Set();this.health=new Map();
  for(const def of definitions){
   if(!def.id||this.byId.has(def.id)||!Number.isSafeInteger(def.firstTriangle)||def.firstTriangle<0||!Number.isSafeInteger(def.triangles)||def.triangles<=0||!Number.isFinite(def.health)||def.health<=0)throw Error('Invalid breakable definition');
   this.byId.set(def.id,def);
  }
  for(const [channel,indices]of Object.entries(sourceTrianglesByChannel)){
   const owners=new Map();
   for(let i=0;i<indices.length;i++)for(const def of definitions)if(indices[i]>=def.firstTriangle&&indices[i]<def.firstTriangle+def.triangles){if(owners.has(i))throw Error('Overlapping breakable collision ranges');owners.set(i,def.id);}
   this.owners[channel]=owners;
  }
  this.reset();
 }
 reset(){this.broken.clear();this.health=new Map(this.definitions.map(d=>[d.id,d.health]));}
 triangleEnabled(channel,index){const id=this.owners[channel]?.get(index);return !id||!this.broken.has(id);}
 atTriangle(channel,index){const id=this.owners[channel]?.get(index);return id&&!this.broken.has(id)?this.byId.get(id):null;}
 snapshot(){return this.definitions.map(d=>({id:d.id,broken:this.broken.has(d.id)}));}
 applySnapshot(states=[]){
  this.reset();for(const state of states)if(state?.broken===true&&this.byId.has(state.id)){this.broken.add(state.id);this.health.set(state.id,0);}
 }
 damage(id,amount){
  if(!this.byId.has(id)||this.broken.has(id)||!Number.isFinite(amount)||amount<=0)return false;
  const health=Math.max(0,this.health.get(id)-amount);this.health.set(id,health);
  if(health>0)return false;this.broken.add(id);return true;
 }
}
