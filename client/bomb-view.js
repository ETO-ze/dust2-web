import {c4Display} from './c4-display.js';
import * as THREE from 'three';
import {clone} from 'three/addons/utils/SkeletonUtils.js';
import {loadedSkin,requestSkin,retainSkin} from './skin-assets.js';

export class BombView {
  constructor(scene){this.scene=scene;this.group=new THREE.Group();this.group.visible=false;scene.add(this.group);}
  update(bomb,now){
    const visible=bomb&&['dropped','planted'].includes(bomb.state);this.group.visible=!!visible;if(!visible)return;
    if(!this.model){requestSkin('c4');const source=loadedSkin('c4');if(!source)return;retainSkin('c4');this.model=clone(source.scene);this.group.add(this.model);this.display=c4Display(this.model);
      const light=new THREE.Mesh(new THREE.SphereGeometry(.006,8,6),new THREE.MeshBasicMaterial({color:0xff3218}));light.position.set(.035,.045,.025);this.group.add(light);this.light=light;
    }
    this.display?.update(bomb.state==='planted'?Math.max(0,bomb.remaining||0).toFixed(1).padStart(4,'0'):'');
    this.group.position.set(bomb.x,bomb.y+.048,bomb.z);this.light.visible=bomb.state==='planted'&&now%650<160;
  }
  clear(){this.group.visible=false;}
}
