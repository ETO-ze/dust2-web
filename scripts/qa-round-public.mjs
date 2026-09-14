import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {WebSocket} from 'ws';
import {once} from 'node:events';
const base='https://cs2.duskrain.cn/',release=JSON.parse(fs.readFileSync('artifacts/deploy/round-overlay.json','utf8'));
const hash=data=>createHash('sha256').update(data).digest('hex'),report={release:release.release,hashes:[]},peers=[];
async function peer(team,room){
 const ws=new WebSocket('wss://cs2.duskrain.cn/ws'),messages=[];ws.on('message',raw=>{messages.push(JSON.parse(raw));if(messages.length>300)messages.shift();});peers.push(ws);await once(ws,'open');
 const wait=async pred=>{const until=Date.now()+20000;while(Date.now()<until){const found=messages.find(pred);if(found)return found;await new Promise(r=>setTimeout(r,25));}throw Error('Public response timeout');};
 ws.send(JSON.stringify({type:'join',name:'Release QA '+team,team,mode:'defuse',bots:0,shotProtocol:1,...(room?{room}:{})}));return {ws,messages,wait,welcome:await wait(m=>m.type==='welcome')};
}
try{
 const health=await(await fetch(base+'health')).json();assert.equal(health.release,release.release);
 const targets=Object.keys(release.hashes).filter(p=>p==='dist/index.html'||p.endsWith('.js')&&p.startsWith('dist/')||p.endsWith('manifest.json')||p.endsWith('asset-manifest-mobile.json')||p.endsWith('smokegrenade_smoke_emit.mp3'));
 for(const name of targets){const res=await fetch(base+(name==='dist/index.html'?'':name.slice(5)));assert.equal(res.status,200);const actual=hash(Buffer.from(await res.arrayBuffer()));assert.equal(actual,release.hashes[name],name);report.hashes.push(name);}
 const a=await peer('CT'),b=await peer('T',a.welcome.room);report.room=a.welcome.room;
 for(const [p,side]of [[a,'CT'],[b,'T']]){const snapshot=await p.wait(m=>m.type==='snapshot'&&m.players?.some(q=>q.team===side&&q.botBuy==='手枪局'));assert.ok(snapshot.players.filter(q=>q.team!==side).every(q=>!Object.hasOwn(q,'botBuy')));}
 report.privateEconomy=true;
 const live=await a.wait(m=>m.type==='snapshot'&&m.round.phase==='live'),self=live.players.find(p=>p.id===a.welcome.id),ammo=self.ammo;
 a.ws.send(JSON.stringify({type:'input',seq:1,slot:2,fire:true,shotId:1,yaw:self.yaw,pitch:0,forward:0,right:0}));
 const fired=await a.wait(m=>m.type==='snapshot'&&m.players.some(p=>p.id===self.id&&p.shotAck===1&&p.ammo===ammo-1));
 assert.ok(fired);report.shot={from:ammo,to:ammo-1,ack:1};
 report.ok=true;
}finally{for(const ws of peers)ws.close();}
fs.writeFileSync('artifacts/qa/round-public.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
