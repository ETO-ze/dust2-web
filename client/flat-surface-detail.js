import {DataArrayTexture, RedFormat, RepeatWrapping, LinearFilter, LinearMipmapLinearFilter, Vector2, Vector3, Vector4} from 'three';
import {ladderFinishGLSL, shadeLadderGLSL} from './flat-ladder-finish.js';
import assignments from './map-finishes/assignments.json' with {type:'json'};

import arena from './arena-finishes/palette.json' with {type:'json'};
import plates from './plane-finishes.json' with {type:'json'};

let texturePromise, arenaPixels;
async function unpack({side, finishes, packed}) {
  const source = atob(packed);
  const compressed = new Uint8Array(source.length);
  for (let i = 0; i < source.length; ++i) compressed[i] = source.charCodeAt(i);
  let pixels;
  if (typeof DecompressionStream === 'function') {
    const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'));
    pixels = new Uint8Array(await new Response(stream).arrayBuffer());
  } else {
    const {gunzipSync} = await import('three/addons/libs/fflate.module.js');
    pixels = gunzipSync(compressed);
  }
  if (pixels.length !== side * side * finishes.length) throw Error('地图材质库长度不符');
  // Restore filtered rows in place. Six-bit tones expand into the GPU R8 layer.
  for (let start = 0; start < pixels.length; start += side) {
    let previous = 0;
    for (let i = start; i < start + side; i++) {
      previous = (previous + pixels[i]) & 255;
      pixels[i] = Math.round(previous * 255 / 63);
    }
  }
  return {pixels, side, finishes};
}

function makeTexture(pixels, side, finishes, profiles) {
  const texture = new DataArrayTexture(pixels, side, side, finishes.length);
  texture.name = 'Original Blender architectural finishes';
  texture.format = RedFormat;
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.anisotropy = 4;
  texture.generateMipmaps = true;
  texture.userData.finishes = finishes;
  texture.userData.profiles = profiles;
  texture.needsUpdate = true;
  return texture;
}

export async function loadFlatSurfaceDetail(mapId) {
  if (Object.hasOwn(arena.mapTints, mapId)) {
    // Keep the decoded tiles shared while each map owns a disposable GPU texture.
    arenaPixels ??= import('./arena-finishes/shared.js').then(unpack).catch(error => {
      arenaPixels = undefined;
      throw error;
    });
    const {pixels, side, finishes} = await arenaPixels;
    const texture = makeTexture(pixels, side, finishes, {[mapId]:[0,4,1,1,[1,1,1]]});
    texture.name = mapId + ' arena surfaces';
    texture.userData.mapTiles = true;
    return texture;
  }
  texturePromise ??= import('./flat-surface-swatches.js').then(async source => {
    const {pixels,side,finishes} = await unpack(source);
    return makeTexture(pixels,side,finishes,source.profiles);
  }).catch(error => {
    texturePromise = undefined;
    throw error;
  });
  return texturePromise;
}

const finishUniforms = `
  uniform highp sampler2DArray uSurfaceDetail;
  uniform float uFinishScale[FINISH_COUNT];
  uniform float uFinishContrast[FINISH_COUNT];
  uniform int uTagLayer[6];
  uniform bool uFloorSlabs;
  uniform vec4 uMapFinish;
  uniform vec3 uGrainPigment;
  varying vec3 surfaceWorld;
  varying float surfaceClass;

  // Both projections are affine functions of absolute world position. Concrete,
  // plaster and ground keep the exact same phase at the top and sides of a step
  // and across sector boundaries, even when adjacent triangles have different normals.
  vec2 groundUV(vec3 p) { return p.xz + p.y * vec2(.41,.73); }
  vec2 crossUV(vec3 p) {
    return vec2(-.61*p.x + .79*p.z + .66*p.y, .79*p.x + .61*p.z - .53*p.y) * 1.29;
  }
  float continuousFinish(vec3 p, vec3 dx, vec3 dy, float layer) {
    float first = textureGrad(uSurfaceDetail, vec3(groundUV(p),layer),groundUV(dx),groundUV(dy)).r;
    float crossGrain = textureGrad(uSurfaceDetail,vec3(crossUV(p)+vec2(.27,.63),layer),crossUV(dx),crossUV(dy)).r;
    return mix(first,crossGrain,.28);
  }
  float directionalFinish(vec3 p, vec3 dx, vec3 dy, float layer) {
    vec3 normal = abs(cross(dx,dy));
    float largest = max(max(normal.x,normal.y),max(normal.z,1e-20));
    vec3 weights = smoothstep(vec3(.73),vec3(1.),normal / largest);
    weights /= max(dot(weights,vec3(1.)),1e-10);
    float value = 0.;
    if (weights.x > 0.) value += weights.x * textureGrad(uSurfaceDetail,vec3(p.zy,layer),dx.zy,dy.zy).r;
    if (weights.y > 0.) value += weights.y * textureGrad(uSurfaceDetail,vec3(p.xz,layer),dx.xz,dy.xz).r;
    if (weights.z > 0.) value += weights.z * textureGrad(uSurfaceDetail,vec3(p.xy,layer),dx.xy,dy.xy).r;
    return value;
  }`;

const arenaUniforms = `
  uniform vec3 uArenaBase[6];
  uniform vec3 uArenaKey;
  uniform vec3 uArenaLuma;
  uniform vec2 uSourcePlates[7];
  float flattenSourceLight(float luminance, vec2 cuts) {
    // Cuts come from two area-weighted quantiles of each map's source pigments.
    // Above the upper transition the source is a flat plate: no bright, rounded
    // relief can leak through to the paint colour.
    return .61 + .24*smoothstep(.73*cuts.x,1.13*cuts.x,luminance)
               + .15*smoothstep(.81*cuts.y,1.10*cuts.y,luminance);
  }
  vec3 arenaFinish(vec3 source, vec3 normal, vec3 base, vec2 cuts) {
    float luminance=dot(source,uArenaLuma);
    float plate=flattenSourceLight(luminance,cuts);
    float hi=max(source.r,max(source.g,source.b)), lo=min(source.r,min(source.g,source.b));
    float chroma=(hi-lo)/max(hi,.08);
    float accent=.72*smoothstep(.35,.74,chroma)*smoothstep(.035,.13,luminance);
    // Retain landmark hue after removing its source-light magnitude.
    vec3 pigment=mix(base,.68*source/max(hi,.08),accent);
    float facing=dot(normal,uArenaKey);
    float orientation=.75+.17*smoothstep(-.50,-.10,facing)
                         +.12*smoothstep(.33,.71,facing)+.075*normal.y;
    return pigment*plate*orientation;
  }
  vec3 arenaNormal(vec3 n) {
    return n * inversesqrt(max(dot(n,n),1e-20));
  }
  // Untagged rubble, corner trim and door surrounds share pigments with adjacent
  // neutral faces. Keep foliage, graphic signs and saturated map landmarks intact.
  vec3 blendArenaTrim(vec3 source, vec3 normal) {
    float hi=max(source.r,max(source.g,source.b)), lo=min(source.r,min(source.g,source.b));
    float y=dot(source,uArenaLuma);
    float weight=.84*(1.-smoothstep(.18,.40,(hi-lo)/max(.08,hi)))
                 * smoothstep(.015,.065,y) * (1.-smoothstep(.72,.93,y));
    vec3 base=mix(uArenaBase[0],uArenaBase[4],smoothstep(.65,.92,normal.y));
    return mix(source,arenaFinish(source,normal,base,uSourcePlates[6]),weight);
  }
`;

export function applySurfaceDetail(material, texture, mapId) {
  const profile = texture.userData.profiles[mapId] || [0, 4, 1, 1, [1, 1, 1]];
  const finishes = texture.userData.finishes;
  const local = texture.userData.mapTiles === true;
  const rules = local ? assignments[mapId] || {} : {};
  material.customProgramCacheKey = () => (local ? 'dust2-plane-finishes-v2-' : 'dust2-architectural-surfaces-v4-') + finishes.length;
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, {
      uSurfaceDetail: {value:texture},
      uFinishScale: {value:finishes.map(([,metres]) => 1 / metres)},
      uFinishContrast: {value:finishes.map(([, ,contrast]) => contrast)},
      uTagLayer: {value:[rules.plainConcrete ? 3 : profile[0],1,2,rules.plasterWall ? 0 : 3,profile[1],rules.brickWall ? 0 : 5]},
      uFloorSlabs: {value:!!rules.floorSlabs},
      uMapFinish: {value:new Vector4(...profile.slice(0,4))},
      uGrainPigment: {value:new Vector3(...profile[4])},
    });
    if (local) {
      const tint = arena.mapTints[mapId];
      shader.uniforms.uArenaBase = {value:arena.layers.map(rgb => new Vector3(...rgb).multiply(new Vector3(...tint)))};
      shader.uniforms.uSourcePlates = {value:plates[mapId].map(pair => new Vector2(...pair))};
      shader.uniforms.uArenaKey = {value:new Vector3(...arena.keyDirection).normalize()};
      shader.uniforms.uArenaLuma = {value:new Vector3(...arena.sourceLuma)};
    }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 surfaceWorld;\nvarying float surfaceClass;')
      .replace('#include <color_vertex>', `#include <color_vertex>
        surfaceClass = 255.0;
        #ifdef USE_COLOR_ALPHA
          surfaceClass = floor(255.0 * color.a + 0.5);
          vColor.a = 1.0;
        #endif`)
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nsurfaceWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n#define FINISH_COUNT ' + finishes.length + '\n' + (local ? arenaUniforms : '') + finishUniforms + '\n' + ladderFinishGLSL)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 dx = dFdx(surfaceWorld), dy = dFdy(surfaceWorld);
        if (surfaceClass >= .5 && surfaceClass < 6.5) {
          int tag = int(floor(surfaceClass + .5));
          int layer = uTagLayer[tag-1];
          vec3 normal = cross(dx,dy);
          if (tag == 1 && uFloorSlabs) {
            // Tag 1 includes stone slabs and concrete floors. The original face
            // orientation separates these from vertical masonry in the same mesh.
            if (normal.y > .74 * length(normal)) layer = int(uMapFinish.y);
          }
          ${local ? 'diffuseColor.rgb = arenaFinish(diffuseColor.rgb, arenaNormal(normal), uArenaBase[layer], uSourcePlates[layer]);' : ''}
          float scale = uFinishScale[layer] * uMapFinish.z;
          vec3 position = surfaceWorld * scale;
          dx *= scale;
          dy *= scale;
          // Anisotropic mip filtering keeps receding floors legible along the short
          // footprint axis. Fade only when even that axis spans most of a tile.
          float minor = length(cross(dx,dy)) / max(max(length(dx),length(dy)),1e-10);
          float visibility = 1. - smoothstep(.15,.5,minor);
          if (visibility > 0.) {
            bool alignedGrain = ${local ? 'true' : 'tag == 2 || tag == 3 || tag == 6'};
            float detail = alignedGrain
              ? directionalFinish(position,dx,dy,float(layer))
              : continuousFinish(position,dx,dy,float(layer));
            float strength = visibility * uFinishContrast[layer] * uMapFinish.w;
            diffuseColor.rgb *= vec3(1.) + uGrainPigment * (2.*detail - 1.) * strength;
          }
        }
        ${local ? 'if (surfaceClass > 254.5) diffuseColor.rgb = blendArenaTrim(diffuseColor.rgb, arenaNormal(cross(dx,dy)));' : ''}
        ${shadeLadderGLSL}`);
  };
}
