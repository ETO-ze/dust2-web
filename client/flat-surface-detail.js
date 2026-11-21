import {DataArrayTexture, RedFormat, RepeatWrapping, LinearFilter, LinearMipmapLinearFilter} from 'three';

let texturePromise;
export function loadFlatSurfaceDetail() {
  texturePromise ??= import('./flat-surface-swatches.js').then(({side,packed}) => {
    const input = atob(packed);
    const pixels = new Uint8Array(input.length * 2);
    for(let i=0;i<input.length;i++){
      const value=input.charCodeAt(i);
      pixels[2*i]=(value>>4)*17;
      pixels[2*i+1]=(value&15)*17;
    }
    const texture=new DataArrayTexture(pixels,side,side,6);
    texture.name='Architectural surface detail';
    texture.format=RedFormat;
    texture.wrapS=texture.wrapT=RepeatWrapping;
    texture.magFilter=LinearFilter;
    texture.minFilter=LinearMipmapLinearFilter;
    texture.generateMipmaps=true;
    texture.needsUpdate=true;
    return texture;
  }).catch(error=>{texturePromise=undefined;throw error;});
  return texturePromise;
}

// Draws one continuous swatch across adjacent triangles and batches. Using a
// texture array keeps the six mip chains independent at grazing angles.
export function applySurfaceDetail(material,texture) {
  material.customProgramCacheKey=()=> 'dust2-architectural-surfaces-v2';
  material.onBeforeCompile=shader=>{
    shader.uniforms.uSurfaceDetail={value:texture};
    shader.vertexShader=shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 surfaceWorld;\nvarying float surfaceClass;')
      .replace('#include <color_vertex>', `#include <color_vertex>
        surfaceClass = 255.0;
        #ifdef USE_COLOR_ALPHA
          surfaceClass = floor(255.0 * color.a + 0.5);
          vColor.a = 1.0;
        #endif`)
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nsurfaceWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader=shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform highp sampler2DArray uSurfaceDetail;
        varying vec3 surfaceWorld;
        varying float surfaceClass;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 dx = dFdx(surfaceWorld), dy = dFdy(surfaceWorld);
        vec3 axis = abs(cross(dx,dy));
        if (surfaceClass >= 0.5 && surfaceClass < 6.5) {
          const float repeats[6] = float[6](0.52, 0.70, 0.42, 0.55, 0.52, 0.33);
          float layer = floor(surfaceClass + 0.5) - 1.0;
          float scale = repeats[int(layer)];
          vec3 p = surfaceWorld * scale;
          dx *= scale;
          dy *= scale;
          // Axis-aligned walls and floors use one fetch. A bevel or a ramp can
          // cross the dominant-axis boundary without switching textures in a
          // single pixel. Explicit gradients keep mip levels stable on slopes.
          vec3 weights = smoothstep(vec3(0.76), vec3(1.0), axis / max(max(axis.x,axis.y),max(axis.z,1e-20)));
          weights /= max(dot(weights,vec3(1.0)),1e-10);
          float detail = 0.0;
          if (weights.x > 0.0)
            detail += weights.x * textureGrad(uSurfaceDetail,vec3(p.zy,layer),dx.zy,dy.zy).r;
          if (weights.y > 0.0)
            detail += weights.y * textureGrad(uSurfaceDetail,vec3(p.xz,layer),dx.xz,dy.xz).r;
          if (weights.z > 0.0)
            detail += weights.z * textureGrad(uSurfaceDetail,vec3(p.xy,layer),dx.xy,dy.xy).r;
          // Keep metal grooves legible and let floor markings carry most of the contrast.
          const float contrasts[6] = float[6](0.10, 0.085, 0.15, 0.085, 0.10, 0.18);
          float contrast = contrasts[int(layer)];
          diffuseColor.rgb *= 1.0 + contrast*(2.0*detail-1.0);
        }`);
  };
}
