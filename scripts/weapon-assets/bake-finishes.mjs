import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {Matrix4,Vector3,Quaternion} from '../../node_modules/three/build/three.module.js';
import {pristinePaintCoverage} from './pristine-coverage.mjs';
import {resizePackedRgba} from './packed-texture.mjs';
const require=createRequire('C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json');
const sharp=require('sharp');
const extraction=path.resolve('artifacts/weapon-expansion');
const source=path.join(extraction,'source');
const out=path.resolve('public/assets/weapons/cs2-loadout');
const paintdir=path.join(source,'materials/models/weapons/customization/paints/vmats');
const legacy='materials/models/weapons/customization/';
const allSpecs=JSON.parse(fs.readFileSync(new URL('./default-skins.json',import.meta.url),'utf8'));
const filter=process.argv.find(a=>a.startsWith('--ids='))?.slice(6).split(',');
const specs=allSpecs.filter(s=>!filter||filter.includes(s.id));
fs.mkdirSync(out,{recursive:true});
function params(file){return Object.fromEntries([...fs.readFileSync(file,'utf8').matchAll(/"([^"\n]+)"\s+"([^"\n]*)"/g)].map(x=>[x[1],x[2]]));}
const local=(dir,p)=>path.join(dir,path.basename(p));
const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
const lerp=(a,b,t)=>a+(b-a)*t;
const srgbToLinear=v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4;
const linearToSrgb=v=>v<=.0031308?v*12.92:1.055*v**(1/2.4)-.055;
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const rel=file=>path.relative(path.resolve('.'),file).replaceAll('\\','/');
const vec=s=>(s||'').replace(/[\[\]]/g,'').trim().split(/\s+/).map(Number);
async function rgba(file,n){return resizePackedRgba(sharp,file,n);}
async function bake(spec){
  const paintFile=path.join(paintdir,spec.paint+'.vmat'),p=params(paintFile);
  const inputFile=path.join(source,spec.input),q=params(inputFile),indir=path.dirname(inputFile);
  const n=2048;
  const used=[paintFile,inputFile];
  const patternFile=local(paintdir,p.TexturePattern);used.push(patternFile);
  const pMeta=await sharp(patternFile).metadata(),pn=pMeta.width;
  const pattern=await rgba(patternFile,pn);
  const inputs={};
  for(const key of ['TextureColor1','TextureMasks1','TextureAmbientOcclusion1','TextureNoPaint1','TextureRoughness1','TextureMetalness1']){
    if(!q[key])continue; if(q[key].startsWith('[')){const pixel=Buffer.from(vec(q[key]).map(v=>Math.round(clamp(v)*255)));inputs[key]=Buffer.alloc(n*n*4);for(let offset=0;offset<inputs[key].length;offset+=4)pixel.copy(inputs[key],offset);continue;} const file=local(indir,q[key]);used.push(file);inputs[key]=await rgba(file,n);
  }
  const base=inputs.TextureColor1,mask=inputs.TextureMasks1,ao=inputs.TextureAmbientOcclusion1,metal=inputs.TextureMetalness1,rough=inputs.TextureRoughness1;
  const separate=q.F_SEPARATE_CHANNEL_INPUTS==='1';
  const style=Number(p.F_PAINT_STYLE),brightness=Number(p.g_flColorBrightness||1),scale=Number(p.g_flPatternTexCoordScale||1),angle=Number(p.g_flPatternTexCoordRotation||0)*Math.PI/180;
  const positionFile=path.join(extraction,'glock-position.f32');
  const positionBytes=style===5?fs.readFileSync(positionFile):null;
  if(positionBytes)used.push(positionFile);
  const position=positionBytes?new Float32Array(positionBytes.buffer,positionBytes.byteOffset,positionBytes.byteLength/4):null;
  // Verified in the installed csgo_customweapon shader: all four UiType(Color)
  // parameters have Expression(SrgbGammaToLinear(this)); pattern masks are linear.
  const colors=Array.from({length:4},(_,i)=>vec(p['g_vColor'+i]).slice(0,3).map(srgbToLinear));
  const albedo=Buffer.alloc(n*n*3),orm=Buffer.alloc(n*n*3),coverage=Buffer.alloc(n*n);
  const c=Math.cos(angle),s=Math.sin(angle),baseRough=Number(p.g_flPaintRoughness||.5);
  function pixel(u,v){
    // Valve's IgnoreWeaponSizeScale is enabled for every selected finish.
    // A deterministic zero offset is used; no CS2 seed-number equivalence is claimed.
    const px=Math.floor((((u*c-v*s)*scale)%1+1)%1*pn)%pn;
    const py=Math.floor((((u*s+v*c)*scale)%1+1)%1*pn)%pn;
    return (py*pn+px)*4;
  }
  for(let y=0;y<n;y++)for(let x=0;x<n;x++){
    const t=y*n+x,i=t*4,j=t*3,k=position?((Math.floor(pn*.5)*pn+Math.floor(clamp(position[j+1],0,.99999)*pn))*4):pixel((x+.5)/n,(y+.5)/n);
    const pa=pattern[k+3],originalMetal=metal[i]/255;
    // Installed CS2 composite shader packs TextureNoPaint1 into A for all paint styles.
    const noPaint=(separate?inputs.TextureNoPaint1?.[i]??0:ao[i+3])/255;
    const aoValue=(separate?ao[i]:ao[i+1])/255;
    // Custom Paint Job alpha below 128 increases paint durability. It must
    // protect pristine artwork (not blend scratches back over white finishes).
    // Anodized styles use this range for roughness and keep their own handling.
    const durability=style===6?Math.min(1,pa/128):1;
    let strength=pristinePaintCoverage(noPaint*durability);
    // Alpha near 196 masks paint; 128 and 255 retain default coverage.
    // This is the documented pristine endpoint, not Valve's entire wear simulation.
    if(pa>128){const remove=1-Math.abs(pa-191.5)/63.5;strength*=1-clamp(remove);}
    let color,paintMetal=0,paintRough=baseRough;
    if(style===4||style===5){
      color=colors[0].slice();
      // RGB are successive coat opacities, not additive RGB color artwork.
      for(let layer=0;layer<3;layer++)for(let ch=0;ch<3;ch++)color[ch]=lerp(color[ch],colors[layer+1][ch],pattern[k+layer]/255);
      const red=mask[i]/255,green=mask[i+1]/255,blue=mask[i+2]/255;
      for(let ch=0;ch<3;ch++)color[ch]=lerp(lerp(color[ch],colors[2][ch],green*(1-red)),colors[3][ch],blue*(1-red));
      // Red is the patterned region; the old default's black paint may itself
      // have zero metalness and must not suppress the newly anodized coating.
      // Nonmetal green/blue grips remain substrate; green metal accents retain
      // their original region color. No-paint still protects internal parts.
      strength*=style===5?red:clamp(red+(green+blue)*originalMetal);
      color=color.map(v=>linearToSrgb(clamp(v*brightness)));paintMetal=1;
      // CS2's documented inverted 0..127 roughness range, not the old Phong exponent.
      paintRough=pa<128?clamp(1-pa/127,.075,1):baseRough;
    }else{
      color=[pattern[k]/255,pattern[k+1]/255,pattern[k+2]/255];
      if(style===8){paintMetal=clamp(originalMetal*.7+mask[i]/255*.3);paintRough=pa<128?clamp(1-pa/127,.12,.8):baseRough;}
    }
    // AO is kept in ORM; do not bake directional light or inventory art into albedo.
    for(let ch=0;ch<3;ch++)albedo[j+ch]=Math.round(lerp(base[i+ch],color[ch]*255,strength));
    orm[j]=Math.round(lerp(1,aoValue,.75)*255);
    orm[j+1]=Math.round(lerp(rough[i],paintRough*255,strength));
    orm[j+2]=Math.round(lerp(metal[i],paintMetal*255,strength));
    coverage[t]=Math.round(strength*255);
  }
  const bakeDir=path.join(extraction,'baked',spec.file);fs.mkdirSync(bakeDir,{recursive:true});
  const albedoFile=path.join(bakeDir,'albedo.jpg'),ormFile=path.join(bakeDir,'orm.jpg');
  await sharp(albedo,{raw:{width:n,height:n,channels:3}}).jpeg({quality:96,chromaSubsampling:'4:4:4'}).toFile(albedoFile);
  await sharp(orm,{raw:{width:n,height:n,channels:3}}).resize(1024).jpeg({quality:97,chromaSubsampling:'4:4:4'}).toFile(ormFile);
  let normalFile;
  if(p.TextureNormal){
    const normalSource=local(paintdir,p.TextureNormal);used.push(normalSource);normalFile=path.join(bakeDir,'normal.jpg');
    const normal=await rgba(normalSource,1024);
    // Direct material exports retain Source's tangent normal orientation; glTF uses +Y.
    for(let i=0;i<normal.length;i+=4)normal[i+1]=255-normal[i+1];
    await sharp(normal,{raw:{width:1024,height:1024,channels:4}}).removeAlpha().jpeg({quality:97,chromaSubsampling:'4:4:4'}).toFile(normalFile);
  }
  let pearlFile;
  if(p.TexturePearlescenceMask){
    const pearlSource=local(paintdir,p.TexturePearlescenceMask);used.push(pearlSource);pearlFile=path.join(bakeDir,'iridescence.jpg');
    await sharp(pearlSource).resize(1024).removeAlpha().jpeg({quality:95}).toFile(pearlFile);
  }
  return {p,q,n,style,albedoFile,ormFile,normalFile,pearlFile,used,paintFile,inputFile};
}
const reports=[];
for(const spec of specs){
  const previewSource=path.join(source,'panorama/images/econ/default_generated',spec.inventory+'_light_png.png');
  const previewTarget=path.join(out,'previews',spec.file+'.webp');fs.mkdirSync(path.dirname(previewTarget),{recursive:true});
  await sharp(previewSource).resize(512,384,{fit:'inside',withoutEnlargement:true}).webp({quality:92}).toFile(previewTarget);
  const bakeResult=await bake(spec);const {p,q}=bakeResult;
  const input=path.resolve(spec.rawGLB),bytes=fs.readFileSync(input),jsonLength=bytes.readUInt32LE(12);
  const doc=JSON.parse(bytes.toString('utf8',20,20+jsonLength));
  const binary=bytes.subarray(28+jsonLength,28+jsonLength+bytes.readUInt32LE(20+jsonLength));
  const selectedIndex=doc.meshes.findIndex(m=>m.name.endsWith('.body_'+spec.body));
  if(selectedIndex<0)throw new Error('Missing correct UV body '+spec.id);
  const selected=doc.meshes[selectedIndex];
  const sourcePrims=selected.primitives.filter(primitive=>doc.materials[primitive.material].name!=='sticker_gaps');
  const result={asset:{version:'2.0',generator:'Source2Viewer 20.0.6980; local CS2 paintkit PBR bake',copyright:'Valve Corporation and the original workshop creators. Personal prototype; not CC0.'},scene:0,scenes:[],nodes:structuredClone(doc.nodes),skins:[],meshes:[],accessors:[],bufferViews:[],buffers:[{byteLength:0}],materials:[],textures:[],images:[],samplers:[{magFilter:9729,minFilter:9987,wrapS:10497,wrapT:10497}]};
  const chunks=[];let total=0;const accessorMap=new Map(),viewMap=new Map(),materialMap=new Map(),textureMap=new Map();
  const addBuffer=(data,target)=>{const padded=Buffer.alloc(Math.ceil(data.length/4)*4);data.copy(padded);const index=result.bufferViews.length;result.bufferViews.push({buffer:0,byteOffset:total,byteLength:data.length,...(target?{target}:{})});chunks.push(padded);total+=padded.length;return index;};
  function accessor(index){if(accessorMap.has(index))return accessorMap.get(index);const a=structuredClone(doc.accessors[index]);if(a.sparse)throw new Error('Unexpected sparse accessor');const old=doc.bufferViews[a.bufferView];if(!viewMap.has(a.bufferView)){const i=addBuffer(binary.subarray(old.byteOffset||0,(old.byteOffset||0)+old.byteLength),old.target);if(old.byteStride)result.bufferViews[i].byteStride=old.byteStride;viewMap.set(a.bufferView,i);}a.bufferView=viewMap.get(a.bufferView);const n=result.accessors.length;result.accessors.push(a);accessorMap.set(index,n);return n;}
  async function texture(file,max=1024){
    const key=file+max;if(textureMap.has(key))return textureMap.get(key);
    const data=file.endsWith('.jpg')?fs.readFileSync(file):await sharp(file).resize(max,max,{fit:'inside',withoutEnlargement:true}).removeAlpha().jpeg({quality:97,chromaSubsampling:'4:4:4'}).toBuffer();
    const bufferView=addBuffer(data),imageIndex=result.images.length,textureIndex=result.textures.length;
    result.images.push({name:path.basename(file),bufferView,mimeType:'image/jpeg'});result.textures.push({source:imageIndex,sampler:0});textureMap.set(key,textureIndex);return textureIndex;
  }
  function originalTexture(ref){return path.resolve(path.dirname(input),doc.images[doc.textures[ref.index].source].uri);}
  async function material(index){
    if(materialMap.has(index))return materialMap.get(index);const original=doc.materials[index];
    let m;
    if(original.name==='shared_scope'){
      m=structuredClone(original);delete m.extras;
      for(const ref of [m.pbrMetallicRoughness?.baseColorTexture,m.pbrMetallicRoughness?.metallicRoughnessTexture,m.normalTexture,m.occlusionTexture].filter(Boolean))ref.index=await texture(originalTexture(ref));
    }else{
      m={name:spec.name,pbrMetallicRoughness:{baseColorTexture:{index:await texture(bakeResult.albedoFile,2048)},metallicRoughnessTexture:{index:await texture(bakeResult.ormFile)},metallicFactor:1,roughnessFactor:1},occlusionTexture:{index:await texture(bakeResult.ormFile),strength:1},normalTexture:{index:await texture(bakeResult.normalFile||originalTexture(original.normalTexture))},extras:{sourceMaterial:original.name,paintkit:spec.paintkit,paintKey:spec.paint,sourceUVBody:spec.body,wear:0,materialFidelity:'Original Valve pattern/UV/masks/parameters; browser PBR approximation of Source2 composite shader.'}};
      if(bakeResult.pearlFile){
        result.extensionsUsed=['KHR_materials_iridescence','KHR_materials_clearcoat'];
        m.extensions={KHR_materials_iridescence:{iridescenceFactor:.3,iridescenceIor:1.3,iridescenceThicknessMinimum:250,iridescenceThicknessMaximum:380,iridescenceTexture:{index:await texture(bakeResult.pearlFile)}},KHR_materials_clearcoat:{clearcoatFactor:.4,clearcoatRoughnessFactor:.22}};
      }
    }
    const next=result.materials.length;result.materials.push(m);materialMap.set(index,next);return next;
  }
  const primitives=[];let triangles=0;const minimum=[Infinity,Infinity,Infinity],maximum=[-Infinity,-Infinity,-Infinity];
  for(const primitive of sourcePrims){
    const attributes={};for(const [name,index] of Object.entries(primitive.attributes))attributes[name]=accessor(index);
    const a=doc.accessors[primitive.attributes.POSITION];a.min.forEach((v,i)=>minimum[i]=Math.min(v,minimum[i]));a.max.forEach((v,i)=>maximum[i]=Math.max(v,maximum[i]));
    const next={attributes,indices:accessor(primitive.indices),material:await material(primitive.material)};if(primitive.mode!==undefined)next.mode=primitive.mode;primitives.push(next);triangles+=doc.accessors[primitive.indices].count/3;
  }
  result.meshes.push({name:selected.name,primitives});
  const selectedNodes=new Set(),skinMap=new Map();
  for(let i=0;i<result.nodes.length;i++){
    const node=result.nodes[i];
    if(node.mesh===undefined)continue;
    if(node.mesh!==selectedIndex){delete node.mesh;delete node.skin;continue;}
    selectedNodes.add(i);node.mesh=0;
    if(node.skin!==undefined){
      if(!skinMap.has(node.skin)){const skin=structuredClone(doc.skins[node.skin]);skin.inverseBindMatrices=accessor(skin.inverseBindMatrices);skinMap.set(node.skin,result.skins.length);result.skins.push(skin);}
      node.skin=skinMap.get(node.skin);
    }
  }
  const center=minimum.map((v,i)=>(v+maximum[i])/2),size=minimum.map((v,i)=>maximum[i]-v);
  const normalization=new Matrix4().set(-1,0,0,center[0],0,1,0,-center[1],0,0,-1,center[2],0,0,0,1);
  const normalizationIndex=result.nodes.length;
  const roots=doc.scenes[doc.scene||0].nodes.filter(i=>doc.nodes[i].mesh===undefined||selectedNodes.has(i));
  result.nodes.push({name:'normalization',matrix:normalization.toArray(),children:roots,extras:{forward:'-Z',up:'+Y',units:'metres',sourceForward:'+Z',sourceCenter:center,paintkit:spec.paintkit}});
  result.scenes=[{name:spec.name,nodes:[normalizationIndex]}];
  result.buffers[0].byteLength=total;
  const jsonText=Buffer.from(JSON.stringify(result)),json=Buffer.alloc(Math.ceil(jsonText.length/4)*4,32);jsonText.copy(json);const bin=Buffer.concat(chunks);const output=Buffer.alloc(28+json.length+bin.length);output.writeUInt32LE(0x46546c67,0);output.writeUInt32LE(2,4);output.writeUInt32LE(output.length,8);output.writeUInt32LE(json.length,12);output.writeUInt32LE(0x4e4f534a,16);json.copy(output,20);output.writeUInt32LE(bin.length,20+json.length);output.writeUInt32LE(0x004e4942,24+json.length);bin.copy(output,28+json.length);
  const filename=path.join(out,spec.file+'.glb');fs.writeFileSync(filename,output);
  const worlds=new Map();function walk(index,parent){const n=doc.nodes[index];const localM=n.matrix?new Matrix4().fromArray(n.matrix):new Matrix4().compose(new Vector3().fromArray(n.translation||[0,0,0]),new Quaternion().fromArray(n.rotation||[0,0,0,1]),new Vector3().fromArray(n.scale||[1,1,1]));const world=parent.clone().multiply(localM);worlds.set(index,world);for(const child of n.children||[])walk(child,world);}
  for(const index of doc.scenes[doc.scene||0].nodes)walk(index,new Matrix4());
  const joints=result.skins[0].joints.map(index=>({name:doc.nodes[index].name,index,sourcePosition:new Vector3().setFromMatrixPosition(worlds.get(index)).toArray(),normalizedPosition:new Vector3().setFromMatrixPosition(normalization.clone().multiply(worlds.get(index))).toArray()}));
  const previewFile=path.join(out,'previews',spec.file+'.webp');
  reports.push({id:spec.id,name:spec.name,file:spec.file+'.glb',paintkit:spec.paintkit,paintKey:spec.paint,bytes:output.length,sha256:hash(filename),triangles,sizeMetres:size,sourceBounds:{minimum,maximum,center},up:'+Y',forward:'-Z',normalizationNode:'normalization',sourceToNormalized:normalization.toArray(),normalizedToSource:normalization.clone().invert().toArray(),sourceScale:1,sourceForward:'+Z',sourceUp:'+Y',sourceUVBody:spec.body,sourceMesh:selected.name,rawGLB:rel(input),rawGLBSha256:hash(input),animations:[],joints,wearMin:spec.wearMin,wearMax:spec.wearMax,condition:'Factory New',chineseName:spec.chineseName,englishName:spec.englishName,preview:{file:'previews/'+spec.file+'.webp',sourceVpkPath:'panorama/images/econ/default_generated/'+spec.inventory+'_light_png.vtex_c',bytes:fs.statSync(previewFile).size,sha256:hash(previewFile)},parameters:{paintStyle:Number(p.F_PAINT_STYLE),patternScale:Number(p.g_flPatternTexCoordScale),patternRotation:Number(p.g_flPatternTexCoordRotation),patternOffset:[0,0],seedEquivalentToCS2:false,wear:0,paintRoughness:Number(p.g_flPaintRoughness),pearlescentScale:Number(p.g_flPearlescentScale),colors:[0,1,2,3].filter(i=>p['g_vColor'+i]).map(i=>vec(p['g_vColor'+i]))},sourceFiles:bakeResult.used.map(file=>({file:rel(file),sha256:hash(file)}))});
  console.log(spec.id,output.length,'bytes',triangles,'triangles',joints.length,'joints',spec.body);
}
fs.writeFileSync(path.join(out,filter?'manifest-'+filter.join('-')+'.json':'manifest.json'),JSON.stringify({version:1,extractedAt:new Date().toISOString(),source:'Local owned Counter-Strike 2 installation; pak01_dir.vpk; Valve and workshop creators retain rights.',fidelity:'Original source geometry, correct paintkit UV body, original skin textures, normals, paint masks and parameters. Local pristine PBR bake; Source2 wear randomization, exact composite shader and pearlescence are not reproduced exactly.',tools:{exporter:'Source2Viewer-CLI 20.0.6980',baker:rel(new URL(import.meta.url).pathname.slice(1)),bakerSha256:hash(new URL(import.meta.url))},models:reports},null,2)+'\n');
fs.writeFileSync(path.join(out,filter?'SHA256SUMS-'+filter.join('-')+'.txt':'SHA256SUMS.txt'),reports.flatMap(m=>[m.sha256+'  '+m.file,m.preview.sha256+'  '+m.preview.file]).join('\n')+'\n');
