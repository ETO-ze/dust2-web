import * as THREE from 'three';
import {createFlatWireFence} from './flat-wire-fence.js';
import {applySurfaceDetail} from './flat-surface-detail.js';

// GLTFLoader has resolved any alpha textures by this point. Use one Lambert
// material per parsed variant, including variants produced for vertex colours.
export function applyFlatMaterials(root, detailTexture) {
  const replacements = new Map();
  const replace = original => {
    if (replacements.has(original)) return replacements.get(original);
    if (original.userData.performanceFence === true) {
      const wire = createFlatWireFence(original.visible && !original.userData.flatHidden);
      replacements.set(original, wire);
      return wire;
    }
    const baked=original.userData.bakedSurface===true;
    const Surface=baked?THREE.MeshBasicMaterial:THREE.MeshLambertMaterial;
    const material = new Surface({
      color: original.color, map: original.map || null, side: original.side,
      transparent: original.transparent, opacity: original.opacity, alphaTest: original.alphaTest,
      depthWrite: original.depthWrite, vertexColors: original.vertexColors,
      visible: original.visible && !original.userData.flatHidden,
      polygonOffset: baked || !!original.userData.flatOverlay, polygonOffsetFactor: baked?1:-1, polygonOffsetUnits: baked?1:-1,
    });
    if(baked)material.toneMapped=false;
    if(detailTexture && original.userData.surfaceMaterialVersion===1 && baked && !original.map){
      applySurfaceDetail(material,detailTexture);
    }
    if (original.map) {
      // Preserve the exact source alpha test without sampling decorative RGB.
      material.onBeforeCompile = shader => {
        shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>',
          'diffuseColor.a *= texture2D(map, vMapUv).a;');
      };
    }
    replacements.set(original, material);
    return material;
  };
  root.traverse(mesh => {
    if (mesh.isLineSegments) {
      mesh.material.toneMapped=false;
      mesh.material.depthWrite=false;
      mesh.renderOrder=1;
      return;
    }
    if (!mesh.isMesh) return;
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(replace) : replace(mesh.material);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
  });
  for (const original of replacements.keys()) original.dispose();
}
