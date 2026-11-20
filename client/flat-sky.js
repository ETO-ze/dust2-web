import * as THREE from 'three';
import skies from '../shared/performance-skies.json' with {type: 'json'};

const mounted = new WeakMap();

// VRF writes longitude zero on the +X face and the zenith at the top of the
// image. Source +Y is game -Z. An entity's positive yaw rotates the texture
// in world space, hence the inverse rotation when looking it up.
const vertexShader = `
  uniform mat4 projectionInverse;
  uniform mat4 cameraWorld;
  varying vec3 direction;
  void main() {
    direction = mat3(cameraWorld) * (projectionInverse * vec4(position.xy, 1., 1.)).xyz;
    gl_Position = vec4(position.xy, 1., 1.);
  }
`;
const fragmentShader = `
  uniform sampler2D panorama;
  uniform float yawTurns;
  uniform float exposure;
  varying vec3 direction;
  void main() {
    vec3 ray = normalize(direction);
    float u = atan(ray.z, ray.x) * 0.15915494309 + yawTurns;
    float v = acos(clamp(ray.y, -1., 1.)) * 0.31830988618;
    gl_FragColor = vec4(texture2D(panorama, vec2(u, v)).rgb * exposure, 1.);
    #include <colorspace_fragment>
  }
`;

async function decode(blob) {
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(blob, {imageOrientation:'none', premultiplyAlpha:'none', colorSpaceConversion:'none'});
  }
  const src = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = src;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(src);
  }
}

async function readPanorama(url, signal) {
  signal?.throwIfAborted();
  const controller = new AbortController();
  const cancel = () => controller.abort(signal.reason);
  signal?.addEventListener('abort', cancel, {once:true});
  const timer = setTimeout(() => controller.abort(Error('Sky load timed out')), 6000);
  try {
    const stopped = new Promise((_, reject) => {
      controller.signal.addEventListener('abort', () => reject(controller.signal.reason), {once:true});
    });
    const loading = async () => {
      const response = await fetch(url, {signal:controller.signal, cache:'force-cache'});
      if (!response.ok) throw Error('Sky HTTP ' + response.status);
      const blob = await response.blob();
      controller.signal.throwIfAborted();
      const image = await decode(blob);
      if (controller.signal.aborted) {
        image.close?.();
        throw controller.signal.reason;
      }
      return {image, bytes:blob.size};
    };
    return await Promise.race([stopped, loading()]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
  }
}

export function panoramaMesh(texture, yaw) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1,-1,0, 3,-1,0, -1,3,0], 3));
  const uniforms = {
    projectionInverse:{value:new THREE.Matrix4()}, cameraWorld:{value:new THREE.Matrix4()},
    panorama:{value:texture}, yawTurns:{value:yaw / 360}, exposure:{value:1},
  };
  const material = new THREE.ShaderMaterial({
    uniforms, vertexShader, fragmentShader, toneMapped:false, depthWrite:false, depthFunc:THREE.LessEqualDepth,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'Map sky panorama';
  mesh.renderOrder = 999; // Opaque walls and silhouettes reject covered pixels before texture sampling.
  mesh.frustumCulled = false;
  mesh.raycast = () => {};
  mesh.onBeforeRender = (renderer, _scene, camera) => {
    uniforms.projectionInverse.value.copy(camera.projectionMatrixInverse);
    uniforms.cameraWorld.value.copy(camera.matrixWorld);
    uniforms.exposure.value = renderer.toneMappingExposure / 1.03;
  };
  return mesh;
}

export async function prepareFlatSky(mapId, {signal} = {}) {
  const spec = skies[mapId];
  let image, texture, mesh, scene;
  const details = {mapId, source:'fallback', downloadBytes:0};
  // Keep only the selected map's panorama resident and retain its decoded
  // pixels until dispose, so THREE can upload again after WebGL context loss.
  try {
    if (!spec) throw Error('Unknown map sky');
    const url = new URL(`./flat-skies/${mapId}.webp`, import.meta.url);
    const decoded = await readPanorama(url, signal);
    image = decoded.image;
    signal?.throwIfAborted();
    if (image.width !== image.height * 2 || image.width > 1536) throw Error('Invalid sky panorama');
    texture = new THREE.Texture(image);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.minFilter = texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = texture.flipY = false;
    texture.needsUpdate = true;
    mesh = panoramaMesh(texture, spec.yaw);
    Object.assign(details, {source:'map-panorama', material:spec.material, yaw:spec.yaw,
      resolution:`${image.width} × ${image.height}`, downloadBytes:decoded.bytes});
  } catch (error) {
    image?.close?.();
    image = null;
    signal?.throwIfAborted();
    details.reason = error.message;
  }
  const pageHide = event => { if (!event.persisted) dispose(); };
  function dispose() {
    if (scene && mounted.get(scene) === dispose) mounted.delete(scene);
    mesh?.removeFromParent();
    mesh?.material.dispose();
    mesh?.geometry.dispose();
    texture?.dispose();
    image?.close?.();
    mesh = texture = image = scene = null;
    globalThis.removeEventListener?.('pagehide', pageHide);
  }
  return {
    mount(target) {
      mounted.get(target)?.();
      scene = target;
      scene.background = new THREE.Color(0xbbcbd0);
      scene.userData.sky = details;
      if (mesh) scene.add(mesh);
      mounted.set(scene, dispose);
      globalThis.addEventListener?.('pagehide', pageHide);
    }, dispose,
  };
}
