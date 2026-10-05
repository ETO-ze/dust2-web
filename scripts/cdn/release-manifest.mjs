/** An explicit static-resource inventory; never walks or copies the repository. */
import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {validateMapTransport,transportObjectName} from '../maps/transport-schema.mjs';

export const MAP_IDS=Object.freeze(['de_dust2','de_mirage','de_inferno']);
export const IMMUTABLE_CACHE='public, max-age=31536000, immutable, no-transform';
const hashPattern=/^[a-f0-9]{64}$/;
const types={'.json':'application/json; charset=utf-8','.gltf':'model/gltf+json','.glb':'model/gltf-binary','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.avif':'image/avif','.svg':'image/svg+xml','.mp3':'audio/mpeg','.ogg':'audio/ogg','.wav':'audio/wav','.hdr':'application/octet-stream','.bin':'application/octet-stream','.f32':'application/octet-stream','.u8':'application/octet-stream','.gz':'application/octet-stream','.woff2':'font/woff2'};
const sensitive=/(?:^|\/)(?:\.git|\.env(?:\.[^/]*)?|node_modules|server|config(?:\.[^/]*)?|credentials?(?:\.[^/]*)?|secrets?(?:\.[^/]*)?|saves?|backups?|\.ssh|signing|private(?:\.[^/]*)?|id_rsa|id_ed25519)(?:\/|$)/i;

export function validateReleaseId(value){
  if(typeof value!=='string'||! /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/.test(value))throw Error('Invalid releaseId');
  return value;
}
export function validateRelativePath(value){
  if(typeof value!=='string'||!value||value.length>512||/[\\%?#\x00-\x1f\x7f:]/.test(value)||value.startsWith('/')||value.split('/').some(p=>!p||p==='.'||p==='..'||p.startsWith('.'))||sensitive.test(value))throw Error('Unsafe static resource path');
  return value;
}
export function validateResourceKey(key,releaseId){
  const prefix=`releases/${validateReleaseId(releaseId)}/`;
  validateRelativePath(key);
  if(!key.startsWith(prefix))throw Error('Resource outside release');
  const relative=key.slice(prefix.length),ext=path.posix.extname(relative).toLowerCase();
  if(!types[ext])throw Error('Unsupported static resource type');
  if(relative.startsWith('assets/')&&relative.length>7)return key;
  const map=/^maps\/(de_dust2|de_mirage|de_inferno)\/(.+)$/.exec(relative);
  if(!map)throw Error('Resource outside static allowlist');
  if(/^(?:map\.json|nav\.json|manifest\.json|audit\.json|render-manifest\.json|transport-manifest\.json|physics\.f32|physics-mask\.u8|physics-groups\.json|entity-collision-policy\.json)$/.test(map[2])||/^render\/[^/]+$/.test(map[2])||/^transport\/[a-f0-9]{64}\.(?:gz|webp)$/.test(map[2]))return key;
  throw Error('Resource outside map allowlist');
}
const within=(root,file)=>{const relative=path.relative(root,file);return relative!==''&&!relative.startsWith(`..${path.sep}`)&&relative!=='..'&&!path.isAbsolute(relative);};
export async function sha256File(file){
  const digest=createHash('sha256');
  for await(const block of createReadStream(file))digest.update(block);
  return digest.digest('hex');
}
function metadataShape(file){
  if(!Number.isSafeInteger(file?.bytes)||file.bytes<0||typeof file.sha256!=='string'||!hashPattern.test(file.sha256))throw Error('Invalid resource size/hash');
}
async function json(file){return JSON.parse(await fs.readFile(file,'utf8'));}
async function prospectiveRealPath(file){
  let ancestor=path.resolve(file);const missing=[];
  for(;;){try{return path.join(await fs.realpath(ancestor),...missing.reverse());}catch(error){if(error.code!=='ENOENT')throw error;const parent=path.dirname(ancestor);if(parent===ancestor)throw error;missing.push(path.basename(ancestor));ancestor=parent;}}
}
export async function writeLocalMetadata(file,text){
  try{
    const stat=await fs.lstat(file);
    if(!stat.isFile()||stat.isSymbolicLink())throw Error('Metadata destination is not a regular file');
    if(!Buffer.from(text).equals(await fs.readFile(file)))throw Error('Generated metadata conflict; choose a new release output');
  }catch(error){
    if(error.code!=='ENOENT')throw error;
    const handle=await fs.open(file,'wx');try{await handle.writeFile(text);}finally{await handle.close();}
  }
}

export class ReleaseInventory {
  constructor(releaseId){this.releaseId=validateReleaseId(releaseId);this.assets=new Map();this.roots=new Set();}
  async add({relativePath,sourcePath,root,bytes,sha256}){
    const key=validateResourceKey(`releases/${this.releaseId}/${relativePath}`,this.releaseId);
    if(bytes!==undefined||sha256!==undefined)metadataShape({bytes,sha256});
    const realRoot=await fs.realpath(root),realFile=await fs.realpath(sourcePath).catch(()=>{throw Error(`Missing resource: ${relativePath}`);});
    if(!within(realRoot,realFile))throw Error('Resource escapes allowed source root');
    const stat=await fs.stat(realFile);
    if(!stat.isFile())throw Error('Resource is not a file');
    if(bytes!==undefined&&bytes!==stat.size)throw Error(`Resource size changed: ${relativePath}`);
    const digest=await sha256File(realFile);
    if(sha256!==undefined&&sha256!==digest)throw Error(`Resource checksum changed: ${relativePath}`);
    const entry={key,sourcePath:realFile,bytes:stat.size,sha256:digest,contentType:types[path.extname(relativePath).toLowerCase()],cacheControl:IMMUTABLE_CACHE};
    const existing=this.assets.get(key);
    if(existing&&(existing.bytes!==entry.bytes||existing.sha256!==entry.sha256))throw Error(`Conflicting resource key: ${key}`);
    if(!existing)this.assets.set(key,entry);
    this.roots.add(realRoot);return entry;
  }
  manifest(){
    const assets=[...this.assets.values()].sort((a,b)=>a.key<b.key?-1:a.key>b.key?1:0);
    return {schemaVersion:1,releaseId:this.releaseId,manifestKey:`releases/${this.releaseId}/release-manifest.json`,totalBytes:assets.reduce((n,a)=>n+a.bytes,0),fileCount:assets.length,sourceRoots:[...this.roots].sort(),assets};
  }
}

/** Reconstruct allowed fields instead of merely deleting one local field. */
export function toPublicManifest(local){
  validateReleaseId(local?.releaseId);
  if(local.schemaVersion!==1||!Array.isArray(local.assets))throw Error('Invalid release manifest');
  const keys=new Set();
  const assets=local.assets.map(file=>{
    validateResourceKey(file.key,local.releaseId);metadataShape(file);
    if(keys.has(file.key))throw Error('Duplicate resource key');keys.add(file.key);
    if(file.contentType!==types[path.posix.extname(file.key).toLowerCase()]||file.cacheControl!==IMMUTABLE_CACHE||file.contentEncoding!==undefined)throw Error('Invalid static delivery metadata');
    return {key:file.key,bytes:file.bytes,sha256:file.sha256,contentType:file.contentType,cacheControl:file.cacheControl};
  });
  return {schemaVersion:1,releaseId:local.releaseId,manifestKey:`releases/${local.releaseId}/release-manifest.json`,totalBytes:assets.reduce((n,a)=>n+a.bytes,0),fileCount:assets.length,assets};
}

export async function addAssetManifests(inventory,{publicRoot,manifestNames=['asset-manifest.json','asset-manifest-mobile.json'],extraAssets=[]}){
  for(const name of manifestNames){
    if(!['asset-manifest.json','asset-manifest-mobile.json'].includes(name))throw Error('Unknown asset manifest');
    const file=path.join(publicRoot,'assets',name),data=await json(file);
    if(!Array.isArray(data.files))throw Error('Invalid asset manifest');
    for(const entry of data.files){
      validateRelativePath(entry.path);
      if(!entry.path.startsWith('assets/'))throw Error('Asset outside assets root');
      await inventory.add({relativePath:entry.path,sourcePath:path.join(publicRoot,...entry.path.split('/')),root:path.join(publicRoot,'assets'),bytes:entry.bytes,sha256:entry.sha256});
    }
    await inventory.add({relativePath:`assets/${name}`,sourcePath:file,root:path.join(publicRoot,'assets')});
  }
  for(const entry of extraAssets){
    validateRelativePath(entry.path);
    if(!entry.path.startsWith('assets/'))throw Error('Asset outside assets root');
    await inventory.add({relativePath:entry.path,sourcePath:path.join(publicRoot,...entry.path.split('/')),root:path.join(publicRoot,'assets'),bytes:entry.bytes,sha256:entry.sha256});
  }
}

export async function addMaps(inventory,{mapRoot,transportRoot,generatedRoot,mapIds=MAP_IDS}){
  if(!Array.isArray(mapIds)||new Set(mapIds).size!==mapIds.length||mapIds.some(id=>!MAP_IDS.includes(id)))throw Error('Invalid map selection');
  const reports=await json(path.join(mapRoot,'exports.json'));
  if(!Array.isArray(reports))throw Error('Invalid map export inventory');
  const realMapRoot=await fs.realpath(mapRoot);
  const realTransportRoot=await fs.realpath(transportRoot),prospectiveGenerated=await prospectiveRealPath(generatedRoot);
  for(const sourceRoot of [realMapRoot,realTransportRoot])if(sourceRoot===prospectiveGenerated||within(sourceRoot,prospectiveGenerated))throw Error('Generated metadata must be outside source roots');
  await fs.mkdir(generatedRoot,{recursive:true});const realGeneratedRoot=await fs.realpath(generatedRoot);
  for(const id of mapIds){
    const matches=reports.filter(r=>r.id===id);
    if(matches.length!==1)throw Error(`Missing or duplicate map: ${id}`);
    const report=matches[0],directory=await fs.realpath(report.directory);
    if(!within(realMapRoot,directory)||!hashPattern.test(report.sourceSha256)||!Array.isArray(report.files))throw Error('Map source outside library');
    const original=new Map();let renderFiles=[];
    for(const file of report.files.filter(f=>f.path.startsWith('raw/')&&!f.path.endsWith('.log'))){
      validateRelativePath(file.path);metadataShape(file);
      const name=file.path.slice(4);
      if(name.includes('/')||original.has(file.path))throw Error('Invalid render inventory');
      original.set(file.path,file);renderFiles.push({path:name,bytes:file.bytes,sha256:file.sha256});
    }
    if(!original.has('raw/map.gltf'))throw Error('Missing render glTF');
    let renderDirectory=path.join(directory,'raw');
    // Inferno's deployed render uses the proven equivalent, bounded glTF export.
    // Its transport pack was deliberately bound to this derived source.
    if(id==='de_inferno'){
      const proof=await json(path.join(directory,'derived','render-equivalence.json'));
      if(proof.schemaVersion!==1||proof.byteEquivalent!==true||proof.primitiveOrderPreserved!==true||proof.threshold512MiBPassed!==true||proof.source?.gltfSha256!==original.get('raw/map.gltf').sha256||proof.source?.bufferSha256!==original.get('raw/map.bin')?.sha256)throw Error('Unproven derived Inferno source');
      renderDirectory=await fs.realpath(path.join(directory,'derived','raw'));
      if(!within(realMapRoot,renderDirectory))throw Error('Derived render escapes library');
      for(const [name,field] of [['map.gltf','gltfSha256'],['map.bin','bufferSha256']]){
        const source=path.join(renderDirectory,name),stat=await fs.stat(source),digest=await sha256File(source);
        if(!hashPattern.test(proof.derived?.[field])||digest!==proof.derived[field]||(name==='map.bin'&&(stat.size!==proof.derived.bufferBytes||stat.size>512*1024*1024)))throw Error('Derived Inferno checksum changed');
        const entry={path:`raw/${name}`,bytes:stat.size,sha256:digest};original.set(entry.path,entry);
        const at=renderFiles.findIndex(f=>f.path===name);if(at<0)throw Error('Missing original render source');renderFiles[at]={path:name,bytes:stat.size,sha256:digest};
      }
    }
    const gltf=await json(path.join(renderDirectory,'map.gltf')),referenced=new Set(['raw/map.gltf']);
    for(const reference of [...(gltf.buffers||[]),...(gltf.images||[])]){
      validateRelativePath(reference.uri);
      if(reference.uri.includes('/')||!original.has(`raw/${reference.uri}`))throw Error('Unknown render dependency');
      referenced.add(`raw/${reference.uri}`);
    }
    renderFiles=renderFiles.filter(file=>referenced.has(`raw/${file.path}`));
    for(const logical of [...original.keys()])if(logical.startsWith('raw/')&&!referenced.has(logical))original.delete(logical);
    const compiled=await json(path.join(directory,'compiled','manifest.json'));
    if(compiled.sourceSha256!==report.sourceSha256||!Array.isArray(compiled.files))throw Error('Compiled map source changed');
    for(const file of compiled.files){validateRelativePath(file.path);metadataShape(file);if(original.has(`compiled/${file.path}`))throw Error('Duplicate compiled entry');original.set(`compiled/${file.path}`,file);}
    const policyFile=path.join(directory,'entity-collision-policy.json'),policyStat=await fs.stat(policyFile);
    original.set('entity-collision-policy.json',{bytes:policyStat.size,sha256:await sha256File(policyFile)});
    for(const name of ['map.json','nav.json']){
      const source=original.get(`compiled/${name}`);if(!source)throw Error(`Missing map metadata: ${name}`);
      await inventory.add({relativePath:`maps/${id}/${name}`,sourcePath:path.join(directory,'compiled',name),root:mapRoot,...source});
    }
    // Generate the same sanitized bytes as the map HTTP server; do not publish exports.json.
    const generatedDirectory=path.join(generatedRoot,id);await fs.mkdir(generatedDirectory,{recursive:true});
    if(!within(realGeneratedRoot,await fs.realpath(generatedDirectory)))throw Error('Generated map metadata escapes output');
    const renderManifest=path.join(generatedDirectory,'render-manifest.json');
    await writeLocalMetadata(renderManifest,JSON.stringify({schemaVersion:1,id,sourceSha256:report.sourceSha256,files:renderFiles}));
    await inventory.add({relativePath:`maps/${id}/render-manifest.json`,sourcePath:renderManifest,root:generatedRoot});
    const transportDirectory=path.join(transportRoot,id),transportFile=path.join(transportDirectory,'transport-manifest.json'),transport=await json(transportFile);
    const entries=validateMapTransport(transport,{id,sourceSha256:report.sourceSha256,originalRenderGltfSha256:original.get('raw/map.gltf').sha256});
    await inventory.add({relativePath:`maps/${id}/transport-manifest.json`,sourcePath:transportFile,root:transportRoot});
    for(const [name,entry] of entries){
      const source=original.get(name);
      if(!source||source.bytes!==entry.bytes||source.sha256!==entry.sha256)throw Error('Transport source changed');
      for(const chunk of entry.chunks){
        const object=transportObjectName(entry,chunk);
        await inventory.add({relativePath:`maps/${id}/transport/${object}`,sourcePath:path.join(transportDirectory,'objects',object),root:transportRoot,bytes:chunk.bytes,sha256:chunk.sha256});
      }
    }
    for(const [logical,source] of original){
      if(entries.has(logical)||!(/^(?:raw\/|compiled\/(?:physics\.f32|physics-mask\.u8|physics-groups\.json)$|entity-collision-policy\.json$)/.test(logical)))continue;
      const destination=logical.startsWith('raw/')?'render/'+logical.slice(4):logical.replace(/^compiled\//,'');
      const file=logical.startsWith('raw/')?path.join(renderDirectory,logical.slice(4)):path.join(directory,...logical.split('/'));
      await inventory.add({relativePath:`maps/${id}/${destination}`,sourcePath:file,root:mapRoot,bytes:source.bytes,sha256:source.sha256});
    }
  }
}
