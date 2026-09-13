import test from 'node:test';
import assert from 'node:assert/strict';
import {GameRoom} from '../server/game.js';
import {initPhysics} from '../shared/physics.js';
import {ShotPrediction} from '../client/shot-prediction.js';

initPhysics([-200,0,-200,200,0,200,200,0,-200,-200,0,-200,-200,0,200,200,0,200]);
function fixture(){
  let now=100000,seq=0;const room=new GameRoom('SHOTS',{mode:'deathmatch',bots:0,clock:()=>now});
  const p=room.addHuman({}, {name:'QA',team:'CT',primary:'awp'}),v=room.addHuman({}, {name:'target',team:'T'});
  Object.assign(p,{x:0,y:0,z:0,grounded:true,protectionUntil:0,nextShotAt:0,equipReadyAt:0});
  Object.assign(v,{x:0,y:0,z:-10,grounded:true,health:100,armor:0,protectionUntil:0});
  room.traceBullet=({origin})=>({end:{...origin,z:-10},hits:[{playerId:v.id,distance:10,headshot:false}]});
  const send=extra=>room.receiveInput(p.id,{seq:++seq,bodyId:p.id,lifeId:p.lifeId,forward:0,right:0,yaw:0,pitch:0,slot:1,fire:true,shotId:seq,shotWeapon:'awp',zoomLevel:1,...extra});
  return {room,p,v,send,advance:ms=>now+=ms,snapshot:()=>room.snapshot().players.find(x=>x.id===p.id)};
}
test('190-450 ms delayed legal shots deduct one bullet, deal damage and acknowledge exactly once',()=>{
  for(const delay of [190,300,450]){
    const {room,p,v,send,advance,snapshot}=fixture();send();advance(delay);room.tick();
    assert.equal(p.inventory.awp.ammo,4);assert.ok(v.health<100);assert.equal(snapshot().shotAck,1);
    send({shotId:1});advance(1500);room.tick();assert.equal(p.inventory.awp.ammo,4);
  }
});
test('a queued shot waits for its movement and survives more than the old 150 ms timeout',()=>{
  const {room,p,v,send,advance,snapshot}=fixture();
  const move={id:1,lifeId:p.lifeId,forward:0,right:0,yaw:0,pitch:0,speedScale:.7};
  send({moveId:2,moves:[move]});advance(190);room.tick();assert.equal(snapshot().shotAck,0);assert.equal(v.health,100);
  send({shotId:0,fire:false,moveId:2,moves:[{...move,id:2}]});advance(34);room.tick();
  assert.equal(snapshot().shotAck,1);assert.equal(p.inventory.awp.ammo,4);assert.ok(v.health<100);
});
test('an impossible movement reference expires, releases its reservation and cannot fire late',()=>{
  const {room,p,send,advance,snapshot}=fixture();
  send({moveId:999,moves:[{id:1,lifeId:p.lifeId,forward:0,right:0,yaw:0,pitch:0,speedScale:.7}]});advance(501);room.tick();
  const state=snapshot();assert.equal(state.shotAck,1);assert.equal(state.shotRejected.reason,'expired');assert.equal(p.fireQueue.length,0);assert.equal(p.inventory.awp.ammo,5);
});
test('reload boundary commands finish the reload before firing; early clicks cannot bypass it',()=>{
  const {room,p,send,advance}=fixture();p.inventory.awp.ammo=0;room.reload(p);
  send();assert.equal(p.fireQueue?.length||0,0);assert.equal(p.shotRejected.reason,'not_ready');
  advance(p.reloadEndsAt-100000-100);send();room.tick();assert.equal(p.fireQueue.length,1);
  advance(134);room.tick();assert.equal(p.reloadEndsAt,0);assert.equal(p.inventory.awp.ammo,4);
});
test('queue saturation cannot acknowledge earlier shots before their actual damage and ammo update',()=>{
  const {room,p,send,advance,snapshot}=fixture();for(let i=0;i<8;i++)send();
  assert.equal(p.fireQueue.length,4);assert.equal(snapshot().shotAck,0);
  advance(34);room.tick();assert.equal(snapshot().shotAck,1);assert.equal(p.inventory.awp.ammo,4);
  advance(501);room.tick();assert.equal(snapshot().shotAck,8);assert.equal(p.inventory.awp.ammo,4);
});
test('old body and life packets cannot fire or advance the current shot acknowledgement',()=>{
  const {room,p,send,advance,snapshot}=fixture();send({lifeId:p.lifeId-1});send({bodyId:'old-body'});advance(200);room.tick();
  assert.equal(p.inventory.awp.ammo,5);assert.equal(snapshot().shotAck,undefined);
});
test('draw readiness is visible after spawn and switching, without throttling sustained fire',()=>{
  const {room,p,advance,snapshot}=fixture();room.respawn(p);assert.ok(snapshot().fireReadyRemaining>0);
  advance(400);assert.equal(snapshot().fireReadyRemaining,0);room.selectSlot(p,3);assert.ok(snapshot().fireReadyRemaining>0);
  advance(200);p.nextShotAt=101500;assert.equal(snapshot().fireReadyRemaining,0);
});
test('acknowledgements release rejected reservations even when authoritative ammo never decreases',()=>{
  const prediction=new ShotPrediction();prediction.reserve(1,0,'ak47');prediction.reserve(2,100,'ak47');
  prediction.reconcile({ammo:30,shotAck:1,shotRejected:{id:1,reason:'expired'}});
  assert.deepEqual(prediction.pending.map(x=>x.id),[2]);prediction.reconcile({ammo:29,shotAck:2});assert.equal(prediction.pending.length,0);
});
test('holding a semi-auto trigger through draw/reload fires once when ready and requires a new press afterward',()=>{
  const prediction=new ShotPrediction();for(let i=0;i<120;i++)assert.equal(prediction.triggerReady(true),true);
  prediction.reserve(1,2000,'awp');assert.equal(prediction.triggerReady(true),false);
  assert.equal(prediction.triggerReady(false),false);assert.equal(prediction.triggerReady(true),true);
  assert.equal(prediction.triggerReady(true,true),true);prediction.expire(7000,7000);assert.equal(prediction.pending.length,0);
});

test('30 AK shots survive ordered jitter and a 200 ms tick stall with no duplicate or missing bullets',()=>{
  for(const jitter of [20,80,180]){
    let now=100000,seq=0,moveId=0,shot=0,seed=37,lastDelivery=0,nextTick=0;
    const room=new GameRoom('BURST',{mode:'deathmatch',bots:0,clock:()=>now});
    const p=room.addHuman({}, {name:'QA',team:'T',primary:'ak47',shotProtocol:1,movementProtocol:1});
    Object.assign(p,{x:0,y:0,z:0,grounded:true,protectionUntil:0,nextShotAt:0,equipReadyAt:0});p.inventory.ak47.reserve=0;
    room.traceBullet=({origin})=>({end:origin,hits:[]});const pending=[];
    for(let frame=0;frame<360;frame++){
      now=100000+frame*1000/60;
      if(frame<180){
        seed=(seed*1664525+1013904223)>>>0;lastDelivery=Math.max(lastDelivery,frame*1000/60+120+(seed%jitter));
        const move={id:++moveId,lifeId:p.lifeId,forward:0,right:0,yaw:0,pitch:0,speedScale:.7},fire=frame%6===0;
        pending.push({at:lastDelivery,input:{seq:++seq,forward:0,right:0,yaw:0,pitch:0,slot:1,fire,shotId:fire?++shot:0,shotWeapon:'ak47',moveId,moves:[move]}});
      }
      while(pending[0]?.at<=frame*1000/60)room.receiveInput(p.id,pending.shift().input);
      if(frame>=nextTick){room.tick();nextTick=frame+2+(frame===90?12:0);}
    }
    const shots=room.events.filter(e=>e.type==='shot');assert.equal(shots.length,30);assert.equal(new Set(shots.map(e=>e.shotId)).size,30);
    assert.equal(p.inventory.ak47.ammo,0);assert.equal(p.shotRejected,undefined);assert.equal(p.movementStream.ack,180);
  }
});

test('negotiated shot commands never synthesize an unpredicted shot from held-fire movement packets',()=>{
  const {room,advance}=fixture();const p=room.addHuman({}, {name:'modern client',team:'T',primary:'ak47',shotProtocol:1});p.nextShotAt=0;
  room.receiveInput(p.id,{seq:1,forward:0,right:0,yaw:0,pitch:0,slot:1,fire:true});advance(34);room.tick();
  assert.equal(p.inventory.ak47.ammo,30);assert.equal(room.events.filter(e=>e.type==='shot').length,0);
});
