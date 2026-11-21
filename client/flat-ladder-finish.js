// These tags are baked only onto triangles matched to original ladder models.
// The mesh supplies rails, joints and rung silhouettes. Texture projection in
// metres keeps lacquer, grain and brushed alloy continuous across sector splits.
export const ladderFinishGLSL = `
  vec3 ladderFinish(vec3 color, vec3 p, vec3 dx, vec3 dy, float tag) {
    bool timber = tag < 33.5;
    bool paint = tag > 34.5;
    vec3 n = cross(dx, dy);
    n /= max(length(n), 1e-8);
    vec3 base = timber ? vec3(.30,.176,.083) :
                paint ? vec3(.255,.243,.187) : vec3(.46,.52,.54);
    float brightness = dot(color, vec3(.2126,.7152,.0722));
    vec3 pigment = mix(base, color, timber ? .35 : .48);
    pigment *= mix(.88,1.1,clamp(brightness,0.,1.));
    float grain = directionalFinish(p*(timber ? .91 : 2.8),
                         dx*(timber ? .91 : 2.8),dy*(timber ? .91 : 2.8),timber ? 2. : 1.);
    float nearGrain = 1. - smoothstep(.018,.065,max(length(dx),length(dy)));
    pigment *= 1. + (grain-.5)*nearGrain*(timber ? .36 : .14);
    // Rung tops and outward-facing rails catch soft skylight at all distances.
    float upward = abs(n.y);
    float edge = abs(dot(n,normalize(vec3(.55,.72,.41))));
    return pigment * (.91 + .16*edge + .12*upward);
  }`;
export const shadeLadderGLSL = `
  if (surfaceClass >= 32.5 && surfaceClass < 35.5) {
    diffuseColor.rgb = ladderFinish(diffuseColor.rgb, surfaceWorld, dFdx(surfaceWorld), dFdy(surfaceWorld), surfaceClass);
  }`;
