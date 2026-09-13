import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import WebSocket from 'ws';
import {startGameServer} from '../server/index.js';

test('compressed and legacy peers share snapshots; wire traffic drops without losing authoritative control', {timeout:25000},async t=>{
 const app=await startGameServer({host:'127.0.0.1',port:0});t.after(()=>app.close());
 const peers=[];t.after(()=>peers.forEach(p=>p.ws.terminate()));
 for(const compressed of [true,false]){
   const ws=new WebSocket(`ws://127.0.0.1:${app.port}/ws`,{perMessageDeflate:compressed}),messages=[];
   ws.on('message',data=>messages.push(JSON.parse(data)));await once(ws,'open');
   const peer={ws,messages};peers.push(peer);
   ws.send(JSON.stringify({type:'join',room:'NETZIP',mode:'defuse',name:compressed?'ZIP':'RAW',team:'CT',bots:8}));
   for(let i=0;i<100&&!messages.some(m=>m.type==='welcome');i++)await delay(20);
   peer.id=messages.find(m=>m.type==='welcome')?.id;assert.ok(peer.id);
   assert.equal(ws.extensions.includes('permessage-deflate'),compressed);
 }
 const room=app.rooms.get('NETZIP');room.startRound();room.round.phase='live';room.round.phaseEndsAt=Date.now()+60000;
 const a=room.players.get(peers[0].id);a.alive=false;a.health=0;
 const body=[...room.players.values()].find(p=>p.bot&&p.team==='CT');
 peers[0].ws.send(JSON.stringify({type:'takeBot',botId:body.id}));
 for(let i=0;i<100&&!a.controlledBotId;i++)await delay(20);
 assert.equal(a.controlledBotId,body.id);
 peers[0].ws.send(JSON.stringify({type:'input',seq:1,bodyId:body.id,lifeId:body.lifeId,forward:0,right:0,yaw:.2,pitch:0,slot:3}));
 await delay(150);assert.equal(body.weapon,'knife');
 const start=peers.map(p=>p.ws._socket.bytesRead);await delay(2000);
 const bytes=peers.map((p,i)=>p.ws._socket.bytesRead-start[i]);
 const snaps=peers.map(p=>p.messages.filter(m=>m.type==='snapshot'));
 const common=snaps[0].findLast(a=>snaps[1].some(b=>a.time===b.time));assert.ok(common);
 assert.deepEqual(common,snaps[1].find(b=>b.time===common.time));
 assert.ok(bytes[0]<bytes[1]*.45,JSON.stringify({compressed:bytes[0],plain:bytes[1]}));
 console.log(JSON.stringify({wireBytes2s:bytes,reductionPercent:Math.round((1-bytes[0]/bytes[1])*100)}));
});
