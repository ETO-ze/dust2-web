import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {once} from 'node:events';
import WebSocket from 'ws';
const root=process.env.DUSTII_BUILD_ROOT||'D:/CodexBuilds/dust2-online-1.2.0';
const release=JSON.parse(fs.readFileSync(root+'/overlay.json'));
const base='https://cs2.duskrain.cn/',peers=[],report={at:new Date().toISOString(),release:release.release,checks:[]};
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const hash=b=>createHash('sha256').update(b).digest('hex');
async function peer(name,team,room){
 const ws=new WebSocket('wss://cs2.duskrain.cn/ws',{origin:base.slice(0,-1)}),messages=[];peers.push(ws);
 ws.on('message',raw=>{messages.push(JSON.parse(raw));if(messages.length>300)messages.shift();});await once(ws,'open');
 const send=m=>ws.send(JSON.stringify(m));
 const wait=async pred=>{const until=Date.now()+15000;while(Date.now()<until){const value=messages.find(pred);if(value)return value;await pause(25);}throw Error('WSS verification timeout');};
 send({type:'join',name,team,room,mode:'deathmatch',bots:0,primary:'ak',shotProtocol:1,movementProtocol:1});
 const welcome=await wait(m=>m.type==='welcome');assert.equal(welcome.clientBuild,'1.2.0');assert.equal(welcome.assetVersion,'5a82c6eead18b7e0');assert.equal(welcome.tickRate,30);assert.equal(welcome.snapshotRate,15);
 return {send,wait,welcome};
}
try{
 report.healthBefore=await(await fetch(base+'health')).json();assert.equal(report.healthBefore.release,release.release);
 for(const [name,expected] of Object.entries(release.fileHashes).filter(([n])=>n.startsWith('dist/')&&!n.endsWith('.gz'))){
  const r=await fetch(base+(name==='dist/index.html'?'':name.slice(5)));assert.equal(r.status,200,name);assert.equal(hash(Buffer.from(await r.arrayBuffer())),expected,name);
 }
 report.checks.push('public HTML, JS and both APK metadata match staged SHA-256');
 const manifest=await(await fetch(base+'assets/asset-manifest-mobile.json')).json();report.assetManifestVersion=manifest.version;
 const a=await peer('Mobile 1.2 release QA','T'),b=await peer('Desktop 1.2 release QA','CT',a.welcome.room);report.room=a.welcome.room;
 const snap=await a.wait(m=>m.type==='snapshot'&&m.players.length===2),self=snap.players.find(p=>p.id===a.welcome.id);assert.ok(self.alive);
 a.send({type:'input',seq:1,slot:1,fire:true,shotId:1,yaw:self.yaw,pitch:0,forward:0,right:0});
 const shot=await a.wait(m=>m.type==='snapshot'&&m.players.some(p=>p.id===self.id&&p.shotAck===1&&p.ammo<self.ammo));
 a.send({type:'input',seq:2,slot:1,fire:false,yaw:self.yaw,pitch:0,forward:0,right:0});
 report.shot={before:self.ammo,after:shot.players.find(p=>p.id===self.id).ammo};
 await b.wait(m=>m.type==='snapshot'&&m.players.some(p=>p.id===self.id&&p.ammo<self.ammo));
 report.checks.push('two real WSS peers join same room; authoritative fire/ammo reaches both');
}finally{for(const ws of peers)ws.close();}
await pause(1500);report.healthAfter=await(await fetch(base+'health')).json();
assert.equal(report.healthAfter.release,release.release);report.ok=true;
fs.writeFileSync(root+'/production-audit.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
