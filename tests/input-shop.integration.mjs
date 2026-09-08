import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { startGameServer } from '../server/index.js';
import { GameRoom, sanitizeInput } from '../server/game.js';
import { MAP } from '../shared/map-data.js';
import { createPlayerState, stepPlayer, raycastWorld } from '../shared/physics.js';
import { getWeapon } from '../shared/weapons.js';

const input = (seq, extra = {}) => ({ type: 'input', seq, forward: 0, right: 0, yaw: 0, pitch: 0, jump: false, jumpId: 0, reload: false, reloadId: 0, fire: false, ...extra });
const neutral = { forward: 0, right: 0, yaw: 0, pitch: 0, jump: false, jumpId: 0 };
function standingSpot() {
  for (const spawn of MAP.spawns.T) {
    const player = createPlayerState(spawn);
    for (let i=0;i<100;i++) stepPlayer(player, neutral, 1/60);
    if (player.grounded && raycastWorld({x:player.x,y:player.y+1.79,z:player.z},{x:0,y:1,z:0},2) === null) return {x:player.x,y:player.y,z:player.z};
  }
  throw Error('No grounded spawn with jump headroom on the real map');
}
function fixture(spot, mode='deathmatch') {
  let now=1000000;
  const room=new GameRoom('INPUTSHOP',{mode,bots:0,clock:()=>now});
  const player=room.addHuman({}, {name:'Input QA',team:'T',primary:'ak47'});
  if(mode==='defuse')room.addHuman({}, {name:'Opponent',team:'CT'});
  Object.assign(player,createPlayerState(spot),{grounded:true,alive:true,health:100});
  const advance=(milliseconds=1000/30)=>{now+=milliseconds};
  const tick=()=>{advance();room.tick(1/30)};
  const receive=(seq,extra)=>room.receiveInput(player.id,input(seq,extra));
  const snapshot=()=>room.snapshot({drainEvents:false}).players.find(p=>p.id===player.id);
  return {room,player,advance,tick,receive,snapshot,now:()=>now};
}
async function connect(port) {
  const socket=new WebSocket(`ws://127.0.0.1:${port}/ws`),messages=[],watchers=new Set();
  socket.on('message',raw=>{messages.push(JSON.parse(raw));for(const check of watchers)check()});
  await once(socket,'open');
  return {socket,send:data=>socket.send(JSON.stringify(data)),waitFor(predicate,timeout=4000){return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{watchers.delete(check);reject(Error('Input/shop WebSocket timeout'))},timeout);
    function check(){const index=messages.findIndex(predicate);if(index<0)return;clearTimeout(timer);watchers.delete(check);resolve(messages.splice(index,1)[0])}
    watchers.add(check);check();
  })}};
}

test('input edge counters and authoritative shop on the real Dust2 collision', {timeout:15000}, async t=>{
  const app=await startGameServer({port:0,host:'127.0.0.1'}),peers=[];
  t.after(async()=>{for(const peer of peers)peer.socket.terminate();await app.close()});
  const spot=standingSpot();

  await t.test('real WebSocket release-only jump counter survives the server 30 Hz tick, followed by a confirmed free purchase',async()=>{
    const peer=await connect(app.port);peers.push(peer);
    peer.send({type:'join',room:'INPUTLIVE',mode:'deathmatch',name:'Real tick QA',team:'T',primary:'ak47',bots:0});
    const welcome=await peer.waitFor(m=>m.type==='welcome');
    const grounded=await peer.waitFor(m=>m.type==='snapshot'&&m.players.find(p=>p.id===welcome.id)?.grounded);
    const before=grounded.players.find(p=>p.id===welcome.id);
    assert.equal(before.buyAllowed,true);assert.equal(before.buyReason,'');
    // The press packet can be absent: a later monotonically increasing counter preserves the tap.
    peer.send(input(1,{jump:false,jumpId:1}));
    const airborne=await peer.waitFor(m=>m.type==='snapshot'&&m.players.find(p=>p.id===welcome.id)?.vy>2);
    assert.ok(airborne.players.find(p=>p.id===welcome.id).y>before.y+.05);
    peer.send({type:'buy',weapon:'awp'});
    const purchase=await peer.waitFor(m=>m.type==='purchase');assert.equal(purchase.ok,true);assert.equal(purchase.weapon,'awp');assert.equal(purchase.money,before.money);
    const equipped=await peer.waitFor(m=>m.type==='snapshot'&&m.players.find(p=>p.id===welcome.id)?.weapon==='awp');
    assert.equal(equipped.players.find(p=>p.id===welcome.id).ammo,5);
    assert.equal(equipped.events.filter(e=>e.type==='buy'&&e.playerId===welcome.id).length,1);
  });

  await t.test('press/release within one 30 Hz step jumps once; duplicate IDs cannot jump again after landing',()=>{
    const {player,receive,tick}=fixture(spot);
    assert.equal(receive(1,{jump:true,jumpId:1}),true);assert.equal(receive(2,{jump:false,jumpId:1}),true);tick();
    assert.ok(player.vy>2);assert.equal(player.grounded,false);
    for(let i=0;i<45;i++)tick();assert.equal(player.grounded,true);
    receive(3,{jump:false,jumpId:1});tick();assert.equal(player.grounded,true);assert.ok(player.vy<=.1);
    receive(4,{jump:false,jumpId:2});tick();assert.ok(player.vy>2);
  });

  await t.test('short R taps execute once, and a consumed reload counter cannot restart an interrupted reload',()=>{
    const {room,player,receive,tick}=fixture(spot);player.inventory.ak47={ammo:2,reserve:10};
    receive(1,{reload:true,reloadId:1});receive(2,{reload:false,reloadId:1});tick();assert.ok(player.reloadEndsAt>0);
    room.selectSlot(player,2);room.selectSlot(player,1);assert.equal(player.reloadEndsAt,0);
    receive(3,{reload:false,reloadId:1});tick();assert.equal(player.reloadEndsAt,0);
    receive(4,{reload:false,reloadId:2});tick();assert.ok(player.reloadEndsAt>0);
    assert.deepEqual(player.inventory.ak47,{ammo:2,reserve:10});
  });

  await t.test('expired sequence packets and stale edges cannot trigger jump/reload even when resent with a fresh sequence',()=>{
    const {player,receive,tick,advance}=fixture(spot);player.inventory.ak47={ammo:2,reserve:10};
    receive(5,{});assert.equal(receive(4,{jumpId:10,reloadId:10}),false);tick();assert.equal(player.grounded,true);assert.equal(player.reloadEndsAt,0);
    receive(6,{jumpId:2,reloadId:2});advance(301);tick();assert.equal(player.grounded,true);assert.equal(player.reloadEndsAt,0);
    receive(7,{jumpId:2,reloadId:2});tick();assert.equal(player.grounded,true);assert.equal(player.reloadEndsAt,0);
    assert.equal(sanitizeInput(input(8,{jumpId:-1,reloadId:Number.MAX_SAFE_INTEGER})).jumpId,0);
    assert.equal(sanitizeInput(input(8,{jumpId:-1,reloadId:Number.MAX_SAFE_INTEGER})).reloadId,0);
  });

  await t.test('freeze consumes input counters and existing landing buffers; no jump remains when live play starts',()=>{
    const {room,player,receive,tick,advance,now}=fixture(spot,'defuse');
    room.round.phase='freeze';room.round.phaseEndsAt=now()+1000;
    player.jumpBufferRemaining=.1;receive(1,{jumpId:3});tick();assert.equal(player.grounded,true);assert.equal(player.jumpBufferRemaining,0);
    advance(1001);tick();assert.equal(room.round.phase,'live');assert.equal(player.grounded,true);
    receive(2,{jumpId:3});tick();assert.equal(player.grounded,true);
  });

  await t.test('death/respawn consumes jump and reload counters; stale landing buffers are cleared',()=>{
    const {room,player,receive,tick,advance}=fixture(spot);
    room.kill(player,null);receive(1,{jumpId:4,reloadId:4});advance(3001);tick();assert.equal(player.alive,true);
    for(let i=0;i<15;i++)tick();assert.equal(player.grounded,true);
    player.inventory.ak47={ammo:2,reserve:10};receive(2,{jumpId:4,reloadId:4});tick();assert.equal(player.grounded,true);assert.equal(player.reloadEndsAt,0);
    player.jumpBufferRemaining=.1;receive(3,{});advance(301);tick();assert.equal(player.grounded,true);assert.equal(player.jumpBufferRemaining,0);
  });

  await t.test('deathmatch purchases are free, replace only the primary, and dead players cannot buy',()=>{
    const {room,player,snapshot}=fixture(spot);player.money=0;
    for(const weapon of ['awp','m4a1','ak47']){
      const result=room.buy(player.id,weapon);assert.equal(result.ok,true);assert.equal(result.money,0);assert.equal(player.weapon,weapon);
      assert.deepEqual(Object.keys(player.inventory).filter(id=>getWeapon(id).slot===1),[weapon]);
      assert.ok(player.inventory.pistol);assert.ok(player.inventory.knife);assert.equal(snapshot().buyAllowed,true);
    }
    player.armor=1;assert.equal(room.buy(player.id,'armor').ok,true);assert.equal(player.armor,100);
    room.kill(player,null);assert.equal(snapshot().buyAllowed,false);assert.equal(room.buy(player.id,'awp').message,snapshot().buyReason);
  });

  await t.test('defuse shop validates funds, spawn radius and height, buy window and round phase consistently with snapshots',()=>{
    const {room,player,snapshot,advance,now}=fixture(spot,'defuse');
    Object.assign(player,MAP.spawns.T[0]);room.round.phase='freeze';room.round.phaseEndsAt=now()+10000;room.round.buyEndsAt=now()+20000;player.money=4750;
    assert.equal(snapshot().buyAllowed,true);assert.equal(room.buy(player.id,'awp').ok,true);assert.equal(player.money,0);
    const events=room.events.length;assert.equal(room.buy(player.id,'m4a1').ok,false);assert.equal(player.weapon,'awp');assert.equal(room.events.length,events);
    player.money=10000;player.y=Math.max(...MAP.spawns.T.map(spawn=>spawn.y))+3.1;assert.equal(snapshot().buyAllowed,false);assert.equal(room.buy(player.id,'ak47').message,snapshot().buyReason);
    Object.assign(player,MAP.spawns.T[0]);player.x=MAP.bounds.max.x+100;assert.equal(snapshot().buyAllowed,false);assert.equal(room.buy(player.id,'ak47').ok,false);
    Object.assign(player,MAP.spawns.T[0]);advance(20001);assert.equal(snapshot().buyAllowed,false);assert.equal(room.buy(player.id,'ak47').message,snapshot().buyReason);
    room.round.buyEndsAt=now()+10000;room.round.phase='ended';assert.equal(snapshot().buyAllowed,false);assert.equal(room.buy(player.id,'ak47').ok,false);
  });
});
