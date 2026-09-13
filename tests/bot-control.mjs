import test from 'node:test';
import assert from 'node:assert/strict';
import {BoxGeometry} from 'three';
import {initPhysics} from '../shared/physics.js';
import {GameRoom} from '../server/game.js';
import {MatchView} from '../client/match-view.js';

function fixture(){
  const floor=new BoxGeometry(500,1,500).toNonIndexed();floor.translate(0,-.5,0);initPhysics(floor.attributes.position.array);floor.dispose();
  let now=100000;const room=new GameRoom('CONTROL',{bots:0,clock:()=>now});
  const a=room.addHuman({}, {name:'Alice',team:'CT',movementProtocol:1});
  const b=room.addHuman({}, {name:'Bob',team:'CT'});
  const bots=['CT','CT','T'].map((team,i)=>{const p=room.makePlayer('b_'+i,'BOT '+i,team,true);room.players.set(p.id,p);return p;});
  room.startRound();room.round.phase='live';room.round.phaseEndsAt=now+115000;
  a.alive=b.alive=false;a.health=b.health=0;
  room.botInput=p=>({...p.input,forward:0,right:0,fire:false,fire2:false,interact:false});
  for(const p of room.players.values())Object.assign(p,{x:p.seat*5,y:0,z:p.team==='CT'?0:40,grounded:true,protectionUntil:0});
  return {room,a,b,bots,tick:()=>{now+=1000/30;room.tick();}};
}
const input=(seq,body,extra={})=>({seq,bodyId:body.id,lifeId:body.lifeId,forward:0,right:0,yaw:0,pitch:0,...extra});

test('takeover is exclusive, friendly, dead-only, and limited to live defuse rounds',()=>{
  const {room,a,b,bots}=fixture();
  for(const target of [a.id,b.id,bots[2].id,'missing'])assert.equal(room.takeBot(a.id,target).ok,false);
  a.alive=true;assert.equal(room.takeBot(a.id,bots[0].id).ok,false);a.alive=false;
  bots[0].alive=false;assert.equal(room.takeBot(a.id,bots[0].id).ok,false);bots[0].alive=true;
  for(const phase of ['freeze','ended','matchEnded']){room.round.phase=phase;assert.equal(room.takeBot(a.id,bots[0].id).ok,false);}
  room.round.phase='live';room.mode='deathmatch';assert.equal(room.takeBot(a.id,bots[0].id).ok,false);room.mode='defuse';
  assert.equal(room.takeBot(a.id,bots[0].id).ok,true);
  assert.equal(room.takeBot(b.id,bots[0].id).ok,false);
  assert.equal(room.takeBot(a.id,bots[1].id).ok,false);
});
test('handoff keeps the body, inventory, C4, health, reload and cooldown; cancels old commands',()=>{
  const {room,a,bots}=fixture(),body=bots[0];
  Object.assign(body,{health:37,armor:26,money:1300,defuseKit:true,crouch:true,zoomLevel:1,nextShotAt:101000,reloadEndsAt:102000});
  room.giveWeapon(body,'hegrenade');body.grenadeState={weapon:'hegrenade',mode:'full',primedAt:99900};body.fireQueue=[{input:{fire:true}}];
  const inventory=structuredClone(body.inventory),pose=[body.x,body.y,body.z],life=body.lifeId;
  const living=[...room.players.values()].filter(p=>p.alive).length;
  assert.equal(room.takeBot(a.id,body.id).ok,true);
  assert.deepEqual(body.inventory,inventory);assert.deepEqual([body.x,body.y,body.z],pose);
  assert.equal(body.health,37);assert.equal(body.armor,26);assert.equal(body.money,1300);assert.equal(body.defuseKit,true);
  assert.equal(body.reloadEndsAt,102000);assert.equal(body.nextShotAt,101000);assert.equal(body.lifeId,life+1);
  assert.equal(body.grenadeState,null);assert.equal(body.fireQueue.length,0);assert.equal(body.movementStream.lifeId,body.lifeId);
  assert.equal(room.grenades.snapshot().grenades.length,0);assert.equal(a.alive,false);
  assert.equal([...room.players.values()].filter(p=>p.alive).length,living);
});
test('only authenticated owner drives movement and equipment; old body packets are ignored',()=>{
  const {room,a,b,bots,tick}=fixture(),body=bots[0];room.takeBot(a.id,body.id);
  assert.equal(room.receiveInput(a.id,input(1,a,{fire:true})),true);assert.equal(body.input.fire,false);
  room.receiveInput(b.id,input(1,body,{fire:true}));assert.equal(body.input.fire,false);
  room.receiveInput(a.id,input(2,body,{slot:3,yaw:.6,moves:[{id:1,lifeId:body.lifeId,forward:1,right:0,yaw:.6,pitch:0,speedScale:1}]}));
  const start={x:body.x,z:body.z};tick();assert.equal(body.weapon,'knife');assert.ok(Math.abs(body.yaw-.6)<1e-9);
  assert.ok(Math.hypot(body.x-start.x,body.z-start.z)>0);assert.equal(body.movementStream.ack,1);
  room.giveWeapon(body,'m4a1');body.weapon='m4a1';body.slot=1;
  assert.equal(room.dropWeapon(a.id).ok,true);assert.equal(body.inventory.m4a1,undefined);
  assert.equal(room.snapshot().players.find(p=>p.id===a.id).controlledBotId,body.id);
});
test('controlled kills credit the human once, and another bot can be taken after death',()=>{
  const {room,a,bots}=fixture(),body=bots[0],enemy=bots[2];room.takeBot(a.id,body.id);
  room.kill(enemy,body,'ak47',true);assert.equal(a.kills,1);assert.equal(body.kills,0);
  const event=room.events.findLast(e=>e.type==='kill');assert.equal(event.killerId,body.id);assert.equal(event.killerControllerId,a.id);assert.equal(event.killerName,a.name);
  room.kill(body,null);assert.equal(a.controlledBotId,body.id);
  assert.equal(room.takeBot(a.id,bots[1].id).ok,true);assert.equal(body.controllerId,undefined);
});
test('disconnect returns the living bot to AI; team change, removal and next round clear ownership',()=>{
  for(const action of ['disconnect','team','remove','round']){
    const {room,a,bots,tick}=fixture(),body=bots[0];room.takeBot(a.id,body.id);
    if(action==='disconnect')room.removePlayer(a.id);
    if(action==='team')assert.equal(room.takeSeat(a.id,'T',4).ok,true);
    if(action==='remove')room.removePlayer(body.id);
    if(action==='round')room.startRound();
    assert.equal(a.controlledBotId,undefined);assert.equal(body.controllerId,undefined);
    if(action==='disconnect'){assert.equal(body.alive,true);assert.equal(body.movementStream,null);assert.equal(body.input.fire,false);tick();}
    if(action==='round')assert.equal(a.alive,true);
  }
});
test('E hint follows the current spectator and respects the death camera delay',()=>{
  const view=new MatchView(),self={id:'self',team:'CT',alive:false};
  const bot={id:'bot',team:'CT',alive:true,bot:true},human={id:'human',team:'CT',alive:true};
  const snapshot={mode:'defuse',round:{phase:'live'},players:[self,bot,human]};view.update(self,snapshot,100);
  assert.equal(view.takeoverTarget(self,snapshot,200),null);assert.equal(view.takeoverTarget(self,snapshot,1700),bot);
  view.cycle(self,snapshot);assert.equal(view.takeoverTarget(self,snapshot,1700),null);view.cycle(self,snapshot);
  bot.controllerId='other';assert.equal(view.takeoverTarget(self,snapshot,1700),null);
});
