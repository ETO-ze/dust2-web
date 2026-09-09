import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const args=process.argv.slice(2);assert.ok(args.every(a=>['--run','--plan'].includes(a)),'Unknown argument');
const release=JSON.parse(await fs.readFile('artifacts/deploy/gameplay-overlay.json','utf8'));
const files=release.files.filter(f=>f.path.startsWith('dist/')&&!f.path.endsWith('.gz'));
if(!args.includes('--run')){console.log(JSON.stringify({networkRequests:0,plan:'Verify changed public client/assets against packaged SHA-256',release:release.release,files:files.length,bytes:files.reduce((n,f)=>n+f.bytes,0)},null,2));}
else{
 const base='https://cs2.duskrain.cn/',health=await fetch(base+'health').then(r=>r.json());assert.equal(health.release,release.release);
 const report={release:release.release,startedAt:new Date().toISOString(),files:[]};let index=0;
 await Promise.all(Array.from({length:3},async()=>{
  while(index<files.length){const file=files[index++],url=new URL(file.path.slice(5),base);url.searchParams.set('v',file.sha256.slice(0,12));const response=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(90000)});assert.equal(response.status,200,file.path);const bytes=Buffer.from(await response.arrayBuffer());assert.equal(bytes.length,file.bytes,file.path+' bytes');assert.equal(createHash('sha256').update(bytes).digest('hex'),file.sha256,file.path+' hash');report.files.push({path:file.path,bytes:bytes.length,sha256:file.sha256});if(report.files.length%20===0)console.log(`Verified ${report.files.length}/${files.length}`);}
 }));
 report.finishedAt=new Date().toISOString();report.ok=true;await fs.writeFile('artifacts/deploy/gameplay-public-assets.json',JSON.stringify(report,null,2));console.log(JSON.stringify({ok:true,release:report.release,files:report.files.length,bytes:report.files.reduce((n,f)=>n+f.bytes,0)}));
}
