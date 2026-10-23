import test from 'node:test';
import assert from 'node:assert/strict';
import {GameRoom} from '../server/game.js';
import {initPhysics} from '../shared/physics.js';
import {WEAPONS} from '../shared/weapons.js';
import {accuracyForShot} from '../shared/aim.js';
import {RevolverTrigger,REVOLVER_PRIMARY_FIRE_DELAY_MS,weaponFireInterval} from '../shared/revolver.js';
import {RULES_VERSION,ASSET_VERSION,compatibilityError} from '../shared/online-build.js';

initPhysics([-200,0,-200,200,0,200,200,0,-200,-200,0,-200,-200,0,200,200,0,200]);
function fixture(){
 let now=100000,seq=0;
 const room=new GameRoom('R8',{mode:'deathmatch',bots:0,clock:()=>now});
 const p=room.addHuman({}, {name:'R8 QA',team:'CT',shotProtocol:1});
 room.giveWeapon(p,'revolver');delete p.inventory.usp;
 Object.assign(p,{weapon:'revolver',slot:2,x:0,y:0,z:0,grounded:true,protectionUntil:0,nextShotAt:0,equipReadyAt:0});
 room.traceBullet=({origin})=>({end:origin,hits:[]});room.events=[];
 const send=extra=>room.receiveInput(p.id,{seq:++seq,bodyId:p.id,lifeId:p.lifeId,forward:0,right:0,yaw:0,pitch:0,slot:2,fire:true,shotWeapon:'revolver',...extra});
 return {room,p,send,advance:ms=>now+=ms,now:()=>now,shots:()=>room.events.filter(e=>e.type==='shot')};
}

test('shared trigger supports zero time, cancellable preparation and immediate secondary priority',()=>{
 const trigger=new RevolverTrigger();assert.equal(trigger.startedAt,null);
 assert.equal(trigger.update({fire:true},0),null);assert.equal(trigger.startedAt,0);assert.equal(trigger.fireAt,250);
 assert.equal(trigger.update({fire:true},249),null);assert.equal(trigger.update({fire:true},250),'primary');
 assert.equal(trigger.update({fire:false},251),null);assert.equal(trigger.startedAt,null);
 trigger.update({fire:true},300);assert.equal(trigger.update({fire:true,fire2:true},301),'secondary');assert.equal(trigger.startedAt,null);
 trigger.update({fire:true},400);assert.equal(trigger.update({fire:true},700,false),null);assert.equal(trigger.startedAt,null);
 assert.equal(REVOLVER_PRIMARY_FIRE_DELAY_MS,250);assert.equal(weaponFireInterval(WEAPONS.revolver,'secondary'),.4);
 assert.equal(weaponFireInterval(WEAPONS.deagle,'secondary'),WEAPONS.deagle.fireInterval);
});

test('modern preparation inputs never create an unpredicted shot; prepared command fires once',()=>{
 const {room,p,send,advance,shots}=fixture();send({shotId:0});advance(250);room.tick();
 assert.equal(p.inventory.revolver.ammo,8);assert.equal(shots().length,0);
 send({shotId:1,yaw:.25,pitch:.1});room.tick();assert.equal(p.inventory.revolver.ammo,7);
 assert.equal(shots().length,1);assert.equal(shots()[0].fireMode,'primary');assert.equal(shots()[0].accuracy,.00252);
 assert.equal(shots()[0].aim.yaw,.25);assert.equal(p.nextShotAt-100250,500);
 send({shotId:1});advance(500);room.tick();assert.equal(shots().length,1);
});

test('explicit shot IDs cannot bypass preparation, and early release cancels a waiting shot',()=>{
 const {room,p,send,advance,shots}=fixture();send({shotId:1});room.tick();assert.equal(shots().length,0);
 advance(100);send({fire:false,shotId:0});advance(200);room.tick();
 assert.equal(p.inventory.revolver.ammo,8);assert.equal(shots().length,0);assert.equal(p.fireQueue.length,0);assert.equal(p.shotRejected.reason,'cancelled');
 send({shotId:2});advance(249);room.tick();assert.equal(shots().length,0);
 advance(1);room.tick();assert.equal(shots().length,1);assert.equal(p.inventory.revolver.ammo,7);
});

test('a slightly early command waits for the server deadline, preserving a completed click sample',()=>{
 const {room,p,send,advance,shots}=fixture();send({shotId:0});advance(240);send({shotId:1,yaw:.35,pitch:.12});
 room.tick();assert.equal(shots().length,0);advance(11);send({fire:false,shotId:0,yaw:1,pitch:1});room.tick();
 assert.equal(p.inventory.revolver.ammo,7);assert.ok(Math.abs(shots()[0].aim.yaw-.35)<1e-12);assert.equal(shots()[0].aim.pitch,.12);
 assert.equal(p.nextShotAt,100750);
});

test('secondary commands use the alternate accuracy and 400 ms cadence without preparation',()=>{
 const {room,p,send,advance,shots}=fixture();send({fire:false,fire2:true,shotId:1});room.tick();
 assert.equal(p.inventory.revolver.ammo,7);assert.equal(shots()[0].fireMode,'secondary');assert.equal(shots()[0].accuracy,.08);assert.equal(p.nextShotAt,100400);
 advance(250);send({fire:false,fire2:true,shotId:2});advance(149);room.tick();assert.equal(shots().length,1);
 advance(1);room.tick();assert.equal(shots().length,2);assert.equal(p.inventory.revolver.ammo,6);assert.equal(p.nextShotAt,100800);
 const player={grounded:true,crouch:true,vx:0,vz:0};assert.equal(accuracyForShot(WEAPONS.revolver,player,0,'secondary').total,.07300000000000001);
});

test('primary prepares during cooldown, retaining a 500 ms sustained cadence',()=>{
 const {room,p,send,advance,shots}=fixture();send({shotId:0});advance(250);send({shotId:1});room.tick();
 advance(20);send({shotId:0});advance(250);send({shotId:0});advance(229);send({shotId:2});room.tick();assert.equal(shots().length,1);
 advance(1);room.tick();assert.equal(shots().length,2);assert.equal(p.nextShotAt,101250);
});

test('release, switch, reload, death, freeze, match end and stale input reset primary preparation',()=>{
 for(const action of ['release','switch','reload','death','freeze','match','stale']){
  const {room,p,send,advance}=fixture();send({shotId:0});assert.notEqual(p.revolverTrigger.startedAt,null);advance(100);
  if(action==='release')send({fire:false});
  if(action==='switch')room.selectSlot(p,1);
  if(action==='reload'){p.inventory.revolver.ammo=7;room.reload(p);}
  if(action==='death')room.kill(p,null);
  if(action==='freeze'){room.round.phase='freeze';room.tick();}
  if(action==='match')room.endMatch('A','QA');
  if(action==='stale'){advance(300);room.tick();}
  assert.equal(p.revolverTrigger.startedAt,null,action);
 }
});

test('a spoofed alternate slot or weapon cannot enable an R8 secondary shot for another gun',()=>{
 const {room,p,send,shots}=fixture();room.selectSlot(p,1);p.nextShotAt=0;p.equipReadyAt=0;
 const originalWeapon=p.weapon,original=p.inventory[p.weapon].ammo;
 send({slot:2,fire:false,fire2:true,shotId:1,shotWeapon:'revolver'});room.tick();
 assert.equal(p.inventory[originalWeapon].ammo,original);assert.equal(p.inventory.revolver.ammo,8);assert.equal(shots().length,0);
});

test('both triggers consistently select secondary, and empty/reloading revolvers cannot shoot',()=>{
 const {room,p,send,advance,shots}=fixture();send({fire:true,fire2:true,shotId:1});room.tick();assert.equal(shots()[0].fireMode,'secondary');
 advance(400);p.inventory.revolver.ammo=0;send({fire:false,fire2:true,shotId:2});room.tick();assert.equal(p.inventory.revolver.ammo,0);assert.equal(shots().length,1);
 room.reload(p);advance(100);send({fire:false,fire2:true,shotId:3});room.tick();assert.equal(shots().length,1);assert.equal(p.revolverTrigger.startedAt,null);
});

test('taking over a bot clears its prior preparation and preserves modern shot negotiation',()=>{
 const {room,p,advance,shots}=fixture();room.mode='defuse';room.round.phase='live';p.alive=false;p.health=0;
 const body=room.makePlayer('r8-bot','R8 BOT','CT',true);room.players.set(body.id,body);
 room.giveWeapon(body,'revolver');delete body.inventory.usp;Object.assign(body,{weapon:'revolver',slot:2,equipReadyAt:0,nextShotAt:0,grounded:true,protectionUntil:0});
 room.fire(body,{fire:true,yaw:0,pitch:0});assert.notEqual(body.revolverTrigger.startedAt,null);advance(100);
 assert.equal(room.takeBot(p.id,body.id).ok,true);assert.equal(body.revolverTrigger.startedAt,null);assert.equal(body.shotCommands,true);
 const packet={bodyId:body.id,lifeId:body.lifeId,forward:0,right:0,yaw:0,pitch:0,slot:2,fire:true,shotWeapon:'revolver'};
 room.receiveInput(p.id,{...packet,seq:1,shotId:0});assert.equal(body.fireQueue.length,0);advance(250);
 room.receiveInput(p.id,{...packet,seq:2,shotId:1});assert.equal(body.fireQueue.length,1);room.fireQueued(body);
 assert.equal(body.inventory.revolver.ammo,7);assert.equal(shots().length,1);
 room.releaseBot(p.id);assert.equal(body.revolverTrigger.startedAt,null);
});

test('old R8 prediction rules are rejected and the matching deployment identity is accepted',()=>{
 assert.equal(RULES_VERSION,2);
 assert.ok(compatibilityError({rulesVersion:1,assetVersion:ASSET_VERSION}));
 assert.equal(compatibilityError({rulesVersion:RULES_VERSION,assetVersion:ASSET_VERSION}),null);
});
