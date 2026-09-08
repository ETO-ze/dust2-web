import assert from 'node:assert/strict';
import fs from 'node:fs';
import WebSocket from 'ws';

const base=new URL(process.argv[2]||'https://duskrain.cn/dust2/');
const wsUrl=new URL('ws',base);wsUrl.protocol=base.protocol==='https:'?'wss:':'ws:';
const room=`QA${Date.now().toString(36).slice(-6)}`.toUpperCase();
const peers=[];
const results={base:base.href,at:new Date().toISOString(),checks:[]};
async function peer(name,team,primary){
  const socket=new WebSocket(wsUrl,{origin:base.origin}),messages=[];
  socket.on('message',data=>messages.push(JSON.parse(data)));
  await new Promise((resolve,reject)=>{socket.once('open',resolve);socket.once('error',reject);});
  const p={socket,messages,send:msg=>socket.send(JSON.stringify(msg)),wait:async pred=>{
    const start=Date.now();
    while(Date.now()-start<15000){const found=messages.find(pred);if(found)return found;await new Promise(r=>setTimeout(r,25));}
    throw new Error('Timed out waiting for public WebSocket response');
  }};
  peers.push(p);p.send({type:'join',name,team,room,mode:'deathmatch',bots:0,primary});
  p.welcome=await p.wait(m=>m.type==='welcome');return p;
}
try{
  const response=await fetch(base);assert.equal(response.status,200);
  const html=await response.text();assert.match(html,/DUST/);
  const assets=[...html.matchAll(/(?:src|href)="([^"\s]+\.(?:js|css))"/g)].map(m=>m[1]);
  assert.ok(assets.length>=2);
  for(const asset of assets){const res=await fetch(new URL(asset,base),{method:'HEAD'});assert.equal(res.status,200,asset);}
  results.checks.push('HTTPS page and built JS/CSS return 200');
  const health=await (await fetch(new URL('health',base))).json();assert.equal(health.ok,true);
  results.release=health.release;
  for(const asset of ['sw.js','manifest.webmanifest','icons/icon-192.png','assets/weapons/cs2-skins/optional/awp-dragon-lore.glb']){
    const response=await fetch(new URL(asset,base),{method:'HEAD'});assert.equal(response.status,200,asset);
    if(asset==='sw.js')assert.match(response.headers.get('content-type'),/javascript/);
  }
  results.checks.push('PWA worker, install manifest, icon and optional skin are reachable under /dust2/');
  const a=await peer('QA-one','T'),b=await peer('QA-two','CT','awp');
  assert.equal(a.welcome.room,b.welcome.room);assert.notEqual(a.welcome.id,b.welcome.id);
  const snap=await a.wait(m=>m.type==='snapshot'&&m.players?.length===2);
  const before=snap.players.find(p=>p.id===a.welcome.id);
  const defender=snap.players.find(p=>p.id===b.welcome.id);
  assert.ok(before.inventory.includes('pistol'));assert.ok(defender.inventory.includes('usp'));
  assert.equal(defender.weapon,'awp');assert.ok(defender.inventory.includes('knife'));
  results.checks.push('Pregame AWP selection and distinct T Glock / CT USP inventories synchronize');
  await b.wait(m=>m.type==='snapshot'&&m.players?.some(p=>p.id===a.welcome.id));
  results.checks.push('Two independent WSS clients see each other in one room');
  let seq=0;
  const loop=setInterval(()=>a.send({type:'input',seq:++seq,forward:1,right:0,yaw:before.yaw,pitch:0,slot:1}),33);
  await new Promise(r=>setTimeout(r,900));clearInterval(loop);
  a.send({type:'input',seq:++seq,forward:0,right:0,yaw:before.yaw,pitch:0,slot:1});
  const moved=await b.wait(m=>m.type==='snapshot'&&m.players?.some(p=>p.id===a.welcome.id&&Math.hypot(p.x-before.x,p.z-before.z)>.25));
  results.movementMetres=Math.round(Math.hypot(moved.players.find(p=>p.id===a.welcome.id).x-before.x,moved.players.find(p=>p.id===a.welcome.id).z-before.z)*100)/100;
  results.checks.push('Server-authoritative movement arrives at the other client');
  a.send({type:'buy',weapon:'awp'});
  const equipped=await a.wait(m=>m.type==='snapshot'&&m.players?.some(p=>p.id===a.welcome.id&&p.weapon==='awp'));
  const ammo=equipped.players.find(p=>p.id===a.welcome.id).ammo;
  await new Promise(r=>setTimeout(r,450));
  a.send({type:'input',seq:++seq,forward:0,right:0,yaw:before.yaw,pitch:0,slot:1,fire:true});
  await b.wait(m=>m.type==='snapshot'&&m.players?.some(p=>p.id===a.welcome.id&&p.weapon==='awp'&&p.ammo<ammo));
  results.checks.push('Purchase and firing ammo changes synchronize across WSS');
  a.send({type:'equipSkin',weapon:'awp',skin:'awp-dragon-lore'});
  await a.wait(m=>m.type==='skinEquipped'&&m.skin==='awp-dragon-lore');
  await b.wait(m=>m.type==='snapshot'&&m.players?.some(p=>p.id===a.welcome.id&&p.skinId==='awp-dragon-lore'));
  results.checks.push('Optional skin receives authoritative ACK and synchronizes to the second WSS client');
  const ground=await a.wait(m=>m.type==='snapshot'&&m.players?.some(p=>p.id===a.welcome.id&&p.grounded));
  const oldY=ground.players.find(p=>p.id===a.welcome.id).y;
  a.send({type:'input',seq:++seq,forward:0,right:0,yaw:before.yaw,pitch:0,slot:1,fire:false,jump:false,jumpId:1});
  const airborne=await b.wait(m=>m.type==='snapshot'&&m.players?.some(p=>p.id===a.welcome.id&&!p.grounded&&p.y>oldY+.1));
  assert.ok(airborne);results.checks.push('Released short jump event survives public 30 Hz synchronization');
  const now=Date.now();a.send({type:'ping',time:now});await a.wait(m=>m.type==='pong'&&m.time===now);results.roundTripMs=Date.now()-now;
  results.ok=true;
}finally{
  for(const p of peers)p.socket.close();
}
fs.mkdirSync(new URL('../output/',import.meta.url),{recursive:true});
fs.writeFileSync(new URL('../output/public-verification.json',import.meta.url),JSON.stringify(results,null,2));
console.log(JSON.stringify(results,null,2));
