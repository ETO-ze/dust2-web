import {BufferGeometry, Color, Float32BufferAttribute, Mesh, MeshBasicMaterial, SRGBColorSpace, TextureLoader} from 'three';
import {paintSiteWalls} from './wall-site-signs.js';
import publicPaint from './flat-site-release-paint.json' with {type:'json'};
import sites from './flat-site-markings-data.json' with {type:'json'};

const artwork = new URL('./flat-site-stencils.png', import.meta.url).href;

function bytes(encoded) {
  const raw = atob(encoded);
  return Uint8Array.from(raw, char => char.charCodeAt(0));
}

// Each triangle is either clipped to an actual opaque support face or taken
// from a specific placed sign in the signed source archive. World→glTF matches
// the +90° Y rotation of the map root. The texture has floor and wall variants.
export function flatSiteGeometry(map) {
  const data = sites[map.id];
  if (!data || data.source !== map.sourceSha256) return null;
  const xyz=[],uv=[],indices=[];
  for (const site of ['A','B']) {
    const entry=data[site], table=bytes(entry.vertices), refs=bytes(entry.indices);
    const values=new DataView(table.buffer), faces=new DataView(refs.buffer);
    const [cx,cy,cz]=entry.anchor, base=xyz.length/3;
    for(let i=0; i<table.length; i+=8) {
      const x=cx+values.getInt16(i,true)/5000;
      const y=cy+values.getInt16(i+2,true)/5000;
      const z=cz+values.getInt16(i+4,true)/5000;
      xyz.push(-z,y,x);
      // Sample half a texel inside each cell so its neighbour cannot bleed in.
      const u=(.5+511*table[i+6]/255)/512;
      const v=(.5+511*table[i+7]/255)/512;
      uv.push(((site==='B'?1:0)+u)/2, ((entry.wall?0:1)+v)/2);
    }
    for(let i=0; i<refs.length; i+=2)indices.push(base+faces.getUint16(i,true));
  }
  const geometry=new BufferGeometry();
  geometry.setAttribute('position',new Float32BufferAttribute(xyz,3));
  geometry.setAttribute('uv',new Float32BufferAttribute(uv,2));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

// Only the exact sealed source indices may be replaced. This strips obsolete
// red paint on top of the floor; supports, source collision, boundary paint
// and every other sector remain independently indexed.
export function replaceOriginalFloorPaint(root,map,renderHash,geometryHash) {
  const entry = sites[map.id];
  const published=publicPaint[map.id];
  const patch=[entry?.replace,published?.source===map.sourceSha256 ? published : null].find(p=>p && p.render===renderHash && p.geometry===geometryHash);
  if (entry?.source !== map.sourceSha256 || !patch || patch.render !== renderHash || patch.geometry !== geometryHash) return 0;
  let count=0;
  for(const [name,ranges] of Object.entries(patch.ranges)){
    const mesh=root.getObjectByName(name);
    const geometry=mesh?.geometry, index=geometry?.getIndex();
    if(!index || ranges.at(-2)+ranges.at(-1)>index.count/3)continue;
    const kept=[];
    let offset=0;
    for(let i=0;i<ranges.length;i+=2){
      const first=ranges[i]*3, end=first+ranges[i+1]*3;
      while(offset<first)kept.push(index.getX(offset++));
      offset=end;
      count+=ranges[i+1];
    }
    while(offset<index.count)kept.push(index.getX(offset++));
    geometry.setIndex(kept);
  }
  return count;
}

export async function createFlatSiteMarkings(map,manager) {
  const geometry = flatSiteGeometry(map);
  if (!geometry) return null;
  try {
    const texture = await new TextureLoader(manager).loadAsync(artwork);
    texture.colorSpace=SRGBColorSpace;
    texture.anisotropy=8;
    const material=new MeshBasicMaterial({
      map:texture, color:new Color(0xffffff), alphaTest:.025, transparent:true,
      depthTest:true, depthWrite:false, polygonOffset:true, polygonOffsetFactor:-2,
      polygonOffsetUnits:-3, toneMapped:false,
    });
    const mesh=new Mesh(geometry,material);
    mesh.name='World bombsite stencils';
    mesh.raycast=()=>{};
    let release;
    mesh.addEventListener('added',()=>{release=paintSiteWalls(mesh.parent,map,texture);});
    mesh.addEventListener('removed',()=>{release?.();release=null;});
    return mesh;
  } catch(error) {
    geometry.dispose();
    console.warn('Map site stencil texture unavailable', error);
    return null;
  }
}
