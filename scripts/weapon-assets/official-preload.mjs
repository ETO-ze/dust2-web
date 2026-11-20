// Build the server's offline staging list from the same catalogue used by real rooms.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {SKINS} from '../../shared/skins.js';

const repo=path.resolve(import.meta.dirname,'../..'),publicDir=path.join(repo,'public');
const dest=process.argv[2];if(!dest)throw Error('Usage: node scripts/weapon-assets/official-preload.mjs <manifest.json>');
const digest=b=>createHash('sha256').update(b).digest('hex');
const json=f=>JSON.parse(fs.readFileSync(f,'utf8'));
const gltf=b=>JSON.parse(b.toString('utf8',20,20+b.readUInt32LE(12)));
const manifests=new Map(),files=new Map(),verifiedSources=new Map();
function verifySource(file,sha256){
 if(verifiedSources.has(file)){
  if(verifiedSources.get(file)!==sha256)throw Error('Conflicting source hash: '+file);
  return;
 }
 if(digest(fs.readFileSync(path.join(repo,file)))!==sha256)throw Error('Extracted source differs: '+file);
 verifiedSources.set(file,sha256);
}
for(const name of ['cs2-loadout/manifest.json','cs2-skins/legacy-manifest.json','cs2-skins/expansion/manifest.json','cs2-skins/popular/manifest.json']){
 const file='assets/weapons/'+name;
 for(const record of json(path.join(publicDir,file)).models)manifests.set(record.sha256,{file,record});
}
const stockGunManifest='assets/weapons/cs2-skins/stock-guns/manifest.json';
const stockGuns=json(path.join(publicDir,stockGunManifest)).sources;
const stockKnifeManifest='assets/weapons/cs2-skins/knives/manifest.json';
const stockKnives=json(path.join(publicDir,stockKnifeManifest)).sources.items;
function verify(relative,bytes,sha256,role){
 if(!/^assets\/[a-z0-9/_-]+\.(?:glb|webp)$/i.test(relative))throw Error('Invalid resource '+relative);
 const data=fs.readFileSync(path.join(publicDir,relative));
 if(data.length!==bytes||digest(data)!==sha256)throw Error('Local release asset differs: '+relative);
 files.set(relative,{path:relative,bytes,sha256,role});return data;
}
function modelSource(s,b){
 const g=gltf(b),found=manifests.get(s.sha256);
 if(Object.hasOwn(stockKnives,s.id)){
  const source=stockKnives[s.id],base='artifacts/stock-knife-work/loose/game/csgo/';
  verifySource(base+source.model,source.modelSourceSha256);
  verifySource(base+source.preview,source.previewSourceSha256);
  if(source.worldGrip)verifySource(base+source.worldGrip.path,source.worldGrip.sha256);
  for(const clip of Object.values(source.clips))verifySource(base+clip.path,clip.sha256);
  if(s.weapon!=='knife'||s.condition!=='Vanilla'||!s.animation||!g.skins.length)throw Error('Invalid stock knife: '+s.id);
  return {manifest:stockKnifeManifest,model:source.model,rawModelSha256:source.modelSourceSha256,inventoryIcon:source.preview,clips:source.clips,paintkit:null};
 }
 if(Object.hasOwn(stockGuns,s.id)){
  const source=stockGuns[s.id];
  for(const input of [source.rawGLB,source.inventorySource,...source.sourceFiles])verifySource(input.file,input.sha256);
  if(s.condition!=='Vanilla'||s.paintkit!=null||g.meshes[0].name!==source.sourceMesh)throw Error('Invalid stock body: '+s.id);
  return {manifest:stockGunManifest,model:source.sourceMesh,rawModelSha256:source.rawGLB.sha256,inventoryIcon:source.inventoryIcon,paintkit:null};
 }
 if(found){
  const {file,record:m}=found;
  verifySource(m.rawGLB,m.rawGLBSha256);
  for(const input of m.sourceFiles)verifySource(input.file,input.sha256);
  if(m.paintkit!==s.paintkit||m.parameters.wear!==s.wear||m.preview.sha256!==s.previewSha256)throw Error('Source record differs: '+s.id);
  if(!g.materials.some(material=>material.extras?.paintkit===m.paintkit&&material.extras.wear===s.wear))throw Error('Material assignment differs: '+s.id);
  return {manifest:file,model:m.sourceMesh,paintkit:m.paintkit,paintKey:m.paintKey,material:'materials/models/weapons/customization/paints/vmats/'+m.paintKey+'.vmat_c',inventoryIcon:m.preview.sourceVpkPath,rawModelSha256:m.rawGLBSha256,paintInputs:m.sourceFiles.map(({file,sha256})=>({path:file.split('/source/').pop(),sha256}))};
 }
 const knife={m9:'weapon_knife_m9_bayonet',butterfly:'weapon_knife_butterfly'}[s.animationFamily];
 if(!knife||s.condition!=='Vanilla'||!g.asset.generator.includes('Source 2 Viewer'))throw Error('No source record: '+s.id);
 const model=g.nodes.find(n=>n.name?.endsWith('.vmdl_c'))?.name;
 if(!model)throw Error('Missing Source 2 model path: '+s.id);
 const icon='panorama/images/econ/weapons/base_weapons/'+knife+'_png';
 return {model:model.replaceAll('\\','/'),paintkit:null,inventoryIcon:icon+'.vtex_c',rawIconSha256:digest(fs.readFileSync(path.join(repo,'artifacts/optional-extras/previews',icon+'.png')))};
}
const skins=SKINS.map(s=>{
 const b=verify(s.model,s.bytes,s.sha256,'model');verify(s.preview,s.previewBytes,s.previewSha256,'preview');
 if(s.animation)verify(s.animation.model,s.animation.bytes,s.animation.sha256,'animation');
 return {id:s.id,name:s.englishName,weapon:s.weapon,isDefault:s.isDefault,condition:s.condition,wear:s.condition==='Vanilla'?null:s.wear,model:s.model,preview:s.preview,...(s.animation?{animation:s.animation.model}:{}),source:modelSource(s,b)};
});
const manifest={schemaVersion:1,source:'Valve Counter-Strike 2 VPK and shipped inventory art',rendering:'Converted GLB and WebP from Valve assets. Browser PBR baking approximates Source 2 wear, shader lighting, seed and pearlescence.',skins,files:[...files.values()].sort((a,b)=>a.path.localeCompare(b.path))};
fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({dest,skins:skins.length,files:files.size,bytes:manifest.files.reduce((n,f)=>n+f.bytes,0),sha256:digest(fs.readFileSync(dest)),verifiedSourceInputs:verifiedSources.size}));
