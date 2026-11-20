/** Per-room/tab state. Original geometry never changes; BVH queries consult
 * this table using the decoder's exact source-triangle mapping. */
export class PrivateMapBreakables {
 constructor(definitions=[],sourceTrianglesByChannel={}){
  this.definitions=definitions;this.byId=new Map();this.owners={};this.broken=new Set();this.opened=new Set();this.health=new Map();
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
 reset(){this.broken.clear();this.opened=new Set(this.definitions.filter(d=>d.initialOpen).map(d=>d.id));this.health=new Map(this.definitions.map(d=>[d.id,d.health]));this.nextToggle=new Map();}
 toggle(id,now){
  if(!this.byId.get(id)?.button||this.broken.has(id)||now<(this.nextToggle.get(id)||0))return false;
  if(this.opened.has(id))this.opened.delete(id);else this.opened.add(id);
  this.nextToggle.set(id,now+700); // Original map relay enables the opposite relay after 0.7 s.
  return true;
 }
 collisionKey(){return this.definitions.map(d=>this.broken.has(d.id)?'0':'1').join('');}
 triangleEnabled(channel,index){const id=this.owners[channel]?.get(index);return !id||!this.broken.has(id);}
 atTriangle(channel,index){const id=this.owners[channel]?.get(index);return id&&!this.broken.has(id)?this.byId.get(id):null;}
 snapshot(){return this.definitions.map(d=>({id:d.id,broken:this.broken.has(d.id),...(d.button?{open:this.opened.has(d.id)}:{})}));}
 applySnapshot(states=[]){
  this.reset();for(const state of states){
    if(!this.byId.has(state?.id))continue;
    if(state.broken===true){this.broken.add(state.id);this.health.set(state.id,0);}
    if(this.byId.get(state.id).button&&typeof state.open==='boolean'){
      if(state.open)this.opened.add(state.id);else this.opened.delete(state.id);
    }
  }
 }
 damage(id,amount){
  if(!this.byId.has(id)||this.broken.has(id)||!Number.isFinite(amount)||amount<=0)return false;
  const health=Math.max(0,this.health.get(id)-amount);this.health.set(id,health);
  if(health>0)return false;this.broken.add(id);return true;
 }
}
