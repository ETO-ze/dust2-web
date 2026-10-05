import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {validateDownloadConfig} from '../../shared/download-config.js';

export function createCloudflarePlan({releaseId,bucket='dustii-downloads',hostname='downloads.duskrain.cn',zoneId=null,
 origins=['https://cs2.duskrain.cn','https://cs2.duskrain.cn:8443']}={}){
 if(typeof releaseId!=='string'||! /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(releaseId))throw Error('Invalid releaseId');
 if(typeof bucket!=='string'||! /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket))throw Error('Invalid bucket');
 if(typeof hostname!=='string'||hostname.length>253||!hostname.split('.').every(label=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))||!hostname.includes('.'))throw Error('Invalid hostname');
 if(zoneId!==null&&!/^[a-f0-9]{32}$/.test(zoneId))throw Error('Invalid zoneId');
 if(!Array.isArray(origins)||origins.length===0)throw Error('At least one origin is required');
 const allowedOrigins=[...new Set(origins)].map(origin=>{
  const url=new URL(origin);
  if(url.protocol!=='https:'||url.origin!==origin||url.username||url.password)throw Error('Invalid production origin');
  return origin;
 });
 const base=`https://${hostname}/releases/${releaseId}/`;
 const downloadConfig=validateDownloadConfig({schemaVersion:1,assetBaseURL:base+'assets/',mapBaseURL:base+'maps/',fallbackToGameServer:false},allowedOrigins[0]);
 return {
  schemaVersion:1,mode:'plan-only',releaseId,
  placement:{requested:'apac',guaranteedHongKong:false},
  createBucket:{name:bucket,locationHint:'apac',storageClass:'Standard'},
  cors:{rules:[{id:'dustii-read-only',allowed:{methods:['GET','HEAD'],origins:allowedOrigins,headers:['Range','If-None-Match']},
   exposeHeaders:['Content-Length','Content-Range','Accept-Ranges','ETag','Content-Encoding','CF-Cache-Status'],maxAgeSeconds:3600}]},
  customDomain:{domain:hostname,zoneId,enabled:false,minTLS:'1.2'},
  cacheRule:{description:'Cache immutable Dust II release objects',action:'set_cache_settings',
   expression:`(http.host eq "${hostname}" and starts_with(http.request.uri.path, "/releases/"))`,
   action_parameters:{cache:true}},
  objectHeaders:{cacheControl:'public, max-age=31536000, immutable, no-transform',gzipContentType:'application/octet-stream',gzipContentEncoding:null},
  proposedDownloadConfig:downloadConfig,
  proposedOperatorEnvironment:{DUST2_ASSET_DOWNLOAD_BASE:downloadConfig.assetBaseURL,DUSTII_MAP_DOWNLOAD_BASE:downloadConfig.mapBaseURL,DUST2_DOWNLOAD_FALLBACK:'false'},
  activationRequirements:['R2 subscription enabled','Complete existing DNS record export verified before changing nameservers',
   'Zone active in the R2 account; game records remain DNS-only','All objects and final manifest verified',
   'Public HTTP audit and actual browser/WSS tests passed','Private map review entry remains private'],
  rollout:{automaticActivation:false,deleteOldObjects:false,replaceExistingRulesets:false,
   instruction:'Append the dedicated hostname cache rule after reading the existing ruleset; retain all unrelated rules. Apply download configuration only after acceptance, and retain previous values for rollback.'}
 };
}

async function main(args){
 const options={};let output;
 for(let i=0;i<args.length;i++){
  const key=args[i];
  if(!['--release','--bucket','--hostname','--zone-id','--origin','--output'].includes(key)||!args[i+1]||args[i+1].startsWith('--'))throw Error('Usage: --release ID --output FILE [--bucket NAME] [--hostname HOST] [--zone-id ID] [--origin HTTPS_ORIGIN]');
  const value=args[++i];
  if(key==='--output')output=value;
  else if(key==='--origin')(options.origins??=[]).push(value);
  else options[{'--release':'releaseId','--bucket':'bucket','--hostname':'hostname','--zone-id':'zoneId'}[key]]=value;
 }
 if(!output)throw Error('--output is required');
 const plan=createCloudflarePlan(options);
 const file=resolve(output);await mkdir(dirname(file),{recursive:true});await writeFile(file,JSON.stringify(plan,null,2)+'\n');
 console.log(JSON.stringify({mode:plan.mode,releaseId:plan.releaseId,bucket:plan.createBucket.name,hostname:plan.customDomain.domain,placement:'apac',activation:false,output:file}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 main(process.argv.slice(2)).catch(error=>{console.error(error.message);process.exitCode=1;});
}
