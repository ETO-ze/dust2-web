import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {WebSocket} from 'ws';
import assert from 'node:assert/strict';
import {CLIENT_BUILD,RULES_VERSION,ASSET_VERSION} from '../../shared/online-build.js';
import {PERFORMANCE_MAPS} from '../../shared/performance-map-pool.js';
const root=path.resolve(process.argv[2]),reports=[];
for(const {id} of PERFORMANCE_MAPS){
 const child=spawn(process.execPath,['server/private-map-server.js'],{windowsHide:true,env:{...process.env,DUSTII_PRIVATE_MAP_DIRECTORY:path.join(root,id),DUSTII_PRIVATE_MAP_ID:id,HOST:'127.0.0.1',PORT:'0',DUSTII_GRID_VISION:'1'},stdio:['ignore','pipe','inherit']});
 let socket=null;
 try{
  const info=await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(Error('Worker startup timed out')),75000);let buf='';
   child.stdout.on('data',data=>{buf+=data;for(const line of buf.split('\n')){try{const msg=JSON.parse(line);if(msg.port){clearTimeout(timer);resolve(msg);}}catch{}}});child.once('exit',()=>{clearTimeout(timer);reject(Error('Worker exited'));});
  });
  const ws=new WebSocket('ws://127.0.0.1:'+info.port+'/ws');socket=ws;
  const joined=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('No complete snapshot')),10000);let welcome=null;
   ws.on('message',data=>{const msg=JSON.parse(data);if(msg.type==='welcome')welcome=msg;
    if(msg.type==='error'){clearTimeout(timer);reject(Error(msg.message));}
    if(msg.type==='snapshot'&&welcome&&msg.players?.length===10){clearTimeout(timer);resolve({map:id,signature:welcome.mapSignature,bots:msg.players.filter(p=>p.bot).length,players:msg.players.length,startRSS:info.rssMiB});}});
   ws.on('error',reject);
  });
  await once(ws,'open');
  const config=await fetch('http://127.0.0.1:'+info.port+'/private-map.json').then(r=>r.json());
  ws.send(JSON.stringify({type:'join',name:'Perf QA',clientBuild:CLIENT_BUILD,rulesVersion:RULES_VERSION,assetVersion:ASSET_VERSION,mapId:id,mapSignature:config.mapSignature,physicsSha256:config.physicsSha256,bots:9,mode:'deathmatch',team:'CT'}));
  const result=await joined;assert.equal(result.signature,config.mapSignature);assert.equal(result.bots,9);
  ws.close();await once(ws,'close');socket=null;
  let health;
  for(let i=0;i<30;i++){health=await fetch('http://127.0.0.1:'+info.port+'/health').then(r=>r.json());if(!health.rooms&&!health.humans&&!health.players)break;await new Promise(r=>setTimeout(r,100));}
  assert.equal(health.rooms+health.humans+health.players,0);reports.push(result);console.log(JSON.stringify(result));
 }finally{socket?.terminate();child.kill();if(child.exitCode===null)await once(child,'exit');}
}
if(process.argv[3])fs.writeFileSync(process.argv[3],JSON.stringify(reports,null,2));
