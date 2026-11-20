import * as THREE from 'three';

// Integral of a unit-period set of wire strips. Integrating across each pixel
// keeps a thin distant wire's average coverage without screen-door dithering.
const wireFunctions = `
  varying vec3 fenceWorld;
  const float wireFraction = 0.055;
  vec2 stripIntegral(vec2 x) {
    return floor(x) * wireFraction + min(fract(x), vec2(wireFraction));
  }
  vec2 diamondAxes(vec2 p) {
    return vec2(p.x + p.y, p.x - p.y) / 0.16;
  }
  float fenceCoverage() {
    vec3 dx = dFdx(fenceWorld), dy = dFdy(fenceWorld);
    vec3 normal = cross(dx, dy);
    vec3 right = abs(normal.y) > 0.97 * length(normal)
      ? vec3(1., 0., 0.) : normalize(vec3(normal.z, 0., -normal.x));
    vec3 up = normalize(cross(normal, right));
    vec2 p = diamondAxes(vec2(dot(fenceWorld, right), dot(fenceWorld, up)));
    vec2 stepX = diamondAxes(vec2(dot(dx, right), dot(dx, up)));
    vec2 stepY = diamondAxes(vec2(dot(dy, right), dot(dy, up)));
    vec2 span = clamp(abs(stepX) + abs(stepY), vec2(.001), vec2(1.));
    vec2 center = fract(p + .5 * wireFraction);
    vec2 lanes = clamp((stripIntegral(center + .5 * span) - stripIntegral(center - .5 * span)) / span, 0., 1.);
    return 1. - (1. - lanes.x) * (1. - lanes.y);
  }
`;

export function createFlatWireFence(visible) {
  const material = new THREE.MeshBasicMaterial({
    name:'Performance chain-link mesh', color:0x52616a, visible,
    side:THREE.DoubleSide, transparent:true, depthWrite:false, forceSinglePass:true,
    // Signs and solid framing stay in front of any coplanar wire fragments.
    polygonOffset:true, polygonOffsetFactor:1, polygonOffsetUnits:2,
    toneMapped:false,
  });
  material.userData.performanceFence = true;
  material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 fenceWorld;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nfenceWorld = (modelMatrix * vec4(transformed, 1.)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + wireFunctions)
      .replace('#include <alphamap_fragment>', `
        #include <alphamap_fragment>
        diffuseColor.a *= fenceCoverage();
        if (diffuseColor.a < 0.002) discard;
      `);
  };
  return material;
}
