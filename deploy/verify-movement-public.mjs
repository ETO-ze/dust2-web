// Ordinary protocol, isolated room, zero bots. No flags means no network access.
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import fs from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import WebSocket from 'ws';
const args=process.argv.slice(2),run=args.includes('--run'),local=args.includes('--self-test');
const release=args.find(a=>a.startsWith('--release='))?.slice(10);
assert.ok(!(run&&local));assert.ok(args.every(a=>['--run','--self-test'].includes(a)||a.startsWith('--release=')));
let app,socket;const report={at:new Date().toISOString(),release,mode:local?'local':'public',checks:[]};
if(!run&&!local){console.log('No network requests. Use --self-test or --run --release=YYYYMMDDTHHMMSSZ.');}
else try{
 let base=new URL('https://cs2.duskrain.cn/');
 if(local){const {startGameServer}=await import('../server/index.js');app=await startGameServer({host:'127.0.0.1',port:0});base=new URL(`http://127.0.0.1:${app.port}/`);}
 else{assert.match(release||'',/^\d{8}T\d{6}Z$/);const response=await fetch(new URL('health',base),{signal:AbortSignal.timeout(8000)});assert.equal(response.status,200);report.health=await response.json();assert.equal(report.health.release,release);}
 const ws=new URL('ws',base);ws.protocol=base.protocol==='https:'?'wss:':'ws:';
 socket=new WebSocket(ws,{origin:base.origin});let welcome,state,seq=0,id=0;const samples=[];
 socket.on('message',raw=>{const m=JSON.parse(raw);if(m.type==='welcome')welcome=m;if(m.type==='snapshot'&&welcome){state=m.players.find(p=>p.id===welcome.id);if(state){samples.push(state);if(samples.length>150)samples.shift();}}});
 socket.on('error',error=>{report.socketError=error.message;});
 await new Promise((resolve,reject)=>{socket.once('open',resolve);socket.once('error',reject);});
 const send=m=>socket.send(JSON.stringify(m));
 const wait=async predicate=>{const end=Date.now()+8000;while(!predicate()){assert.ok(!report.socketError,report.socketError);if(Date.now()>end)throw Error('Movement protocol response timed out');await delay(12);}};
 report.room=`MQ${randomBytes(4).toString('hex')}`.toUpperCase();send({type:'join',room:report.room,name:'Movement QA',team:'CT',mode:'deathmatch',bots:0,movementProtocol:1});
 await wait(()=>state?.movementState);assert.equal(welcome.movementProtocol,1);report.lifeId=state.lifeId;
 const batch=async (count,action={})=>{for(let n=0;n<count;n+=2){const moves=Array.from({length:Math.min(2,count-n)},()=>({id:++id,lifeId:state.lifeId,forward:0,right:0,yaw:state.yaw,pitch:0,speedScale:.86,jump:false,jumpId:0,crouch:false,walk:false,...action}));send({type:'input',seq:++seq,forward:0,right:0,slot:1,fire:false,yaw:state.yaw,pitch:0,moveId:id,moves});await delay(34);}await wait(()=>state.movementAck===id);};
 await batch(60);assert.equal(state.grounded,true);const initial={...state.movementState};
 await batch(24,{forward:1});await batch(30);const distance=Math.hypot(state.x-initial.x,state.z-initial.z);assert.ok(distance>.25&&distance<3,`Bounded walk distance ${distance}`);
 report.checks.push({name:'Negotiated 60 Hz commands move and acknowledge in a normal room',ack:state.movementAck,distance});
 samples.length=0;const baseY=state.y;await batch(2,{jump:true,jumpId:1});await batch(88,{jumpId:1});
 const peak=Math.max(...samples.map(p=>p.y))-baseY;assert.ok(peak>1&&peak<1.7,`Jump peak ${peak}`);assert.equal(state.grounded,true);assert.ok(Math.abs(state.y-baseY)<.2);
 report.checks.push({name:'Short jump press takes off and lands once',peak,finalY:state.y,baseY,ack:state.movementAck});
 const ack=state.movementAck;send({type:'input',seq:++seq,forward:0,right:0,yaw:state.yaw,pitch:0,moves:[{id:id+1,lifeId:state.lifeId+1,forward:1,right:0,yaw:0,pitch:0,speedScale:1}],moveId:id+1});await delay(250);assert.equal(state.movementAck,ack);
 report.checks.push({name:'Wrong-life command does not move or advance acknowledgement',ack});report.ok=true;
}catch(error){report.ok=false;report.error={message:error.message,stack:error.stack};process.exitCode=1;}
finally{
 if(socket&&socket.readyState!==WebSocket.CLOSED)await new Promise(resolve=>{const timer=setTimeout(()=>{socket.terminate();resolve();},2000);socket.once('close',code=>{clearTimeout(timer);report.closeCode=code;resolve();});socket.close(1000,'Movement verification complete');});
 if(app){await delay(50);report.remainingRooms=app.rooms.size;await app.close();if(report.remainingRooms){report.ok=false;process.exitCode=1;}}
 await fs.mkdir(new URL('../artifacts/deploy/',import.meta.url),{recursive:true});await fs.writeFile(new URL(`../artifacts/deploy/movement-public-${local?'local':'verification'}.json`,import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}
