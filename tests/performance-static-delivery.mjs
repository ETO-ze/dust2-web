import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {gzipSync} from 'node:zlib';

test('map gateway revalidates static files separately for gzip and identity',async t=>{
  const root=await mkdtemp(path.join(tmpdir(),'dust2-static-'));
  await mkdir(path.join(root,'assets'));
  const body='client bundle fixture '.repeat(120);
  await Promise.all([
    writeFile(path.join(root,'assets/bundle.js'),body),
    writeFile(path.join(root,'assets/bundle.js.gz'),gzipSync(body)),
    writeFile(path.join(root,'catalog.json'),'{"maps":[]}'),
  ]);
  const child=spawn(process.execPath,['server/performance-maps.js'],{env:{...process.env,PORT:'0',PERF_MAP_ROOT:root,PERF_GAME_DIST:root},stdio:['ignore','pipe','inherit','ipc']});
  const closed=once(child,'exit');
  t.after(async()=>{if(child.connected)child.disconnect();await closed;await rm(root,{recursive:true,force:true});});
  const [output]=await once(child.stdout,'data',{signal:AbortSignal.timeout(15000)});
  const url=output.toString().match(/http:\/\/127\.0\.0\.1:\d+\/perf\//)[0]+'assets/bundle.js';
  const get=(encoding,etag)=>fetch(url,{headers:{'Accept-Encoding':encoding,...(etag?{'If-None-Match':etag}:{})}});
  const compressed=await get('br, gzip');
  assert.equal(compressed.headers.get('content-encoding'),'gzip');
  assert.equal(compressed.headers.get('vary'),'Accept-Encoding');
  assert.equal(await compressed.text(),body);
  const etag=compressed.headers.get('etag');
  const hit=await get('gzip',etag);
  assert.equal(hit.status,304);assert.equal((await hit.arrayBuffer()).byteLength,0);
  const plain=await get('gzip;q=0, identity',etag);
  assert.equal(plain.status,200);assert.equal(plain.headers.get('content-encoding'),null);
  assert.notEqual(plain.headers.get('etag'),etag);assert.equal(await plain.text(),body);
});