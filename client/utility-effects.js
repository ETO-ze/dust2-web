import * as THREE from 'three';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { loadedSkin, requestSkin, retainSkin, releaseSkin } from './skin-assets.js';
import { disposeInstanceSkeletons } from './resource-lifecycle.js';
import { EQUIPMENT } from '../shared/equipment.js';

/** Bounded, shared geometry for server-owned utility effects. */
export class UtilityEffects {
  constructor(scene){
    this.scene=scene;this.projectiles=new Map();this.smokes=[];this.bursts=[];
    this.grenadeGeometry=new THREE.CapsuleGeometry(.045,.08,3,6);
    this.materials=Object.fromEntries(['hegrenade','flashbang','smokegrenade'].map(id=>[id,new THREE.MeshStandardMaterial({color:EQUIPMENT[id].color,metalness:.4,roughness:.6})]));
    const canvas=document.createElement('canvas');canvas.width=canvas.height=64;const ctx=canvas.getContext('2d');
    const gradient=ctx.createRadialGradient(32,32,2,32,32,32);gradient.addColorStop(0,'rgba(183,188,178,1)');gradient.addColorStop(.45,'rgba(167,174,162,.96)');gradient.addColorStop(.8,'rgba(157,167,151,.6)');gradient.addColorStop(1,'rgba(145,155,143,0)');ctx.fillStyle=gradient;ctx.fillRect(0,0,64,64);
    this.smokeTexture=new THREE.CanvasTexture(canvas);this.smokeTexture.colorSpace=THREE.SRGBColorSpace;
    this.smokeMaterial=new THREE.MeshBasicMaterial({map:this.smokeTexture,transparent:true,opacity:.94,depthWrite:false,side:THREE.DoubleSide});
    this.smokeMesh=new THREE.InstancedMesh(new THREE.PlaneGeometry(1,1),this.smokeMaterial,40*13);this.smokeMesh.count=0;this.smokeMesh.frustumCulled=false;scene.add(this.smokeMesh);
    this.transform=new THREE.Object3D();this.direction=new THREE.Vector3();
    this.flash=document.createElement('div');this.flash.className='utility-screen';this.flash.id='flash-effect';document.body.append(this.flash);
    this.fog=document.createElement('div');this.fog.className='utility-screen smoke-screen';this.fog.id='smoke-effect';document.body.append(this.fog);
    this.flashRemaining=0;this.flashDuration=0;this.flashExposure=0;
  }
  sync(snapshot){
    this.smokes=(snapshot.smokes||[]).slice(-40).map(s=>({...s}));
    const visible=new Set();for(const p of (snapshot.grenades||[]).slice(-40)){
      visible.add(p.id);let entry=this.projectiles.get(p.id);if(!entry){const mesh=new THREE.Mesh(this.grenadeGeometry,this.materials[p.weapon]);this.scene.add(mesh);entry={mesh};this.projectiles.set(p.id,entry);}entry.state=p;requestSkin(p.weapon);if(!entry.original&&loadedSkin(p.weapon)){entry.mesh.removeFromParent();entry.mesh=clone(loadedSkin(p.weapon).scene);entry.original=p.weapon;retainSkin(p.weapon);this.scene.add(entry.mesh);}entry.mesh.position.set(p.x,p.y,p.z);
    }
    for(const [id,entry] of this.projectiles)if(!visible.has(id)){entry.mesh.removeFromParent();if(entry.original){disposeInstanceSkeletons(entry.mesh);releaseSkin(entry.original);}this.projectiles.delete(id);}
  }
  event(event,myId){
    if(event.type==='flash'){
      const hit=event.affected?.find(p=>p.playerId===myId);if(hit&&hit.duration>0){this.flashDuration=Math.max(this.flashRemaining,hit.duration);this.flashRemaining=this.flashDuration;this.flashExposure=Math.max(this.flashExposure,hit.exposure);}
    }
    if(event.type==='explosion'&&event.origin){
      while(this.bursts.length>=12){const old=this.bursts.shift();old.mesh.removeFromParent();old.mesh.geometry.dispose();old.mesh.material.dispose();}
      const mesh=new THREE.Mesh(new THREE.IcosahedronGeometry(1,1),new THREE.MeshBasicMaterial({color:0xffb75d,transparent:true,opacity:.65,depthWrite:false}));mesh.position.set(event.origin.x,event.origin.y,event.origin.z);this.scene.add(mesh);this.bursts.push({mesh,remaining:.35});
    }
  }
  update(dt,camera,visible=true){
    this.flashRemaining=Math.max(0,this.flashRemaining-dt);if(!this.flashRemaining)this.flashExposure=0;
    this.flash.style.opacity=visible?String(Math.min(1,this.flashExposure*Math.min(1,this.flashRemaining/Math.max(.1,this.flashDuration*.5)))):'0';
    for(const entry of this.projectiles.values()){entry.mesh.rotation.x+=dt*6;entry.mesh.rotation.z+=dt*3;entry.mesh.position.addScaledVector(this.direction.set(entry.state.vx,entry.state.vy,entry.state.vz),Math.min(dt,.033));}
    let count=0,inside=0;for(const cloud of this.smokes){
      cloud.remaining=Math.max(0,cloud.remaining-dt);if(!cloud.remaining)continue;
      const scale=Math.min(1,cloud.remaining/2),r=cloud.radius*scale,distance=camera.position.distanceTo(cloud);
      inside=Math.max(inside,THREE.MathUtils.clamp((r-distance)/Math.max(.5,r*.3),0,1));
      for(let i=0;i<13;i++){
        const angle=i*2.399963,radial=i===0?0:r*.54,height=Math.sin(i*1.7)*r*.36;
        this.transform.position.set(cloud.x+Math.cos(angle)*radial,cloud.y+height,cloud.z+Math.sin(angle)*radial);this.transform.quaternion.copy(camera.quaternion);this.transform.scale.setScalar(r*(i===0?2:1.3));this.transform.updateMatrix();this.smokeMesh.setMatrixAt(count++,this.transform.matrix);
      }
    }
    this.smokeMesh.count=count;this.smokeMesh.instanceMatrix.needsUpdate=true;this.fog.style.opacity=visible?String(inside):'0';
    for(let i=this.bursts.length-1;i>=0;i--){const b=this.bursts[i];b.remaining-=dt;if(b.remaining<=0){b.mesh.removeFromParent();b.mesh.geometry.dispose();b.mesh.material.dispose();this.bursts.splice(i,1);}else{b.mesh.scale.setScalar(.3+(1-b.remaining/.35)*1.7);b.mesh.material.opacity=b.remaining/.35*.65;}}
  }
  resetFlash(){this.flashRemaining=0;this.flashExposure=0;this.flash.style.opacity='0';}
  clear(){for(const p of this.projectiles.values()){p.mesh.removeFromParent();if(p.original){disposeInstanceSkeletons(p.mesh);releaseSkin(p.original);}}this.projectiles.clear();this.smokes=[];this.smokeMesh.count=0;this.flashRemaining=0;this.flashExposure=0;this.flash.style.opacity=this.fog.style.opacity='0';for(const b of this.bursts){b.mesh.removeFromParent();b.mesh.geometry.dispose();b.mesh.material.dispose();}this.bursts=[];}
  dispose(){this.clear();this.smokeMesh.removeFromParent();this.smokeMesh.geometry.dispose();this.smokeMaterial.dispose();this.smokeTexture.dispose();this.grenadeGeometry.dispose();Object.values(this.materials).forEach(m=>m.dispose());this.flash.remove();this.fog.remove();}
}
