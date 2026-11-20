// Exercise the local review gateway with its sealed packs. No public games are contacted.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import http from 'node:http';
import {fileURLToPath} from 'node:url';
import {WebSocket} from 'ws';
import {CLIENT_BUILD, RULES_VERSION, ASSET_VERSION} from '../../shared/online-build.js';
import {PERFORMANCE_MAPS} from '../../shared/performance-map-pool.js';
import {privateConfig} from '../../client/private-game-config.js';
import {transportObjectName} from './transport-schema.mjs';

const child = spawn(process.execPath, ['server/performance-maps.js'], {
  cwd:fileURLToPath(new URL('../../', import.meta.url)), env:{...process.env, PORT:'0'},
  stdio:['ignore','pipe','inherit','ipc'], windowsHide:true
});
const closed = once(child, 'exit'), sockets = [];
const digest = data => createHash('sha256').update(data).digest('hex');
const timeout = AbortSignal.timeout(30000);
try {
  let log = '', origin;
  while (!origin) {
    const [data] = await once(child.stdout, 'data', {signal:timeout});
    log += data;
    origin = /http:\/\/127\.0\.0\.1:\d+/.exec(log)?.[0];
  }
  const get = async path => { const r=await fetch(new URL(path, origin),{signal:timeout});assert.equal(r.status,200,path);return r; };
  const rawStatus = path => new Promise((resolve,reject) => http.get({hostname:'127.0.0.1',port:new URL(origin).port,path,signal:timeout},
    r=>{r.resume();resolve(r.statusCode);}).on('error',reject));
  const {maps} = await (await get('/perf/graphics.json')).json();
  assert.deepEqual(maps.map(map=>map.id), PERFORMANCE_MAPS.map(map=>map.id));
  assert.ok((await (await get('/perf/ui/screen.css')).headers.get('content-type')).startsWith('text/css'));
  await get('/perf/mode-previews/previews.json');
  for (const path of ['/perf/ui/../catalog.json','/perf/ui/%2e%2e/catalog.json','/perf/ui/no.wrong','/perf/mode-previews/dummy.json'])
    assert.equal(await rawStatus(path),404,path);
  assert.deepEqual((await (await get('/perf/health')).json()).workers,[]);
  for (const map of maps) {
    await get(map.performanceURL);
    if (!map.qualityURL) { assert.equal(await rawStatus('/perf/quality/play/'+map.id+'/'),404); continue; }
    assert.equal(map.qualitySource,'local');await get(map.qualityURL);
    const base='/perf/quality/maps/'+map.id+'/';
    const manifest=await (await get(base+'render-manifest.json')).json();
    const model=manifest.files.find(file=>file.path==='map.gltf');
    const gltfBytes=Buffer.from(await (await get(base+'render/map.gltf?v='+model.sha256)).arrayBuffer());
    assert.equal(digest(gltfBytes),model.sha256);
    const gltf=JSON.parse(gltfBytes);
    assert.ok(gltf.images.length>0);
    const entries=new Map(manifest.files.map(file=>[file.path,file]));
    for(const file of [...gltf.buffers,...gltf.images])assert.ok(entries.has(file.uri),file.uri);
    const sample=entries.get(gltf.images[0].uri);
    assert.equal(digest(Buffer.from(await (await get(base+'render/'+sample.path+'?v='+sample.sha256)).arrayBuffer())),sample.sha256);
    assert.equal(await rawStatus(base+'render/map.bin?v=wrong'),404);
    if(await rawStatus(base+'transport-manifest.json')===200){
      const transport=await (await get(base+'transport-manifest.json')).json();
      const file=transport.files.find(item=>item.path==='raw/map.gltf'), chunk=file.chunks[0];
      const block=await (await get(base+'transport/'+transportObjectName(file,chunk))).arrayBuffer();
      assert.equal(digest(Buffer.from(block)),chunk.sha256);
    }
    console.log(map.id, gltf.images.length+' 原图引用已核对');
  }
  assert.deepEqual((await (await get('/perf/health')).json()).workers,[]);
  const map=maps.find(m=>m.id==='de_mirage'&&m.qualityURL) || maps.find(m=>m.qualityURL);
  if(map){
    const configs=[];
    for(const path of [map.performanceURL,map.qualityURL]){
      const config=await (await get(path+'private-map.json')).json();
      configs.push(privateConfig(config, new URL(path,origin).href));
    }
    assert.equal(configs[0].mapSignature,configs[1].mapSignature);
    assert.equal(configs[0].flatOnly,true);assert.equal(configs[1].graphicsMode,'quality');
    let room;
    for(const cfg of configs){
      const socket=new WebSocket(cfg.socketURL);sockets.push(socket);
      await once(socket,'open',{signal:timeout});
      const inbound=once(socket,'message',{signal:timeout});
      socket.send(JSON.stringify({type:'join',name:'Mode review',mode:'deathmatch',bots:0,clientBuild:CLIENT_BUILD,
        rulesVersion:RULES_VERSION,assetVersion:ASSET_VERSION,mapId:map.id,mapSignature:cfg.mapSignature,
        physicsSha256:cfg.physicsSha256,...(room?{room,existing:true}: {})}));
      const [payload]=await inbound,result=JSON.parse(payload);
      assert.equal(result.type,'welcome',JSON.stringify(result));
      if(room)assert.equal(result.room,room);room=result.room;
    }
    const health=async()=>await (await get(map.qualityURL+'health')).json();
    assert.equal((await health()).humans,2);
    await Promise.all(sockets.map(s=>{const done=once(s,'close',{signal:timeout});s.close();return done;}));
    for(let i=0;i<20&&(await health()).rooms;i++)await new Promise(resolve=>setTimeout(resolve,50));
    assert.equal((await health()).rooms,0);
    console.log(map.id+' 高画质 / 高帧率同房加入、退出通过');
  }
} finally {
  for(const socket of sockets)socket.terminate();
  child.disconnect();await closed;
}
