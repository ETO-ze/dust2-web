#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {SKINS} from '../../shared/skins.js';
import {UTILITY_ASSETS} from '../../shared/utility-assets.js';
import {AGENT_ASSETS} from '../../shared/agent-assets.js';
import {AGENT_ARM_ASSETS} from '../../shared/agent-arm-assets.js';
import {ReleaseInventory,addAssetManifests,addMaps,toPublicManifest,MAP_IDS,validateReleaseId,writeLocalMetadata} from './release-manifest.mjs';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
export function parseArguments(args){
  const values={},booleans=new Set(['dry-run','help']);
  for(let i=0;i<args.length;i++){
    const name=args[i].replace(/^--/,'');
    if(!args[i].startsWith('--')||!['release-id','output','public-root','map-root','transport-root','maps',...booleans].includes(name))throw Error('Unknown argument');
    if(Object.hasOwn(values,name))throw Error('Duplicate argument');
    if(booleans.has(name))values[name]=true;
    else{if(!args[i+1]||args[i+1].startsWith('--'))throw Error(`Missing value for ${name}`);values[name]=args[++i];}
  }
  return values;
}
export async function collectOptionalAssets(publicRoot){
  const assets=[];
  const add=(name,bytes,sha256)=>assets.push({path:name,bytes,sha256});
  for(const skin of SKINS){add(skin.model,skin.bytes,skin.sha256);add(skin.preview,skin.previewBytes,skin.previewSha256);if(skin.animation)add(skin.animation.model,skin.animation.bytes,skin.animation.sha256);}
  for(const asset of Object.values(UTILITY_ASSETS))add(asset.model,asset.bytes,asset.sha256);
  for(const asset of Object.values(AGENT_ASSETS)){add(asset.model,asset.bytes,asset.sha256);add(asset.preview.file,asset.preview.bytes,asset.preview.sha256);}
  for(const asset of Object.values(AGENT_ARM_ASSETS))add(asset.model,asset.bytes,asset.sha256);
  const music=JSON.parse(await fs.readFile(path.join(publicRoot,'assets/audio/music/manifest.json'),'utf8'));
  for(const kit of Object.values(music.kits))for(const cue of Object.values(kit.cues))add('assets/audio/music/optional/'+cue.file,cue.bytes,cue.sha256);
  return assets;
}
export async function buildRelease(options){
  const releaseId=validateReleaseId(options['release-id']),output=path.resolve(options.output||path.join(repo,'artifacts','cdn',releaseId));
  const publicRoot=path.resolve(options['public-root']||path.join(repo,'public'));
  const mapRoot=path.resolve(options['map-root']||'E:/CodexBuilds/dust2-map-library');
  const transportRoot=path.resolve(options['transport-root']||'D:/CodexBuilds/dust2-loading-transport/package');
  const mapIds=options.maps?options.maps.split(','):MAP_IDS;
  const inventory=new ReleaseInventory(releaseId);
  await addAssetManifests(inventory,{publicRoot,extraAssets:await collectOptionalAssets(publicRoot)});
  await addMaps(inventory,{mapRoot,transportRoot,generatedRoot:path.join(output,'generated'),mapIds});
  const local=inventory.manifest(),remote=toPublicManifest(local);
  await fs.mkdir(output,{recursive:true});
  await writeLocalMetadata(path.join(output,'release-local-manifest.json'),JSON.stringify(local,null,2)+'\n');
  await writeLocalMetadata(path.join(output,'release-manifest.json'),JSON.stringify(remote,null,2)+'\n');
  return {releaseId,fileCount:local.fileCount,totalBytes:local.totalBytes,mapIds,dryRun:true,uploaded:false};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const options=parseArguments(process.argv.slice(2));
    if(options.help)console.log('node scripts/cdn/build-release.mjs --release-id <immutable-id> [--output <local-dir>] [--maps de_dust2,de_mirage,de_inferno] [--public-root <public-dir>] [--map-root <library-dir>] [--transport-root <package-dir>] [--dry-run]\nOnly local manifests and small generated metadata are written. No network upload.');
    else console.log(JSON.stringify(await buildRelease(options),null,2));
  }catch(error){console.error(error.message);process.exitCode=1;}
}
