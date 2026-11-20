import test from 'node:test';
import assert from 'node:assert/strict';
import {GameRoom} from '../server/game.js';
import {initPhysics} from '../shared/physics.js';

initPhysics([-200,0,-200,200,0,200,200,0,-200,-200,0,-200,-200,0,200,200,0,200]);
function fixture(){
  let now=100000,seq=0,shotId=0;
  const room=new GameRoom('BURST',{mode:'deathmatch',bots:0,clock:()=>now});
  const p=room.addHuman({},{name:'Tester',team:'T',shotProtocol:1});
  room.selectSlot(p,2);
  const target=room.addHuman({},{name:'Target',team:'CT'});
  Object.assign(target,{health:100,armor:0,protectionUntil:0});
  room.traceBullet=({origin})=>({end:origin,hits:[{playerId:target.id,distance:2}]});
  now+=600;
  function send(fields){
    return room.receiveInput(p.id,{seq:++seq,forward:0,right:0,yaw:0,pitch:0,slot:2,lifeId:p.lifeId,bodyId:p.id,...fields});
  }
  const tick=(ms=0)=>{now+=ms;room.tick();};
  const shots=()=>room.events.filter(e=>e.type==='shot'&&e.shooterId===p.id);
  const trigger=()=>send({fire:true,shotWeapon:'pistol',shotId:++shotId});
  const toggle=()=>send({toggleBurst:true});
  return {room,p,target,send,tick,toggle,trigger,shots};
}

test('right click toggles Glock without shooting, release completes one independently resolved burst',()=>{
  const {room,p,target,send,tick,toggle,trigger,shots}=fixture();
  toggle();tick();assert.equal(shots().length,0);
  const state=()=>room.snapshot({drainEvents:false}).players.find(x=>x.id===p.id);
  assert.equal(state().burstMode,true);
  trigger();tick();send({fire:false,yaw:0.8});
  tick(49);assert.equal(shots().length,1);tick(1);tick(50);
  assert.deepEqual(shots().map(e=>e.burstIndex),[1,2,3]);
  assert.deepEqual(shots().map(e=>e.shotId),[1,0,0]);
  assert.equal(state().shotAck,1);assert.equal(p.inventory.pistol.ammo,17);
  assert.ok(Math.abs(shots()[1].aim.yaw-.8)<.001);
  assert.equal(room.events.filter(e=>e.type==='hit'&&e.targetId===target.id).length,3);
  assert.ok(target.health<20);
  tick(400);toggle();tick();assert.equal(state().burstMode,false);
  trigger();tick();tick(650);assert.equal(shots().length,4);
});

test('burst mode enforces its trigger cycle and ignores held or replayed trigger IDs',()=>{
  const {send,toggle,trigger,tick,p,shots}=fixture();
  toggle();trigger();tick();send({fire:true,shotWeapon:'pistol',shotId:1});
  tick(100);trigger();tick(100);assert.equal(shots().length,3);
  assert.equal(p.shotRejected.reason,'not_ready');
  tick(299);assert.equal(shots().length,3);
  tick(1);trigger();tick();tick(100);assert.equal(shots().length,6);
  assert.equal(p.inventory.pistol.ammo,14);
});

test('partial magazine, switch, reload and death cannot create extra rounds',()=>{
  for(const [action,expected] of [['one',1],['two',2],['switch',1],['reload',1],['death',1]]){
    const {p,send,tick,toggle,trigger,shots,room}=fixture();
    if(action==='one'||action==='two')p.inventory.pistol.ammo=action==='one'?1:2;
    toggle();trigger();tick();
    if(action==='switch')send({slot:3});
    if(action==='reload')send({reload:true});
    if(action==='death')room.kill(p,null);
    tick(200);assert.equal(shots().length,expected,action);
  }
});

test('a right click from an old life or while holding a different weapon has no effect',()=>{
  const {p,room,send,tick,trigger,shots}=fixture();
  send({toggleBurst:true,lifeId:p.lifeId-1});send({toggleBurst:true,slot:1});
  trigger();tick();tick(120);assert.equal(shots().length,1);
  room.selectSlot(p,1);tick(700);send({toggleBurst:true,slot:1});
  assert.equal(p.inventory.pistol.burstMode,undefined);
});

test('the selector stays with a dropped Glock and with a surviving player between rounds',()=>{
  const {room,p,target,toggle,tick}=fixture();
  toggle();
  const dropped=room.dropWeapon(p.id);
  assert.equal(dropped.ok,true);
  const item=room.droppedWeapons.items.find(x=>x.id===dropped.id);
  assert.equal(item.burstMode,true);
  Object.assign(target,{x:item.x,y:item.y-.75,z:item.z});
  assert.equal(room.pickupWeapon(target),true);
  assert.equal(target.inventory.pistol.burstMode,true);
  room.respawn(target,true);assert.equal(target.inventory.pistol.burstMode,true);
  target.alive=false;room.respawn(target,true);tick(34);
  assert.equal(target.inventory.pistol?.burstMode,undefined);
});
