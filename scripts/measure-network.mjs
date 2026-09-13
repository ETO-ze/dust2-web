// Explicit, bounded measurement in a new disposable room. Never joins a user's room.
import WebSocket from 'ws';
import {randomBytes} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
const args=process.argv.slice(2),option=(name,fallback)=>args.includes(name)?args[args.indexOf(name)+1]:fallback;
const origin=option('--url','http://127.0.0.1:3003'),output=option('--output','artifacts/network-compressed.json');
const max=Math.min(10,Math.max(1,Number(option('--clients','2'))||2));
const peers=[],room='NQ'+randomBytes(4).toString('hex').toUpperCase(),report={at:new Date().toISOString(),origin,stages:[]};
async function peer(){
 const url=new URL('/ws',origin);url.protocol=url.protocol==='https:'?'wss:':'ws:';
 return new Promise((resolve,reject)=>{
   const ws=new WebSocket(url,{handshakeTimeout:10000}),p={ws,bytes:0,pings:[],count:0,errors:[]};peers.push(p);
   const timeout=setTimeout(()=>reject(new Error('Join timed out')),15000);
   ws.on('error',reject);ws.on('message',data=>{
     const m=JSON.parse(data);if(m.type==='welcome'){clearTimeout(timeout);p.id=m.id;resolve(p);}
     if(m.type==='snapshot'){p.bytes+=data.length;p.count++;p.latest=m;}
     if(m.type==='pong')p.pings.push(performance.now()-m.time);
     if(m.type==='error')p.errors.push(m.code);
   });
   ws.on('open',()=>ws.send(JSON.stringify({type:'join',room,name:'Network QA',mode:'deathmatch',team:'auto',bots:9})));
 });
}
try{
 for(const target of [...new Set([1,Math.min(2,max),Math.min(5,max),max])]){
   while(peers.length<target)await peer();await delay(700);
   for(const p of peers){p.startBytes=p.ws._socket.bytesRead;p.bytes=0;p.count=0;p.pings=[];p.timer=setInterval(()=>{if(p.ws.readyState===1)p.ws.send(JSON.stringify({type:'ping',time:performance.now()}));},700);}
   const start=performance.now();await delay(8000);const seconds=(performance.now()-start)/1000;
   const clients=peers.map(p=>{clearInterval(p.timer);const pings=p.pings.toSorted((a,b)=>a-b),wire=p.ws._socket.bytesRead-p.startBytes;return {compression:p.ws.extensions,wireMbps:+(wire*8/seconds/1e6).toFixed(3),decodedMbps:+(p.bytes*8/seconds/1e6).toFixed(3),snapshots:p.count,rttP50Ms:Math.round(pings[Math.floor(pings.length*.5)]||0),rttP95Ms:Math.round(pings[Math.floor(pings.length*.95)]||0),errors:p.errors};});
   const health=await(await fetch(new URL('/health',origin))).json();
   const stage={humans:peers.length,bodies:peers[0].latest?.players.length,seconds:+seconds.toFixed(2),clients,health};report.stages.push(stage);console.log(JSON.stringify(stage));
 }
}finally{for(const p of peers){clearInterval(p.timer);p.ws.terminate();}await writeFile(output,JSON.stringify(report,null,2));}
