import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {WebSocket} from 'ws';
import {snapshotForSide} from '../server/snapshot-view.js';
import {startGameServer} from '../server/index.js';
test('private economy fields are absent for opponents and unidentified spectators without changing shared state',()=>{
 const original={players:[{id:'a',team:'CT',botBuy:'ECO',lossIncome:2400},{id:'b',team:'T',botBuy:'全起',lossIncome:1400}]};
 for(const side of ['CT','T',undefined]){const view=snapshotForSide(original,side);for(const p of view.players)assert.equal(Object.hasOwn(p,'botBuy'),p.team===side);}
 assert.equal(original.players[0].botBuy,'ECO');
});
function message(ws,predicate){return new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{ws.off('message',read);reject(Error('snapshot timeout'));},5000);function read(raw){const data=JSON.parse(raw);if(predicate(data)){clearTimeout(timeout);ws.off('message',read);resolve(data);}}ws.on('message',read);});}
test('welcome and recurring WebSocket snapshots expose only the recipient team purchase plan',async()=>{
 const app=await startGameServer({port:0,host:'127.0.0.1'}),sockets=[];
 try{
  const connect=async team=>{const ws=new WebSocket(`ws://127.0.0.1:${app.port}/ws`);sockets.push(ws);await once(ws,'open');const welcome=message(ws,m=>m.type==='welcome');const snapshot=message(ws,m=>m.type==='snapshot');ws.send(JSON.stringify({type:'join',name:team,team,bots:0,mode:'defuse',...(app.rooms.size?{room:[...app.rooms.keys()][0]}:{})}));return {ws,welcome:await welcome,first:await snapshot};};
  const a=await connect('CT'),b=await connect('T');
  assert.equal(b.first.players.find(p=>p.team==='T').botBuy,'手枪局');assert.ok(b.first.players.filter(p=>p.team==='CT').every(p=>!Object.hasOwn(p,'botBuy')));
  const room=[...app.rooms.values()][0];room.teamBuys.CT={label:'ECO'};room.teamBuys.T={label:'全起'};
  for(const [peer,side,label]of [[a,'CT','ECO'],[b,'T','全起']]){
   const s=await message(peer.ws,m=>m.type==='snapshot'&&m.players.some(p=>p.team===side&&p.botBuy===label));
   assert.ok(s.players.filter(p=>p.team!==side).every(p=>!Object.hasOwn(p,'botBuy')&&!Object.hasOwn(p,'lossIncome')));
  }
 }finally{for(const ws of sockets)ws.close();await app.close();}
});
