import * as THREE from 'three';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';

/** Keep a separate viewmodel scene in the same lighting frame as the world.
 * Colors, metalness, roughness and AO remain authored material values. The old
 * fixed camera light was only 0.4 / 1.2 while the map uses 2.15 / 3.3, making
 * even a correctly baked finish appear darker than the scene around it.
 */
export function createWeaponLighting(renderer,weaponScene){
 const sky=new THREE.HemisphereLight(0xd5e9ff,0x99805f,2.15),sun=new THREE.DirectionalLight(0xfff0d7,3.3);
 sky.name='viewmodel-sky';sun.name='viewmodel-sun';weaponScene.add(sky,sun,sun.target);
 const inverseView=new THREE.Quaternion(),direction=new THREE.Vector3(),position=new THREE.Vector3(),target=new THREE.Vector3();let environment=null,sourceScene=null,worldSky=null,worldSun=null;
 function rebuild(){
  const generator=new THREE.PMREMGenerator(renderer),room=new RoomEnvironment();
  try{const next=generator.fromScene(room,.04);weaponScene.environment=next.texture;weaponScene.environmentIntensity=.45;environment?.dispose();environment=next;}
  finally{room.dispose();generator.dispose();}
 }
 function update(worldScene,worldCamera){
  worldCamera.getWorldQuaternion(inverseView).invert();
  // The map lights are stable. Searching the complete map + every player's
  // skeleton twice per frame consumed measurable CPU as players were added.
  if(sourceScene!==worldScene||!worldSky||!worldSun){sourceScene=worldScene;worldSky=worldScene.getObjectByName('dust2-web-sky');worldSun=worldScene.getObjectByName('dust2-web-sun');}
  if(worldSky?.isHemisphereLight){sky.color.copy(worldSky.color);sky.groundColor.copy(worldSky.groundColor);sky.intensity=worldSky.intensity;}
  if(worldSun?.isDirectionalLight){
   sun.color.copy(worldSun.color);sun.intensity=worldSun.intensity;
   worldSun.getWorldPosition(position);worldSun.target.getWorldPosition(target);direction.subVectors(position,target).normalize();
  }else direction.set(.43,.84,.33).normalize();
  sun.position.copy(direction.applyQuaternion(inverseView)).multiplyScalar(10);sun.target.position.set(0,0,0);
  sky.position.set(0,1,0).applyQuaternion(inverseView).multiplyScalar(10);
  weaponScene.environmentRotation.setFromQuaternion(inverseView);
 }
 function dispose(){sky.removeFromParent();sun.removeFromParent();sun.target.removeFromParent();if(weaponScene.environment===environment?.texture)weaponScene.environment=null;environment?.dispose();environment=null;}
 rebuild();return {update,rebuild,dispose,sky,sun};
}
