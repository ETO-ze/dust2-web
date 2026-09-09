import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const args=process.argv.slice(2);assert.ok(args.every(a=>['--run','--plan'].includes(a)||a.startsWith('--manifest=')||a.startsWith('--output=')),'Unknown argument');
const manifest=args.find(a=>a.startsWith('--manifest='))?.slice(11)||'artifacts/deploy/gameplay-overlay.json';
const output=args.find(a=>a.startsWith('--output='))?.slice(9)||'artifacts/deploy/gameplay-public-assets.json';
const release=JSON.parse(await fs.readFile(manifest,'utf8'));
const files=release.files.filter(f=>f.path.startsWith('dist/')&&!f.path.endsWith('.gz'));
if(!args.includes('--run')){console.log(JSON.stringify({networkRequests:0,plan:'Verify changed public client/assets against packaged SHA-256',release:release.release,files:files.length,bytes:files.reduce((n,f)=>n+f.bytes,0)},null,2));}
else{
 const base='https://cs2.duskrain.cn/',health=await fetch(base+'health').then(r=>r.json());assert.equal(health.release,release.release);
 const previous=await fs.readFile(output,'utf8').then(JSON.parse).catch(()=>null);
 const expected=new Map(files.map(file=>[file.path,file]));
 const verified=previous?.release===release.release?(previous.files||[]).filter(file=>expected.get(file.path)?.sha256===file.sha256&&expected.get(file.path)?.bytes===file.bytes):[];
 const report={release:release.release,startedAt:previous?.release===release.release?previous.startedAt:new Date().toISOString(),files:verified,errors:[],ok:false};
 const done=new Set(verified.map(file=>file.path)),pending=files.filter(file=>!done.has(file.path));let index=0,persist=Promise.resolve();
 const save=()=>{const data=JSON.stringify(report,null,2);persist=persist.then(()=>fs.writeFile(output,data));return persist;};
 await Promise.all(Array.from({length:3},async()=>{
  while(index<pending.length){const file=pending[index++],url=new URL(file.path.slice(5),base);url.searchParams.set('v',file.sha256.slice(0,12));
   try{const response=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(180000)});assert.equal(response.status,200,file.path);const bytes=Buffer.from(await response.arrayBuffer());assert.equal(bytes.length,file.bytes,file.path+' bytes');assert.equal(createHash('sha256').update(bytes).digest('hex'),file.sha256,file.path+' hash');report.files.push({path:file.path,bytes:bytes.length,sha256:file.sha256});if(report.files.length%20===0){console.log(`Verified ${report.files.length}/${files.length}`);await save();}}
   catch(error){report.errors.push({path:file.path,error:String(error.message)});console.error(file.path+': '+error.message);}
  }
 }));
 report.finishedAt=new Date().toISOString();report.ok=report.files.length===files.length&&!report.errors.length;await save();
 console.log(JSON.stringify({ok:report.ok,release:report.release,files:report.files.length,bytes:report.files.reduce((n,f)=>n+f.bytes,0),errors:report.errors}));if(!report.ok)process.exitCode=1;
}
