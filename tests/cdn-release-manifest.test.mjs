import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {ReleaseInventory,addAssetManifests,addMaps,toPublicManifest,validateRelativePath,validateResourceKey,writeLocalMetadata,IMMUTABLE_CACHE} from '../scripts/cdn/release-manifest.mjs';
const sha=data=>createHash('sha256').update(data).digest('hex');
async function fixture(t){const directory=await fs.mkdtemp(path.join(os.tmpdir(),'dust2-cdn-manifest-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));return directory;}
async function write(root,name,data){const target=path.join(root,...name.split('/'));await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,data);return target;}
const dataEntry=(name,data)=>({path:name,bytes:Buffer.byteLength(data),sha256:sha(data)});

test('canonical paths reject traversal, encoded separators, secrets and non-resource trees',()=>{
  for(const name of ['../server/.env','assets/../secret.json','assets//a.glb','assets/%2e%2e/a.json','assets/evil\\x.json','assets/a?token=one','assets/a#x','C:/secret','assets/.env','assets/signing/private.json','assets/server/config.json'])assert.throws(()=>validateRelativePath(name));
  for(const key of ['releases/demo/server/index.js','releases/demo/maps/de_ancient/map.json','releases/demo/maps/de_dust2/ai-replay.json','releases/demo/assets/prepare_assets.py','releases/other/assets/file.glb'])assert.throws(()=>validateResourceKey(key,'demo'));
  assert.equal(validateResourceKey('releases/demo/maps/de_dust2/transport/'+ 'a'.repeat(64)+'.gz','demo'),'releases/demo/maps/de_dust2/transport/'+ 'a'.repeat(64)+'.gz');
});

test('inventory computes actual SHA, keeps original sources and public metadata omits local paths',async t=>{
  const root=await fixture(t),bytes=Buffer.from('compressed wire bytes'),source=await write(root,'objects/a.gz',bytes),i=new ReleaseInventory('test-20261004');
  await i.add({relativePath:'maps/de_dust2/transport/'+sha(bytes)+'.gz',sourcePath:source,root,bytes:bytes.length,sha256:sha(bytes)});
  const local=i.manifest(),remote=toPublicManifest({...local,extraSecret:'must not leak'});
  assert.equal(local.assets[0].sourcePath,await fs.realpath(source));assert.equal(remote.assets[0].sha256,sha(bytes));
  assert.equal(remote.assets[0].contentType,'application/octet-stream');assert.equal(remote.assets[0].cacheControl,IMMUTABLE_CACHE);
  assert.equal(Object.hasOwn(remote.assets[0],'contentEncoding'),false);assert.equal(Object.hasOwn(remote.assets[0],'sourcePath'),false);
  assert.equal(Object.hasOwn(remote,'sourceRoots'),false);assert.equal(Object.hasOwn(remote,'extraSecret'),false);assert.equal(remote.totalBytes,bytes.length);
  assert.equal(JSON.stringify(remote).includes(root),false);assert.deepEqual(await fs.readFile(source),bytes);
});

test('inventory fails on missing, changed, conflicting or out-of-root source bytes',async t=>{
  const root=await fixture(t),allowed=path.join(root,'allowed'),outside=await write(root,'outside.glb','outside'),a=await write(root,'allowed/a.glb','aaa'),b=await write(root,'allowed/b.glb','bbb'),i=new ReleaseInventory('test');
  await assert.rejects(i.add({relativePath:'assets/no.glb',sourcePath:path.join(root,'missing'),root:allowed}),/Missing resource/);
  await assert.rejects(i.add({relativePath:'assets/out.glb',sourcePath:outside,root:allowed}),/escapes/);
  await assert.rejects(i.add({relativePath:'assets/a.glb',sourcePath:a,root:allowed,bytes:4,sha256:sha('aaa')}),/size changed/);
  await assert.rejects(i.add({relativePath:'assets/a.glb',sourcePath:a,root:allowed,bytes:3,sha256:sha('bbb')}),/checksum changed/);
  await i.add({relativePath:'assets/a.glb',sourcePath:a,root:allowed});
  await assert.rejects(i.add({relativePath:'assets/a.glb',sourcePath:b,root:allowed}),/Conflicting/);
  await i.add({relativePath:'assets/a.glb',sourcePath:a,root:allowed});assert.equal(i.manifest().fileCount,1);
});

test('public manifests reject invalid delivery metadata and duplicate keys',()=>{
  const asset={key:'releases/test/assets/a.glb',bytes:1,sha256:'a'.repeat(64),contentType:'model/gltf-binary',cacheControl:IMMUTABLE_CACHE},local={schemaVersion:1,releaseId:'test',assets:[asset]};
  assert.throws(()=>toPublicManifest({...local,assets:[{...asset,contentEncoding:'gzip'}]}));
  assert.throws(()=>toPublicManifest({...local,assets:[{...asset,cacheControl:'public'}]}));
  assert.throws(()=>toPublicManifest({...local,assets:[{...asset,bytes:-1}]}));
  assert.throws(()=>toPublicManifest({...local,assets:[asset,asset]}),/Duplicate/);
});

test('generation refuses to write metadata into original source roots or replace an immutable output',async t=>{
  const root=await fixture(t),mapRoot=path.join(root,'library'),transportRoot=path.join(root,'transport');await write(mapRoot,'exports.json','[]');await fs.mkdir(transportRoot,{recursive:true});
  await assert.rejects(addMaps(new ReleaseInventory('test'),{mapRoot,transportRoot,generatedRoot:path.join(mapRoot,'generated'),mapIds:[]}),/outside source roots/);
  await assert.rejects(fs.stat(path.join(mapRoot,'generated')),e=>e.code==='ENOENT');
  const file=path.join(root,'generated.json');await writeLocalMetadata(file,'original');await writeLocalMetadata(file,'original');
  await assert.rejects(writeLocalMetadata(file,'changed'),/conflict/);assert.equal(await fs.readFile(file,'utf8'),'original');
});

test('asset manifests merge exact duplicate resources and include mobile variants without a tree walk',async t=>{
  const root=await fixture(t),publicRoot=path.join(root,'public');await write(publicRoot,'assets/a.glb','desktop');await write(publicRoot,'assets/mobile/a.glb','mobile');await write(publicRoot,'assets/prepare_assets.py','never uploaded');
  const desktop={files:[dataEntry('assets/a.glb','desktop')]},mobile={files:[dataEntry('assets/a.glb','desktop'),dataEntry('assets/mobile/a.glb','mobile')]};
  await write(publicRoot,'assets/asset-manifest.json',JSON.stringify(desktop));await write(publicRoot,'assets/asset-manifest-mobile.json',JSON.stringify(mobile));
  const i=new ReleaseInventory('test');await addAssetManifests(i,{publicRoot});const manifest=i.manifest();assert.equal(manifest.fileCount,4);assert.equal(manifest.assets.some(a=>a.key.endsWith('.py')),false);
  await write(publicRoot,'assets/asset-manifest-mobile.json',JSON.stringify({files:[dataEntry('assets/a.glb','changed')]}));
  await assert.rejects(addAssetManifests(new ReleaseInventory('test'),{publicRoot}),/size changed|checksum changed/);
});

test('map release binds transport to original source and retains only needed original images',async t=>{
  const root=await fixture(t),mapRoot=path.join(root,'library'),directory=path.join(mapRoot,'de_dust2/source'),transportRoot=path.join(root,'transport'),generatedRoot=path.join(root,'generated'),sourceSha256='1'.repeat(64);
  const gltf=Buffer.from('{"asset":{"version":"2.0"},"images":[{"uri":"retained.png"}]}'),png=Buffer.from('original retained PNG'),map=Buffer.from('{}'),nav=Buffer.from('[]'),policy=Buffer.from('{}');
  await write(directory,'raw/map.gltf',gltf);await write(directory,'raw/retained.png',png);await write(directory,'compiled/map.json',map);await write(directory,'compiled/nav.json',nav);await write(directory,'entity-collision-policy.json',policy);
  const raw=[dataEntry('raw/map.gltf',gltf),dataEntry('raw/retained.png',png)];
  await write(mapRoot,'exports.json',JSON.stringify([{id:'de_dust2',directory,sourceSha256,files:raw}]));
  await write(directory,'compiled/manifest.json',JSON.stringify({sourceSha256,files:[dataEntry('map.json',map),dataEntry('nav.json',nav)]}));
  const zipped=gzipSync(gltf),chunk={offset:0,bytes:zipped.length,sha256:sha(zipped),decodedBytes:gltf.length,decodedSha256:sha(gltf)},transport={schemaVersion:1,id:'de_dust2',sourceSha256,originalRenderGltfSha256:sha(gltf),files:[{...raw[0],encoding:'gzip-chunks',chunks:[chunk]}]};
  await write(transportRoot,'de_dust2/objects/'+sha(zipped)+'.gz',zipped);await write(transportRoot,'de_dust2/transport-manifest.json',JSON.stringify(transport));
  const i=new ReleaseInventory('test');await addMaps(i,{mapRoot,transportRoot,generatedRoot,mapIds:['de_dust2']});const published=toPublicManifest(i.manifest());
  assert.equal(published.assets.length,7);assert.equal(published.assets.some(a=>a.key.endsWith('/render/retained.png')),true);assert.equal(published.assets.some(a=>a.key.endsWith('/render/map.gltf')),false);
  const render=JSON.parse(await fs.readFile(path.join(generatedRoot,'de_dust2/render-manifest.json'),'utf8'));assert.equal(render.sourceSha256,sourceSha256);assert.deepEqual(render.files,raw.map(f=>({...f,path:f.path.slice(4)})));assert.equal(JSON.stringify(render).includes(directory),false);
  await write(transportRoot,'de_dust2/objects/'+sha(zipped)+'.gz',Buffer.alloc(zipped.length));
  await assert.rejects(addMaps(new ReleaseInventory('test'),{mapRoot,transportRoot,generatedRoot,mapIds:['de_dust2']}),/checksum changed/);
});

test('Inferno requires a source-bound equivalence proof and publishes the actual derived render',async t=>{
  const root=await fixture(t),mapRoot=path.join(root,'library'),directory=path.join(mapRoot,'de_inferno/source'),transportRoot=path.join(root,'transport'),generatedRoot=path.join(root,'generated'),sourceSha256='2'.repeat(64);
  const originalGltf=Buffer.from(JSON.stringify({asset:{version:'2.0'},buffers:[{uri:'map.bin'}],images:[{uri:'used.png'}],extras:{original:true}}));
  const derivedGltf=Buffer.from(JSON.stringify({asset:{version:'2.0'},buffers:[{uri:'map.bin'}],images:[{uri:'used.png'}]})),originalBin=Buffer.from('source index tuples'),derivedBin=Buffer.from('equivalent deduplicated tuples'),png=Buffer.from('identical pixels'),unused=Buffer.from('unused source image');
  for(const [name,data] of [['raw/map.gltf',originalGltf],['raw/map.bin',originalBin],['raw/used.png',png],['raw/unused.png',unused],['derived/raw/map.gltf',derivedGltf],['derived/raw/map.bin',derivedBin],['derived/raw/used.png',png],['compiled/map.json','{}'],['compiled/nav.json','[]'],['entity-collision-policy.json','{}']])await write(directory,name,data);
  const files=[dataEntry('raw/map.gltf',originalGltf),dataEntry('raw/map.bin',originalBin),dataEntry('raw/used.png',png),dataEntry('raw/unused.png',unused)];
  await write(mapRoot,'exports.json',JSON.stringify([{id:'de_inferno',directory,sourceSha256,files}]));await write(directory,'compiled/manifest.json',JSON.stringify({sourceSha256,files:[dataEntry('map.json','{}'),dataEntry('nav.json','[]')]}));
  const proof={schemaVersion:1,byteEquivalent:true,primitiveOrderPreserved:true,threshold512MiBPassed:true,source:{gltfSha256:sha(originalGltf),bufferSha256:sha(originalBin)},derived:{gltfSha256:sha(derivedGltf),bufferSha256:sha(derivedBin),bufferBytes:derivedBin.length}};
  await write(directory,'derived/render-equivalence.json',JSON.stringify(proof));
  const encoded=gzipSync(derivedGltf),transport={schemaVersion:1,id:'de_inferno',sourceSha256,originalRenderGltfSha256:sha(derivedGltf),files:[{...dataEntry('raw/map.gltf',derivedGltf),encoding:'gzip-chunks',chunks:[{offset:0,bytes:encoded.length,sha256:sha(encoded),decodedBytes:derivedGltf.length,decodedSha256:sha(derivedGltf)}]}]};
  await write(transportRoot,'de_inferno/transport-manifest.json',JSON.stringify(transport));await write(transportRoot,'de_inferno/objects/'+sha(encoded)+'.gz',encoded);
  const inventory=new ReleaseInventory('test');await addMaps(inventory,{mapRoot,transportRoot,generatedRoot,mapIds:['de_inferno']});const published=inventory.manifest();
  assert.equal(published.assets.some(a=>a.key.endsWith('/render/unused.png')),false);assert.equal(published.assets.find(a=>a.key.endsWith('/render/map.bin')).sha256,sha(derivedBin));
  const render=JSON.parse(await fs.readFile(path.join(generatedRoot,'de_inferno/render-manifest.json'),'utf8'));assert.equal(render.files.find(f=>f.path==='map.gltf').sha256,sha(derivedGltf));
  await write(directory,'derived/render-equivalence.json',JSON.stringify({...proof,byteEquivalent:false}));
  await assert.rejects(addMaps(new ReleaseInventory('test'),{mapRoot,transportRoot,generatedRoot,mapIds:['de_inferno']}),/Unproven/);
  await write(directory,'derived/render-equivalence.json',JSON.stringify(proof));await write(directory,'derived/raw/map.bin','modified');
  await assert.rejects(addMaps(new ReleaseInventory('test'),{mapRoot,transportRoot,generatedRoot,mapIds:['de_inferno']}),/checksum changed/);
});
