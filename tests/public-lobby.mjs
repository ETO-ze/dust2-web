import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {WebSocket} from 'ws';
import {startGameServer} from '../server/index.js';
test('room directory does not simulate a room; join existing replaces bots and closed rooms cannot be recreated by stale listing',async t=>{
 const app=await startGameServer({port:0,host:'127.0.0.1'});t.after(()=>app.close());
 async function peer(){const ws=new WebSocket(`ws://127.0.0.1:${app.port}/ws`);await once(ws,'open');return ws;}
 function request(ws,message,type){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{ws.off('message',handler);reject(Error('protocol timeout'));},4000);const handler=data=>{const m=JSON.parse(data);if(m.type===type){clearTimeout(timer);ws.off('message',handler);resolve(m);}};ws.on('message',handler);ws.send(JSON.stringify(message));});}
 const directory=await peer();assert.deepEqual((await request(directory,{type:'listRooms'},'rooms')).rooms,[]);assert.equal(app.rooms.size,0);directory.close();
 const host=await peer(),welcome=await request(host,{type:'join',room:'LOBBY9',mode:'deathmatch',bots:9},'welcome');assert.equal(app.rooms.size,1);
 const visitor=await peer(),rooms=(await request(visitor,{type:'listRooms'},'rooms')).rooms;assert.equal(rooms.length,1);assert.equal(rooms[0].humans,1);assert.equal(rooms[0].bots,9);assert.equal(rooms[0].joinable,true);
 const joined=await request(visitor,{type:'join',room:welcome.room,existing:true,team:'auto'},'welcome');assert.equal(joined.room,welcome.room);assert.equal(app.rooms.get(welcome.room).players.size,10);assert.equal(app.rooms.get(welcome.room).humanCount,2);
 host.close();visitor.close();await Promise.all([once(host,'close'),once(visitor,'close')]);
 const stale=await peer();const error=await request(stale,{type:'join',room:welcome.room,existing:true},'error');assert.equal(error.code,'ROOM_GONE');assert.equal(app.rooms.size,0);stale.close();
});
