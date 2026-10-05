import * as THREE from 'three';

/** Render only server-confirmed changes to the exact exported entity nodes. */
export class PrivateMapBreakables {
  constructor({gltf,scene,definitions=[],initialHiddenNodeIndices=[],onBroken=()=>{}}){
    this.scene=scene;this.onBroken=onBroken;this.entries=new Map();this.fragments=[];this.round=null;
    const nodes=new Map();
    gltf.scene.traverse(object=>{const index=gltf.parser?.associations?.get(object)?.nodes;if(Number.isSafeInteger(index)){if(!nodes.has(index))nodes.set(index,[]);nodes.get(index).push(object);}});
    const claimed=new Set();
    const resolve=(indices,label)=>{
      if(!Array.isArray(indices)||indices.some(i=>!Number.isSafeInteger(i)||i<0||!nodes.has(i)))throw Error('可破坏物的原始场景节点缺失：'+label);
      return [...new Set(indices.flatMap(index=>nodes.get(index)))];
    };
    for(const definition of definitions){
      if(typeof definition.id!=='string'||this.entries.has(definition.id))throw Error('可破坏物标识重复或无效');
      if(definition.nodeNames&&(!Array.isArray(definition.nodeNames)||definition.nodeNames.length!==definition.nodeIndices?.length||definition.nodeIndices.some((index,i)=>gltf.parser?.json?.nodes?.[index]?.name!==definition.nodeNames[i])))throw Error('可破坏物原始节点名称不一致：'+definition.id);
      const intact=resolve(definition.nodeIndices,definition.id),remains=resolve(definition.restoredNodeIndices||[],definition.id);
      if(!intact.length)throw Error('可破坏物缺少原始节点：'+definition.id);
      for(const object of [...intact,...remains]){if(claimed.has(object))throw Error('可破坏物场景节点重叠');claimed.add(object);}
      this.entries.set(definition.id,{definition,intact,remains,initial:new Map(intact.map(object=>[object,object.visible])),broken:false});
    }
    this.initialHidden=resolve(initialHiddenNodeIndices,'initially-disabled');
    if(this.initialHidden.some(object=>claimed.has(object)))throw Error('初始隐藏节点与可破坏物重叠');
    this.fragmentGeometry=new THREE.BoxGeometry(1,1,1);
    this.fragmentMaterial=new THREE.MeshBasicMaterial({color:0xffffff});
    this.fragmentMesh=new THREE.InstancedMesh(this.fragmentGeometry,this.fragmentMaterial,48);
    this.fragmentMesh.name='Server-confirmed breakable fragments';this.fragmentMesh.count=0;this.fragmentMesh.frustumCulled=false;this.fragmentMesh.visible=false;
    this.color=new THREE.Color();this.matrix=new THREE.Matrix4();this.rotation=new THREE.Quaternion();this.euler=new THREE.Euler();this.scale=new THREE.Vector3();
    scene.add(this.fragmentMesh);this.reset();
  }
  apply(entry,broken){
    entry.broken=broken;
    for(const object of entry.intact)object.visible=broken?false:entry.initial.get(object);
    for(const object of entry.remains)object.visible=broken;
  }
  sync(snapshot){
    if(!Array.isArray(snapshot?.mapBreakables))return;
    if(this.round!==snapshot.round?.number){this.clearFragments();this.round=snapshot.round?.number;}
    const states=new Map(snapshot.mapBreakables.filter(state=>typeof state?.id==='string'&&typeof state.broken==='boolean').map(state=>[state.id,state.broken]));
    // A complete snapshot repairs both missed break events and late joining.
    for(const [id,entry]of this.entries)if(states.has(id))this.apply(entry,states.get(id));
  }
  event(event,listener){
    if(event?.type!=='map_breakable_broken')return false;
    const entry=this.entries.get(event.breakableId);
    if(!entry?.broken)return false;
    const origin=event.origin;
    if(!origin||!['x','y','z'].every(axis=>Number.isFinite(origin[axis])))return false;
    const distance=listener?Math.hypot(origin.x-listener.x,origin.y-listener.y,origin.z-listener.z):0;
    if(distance>50)return false;
    this.onBroken({...event,material:entry.definition.material||event.material,distance});
    for(let i=0;i<10;i++){
      if(this.fragments.length>=48)this.fragments.shift();
      const angle=(i*2.399963),speed=1+(i%4)*.45;
      this.fragments.push({position:new THREE.Vector3(origin.x,origin.y,origin.z),velocity:new THREE.Vector3(Math.cos(angle)*speed,.6+(i%3)*.3,Math.sin(angle)*speed),life:.7,age:0,seed:i,color:entry.definition.material==='wood'?0x998061:0x938f87});
    }
    this.update(0);return true;
  }
  update(delta){
    if(!this.fragments.length)return;
    const dt=Math.max(0,Math.min(.05,Number(delta)||0));
    for(const fragment of this.fragments){fragment.life-=dt;fragment.age+=dt;fragment.velocity.y-=9.8*dt;fragment.position.addScaledVector(fragment.velocity,dt);}
    this.fragments=this.fragments.filter(fragment=>fragment.life>0);
    this.fragmentMesh.count=this.fragments.length;this.fragmentMesh.visible=!!this.fragments.length;
    for(const [index,fragment]of this.fragments.entries()){
      this.euler.set(fragment.age*5+fragment.seed,fragment.age*3,fragment.seed*.4);this.rotation.setFromEuler(this.euler);
      this.scale.set(.06,.035,.007).multiplyScalar(Math.min(1,fragment.life*7));this.matrix.compose(fragment.position,this.rotation,this.scale);
      this.fragmentMesh.setMatrixAt(index,this.matrix);this.fragmentMesh.setColorAt(index,this.color.setHex(fragment.color));
    }
    this.fragmentMesh.instanceMatrix.needsUpdate=true;if(this.fragmentMesh.instanceColor)this.fragmentMesh.instanceColor.needsUpdate=true;
  }
  clearFragments(){this.fragments.length=0;this.fragmentMesh.count=0;this.fragmentMesh.visible=false;}
  reset(){this.round=null;this.clearFragments();for(const entry of this.entries.values())this.apply(entry,false);for(const object of this.initialHidden)object.visible=false;}
  status(){return {count:this.entries.size,broken:[...this.entries].filter(([,entry])=>entry.broken).map(([id])=>id),fragments:this.fragments.length};}
  dispose(){this.reset();this.fragmentMesh.removeFromParent();this.fragmentMesh.dispose();this.fragmentGeometry.dispose();this.fragmentMaterial.dispose();}
}
