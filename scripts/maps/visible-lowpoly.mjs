/** Build a textureless, spatially batched derivative of the visible Source 2 world export.
 * Source mesh simplification happens per primitive, preserving material and object boundaries.
 * Vertex RGB is sampled in source UV space. Only the small, finished geometry reaches a browser.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {Matrix3,Matrix4,Vector3,Quaternion} from 'three';
import {MeshoptSimplifier as simplify} from 'three/addons/libs/meshopt_simplifier.module.js';
import {PRIVATE_BREAKABLES} from '../../shared/private-map-breakables-data.js';
import {disabledBrushModels,sourceBrushHidden} from './source-brush-visibility.mjs';
import {inactiveVisualPropNodes} from './inactive-source-props.mjs';
import {nukeVentPoses} from './nuke-vent-poses.mjs';

const [src, output, id, sampleFile, sideString, budgetString] = process.argv.slice(2);
const side=Number(sideString), budget=Number(budgetString);
await simplify.ready;
const doc=JSON.parse(fs.readFileSync(src));
const entitiesFile=process.argv[8]||path.resolve(path.dirname(src),'../source/entities.txt');
const entityText=process.argv[8]||fs.existsSync(entitiesFile)?fs.readFileSync(entitiesFile,'utf8'):'';
const disabledModels=disabledBrushModels(entityText,id);
const inactiveProps=inactiveVisualPropNodes(doc,entityText);
const samples=fs.readFileSync(sampleFile);
const floorMasks=process.argv[9]?JSON.parse(fs.readFileSync(process.argv[9])):{};
const streams=doc.buffers.map(b=>{
  const name=decodeURIComponent(b.uri);
  if(path.basename(name)!==name)throw Error('Unsupported source buffer path');
  return fs.openSync(path.join(path.dirname(src),name),'r');
});
const types={5120:Int8Array,5121:Uint8Array,5122:Int16Array,5123:Uint16Array,5125:Uint32Array,5126:Float32Array};
const widths={SCALAR:1,VEC2:2,VEC3:3,VEC4:4};
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const stats={source:'visible-gltf',sourceTriangles:0,visibleTriangles:0,outputTriangles:0,
  sourceInstances:0,hiddenBrushNodes:0,filteredPrimitives:0,smallPropsOmitted:0,decalTriangles:0,fenceTriangles:0,baseColorImages:new Set(),materialIds:new Set(),cells:0};
const accCache=new Map();
function accessor(i){
  if(accCache.has(i))return accCache.get(i);
  const a=doc.accessors[i],v=doc.bufferViews[a.bufferView],Type=types[a.componentType],n=widths[a.type];
  if(a.sparse||!Type||!n)throw Error('Unsupported source accessor');
  const bytes=Type.BYTES_PER_ELEMENT,step=(v.byteStride||n*bytes)/bytes;
  const len=((a.count-1)*step+n)*bytes;
  const raw=Buffer.allocUnsafeSlow(len);
  const read=fs.readSync(streams[v.buffer],raw,0,len,(v.byteOffset||0)+(a.byteOffset||0));
  if(read!==len)throw Error('Truncated source buffer');
  const packed=new Type(raw.buffer,raw.byteOffset,len/bytes);
  let values=packed;
  if(step!==n){
    values=new Type(a.count*n);
    for(let j=0;j<a.count;j++)for(let k=0;k<n;k++)values[j*n+k]=packed[j*step+k];
  }
  if(accCache.size>=48)accCache.delete(accCache.keys().next().value);
  accCache.set(i,values);return values;
}
const sourceTris=doc.meshes.reduce((n,m)=>n+m.primitives.reduce((s,p)=>s+(p.indices==null?doc.accessors[p.attributes.POSITION].count:doc.accessors[p.indices].count)/3,0),0);
stats.sourceTriangles=Math.round(sourceTris);
const ratio=Math.min(1,budget/sourceTris);
// The opaque world uses the spare COLOR_0 byte as a compact surface ID. The
// client uses world-space material coordinates shared across triangle edges.
function surfaceClass(name){
  const leaf=path.posix.basename(name.toLowerCase());
  if(/glass|lamp|emitter|sign|marking|logo|letter|leaf|leaves|foliage|fabric|tarp|decal|paper|plastic|rubber/.test(leaf))return 255;
  if(/metal|steel|iron|duct|pipe|alumin|corrugat|rollup|silo|shipping_container|web_joist|rusted_fence|railcar|tracks_rails|rebar|hvac|roof_gutter|rolling_gate|floor_hatch|industrial_(?:folding|sliding)/.test(leaf))return 2;
  if(/wood|timber|pallet|plywood|plank|lumber/.test(leaf))return 3;
  if(/brick|masonry_block/.test(leaf))return 6;
  if(/plaster|stucco|painted_wall|wallpaint|drywall|site[ab]wall/.test(leaf))return 4;
  if(/sand|ground|gravel|asphalt|road|dirt|earth|ballast|terrain/.test(leaf))return 5;
  if(/concrete|stone|rock|cement|pavement|tile|marble|curbs?[0-9]/.test(leaf))return 1;
  return 255;
}
// These Valve overlay shaders are exported as opaque glTF materials even when
// their entire mesh is a transparent decal card. Only retain informative paint.
const marking=/bombsite|bomb_site|sign|banner|graffiti|marking|letter|poster|logo|floor_arrow|roadstrip|parkingstripe/;
function isOverlay(material) {
  const valve=material.extras?.vmat;
  return material.alphaMode==='BLEND' || valve?.ShaderName==='csgo_static_overlay.vfx' ||
    !!valve?.IntParams?.F_OVERLAY || !!valve?.IntParams?.F_TRANSLUCENT;
}
function fenceType(material) {
  const name=path.posix.basename((material?.extras?.vmat?.Name||material?.name||'').toLowerCase(),'.vmat');
  if(name==='fence001')return 'mirage-atlas';
  if(name==='metalfence004a'||/chainlink_fence_(?:wire|001_card)/.test(name))return 'sheet';
  return null;
}
function visible(material, nodeName){
  const vm=material.extras?.vmat||{},name=String(vm.Name||material.name||'').toLowerCase(),flags=vm.IntParams||{};
  if(/(?:^|\/)tools\/|toolssolid|toolsblock|lightblock|nodraw|visocclud|areaportal|playerclip|skybox|water_caustic/.test(name) ||
    /shadowonly|blocklight|cubemap|_shadow\.mesh|reflectionprobe/.test(nodeName) || flags.F_DEPTH_FEATHER) return false;
  if(vm.ShaderName==='csgo_effects.vfx'||/particle|lightshaft|lightcone|fogvolume|lightbeam|lightglow|lensflare/.test(name))return false;
  if(isOverlay(material)&&(!marking.test(name)||!material.pbrMetallicRoughness?.baseColorTexture))return false;
  const grassCard=/(?:^|[_/.])(?:grass(?:es)?|weeds?)(?:[_/.0-9]|$)/.test(name);
  const namedGrassProp=!vm.ShaderName&&/(?:^|_)(?:grass|weeds?)(?:_[0-9]|_cards?|_clump|_blades?)/.test(path.posix.basename(name));
  if(grassCard && (material.alphaMode==='MASK'||vm.ShaderName==='csgo_foliage.vfx'||namedGrassProp))return false;
  // Without material masks, overlay sheets, particles and glass would become opaque rectangles.
  const missingPaint=!material.pbrMetallicRoughness?.baseColorTexture&&!material.pbrMetallicRoughness?.baseColorFactor&&!vm.ShaderName;
  if(missingPaint){
    if(/mesh_overlay|retake_[ab]site|waterfall|lightcone|lightglow|toolsclip/.test(nodeName))return false;
    if(/decal|overlay|graffiti|translucent|grime|lightbeam|lightshaft|lensflare|vfx|signage_alpha|card_leaf|ivy_leaf|chainlink_fence_wire/.test(name))return false;
    if(/glass/.test(name||nodeName)&&!/frame|trim|opaque|fiberglass/.test(name||nodeName))return false;
  }
  return true;
}
const materialTables=(doc.materials||[]).map((m,i)=>{
  const pbr=m.pbrMetallicRoughness||{},tex=pbr.baseColorTexture,img=tex?doc.textures[tex.index]?.source:null;
  const offset=Number.isInteger(img)?img*side*side*4:-1;
  const avg=[0,0,0]; let count=0;
  if(offset>=0)for(let j=0;j<side*side;j++){const at=offset+j*4;if(samples[at+3]<128)continue;for(let c=0;c<3;c++)avg[c]+=samples[at+c];count++;}
  for(let c=0;c<3;c++)avg[c]=count?avg[c]/count:169;
  const name=String(m.extras?.vmat?.Name||m.name||'').toLowerCase();
  const decal=isOverlay(m)&&marking.test(name);
  const aperture=m.alphaMode==='MASK' && /grate|grating|rail(?:ing)?|window.*bars|door.*bars|metal.*gate|gate.*metal|lattice/.test(name);
  return {i,original:m,img,offset,avg,fence:fenceType(m),missingPaint:offset===-1&&!pbr.baseColorFactor&&!m.extras?.vmat?.ShaderName,
    floorMask:floorMasks[i],surface:surfaceClass(name),tint:pbr.baseColorFactor||[1,1,1,1],cut:m.alphaMode==='MASK'||isOverlay(m),aperture,decal,threshold:(m.alphaCutoff??(decal?.28:.46))*255};
});
const componentColors=[
  [/hazard|warning|crane|forklift|yellow/, [205,158,62]],
  [/orange|trafficcone/, [190,112,61]],
  [/brick|rust|terracotta|red(?:[._0-9]|$)/, [155,88,66]],
  [/green/, [100,122,90]], [/blue/, [86,128,163]],
  [/wood|plywood|pallet|timber|crate|plank/, [159,126,86]],
  [/tarp|container|barrel|drum|wagon|freight|boxcar/, [101,130,132]],
  [/plant|foliage|leaf|tree|hedge/, [97,116,78]],
  [/trashbag|rubber|asphalt|gravel|ballast|roof/, [93,97,102]],
  [/pipe|rail|metal|beam|steel|wire|ladder|stair|window|door|vent/, [118,133,143]],
  [/plaster|concrete|cement|floor|pillar/, [171,167,157]]
];
function fallbackMaterial(name,sourceName='') {
  const leaf=path.posix.basename(sourceName.toLowerCase());
  const swatch=componentColors.find(([match])=>match.test(leaf))?.[1]||
    componentColors.find(([match])=>match.test(name))?.[1]||[165,161,152];
  return {i:'component',original:{},offset:-1,avg:swatch,tint:[1,1,1,1],cut:false,surface:surfaceClass(leaf||name)};
}
function lookup(mat,u,v){
  if(mat.offset<0)return -1;
  const x=Math.min(side-1,Math.floor((u-Math.floor(u))*side)),y=Math.min(side-1,Math.floor((v-Math.floor(v))*side));
  return mat.offset+4*(y*side+x);
}
// A transparent atlas on a railing usually also contains its solid frame.
// Only subdivide UV regions that actually cross the authored opacity contour.
function apertureCoverage(mat,uv,a,b,c){
  const stride=2*side+1;
  if(!mat.integral){
    const sums=new Uint32Array(stride*stride);
    for(let y=0;y<2*side;y++)for(let x=0;x<2*side;x++){
      const i=(y+1)*stride+x+1;
      const alpha=samples[mat.offset+4*((y%side)*side+x%side)+3];
      sums[i]=(alpha>=mat.threshold?1:0)+sums[i-1]+sums[i-stride]-sums[i-stride-1];
    }
    mat.integral=sums;
  }
  const bounds=k=>{
    const values=[uv[a*2+k],uv[b*2+k],uv[c*2+k]];
    const low=Math.floor(Math.min(...values)*side-.5),high=Math.floor(Math.max(...values)*side-.5)+1;
    const start=(low%side+side)%side;
    return [start,start+Math.min(side,high-low+1)];
  };
  const [x0,x1]=bounds(0),[y0,y1]=bounds(1),s=mat.integral;
  const opaque=s[y1*stride+x1]-s[y0*stride+x1]-s[y1*stride+x0]+s[y0*stride+x0];
  return opaque===0?'empty':opaque===(x1-x0)*(y1-y0)?'solid':'cut';
}
const linear=Uint8Array.from({length:256},(_,i)=>Math.round(255*(i<=10?i/(255*12.92):((i/255+.055)/1.055)**2.4)));
const clusters=new Map();
function cluster(key){
  if(!clusters.has(key))clusters.set(key,{xyz:[],rgb:[],indices:[]});
  return clusters.get(key);
}
const breakableFor=new Map(),hiddenNodes=new Set();
const vent=id==='de_nuke'?nukeVentPoses(doc,src):null;
if(id===PRIVATE_BREAKABLES.mapId){
  if(hash(fs.readFileSync(src))!==PRIVATE_BREAKABLES.renderSha256)throw Error('Source Mirage model does not match registered breakable nodes');
  for(const d of PRIVATE_BREAKABLES.objects){for(const k of d.nodeIndices)breakableFor.set(k,d.id);for(const k of d.restoredNodeIndices||[])hiddenNodes.add(k);}
  PRIVATE_BREAKABLES.initialHiddenNodeIndices.forEach(k=>hiddenNodes.add(k));
}
const sun=[-.37,.83,.4]; // world in simulation coordinates, renderer rotates +90 around Y
function clipUV(polygon,axis,bound,sign){
  const result=[];
  for(let i=0;i<polygon.length;i++){
    const a=polygon[i],b=polygon[(i+1)%polygon.length];
    const da=(a[axis]-bound)*sign,db=(b[axis]-bound)*sign;
    if(da>=0)result.push(a);
    if((da>0&&db<0)||(da<0&&db>0)){
      const t=da/(da-db);
      result.push(a.map((v,k)=>v+t*(b[k]-v)));
    }
  }
  return result;
}
function bakeFloorPaint(corners,mat,cell,lit){
  const dest=cluster(cell),first=dest.xyz.length/3;
  const u=corners.map(p=>p[3]),v=corners.map(p=>p[4]);
  const u0=Math.min(...u),u1=Math.max(...u),v0=Math.min(...v),v1=Math.max(...v);
  if(Math.abs((u[1]-u[0])*(v[2]-v[0])-(v[1]-v[0])*(u[2]-u[0]))<1e-9)return;
  for(let by=Math.floor(v0);by<Math.ceil(v1);by++)for(let bx=Math.floor(u0);bx<Math.ceil(u1);bx++){
    for(const [s,t,e,f,r,g,b] of mat.floorMask){
      if(s+bx>=u1||e+bx<=u0||t+by>=v1||f+by<=v0)continue;
      let poly=clipUV(corners,3,s+bx,1);
      poly=clipUV(poly,3,e+bx,-1);
      poly=clipUV(poly,4,t+by,1);
      poly=clipUV(poly,4,f+by,-1);
      if(poly.length<3)continue;
      const start=dest.xyz.length/3;
      const rgb=[r,g,b].map((v,k)=>linear[Math.min(255,Math.round((12+v*.95)*Math.sqrt(mat.tint[k])*lit/11.4))]);
      for(const point of poly){
        dest.xyz.push(point[0],point[1]+.005,point[2]);
        dest.rgb.push(...rgb,255);
      }
      for(let i=2;i<poly.length;i++){
        dest.indices.push(start,start+i-1,start+i);
        stats.outputTriangles++;stats.decalTriangles++;
      }
    }
  }
  const end=dest.xyz.length/3;
  if(end>first){
    dest.paintRanges??=[];
    if(dest.paintRanges.at(-1)===first)dest.paintRanges[dest.paintRanges.length-1]=end;
    else dest.paintRanges.push(first,end);
  }
}
function bakeDecal(corners,mat,cell,lit,normal){
  if(mat.floorMask){bakeFloorPaint(corners,mat,cell,lit);return;}
  const [a,b,c]=corners;
  const span=Math.max(...[3,4].map(k=>Math.max(a[k],b[k],c[k])-Math.min(a[k],b[k],c[k])));
  const meters=Math.max(Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]),Math.hypot(a[0]-c[0],a[1]-c[1],a[2]-c[2]));
  const site=mat.original.alphaMode==='BLEND'&&/bombsite|site_letter|bomb_site/.test(mat.original.name||'');
  const ab=[b[0]-a[0],b[1]-a[1],b[2]-a[2]],ac=[c[0]-a[0],c[1]-a[1],c[2]-a[2]];
  const area=Math.hypot(ab[1]*ac[2]-ab[2]*ac[1],ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0]);
  // Source grilles and trim often contain very long, very narrow triangles.
  // Area limits subdivisions across their narrow dimension.
  const n=Math.max(1,Math.min(site?32:12,Math.ceil((site?meters:Math.sqrt(area))/(site?.035:.14)),Math.ceil(span*side)));
  const dest=cluster(cell),cached=new Map();
  function alphaAt(u,v){
    const x=u*side-.5,y=v*side-.5,x0=Math.floor(x),y0=Math.floor(y);
    const sx=x-x0,sy=y-y0;
    const pixel=(i,j)=>samples[mat.offset+4*((j%side+side)%side*side+(i%side+side)%side)+3];
    return (1-sy)*((1-sx)*pixel(x0,y0)+sx*pixel(x0+1,y0))+sy*((1-sx)*pixel(x0,y0+1)+sx*pixel(x0+1,y0+1));
  }
  function point(i,j){
    const key=i*(n+1)+j;
    if(cached.has(key))return cached.get(key);
    const w1=i/n,w2=j/n,w0=1-w1-w2;
    const p=a.map((v,k)=>w0*v+w1*b[k]+w2*c[k]);
    p[6]=alphaAt(p[3],p[4]);
    cached.set(key,p);return p;
  }
  function emitTriangle(p,q,r){
    for(const v of [p,q,r]){
      if(v[5]==null){
        v[5]=dest.xyz.length/3;
        for(let k=0;k<3;k++){
          dest.xyz.push(v[k]+normal[k]*(mat.decal?.003:0));
          const sample=lookup(mat,v[3],v[4]);
          // Edge texels can be fully transparent and contain arbitrary matte RGB.
          const rgb=samples[sample+3]>=mat.threshold?samples[sample+k]:mat.avg[k];
          dest.rgb.push(linear[Math.min(255,Math.round((12+rgb*.95)*Math.sqrt(mat.tint[k])*lit/11.4))]);
        }
        dest.rgb.push(255);
      }
      dest.indices.push(v[5]);
    }
    stats.outputTriangles++;
    if(mat.decal)stats.decalTriangles++;
    else stats.apertureTriangles=(stats.apertureTriangles||0)+1;
  }
  function triangle(p,q,r){
    // Clip the sampled sign against its continuous opacity contour. Retaining subcell
    // intersections keeps narrow diagonal lines in A/B lettering smooth at close range.
    const source=[p,q,r],polygon=[];
    for(let i=0;i<3;i++){
      const from=source[i],to=source[(i+1)%3];
      const a=from[6]>=mat.threshold,b=to[6]>=mat.threshold;
      if(a)polygon.push(from);
      if(a!==b){
        const t=(mat.threshold-from[6])/(to[6]-from[6]);
        polygon.push(from.slice(0,5).map((v,k)=>v+t*(to[k]-v)));
      }
    }
    for(let i=2;i<polygon.length;i++)emitTriangle(polygon[0],polygon[i-1],polygon[i]);
  }
  for(let i=0;i<n;i++)for(let j=0;j<n-i;j++){
    triangle(point(i,j),point(i+1,j),point(i,j+1));
    if(i+j<n-1)triangle(point(i+1,j),point(i+1,j+1),point(i,j+1));
  }
}
function writePrimitive(primitive,mat,transform,special,name,positions,trainFloorDebris=false){
  if(primitive.mode!==undefined&&primitive.mode!==4)return;
  const raw=positions??accessor(primitive.attributes.POSITION);
  if(!(raw instanceof Float32Array))throw Error('POSITION must be Float32');
  const indices=primitive.indices==null?Uint32Array.from({length:raw.length/3},(_,i)=>i):accessor(primitive.indices);
  const originalTris=indices.length/3;
  stats.visibleTriangles+=originalTris;
  const a=doc.accessors[primitive.attributes.POSITION];
  const min=a.min,max=a.max;
  const wx=transform.elements;
  const scale=Math.max(Math.hypot(wx[0],wx[1],wx[2]),Math.hypot(wx[4],wx[5],wx[6]),Math.hypot(wx[8],wx[9],wx[10]));
  const extent=min&&max?scale*Math.max(...max.map((v,k)=>v-min[k])):20;
  if(!special&&extent<.13){stats.smallPropsOmitted++;return;}
  const surface=String(mat.original.name||'').toLowerCase()+' '+name;
  const fitted=/crate|container|shutter|rollup|door|metal.*box|(?:^|[_ ])beam|rail(?:ing)?|window_?frame|vent_?slat/.test(surface);
  let selected=indices;
  if(!special && !mat.decal && !mat.aperture && !mat.fence && originalTris>30) {
    const target=Math.min(indices.length,3*Math.max(extent>2?12:6,Math.round(originalTris*ratio*.90)));
    // Source primitives share boundaries with other materials. Pin the borders of large
    // wall/floor panels and cap metric error in model space, accounting for node transforms.
    const detail=/leaf|foliage|leaves|bush|trunk|tropical|spindle|fern|ivy|rubble|debris|trash|gutters?|pipes?|cables?|wires?|joist|spindle|bollard|spigot|metal_?gates?|chainlink|duct|spool|rope|louvers?|door_details|drain|lamp_/.test(surface);
    const flags=['ErrorAbsolute','Permissive'];
    const thickness=min&&max?scale*Math.min(...max.map((v,k)=>v-min[k])):Infinity;
    if(extent>5&&((id==='de_mirage'&&!detail)||(!detail&&thickness<.22)))flags.push('LockBorder');
    // A several-centimetre edge collapse merges opposed faces of folded sheet
    // metal and pulls the surviving corner into a visible spike.
    const tolerance=fitted?.012:detail?.075:extent>5?.072:.045;
    const [fine]=simplify.simplify(indices,raw,3,target,tolerance/Math.max(scale,1e-5),flags);
    selected=fine;
    // Dense groups of separate leaves, railings and hardware often cannot collapse by edge operations.
    // Keep the fine result unless an alternate preserves nonempty geometry at a bounded relative error.
    if(detail && !fitted && fine.length>Math.max(90,target*2.6)){
      const [alt]=simplify.simplifySloppy(indices,raw,3,null,target,Math.min(.022,.065/extent));
      if(alt.length>=12&&alt.length<fine.length)selected=alt;
    }
  }
  if(!selected.length)return;
  stats.materialIds.add(mat.i);if(mat.offset>=0)stats.baseColorImages.add(mat.img);
  const uvIndex=primitive.attributes.TEXCOORD_0,uv=uvIndex==null?null:accessor(uvIndex);
  const colorIndex=primitive.attributes.COLOR_0,sourceColor=mat.i==='component'&&colorIndex!=null?accessor(colorIndex):null;
  const channels=sourceColor?widths[doc.accessors[colorIndex].type]:0;
  const colorUnit=sourceColor instanceof Uint8Array?255:sourceColor instanceof Uint16Array?65535:1;
  const normalId=primitive.attributes.NORMAL;
  const sourceNormal=normalId==null||positions?null:accessor(normalId);
  const normalTransform=sourceNormal?new Matrix3().getNormalMatrix(transform).elements:null;
  const pos=new Float32Array(raw.length),color=new Uint8Array(raw.length),sampled=new Uint8Array(raw.length/3);
  const smoothLight=sourceNormal?new Float32Array(sampled.length):null;
  const textured=uv&&mat.offset>=0;
  function vertex(i){
    if(sampled[i])return;
    sampled[i]=1;const j=i*3,x=raw[j],y=raw[j+1],z=raw[j+2];
    pos[j]=wx[0]*x+wx[4]*y+wx[8]*z+wx[12];
    pos[j+1]=wx[1]*x+wx[5]*y+wx[9]*z+wx[13];
    pos[j+2]=wx[2]*x+wx[6]*y+wx[10]*z+wx[14];
    if(sourceNormal){
      const m=normalTransform,a=sourceNormal[j],b=sourceNormal[j+1],c=sourceNormal[j+2];
      const nx=m[0]*a+m[3]*b+m[6]*c,ny=m[1]*a+m[4]*b+m[7]*c,nz=m[2]*a+m[5]*b+m[8]*c;
      const length=Math.hypot(nx,ny,nz);
      if(length) smoothLight[i]=10.4+(2.2*(nz*sun[0]+ny*sun[1]-nx*sun[2])+.65*Math.max(0,ny))/length;
    }
    const at=textured?lookup(mat,uv[i*2],uv[i*2+1]):-1;
    for(let c=0;c<3;c++){
      const ao=sourceColor?.[i*channels+c];
      const componentTint=ao===undefined?1:.65+.35*Math.sqrt(Math.max(0,Math.min(1,ao/colorUnit)));
      // Large opaque panels share a paint colour; a few arbitrary UV corner
      // samples should not paint contrasting triangles onto a continuous face.
      const detailMix=mat.cut?.55:.23;
      const base=at>=0?detailMix*samples[at+c]+(1-detailMix)*mat.avg[c]:mat.avg[c]*componentTint;
      color[j+c]=Math.max(0,Math.min(255,Math.round((25+base*.98)*Math.sqrt(mat.tint[c]))));
    }
  }
  // Weld only the same source corner with a similar facet illumination in the same spatial tile.
  const caches=new Map();
  for(let n=0;n<selected.length;n+=3){
    const ia=selected[n],ib=selected[n+1],ic=selected[n+2];
    let fence=mat.fence==='sheet';
    if(mat.fence==='mirage-atlas'&&uv){
      // The lower middle of Valve's fence001 atlas is chain link. The other islands are
      // solid posts, hinges and hardware; keep those opaque even though they share a material.
      const u=(uv[ia*2]+uv[ib*2]+uv[ic*2])/3, v=(uv[ia*2+1]+uv[ib*2+1]+uv[ic*2+1])/3;
      const s=u-Math.floor(u),t=v-Math.floor(v);
      fence=s>=.12&&s<=.76&&t>=.50;
    }
    if(!fence&&mat.cut&&!mat.decal&&!mat.aperture&&textured){
      const u=(uv[ia*2]+uv[ib*2]+uv[ic*2])/3,v=(uv[ia*2+1]+uv[ib*2+1]+uv[ic*2+1])/3;
      if(samples[lookup(mat,u,v)+3]<mat.threshold)continue;
    }
    vertex(ia);vertex(ib);vertex(ic);
    const j=ia*3,k=ib*3,l=ic*3;
    if(trainFloorDebris){
      // The B hall's broken-concrete scatter sits over the original concrete and
      // rail bed. Drop only that cosmetic layer; preserve the recess and rail mesh.
      // Game X/Z correspond to render Z/-X after the scene's quarter turn.
      const x=(pos[j+2]+pos[k+2]+pos[l+2])/3;
      const z=-(pos[j]+pos[k]+pos[l])/3;
      const y=(pos[j+1]+pos[k+1]+pos[l+1])/3;
      if(x>=-12&&x<=10&&z>=26&&z<=39&&y>=-9.15&&y<=-8.78){
        stats.trainFloorDebrisRemoved=(stats.trainFloorDebrisRemoved||0)+1;
        continue;
      }
    }
    const ux=pos[k]-pos[j],uy=pos[k+1]-pos[j+1],uz=pos[k+2]-pos[j+2];
    const vx=pos[l]-pos[j],vy=pos[l+1]-pos[j+1],vz=pos[l+2]-pos[j+2];
    const nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx;
    const area=Math.hypot(nx,ny,nz);if(area<1e-7)continue;
    const lighting=(nz*sun[0]+ny*sun[1]-nx*sun[2])/area;
    const lit=Math.min(13,Math.max(5,Math.round(10.4+2.2*lighting+Math.max(0,ny/area)*.65)));
    const tx=Math.floor((pos[j]+pos[k]+pos[l])/72),tz=Math.floor((pos[j+2]+pos[k+2]+pos[l+2])/72);
    const cell=special||((fence?'fence_tile_':'tile_')+tx+'_'+tz);
    if(fence)stats.fenceTriangles++;
    const aperture=!fence&&mat.aperture&&textured?apertureCoverage(mat,uv,ia,ib,ic):null;
    if(aperture==='empty')continue;
    if(!fence&&(mat.decal||aperture==='cut')&&textured){
      const corners=[ia,ib,ic].map(i=>[pos[i*3],pos[i*3+1],pos[i*3+2],uv[i*2],uv[i*2+1]]);
      bakeDecal(corners,mat,cell,lit,[nx/area,ny/area,nz/area]);continue;
    }
    let dest=caches.get(cell);
    if(!dest){
      const c=cluster(cell);
      dest={c,map:new Map(),firstVertex:c.xyz.length/3};
      caches.set(cell,dest);
    }
    for(let t=0;t<3;t++){
      const idx=selected[n+t],shade=smoothLight?.[idx]||lit;
      const key=idx*16+(smoothLight?.[idx]?0:lit);let out=dest.map.get(key);
      if(out===undefined){
        out=dest.c.xyz.length/3;dest.map.set(key,out);
        for(let c=0;c<3;c++){
          dest.c.xyz.push(pos[idx*3+c]);
          // Transparent wire texels have arbitrary backing RGB. A steel swatch is
          // stable for both material-rich and untextured official exports.
          const value=fence?[144,147,145][c]:color[idx*3+c];
          dest.c.rgb.push(linear[Math.min(255,Math.round(value*shade/11.4))]);
        }
        dest.c.rgb.push(fence||mat.cut?255:mat.surface);
      }
      dest.c.indices.push(out);
    }
    stats.outputTriangles++;
  }
  // These hard-surface parts have already met the tighter local metric error.
  // Carry their vertex runs only as far as the offline sector reducer.
  if(fitted&&!special&&!mat.fence)for(const {c,firstVertex} of caches.values()){
    const end=c.xyz.length/3;
    c.fittedRanges??=[];
    if(c.fittedRanges.at(-1)===firstVertex)c.fittedRanges[c.fittedRanges.length-1]=end;
    else c.fittedRanges.push(firstVertex,end);
  }
}
const identity=new Matrix4();
const profile=process.env.PERF_MAP_PROFILE?new Map():null;
function walk(i,parent){
 const node=doc.nodes[i];if(hiddenNodes.has(i))return;
 if(sourceBrushHidden(node.name,disabledModels)){stats.hiddenBrushNodes++;return;}
 const local=node.matrix?new Matrix4().fromArray(node.matrix):new Matrix4().compose(
   new Vector3(...(node.translation||[0,0,0])),new Quaternion(...(node.rotation||[0,0,0,1])),new Vector3(...(node.scale||[1,1,1])));
 const transform=parent.clone().multiply(local);
 if(inactiveProps.has(i))stats.inactivePropNodes=(stats.inactivePropNodes||0)+1;
 else if(node.mesh!=null){stats.sourceInstances++;
   for(const p of doc.meshes[node.mesh].primitives){
     const source=materialTables[p.material],name=String(node.name||'').toLowerCase();
     if(!source?.fence&&!visible(source?.original||{},name)){stats.filteredPrimitives++;continue;}
     const mat=source&&(!source.missingPaint||source.fence)?source:fallbackMaterial(name,source?.original.name);
     const count=stats.outputTriangles;
     if(i===vent?.nodeIndex){
       for(const pose of vent.vertices(p,accessor))writePrimitive(p,mat,transform,pose.name,name,pose.positions);
     }else{
       const trainFloorDebris=id==='de_train'&&/\/train_floor_concrete_04_debris(?:_blend)?\.vmat$/.test(source?.original?.name||'');
       writePrimitive(p,mat,transform,breakableFor.get(i),name,undefined,trainFloorDebris);
     }
     if(profile){
       const label=source?.original?.name||name;
       profile.set(label,(profile.get(label)||0)+stats.outputTriangles-count);
     }
   }
 }
 for(const c of node.children||[])walk(c,transform);
}
try{for(const i of doc.scenes[doc.scene||0].nodes)walk(i,identity);}finally{streams.forEach(fd=>fs.closeSync(fd));}
const chunks=[],bufferViews=[],accessors=[],nodes=[],meshes=[];
let offset=0;
function emit(array,componentType,type,height,target,minmax){
 const b=Buffer.from(array.buffer,array.byteOffset,array.byteLength);
 const index=bufferViews.push({buffer:0,byteOffset:offset,byteLength:b.length,target})-1;
 chunks.push(b);offset+=b.length;const pad=(-offset)&3;if(pad){chunks.push(Buffer.alloc(pad));offset+=pad;}
 const a={bufferView:index,componentType,type,count:array.length/height,...minmax};
 if(componentType===5121)a.normalized=true;
 return accessors.push(a)-1;
}
const mapping={};
for(const [name,c] of clusters){
 const xyz=Float32Array.from(c.xyz),min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
 for(let i=0;i<xyz.length;i++){const k=i%3;min[k]=Math.min(min[k],xyz[i]);max[k]=Math.max(max[k],xyz[i]);}
 const p=emit(xyz,5126,'VEC3',3,34962,{min,max}),color=emit(Uint8Array.from(c.rgb),5121,'VEC4',4,34962);
 const small=c.xyz.length/3<65536;const ix=emit(small?Uint16Array.from(c.indices):Uint32Array.from(c.indices),small?5123:5125,'SCALAR',1,34963);
 const fence=name.startsWith('fence_tile_');
 nodes.push({name,mesh:meshes.length});
 const mesh={primitives:[{attributes:{POSITION:p,COLOR_0:color},indices:ix,material:fence?1:0}]};
 if(c.fittedRanges)mesh.extras={fittedRanges:c.fittedRanges};
 if(c.paintRanges)mesh.extras={...mesh.extras,paintRanges:c.paintRanges};
 meshes.push(mesh);
 if(!fence&&!name.startsWith('tile_'))mapping[name]=nodes.length-1;
}
if(id===PRIVATE_BREAKABLES.mapId)for(const d of PRIVATE_BREAKABLES.objects)if(mapping[d.id]===undefined)throw Error('Missing visible breakable '+d.id);
if(vent && (!Object.hasOwn(mapping,'nuke-vent-slats')||!Object.hasOwn(mapping,'nuke-vent-slats-open')))throw Error('Missing Nuke vent endpoint meshes');
if(!meshes.length||stats.outputTriangles===0)throw Error('No visible mesh output');
stats.baseColorImages=stats.baseColorImages.size;stats.materialIds=stats.materialIds.size;stats.cells=nodes.length;
if(profile)console.log(JSON.stringify([...profile].sort((a,b)=>b[1]-a[1]).slice(0,30)));
const primitive={asset:{version:'2.0',generator:'DUSKRAIN visible-world low-poly redraw'},scene:0,scenes:[{nodes:nodes.map((_,i)=>i)}],
 nodes,meshes,materials:[{name:'baked-visible-world',doubleSided:true,extensions:{KHR_materials_unlit:{}},pbrMetallicRoughness:{baseColorFactor:[1,1,1,1],metallicFactor:0,roughnessFactor:1}}],
 extensionsUsed:['KHR_materials_unlit'],buffers:[{uri:'map.bin',byteLength:offset}],bufferViews,accessors,extras:{visibleLowPolyVersion:2,surfaceMaterialVersion:1,outlineSegments:0,...stats}};
primitive.materials[0].extras={surfaceMaterialVersion:1};
if(stats.fenceTriangles)primitive.materials.push({...primitive.materials[0],name:'baked-wire-fence',extras:{performanceFence:true}});
const rd=path.join(output,'render');fs.mkdirSync(rd,{recursive:true});
const json=JSON.stringify(primitive);
fs.writeFileSync(path.join(rd,'map.gltf'),json);fs.writeFileSync(path.join(rd,'map.bin'),Buffer.concat(chunks));
if(Object.keys(mapping).length)fs.writeFileSync(path.join(output,'flat-breakables.json'),JSON.stringify({renderSha256:hash(json),nodesById:mapping}));
console.log(JSON.stringify({map:id,...stats,renderBytes:offset+Buffer.byteLength(json)}));
