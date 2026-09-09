import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {WebSocket} from 'ws';
import fs from 'node:fs/promises';
const args=process.argv.slice(2);assert.ok(args.every(a=>['--run','--self-test'].includes(a)||a.startsWith('--release=')));
if(!args.includes('--run')&&!args.includes('--self-test')){console.log('Use --self-test for loopback or --run --release=STAMP for two isolated public players.');process.exit(0);}
let app;const local=args.includes('--self-test');
if(local){const {startGameServer}=await import('../server/index.js');app=await startGameServer({port:0,host:'127.0.0.1'});}
const base=local?`http://127.0.0.1:${app.port}/`:'https://cs2.duskrain.cn/',health=await fetch(base+'health').then(r=>r.json());
if(!local)assert.equal(health.release,args.find(a=>a.startsWith('--release='))?.slice(10));
const code='RQ'+randomBytes(4).toString('hex').toUpperCase(),peers=[],checks=[];
async function connect(team){const url=new URL('ws',base);url.protocol=local?'ws:':'wss:';const ws=new WebSocket(url),messages=[];ws.on('message',raw=>messages.push(JSON.parse(raw)));await once(ws,'open');
  const wait=async fn=>{for(let i=0;i<500;i++){const n=messages.findIndex(fn);if(n>=0)return messages.splice(n,1)[0];await delay(10);}throw Error('Room verification timeout');};const peer={ws,wait};peers.push(peer);
  ws.send(JSON.stringify({type:'join',room:code,name:'Room verification',mode:'deathmatch',team,bots:0}));peer.id=(await wait(m=>m.type==='welcome')).id;return peer;}
const send=(p,msg)=>p.ws.send(JSON.stringify(msg));
try{
  const host=await connect('T'),friend=await connect('CT');
  send(host,{type:'setSeatBot',team:'CT',seat:4,enabled:true});const added=await friend.wait(m=>m.type==='snapshot'&&m.seats?.CT[4].bot);assert.equal(added.seats.CT.length+added.seats.T.length,10);checks.push('Five seats on each side; exact bot seat broadcasts');
  send(friend,{type:'setSeatBot',team:'CT',seat:4,enabled:false});assert.equal((await friend.wait(m=>m.type==='error')).code,'SEAT_REJECTED');checks.push('Non-host cannot remove bot');
  await delay(350);send(host,{type:'setSeatBot',team:'CT',seat:4,enabled:false});await friend.wait(m=>m.type==='snapshot'&&!m.seats.CT[4].playerId);
  await delay(350);send(host,{type:'takeSeat',team:'CT',seat:4});await friend.wait(m=>m.type==='snapshot'&&m.seats.CT[4].playerId===host.id);checks.push('Bot removed, owner joins the vacated seat');
  send(host,{type:'setBots',bots:8});const full=await friend.wait(m=>m.type==='snapshot'&&m.players.length===10);assert.equal(full.seats.CT.filter(s=>s.playerId).length,5);assert.equal(full.seats.T.filter(s=>s.playerId).length,5);checks.push('Full room remains exactly five versus five');
  host.ws.close();await once(host.ws,'close');await friend.wait(m=>m.type==='snapshot'&&m.hostId===friend.id);checks.push('Host ownership transfers on departure');friend.ws.close();await once(friend.ws,'close');
  const report={ok:true,release:health.release,room:code,checks,at:new Date().toISOString()};await fs.writeFile(`artifacts/deploy/room-public-${local?'local':'live'}.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{peers.forEach(p=>p.ws.terminate());await app?.close();}
