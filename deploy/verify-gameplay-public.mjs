// Normal public protocol only. No arguments performs zero network requests.
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import fs from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import WebSocket from 'ws';
import {DEFAULT_SKINS} from '../shared/skins.js';

const args=process.argv.slice(2),run=args.includes('--run'),selfTest=args.includes('--self-test');
const release=args.find(a=>a.startsWith('--release='))?.slice(10);
assert.ok(!run||!selfTest,'Choose --run or --self-test');
assert.ok(args.every(a=>['--run','--plan','--self-test'].includes(a)||a.startsWith('--release=')),'Unknown argument');
const production=new URL('https://cs2.duskrain.cn/');
const report={startedAt:new Date().toISOString(),base:production.href,release,mode:selfTest?'local':'public',checks:[],peers:[]};
const peers=[];let app;
const pass=(name,details={})=>{report.checks.push({name,...details});console.log(`PASS ${name}`);};
const player=(message,id)=>message.players?.find(p=>p.id===id);

class Peer {
 constructor(url,origin){
  this.socket=new WebSocket(url,{origin});this.messages=[];this.serial=0;this.seq=0;this.latest=null;this.lastBuy=0;
  this.state={forward:0,right:0,yaw:0,pitch:1.45,slot:1,fire:false,fire2:false,cancelGrenade:false};
  this.socket.on('message',raw=>{let m;try{m=JSON.parse(raw);}catch{return;}this.messages.push({n:++this.serial,m});if(this.messages.length>700)this.messages.shift();if(m.type==='snapshot')this.latest=m;});
  this.socket.on('error',e=>{this.error=e.message;});this.socket.on('close',(code,reason)=>{this.closed={code,reason:reason.toString()};});
 }
 mark(){return this.serial;}
 send(m){assert.equal(this.socket.readyState,WebSocket.OPEN,'Socket remains open');this.socket.send(JSON.stringify(m));}
 input(changes={}){Object.assign(this.state,changes);this.send({type:'input',seq:++this.seq,...this.state});}
 async wait(predicate,after=this.mark(),label='response'){
  const until=Date.now()+8000;
  while(Date.now()<until){const found=this.messages.find(o=>o.n>after&&predicate(o.m));if(found)return found.m;
   if(this.closed)throw Error(`${label}: socket closed ${this.closed.code}`);if(this.error)throw Error(`${label}: ${this.error}`);await delay(12);}
  throw Error(`Timed out: ${label}`);
 }
 async close(){
  clearInterval(this.timer);if(this.socket.readyState===WebSocket.CLOSED)return;
  await new Promise(resolve=>{const timeout=setTimeout(()=>{this.socket.terminate();resolve();},2500);this.socket.once('close',()=>{clearTimeout(timeout);resolve();});if(this.socket.readyState===WebSocket.OPEN)this.socket.close(1000,'Gameplay verification complete');else this.socket.terminate();});
 }
}

async function connect(base,team,room){
 const url=new URL('ws',base);url.protocol=base.protocol==='https:'?'wss:':'ws:';
 const p=new Peer(url,base.origin);peers.push(p);
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Socket open timeout')),8000);p.socket.once('open',()=>{clearTimeout(timer);resolve();});p.socket.once('error',e=>{clearTimeout(timer);reject(e);});});
 p.send({type:'join',room,name:`Gameplay QA ${team}`,mode:'deathmatch',bots:0,team,primary:'awp',skins:DEFAULT_SKINS});
 const joined=await p.wait(m=>m.type==='welcome'||m.type==='error',0,'join');assert.equal(joined.type,'welcome',JSON.stringify(joined));
 p.id=joined.id;p.team=team;p.welcome=joined;report.peers.push({id:p.id,team});
 const snap=await p.wait(m=>m.type==='snapshot'&&player(m,p.id),0,'initial snapshot');p.state.yaw=player(snap,p.id).yaw;
 p.timer=setInterval(()=>{if(p.socket.readyState===WebSocket.OPEN)p.input();},50);return p;
}
async function observe(observer,owner,predicate,after=observer.mark(),label='player state'){
 const snap=await observer.wait(m=>m.type==='snapshot'&&player(m,owner.id)&&predicate(player(m,owner.id),m),after,label);return player(snap,owner.id);
}
async function buy(owner,observer,weapon){
 await delay(Math.max(0,owner.lastBuy+350-Date.now()));const mark=owner.mark(),seen=observer.mark();owner.lastBuy=Date.now();owner.send({type:'buy',weapon});
 const ack=await owner.wait(m=>m.type==='purchase'||m.type==='error',mark,`buy ${weapon}`);assert.equal(ack.type,'purchase',JSON.stringify(ack));
 if(ack.slot>0)owner.input({slot:ack.slot,...(ack.slot===4?{utilityId:weapon}:{})});
 return observe(observer,owner,p=>p.inventory.includes(weapon),seen,`replicated ${weapon}`);
}
async function verify(base){
 const room=`GQ${randomBytes(4).toString('hex')}`.toUpperCase();report.room=room;
 const owner=await connect(base,'CT',room),guest=await connect(base,'T',room);
 assert.equal(owner.welcome.hostId,owner.id);assert.equal(guest.welcome.hostId,owner.id);
 await guest.wait(m=>m.type==='snapshot'&&m.players.length===2&&m.botCount===0,0,'two humans without bots');
 pass('Two ordinary WebSocket players create an isolated DM room with zero bots');

 let mark=guest.mark();guest.send({type:'setBots',bots:2});const denied=await guest.wait(m=>m.type==='error',mark,'guest bots denied');assert.equal(denied.code,'BOTS_REJECTED');
 for(const count of [2,0]){
  mark=owner.mark();owner.send({type:'setBots',bots:count});const ack=await owner.wait(m=>m.type==='botsUpdated'||m.type==='error',mark,`host bots ${count}`);assert.equal(ack.type,'botsUpdated',JSON.stringify(ack));assert.equal(ack.botCount,count);
  await guest.wait(m=>m.type==='snapshot'&&m.botCount===count&&m.desiredBots===count,guest.mark()-1,`observer bots ${count}`);if(count)await delay(280);
 }
 pass('Owner changes bots 0→2→0; non-owner request is rejected and snapshots agree');

 for(const mode of ['full','drop','lob']){
  await buy(owner,guest,'flashbang');await observe(guest,owner,p=>p.weapon==='flashbang'&&p.alive);
  owner.input({fire:mode!=='drop',fire2:mode!=='full',cancelGrenade:false});
  await observe(guest,owner,p=>p.grenadeState?.state==='primed'&&p.grenadeState.mode===mode);
  await delay(900);const held=player(guest.latest,owner.id);assert.equal(held.utilityCounts.flashbang,1);assert.equal(held.grenadeState.state,'primed');
  const after=guest.mark();owner.input({fire:false,fire2:false});
  const snap=await guest.wait(m=>m.type==='snapshot'&&m.events?.some(e=>e.type==='grenade_thrown'&&e.shooterId===owner.id&&e.mode===mode)&&player(m,owner.id)?.utilityCounts.flashbang===0,after,`${mode} release`);
  const event=snap.events.find(e=>e.type==='grenade_thrown'&&e.shooterId===owner.id&&e.mode===mode);assert.equal(event.strength,{full:1,drop:0,lob:.5}[mode]);
  owner.input({slot:1});pass(`Held ${mode} throw preserves ammo, then release consumes exactly one`,{eventId:event.id,strength:event.strength});
 }

 await buy(owner,guest,'hegrenade');await observe(guest,owner,p=>p.weapon==='hegrenade');owner.input({fire:true});await observe(guest,owner,p=>p.grenadeState?.state==='primed');
 const cancelMark=guest.mark();owner.input({fire:false,cancelGrenade:true});
 await observe(guest,owner,p=>p.grenadeState?.state==='idle'&&p.utilityCounts.hegrenade===1,cancelMark,'cancel keeps grenade');
 owner.input({slot:1,cancelGrenade:false});await delay(300);assert.equal(player(guest.latest,owner.id).utilityCounts.hegrenade,1);
 pass('Menu/blur-style cancellation releases a held grenade without throwing or consuming it');

 await buy(owner,guest,'awp');await observe(guest,owner,p=>p.weapon==='awp'&&p.alive);await delay(400);
 const before=player(guest.latest,owner.id),shotMark=guest.mark();owner.input({fire:true,pitch:1.45});await observe(guest,owner,p=>p.ammo===before.ammo-1,shotMark,'shot consumes one AWP round');owner.input({fire:false});
 const carried=player(guest.latest,owner.id),dropMark=owner.mark(),observerMark=guest.mark();owner.send({type:'dropWeapon'});
 const dropAck=await owner.wait(m=>m.type==='weaponDropped'||m.type==='error',dropMark,'drop ACK');assert.equal(dropAck.type,'weaponDropped',JSON.stringify(dropAck));assert.equal(dropAck.weaponId,'awp');
 const snap=await guest.wait(m=>m.type==='snapshot'&&m.droppedWeapons?.some(d=>d.id===dropAck.id),observerMark,'observer dropped gun');
 const drop=snap.droppedWeapons.find(d=>d.id===dropAck.id);assert.equal(drop.skinId,carried.skinId);assert.equal(drop.ammo,carried.ammo);assert.equal(drop.reserve,carried.reserve);
 for(const field of ['x','y','z','yaw','remaining'])assert.ok(Number.isFinite(drop[field]),`Finite dropped ${field}`);
 assert.ok(drop.remaining>0&&drop.remaining<=120);assert.ok(!player(snap,owner.id).inventory.includes('awp'));owner.input({slot:player(snap,owner.id).slot});
 pass('Dropped AWP preserves exact skin, magazine and reserve in observer snapshot',{weapon:drop.weaponId,skin:drop.skinId,ammo:drop.ammo,reserve:drop.reserve});

 const leaveMark=owner.mark();await guest.close();await owner.wait(m=>m.type==='snapshot'&&m.players.length===1&&!player(m,guest.id),leaveMark,'departure replicated');await owner.close();
 assert.equal(owner.closed.code,1000);assert.equal(guest.closed.code,1000);pass('Both sockets close cleanly; first departure is observed before final disconnect');
}

if(!run&&!selfTest){
 console.log(JSON.stringify({networkRequests:0,base:production.href,plan:['GET /health release guard','two normal /ws peers; isolated random room','owner bots, three grenade modes, cancellation, gun drop','close both peers; no QA endpoints or asset downloads'],run:'node deploy/verify-gameplay-public.mjs --run --release=YYYYMMDDTHHMMSSZ',local:'node deploy/verify-gameplay-public.mjs --self-test'},null,2));
}else{
 try{
  let base=production;
  if(selfTest){const {startGameServer}=await import('../server/index.js');app=await startGameServer({port:0,host:'127.0.0.1'});base=new URL(`http://127.0.0.1:${app.port}/`);report.base=base.href;}
  else{assert.match(release||'',/^\d{8}T\d{6}Z$/,'Require --release after activation');const response=await fetch(new URL('health',base),{signal:AbortSignal.timeout(8000)});assert.equal(response.status,200);report.healthBefore=await response.json();assert.equal(report.healthBefore.release,release);assert.equal(report.healthBefore.ok,true);}
  await verify(base);if(app){await delay(100);assert.equal(app.rooms.size,0);pass('Local server deletes the verification room when its last human leaves');}report.ok=true;
 }catch(error){report.ok=false;report.error={message:error.message,stack:error.stack};process.exitCode=1;console.error(error.stack);}
 finally{
  await Promise.allSettled(peers.map(p=>p.close()));await app?.close();report.finishedAt=new Date().toISOString();
  for(const row of report.peers)row.close=peers.find(p=>p.id===row.id)?.closed;
  const output=new URL(`../artifacts/deploy/gameplay-public-${selfTest?'local':'verification'}.json`,import.meta.url);await fs.mkdir(new URL('./',output),{recursive:true});await fs.writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({ok:report.ok,checks:report.checks.length,report:output.pathname},null,2));
 }
}
