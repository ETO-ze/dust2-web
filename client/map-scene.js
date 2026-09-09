import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import {HDRLoader} from 'three/addons/loaders/HDRLoader.js';
import { MAP } from '../shared/map-data.js';
import { assetURL, useDownloadedAssets } from './loading.js';

const assetUrl=path=>new URL(path.replace(/^\//,''),document.baseURI).href;

/** Actual CS2 render geometry, original material UVs, browser-compressed textures.
 * Source 2 Viewer handles VTEX/VMAT conversion. Physics stays a separate,
 * separately sourced reduced collision mesh for deterministic multiplayer;
 * render/collision alignment is checked by map-render-validate.mjs.
 */
export async function createMapScene(scene,{onProgress=()=>{}}={}) {
  onProgress('载入 CS2 原版 Dust II 场景…');
  const manager=new THREE.LoadingManager();
  useDownloadedAssets(manager);
  manager.onProgress=(_url,loaded,total)=>{
    if(total>5)onProgress(`载入原版材质 ${Math.min(loaded,total)} / ${total}…`);
  };
  const loader=new GLTFLoader(manager).setMeshoptDecoder(MeshoptDecoder);
  const [gltf,response,sky]=await Promise.all([
    loader.loadAsync(assetUrl('assets/map-cs2/dust2-web.gltf?v=e4f2b2d3903c')),
    fetch(assetURL(assetUrl(MAP.geometryUrl))),
    new HDRLoader(manager).loadAsync(assetUrl('assets/sky/daylight.hdr?v=5244534e9cf5')),
  ]);
  if(!response.ok)throw new Error(`地图碰撞下载失败 (${response.status})`);
  const positions=new Float32Array(await response.arrayBuffer());
  onProgress('对齐场景、材质和碰撞…');
  const group=new THREE.Group();
  group.name='Dust II · original CS2 render';
  // S2V: Source (x,y,z) → meters (y,z,x). Gameplay: (x,z,-y).
  // S2V already bakes inch-to-meter scaling; do not scale the model again.
  group.rotation.y=Math.PI/2;
  group.add(gltf.scene);
  group.updateMatrixWorld(true);
  const originalLights=[];
  const textures=new Set(),materials=new Set();
  let meshCount=0,triangles=0;
  group.traverse(object=>{
    if(object.isLight){originalLights.push(object);return;}
    if(!object.isMesh)return;
    meshCount++;
    triangles+=(object.geometry.index?.count||object.geometry.attributes.position.count)/3;
    object.castShadow=true;object.receiveShadow=true;
    object.frustumCulled=true;
    for(const material of Array.isArray(object.material)?object.material:[object.material]){
      const shaderFlags=material.userData?.vmat?.IntParams||{};
      if(shaderFlags.F_DO_NOT_CAST_SHADOWS)object.castShadow=false;
      if(materials.has(material))continue;
      materials.add(material);
      // Engine depth-feathered dust volumes have no glTF opacity equivalent.
      // Drawing their proxy triangles as opaque walls would obstruct the view.
      if(shaderFlags.F_DEPTH_FEATHER)material.visible=false;
      // In Source foliage/cloth shaders vertex colors encode wind weights,
      // not albedo. Multiplying them into the texture turns green leaves red.
      if(shaderFlags.F_VERTEX_ANIMATION||['csgo_effects.vfx','csgo_foliage.vfx'].includes(material.userData?.vmat?.ShaderName))material.vertexColors=false;
      for(const value of Object.values(material))if(value?.isTexture)textures.add(value);
      // Source overlays are authored almost coplanar with their target wall.
      const sourceName=material.userData?.vmat?.Name||material.name;
      if(/overlay|decal|graffiti|poster/i.test(sourceName)){
        material.polygonOffset=true;material.polygonOffsetFactor=-1;material.polygonOffsetUnits=-1;
      }
    }
  });
  for(const texture of textures)texture.anisotropy=4;

  // Keep the exported sun direction. Web lighting approximates Source 2's
  // baked lighting; original surface textures and their UVs stay untouched.
  const sunDirection=new THREE.Vector3(-.43,-.84,-.33);
  const originalSun=originalLights.find(l=>l.isDirectionalLight);
  if(originalSun){
    const origin=new THREE.Vector3(),target=new THREE.Vector3();
    originalSun.getWorldPosition(origin);originalSun.target.getWorldPosition(target);
    if(target.distanceToSquared(origin)>1e-8)sunDirection.subVectors(target,origin).normalize();
  }
  for(const light of originalLights)light.removeFromParent();
  scene.add(group);
  // The map is static: retain its already-computed transforms instead of
  // multiplying every imported object matrix on every animation frame.
  group.traverse(object=>{object.matrixAutoUpdate=false;object.matrixWorldAutoUpdate=false;});
  sky.mapping=THREE.EquirectangularReflectionMapping;
  scene.background=sky;scene.backgroundIntensity=.8;
  scene.backgroundRotation.y=1.2;
  scene.userData.sky={source:'Poly Haven / Kloofendal 48d Partly Cloudy',resolution:'2048 × 1024',downloadBytes:5451493};
  scene.fog=new THREE.Fog(0xc9d8de,140,300);
  const hemisphere=new THREE.HemisphereLight(0xd5e9ff,0x99805f,2.15);
  hemisphere.name='dust2-web-sky';
  const sun=new THREE.DirectionalLight(0xfff0d7,3.3);
  sun.name='dust2-web-sun';
  const center=new THREE.Vector3(-5,0,-25);
  sun.target.position.copy(center);
  sun.position.copy(center).addScaledVector(sunDirection,-110);
  sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);
  Object.assign(sun.shadow.camera,{left:-78,right:78,top:78,bottom:-78,near:1,far:230});
  sun.shadow.normalBias=.035;sun.shadow.bias=-.00012;
  scene.add(hemisphere,sun,sun.target);
  group.userData.renderStats={meshCount,triangles,materials:materials.size,textures:textures.size,originalCS2Materials:true};
  onProgress('CS2 原版 Dust II 场景就绪');
  return {mapData:MAP,positions,group,lights:[hemisphere,sun],spawn:MAP.spawns.T[0]};
}

export { MAP };
