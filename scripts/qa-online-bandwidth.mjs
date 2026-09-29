// Isolated TCP fixture: one shared 5 Mbps downlink for assets and compressed WS.
// This is a reproducible contention experiment, not a production ISP measurement.
import net from 'node:net';import fs from 'node:fs';import WebSocket from 'ws';
import {setTimeout as sleep} from 'node:timers/promises';
const port=Number(process.env.QA_PORT)||3003,rate=5e6/8,queue=[],connections=new Set();let queued=0,tokens=0,last=performance.now();
function resume(){if(queued<rate/2)for(const c of connections)c.up.resume();}
const proxy=net.createServer(down=>{const up=net.connect(port,'127.0.0.1'),c={down,up};connections.add(c);down.pipe(up);
 up.on('data',data=>{queue.push({c,data,offset:0});queued+=data.length;if(queued>rate)for(const x of connections)x.up.pause();});
 const close=()=>{connections.delete(c);down.destroy();up.destroy();for(let i=queue.length-1;i>=0;i--)if(queue[i].c===c){queued-=queue[i].data.length-queue[i].offset;queue.splice(i,1);}resume();};
 down.on('error',close);up.on('error',close);down.on('close',close);up.on('end',()=>down.end());
});
const pump=setInterval(()=>{const now=performance.now();tokens=Math.min(rate/10,tokens+rate*(now-last)/1000);last=now;
 while(queue.length&&tokens>=1){const head=queue[0],n=Math.min(Math.floor(tokens),head.data.length-head.offset);head.c.down.write(head.data.subarray(head.offset,head.offset+n));head.offset+=n;tokens-=n;queued-=n;if(head.offset===head.data.length)queue.shift();}resume();},10);
await new Promise(r=>proxy.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${proxy.address().port}`,peers=[],report={at:new Date().toISOString(),emulatedDownlinkMbps:5,stages:[]};
async function join(room){return new Promise((resolve,reject)=>{const ws=new WebSocket(origin.replace('http','ws')+'/ws'),p={ws,rtt:[],snapshots:0};peers.push(p);ws.on('error',reject);ws.on('open',()=>ws.send(JSON.stringify({type:'join',name:'Bandwidth fixture',bots:9,mode:'deathmatch',room})));ws.on('message',data=>{const m=JSON.parse(data);if(m.type==='welcome'){p.room=m.room;resolve(p);}if(m.type==='pong')p.rtt.push(performance.now()-m.time);if(m.type==='snapshot')p.snapshots++;});});}
try{
 const first=await join();await join(first.room);await sleep(1000);
 const manifest=JSON.parse(fs.readFileSync('public/assets/asset-manifest.json','utf8')),big=[...manifest.files].sort((a,b)=>b.bytes-a.bytes)[0];
 for(const download of [false,true]){
  const abort=new AbortController();let downloaded=0,assetTask=Promise.resolve();
  if(download)assetTask=fetch(origin+'/'+big.path,{signal:abort.signal}).then(async r=>{for await(const chunk of r.body)downloaded+=chunk.length;}).catch(e=>{if(e.name!=='AbortError')throw e;});
  peers.forEach(p=>{p.rtt=[];p.snapshots=0;p.start=p.ws._socket.bytesRead;p.timer=setInterval(()=>p.ws.readyState===1&&p.ws.send(JSON.stringify({type:'ping',time:performance.now()})),200);});
  await sleep(9000);abort.abort();await assetTask;
  const clients=peers.map(p=>{clearInterval(p.timer);p.rtt.sort((a,b)=>a-b);return {snapshots:p.snapshots,wireMbps:(p.ws._socket.bytesRead-p.start)*8/9e6,rttP50Ms:p.rtt[Math.floor(p.rtt.length*.5)],rttP95Ms:p.rtt[Math.floor(p.rtt.length*.95)]};});
  report.stages.push({assetDownload:download,downloadedBytes:downloaded,clients,server:await(await fetch(`http://127.0.0.1:${port}/health`)).json()});
  await sleep(1000);
 }
 console.log(JSON.stringify(report,null,2));
}finally{for(const p of peers){clearInterval(p.timer);p.ws.terminate();}for(const c of connections){c.down.destroy();c.up.destroy();}clearInterval(pump);proxy.close();fs.mkdirSync('artifacts/online-sync',{recursive:true});fs.writeFileSync('artifacts/online-sync/bandwidth.json',JSON.stringify(report,null,2));}
