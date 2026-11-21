import assert from 'node:assert/strict';
import test from 'node:test';
import {on,once} from 'node:events';
import WebSocket from 'ws';
import {startGameServer} from '../server/index.js';

async function connect(port){
  const ws=new WebSocket('ws://127.0.0.1:'+port+'/ws');
  const messages=on(ws,'message',{signal:AbortSignal.timeout(12000)});
  await once(ws,'open');
  return {send:msg=>ws.send(JSON.stringify(msg)),async waitFor(predicate){
    for(;;){const {value}=await messages.next();const msg=JSON.parse(value[0]);if(predicate(msg))return msg;}
  },close(){ws.terminate();return messages.return();}};
}

test('room cosmetics and round MVP carry the equipped music kit to both real sockets',async()=>{
  const app=await startGameServer({host:'127.0.0.1',port:0,rules:{freezeSeconds:.1}});
  const sockets=[];
  try{
    const ct=await connect(app.port);sockets.push(ct);
    const enemy=await connect(app.port);sockets.push(enemy);
    const list=await connect(app.port);sockets.push(list);
    ct.send({type:'join',team:'CT',name:'CT music',bots:0,musicKit:'neckdeep_01'});
    const first=await ct.waitFor(m=>m.type==='welcome');
    enemy.send({type:'roomCosmetics',room:first.room});
    const before=await enemy.waitFor(m=>m.type==='roomCosmetics');
    assert.deepEqual(before.musicKitIds,['neckdeep_01']);
    enemy.send({type:'join',team:'T',name:'T music',bots:0,musicKit:'alleycvt_01',existing:true,room:first.room,appearanceRevision:before.revision});
    const second=await enemy.waitFor(m=>m.type==='welcome');
    enemy.send({type:'equipMusic',kit:'../../untrusted'});
    assert.equal((await enemy.waitFor(m=>m.type==='error')).code,'MUSIC_REJECTED');
    enemy.send({type:'equipMusic',kit:'isoxo_01'});
    await ct.waitFor(m=>m.events?.some(e=>e.type==='music_equipped'&&e.musicKit==='isoxo_01'));
    list.send({type:'roomCosmetics',room:first.room});
    const current=await list.waitFor(m=>m.type==='roomCosmetics');
    assert.deepEqual(current.musicKitIds,['isoxo_01','neckdeep_01']);
    assert.notEqual(current.revision,before.revision);
    await enemy.waitFor(m=>m.round?.phase==='live');
    const room=app.rooms.get(first.room);
    room.kill(room.players.get(first.id),room.players.get(second.id),'ak47');
    const snapshots=await Promise.all([ct,enemy].map(client=>client.waitFor(m=>m.events?.some(e=>e.type==='round_end'))));
    for(const snap of snapshots){
      const result=snap.events.find(e=>e.type==='round_end');
      assert.equal(result.winner,'T');assert.equal(result.mvpId,second.id);
      assert.equal(result.mvp.name,'T music');assert.equal(result.mvp.musicKit,'isoxo_01');
      assert.deepEqual(snap.round.mvp,result.mvp);
    }
  }finally{for(const socket of sockets)await socket.close();await app.close();}
});
