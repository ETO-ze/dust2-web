import {Box3, Matrix4, Vector2, Vector3, Vector4} from 'three';
import placements from './wall-site-signs.json' with {type:'json'};

const position = 'varying vec3 sitePaintWorld;';
const fragment = `
  varying vec3 sitePaintWorld;
  uniform sampler2D sitePaintInk;
  uniform vec4 sitePaintCenter[2];
  uniform vec3 sitePaintNormal[2];
  uniform vec2 sitePaintDims[2];
  void applySitePaint(inout vec3 rgb) {
    vec3 dx=dFdx(sitePaintWorld),dy=dFdy(sitePaintWorld);
    for (int i=0; i<2; i++) {
      vec3 delta=sitePaintWorld-sitePaintCenter[i].xyz;
      vec3 n=sitePaintNormal[i];
      if (abs(dot(delta,n))>sitePaintDims[i].y || dot(cameraPosition-sitePaintCenter[i].xyz,n)<=0.) continue;
      vec3 right=normalize(cross(vec3(0.,1.,0.),n));
      vec3 up=cross(n,right);
      vec2 density=vec2(sitePaintCenter[i].w,sitePaintDims[i].x);
      vec2 local=vec2(dot(delta,right),dot(delta,up))*density+.5;
      if (any(lessThan(local,vec2(0.))) || any(greaterThan(local,vec2(1.)))) continue;

      vec3 hitNormal=cross(dx,dy);
      if (abs(dot(hitNormal,n))<.96*length(hitNormal)) continue;
      const float tile=512.;
      vec2 uv=(vec2(float(i),0.)+(local*(tile-1.)+.5)/tile)*.5;
      vec2 scale=.5*density*(tile-1.)/tile;
      vec4 ink=textureGrad(sitePaintInk,uv,vec2(dot(dx,right),dot(dx,up))*scale,vec2(dot(dy,right),dot(dy,up))*scale);
      rgb=mix(rgb,ink.rgb,ink.a);
    }
  }
`;

function boundsInGame(mesh,root) {
  if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
  const matrix=new Matrix4();
  for(let node=mesh;node!==root;node=node.parent) {
    if(node.matrixAutoUpdate)node.updateMatrix();
    matrix.premultiply(node.matrix);
  }
  matrix.premultiply(new Matrix4().makeRotationY(Math.PI/2));
  return mesh.geometry.boundingBox.clone().applyMatrix4(matrix);
}

// Clip each print into an existing opaque architectural surface. Only nearby static
// draw batches get the sign variant. Actors, moving doors, glass and the floor decal
// do not participate. The buffers and draw count are unchanged.
export function paintSiteWalls(root,map,atlas) {
  const record=placements[map.id];
  if(record?.source!==map.sourceSha256 || !record.A || !record.B)return ()=>{};
  const signs=[record.A,record.B];
  const centers=signs.map(s=>new Vector4(...s.center,1/s.size));
  const normals=signs.map(s=>new Vector3(...s.normal).normalize());
  const nearby=signs.map(s=>new Box3().setFromCenterAndSize(new Vector3(...s.center),new Vector3().setScalar(Math.max(s.size,s.height || s.size)*1.5)));
  const variants=new Map(), originals=new Map();
  const variant=m=>{
    if(variants.has(m))return variants.get(m);
    const v=m.clone(), compile=m.onBeforeCompile, key=m.customProgramCacheKey();
    v.customProgramCacheKey=()=>key+'-site-wall-print-v1';
    v.onBeforeCompile=(shader,renderer)=>{
      compile.call(m,shader,renderer);
      shader.uniforms.sitePaintInk={value:atlas};
      shader.uniforms.sitePaintCenter={value:centers};
      shader.uniforms.sitePaintNormal={value:normals};
      shader.uniforms.sitePaintDims={value:signs.map(s=>new Vector2(1/(s.height || s.size),s.depth ?? .032))};
      shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\n'+position)
        .replace('#include <project_vertex>','#include <project_vertex>\nsitePaintWorld=(modelMatrix * vec4(transformed,1.)).xyz;');
      shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\n'+fragment)
        .replace('#include <opaque_fragment>','applySitePaint(outgoingLight);\n#include <opaque_fragment>');
    };
    variants.set(m,v);return v;
  };
  root.traverse(mesh=>{
    if(!mesh.isMesh||!mesh.name.startsWith('tile_'))return;
    const bounds=boundsInGame(mesh,root);
    if(!nearby.some(b=>b.intersectsBox(bounds)))return;
    originals.set(mesh,mesh.material);
    mesh.material=Array.isArray(mesh.material)?mesh.material.map(variant):variant(mesh.material);
  });
  return ()=>{for(const [mesh,material] of originals)mesh.material=material;for(const m of variants.values())m.dispose();};
}
