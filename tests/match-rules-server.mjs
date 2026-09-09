import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {WebSocket} from 'ws';
import {GameRoom,sanitizeInput} from '../server/game.js';
import {initPhysics} from '../shared/physics.js';
import {defuseDecision} from '../shared/match-rules.js';
import {BOT_AIM,smoothBotAim,angleDifference} from '../server/bot-aim.js';
import {GrenadeSimulation} from '../server/grenades.js';
import {DroppedWeapons} from '../server/dropped-weapons.js';
import {startGameServer} from '../server/index.js';

initPhysics([-200,0,-200,200,0,200,200,0,-200,-200,0,-200,-200,0,200,200,0,200]);
const packet=(seq,extra={})=>({seq,forward:0,right:0,yaw:0,pitch:0,...extra});
function fixture(mode='deathmatch',bots=0){
  let now=100000;const room=new GameRoom('MATCHQA',{mode,bots,clock:()=>now,traceBullet:null});
  const a=room.addHuman({}, {name:'A',team:'CT',agents:{CT:'ct-ava',T:'t-miami'}});
  const b=room.addHuman({}, {name:'B',team:'T'});
  Object.assign(a,{x:0,y:0,z:0,protectionUntil:0,nextShotAt:0});Object.assign(b,{x:0,y:0,z:-8,protectionUntil:0,nextShotAt:0});
  return {room,a,b,advance:ms=>{now+=ms;},now:()=>now};
}
function winRound(room,teamId){room.round.phase='live';room.endRound(room.teamSides[teamId],'test');}

test('MR12 swaps sides after 12 rounds while preserving team identity, score and both agent choices',()=>{
  const {room,a}=fixture('defuse');const identity=a.teamId,skins={...a.skins};
  for(let i=0;i<12;i++){winRound(room,i<7?'A':'B');if(i<11)room.startRound();}
  assert.equal(a.team,'CT');assert.equal(room.matchSnapshot().teams.A.score,7);
  room.startRound();assert.equal(a.team,'T');assert.equal(a.teamId,identity);assert.equal(a.agentId,'t-miami');assert.equal(a.agents.CT,'ct-ava');assert.deepEqual(a.skins,skins);
  assert.equal(a.money,800);assert.deepEqual(Object.keys(a.inventory).sort(),['c4','knife','pistol']);assert.equal(room.scores.T,7);assert.equal(room.scores.CT,5);
  const transition=room.events.find(event=>event.type==='sides_swapped');assert.equal(transition.kind,'halftime');assert.equal(transition.teams.A.side,'T');
  for(let i=0;i<6;i++){winRound(room,'A');if(i<5)room.startRound();}
  assert.equal(room.match.status,'ended');assert.equal(room.match.winnerTeamId,'A');assert.equal(room.round.phase,'matchEnded');assert.equal(room.matchSnapshot().teams.A.score,13);
  const round=room.round.number;room.startRound();room.tick();assert.equal(room.round.number,round);assert.equal(room.events.filter(event=>event.type==='match_end').length,1);
});

test('12–12 enters MR3, switches every three overtime rounds and repeats a tied set',()=>{
  const {room,a}=fixture('defuse');
  for(let i=0;i<24;i++){winRound(room,i%2?'B':'A');room.startRound();}
  assert.equal(room.match.period,'overtime');assert.equal(room.match.winTarget,16);assert.equal(room.match.overtimeNumber,1);assert.equal(a.money,10000);
  const initialSide=a.team;
  for(const team of ['A','B','A']){winRound(room,team);room.startRound();}
  assert.notEqual(a.team,initialSide);assert.equal(a.money,10000);
  for(const team of ['B','A','B']){winRound(room,team);room.startRound();}
  assert.equal(a.team,initialSide);assert.equal(room.match.overtimeNumber,2);assert.equal(room.match.winTarget,19);assert.equal(room.match.status,'live');
  for(let i=0;i<4;i++){winRound(room,'A');if(i<3)room.startRound();}
  assert.equal(room.match.winnerTeamId,'A');assert.equal(room.matchSnapshot().teams.A.score,19);
  assert.equal(defuseDecision({A:13,B:12},25).winnerTeamId,null);
});

test('deathmatch ends exactly at 100 enemy kills and freezes score, damage and respawn',()=>{
  const {room,a,b,advance}=fixture();
  for(let i=0;i<99;i++){b.alive=true;b.health=100;room.kill(b,a,'m4a1');}
  assert.equal(room.match.status,'live');assert.equal(room.scores.CT,99);
  b.alive=true;b.health=100;room.kill(b,a,'m4a1');assert.equal(room.scores.CT,100);assert.equal(room.match.winnerTeamId,a.teamId);assert.equal(b.respawnAt,0);
  b.alive=true;b.health=100;room.kill(b,a,'m4a1');assert.equal(room.scores.CT,100);assert.equal(b.health,100);
  room.damagePlayer(b,a,100,'hegrenade');assert.equal(b.health,100);
  a.input=packet(1,{forward:1,fire:true});a.inputAt=100000;const start=a.z;advance(4000);room.tick();assert.equal(a.z,start);assert.equal(room.buy(a.id,'awp').ok,false);
  assert.ok(room.droppedWeapons.items.length<=64);
});

test('room owner chooses exact bots from 0 to 9, capacity is 10 and ownership transfers',()=>{
  const {room,a,b}=fixture('defuse');assert.equal(room.hostId,a.id);
  assert.equal(room.setBots(b.id,9).ok,false);assert.equal(room.setBots(a.id,9).ok,true);assert.equal(room.desiredBots,9);assert.equal(room.botCount,8);assert.equal(room.players.size,10);
  for(const bad of [-1,10,1.5,'3',{},null])assert.equal(room.setBots(a.id,bad).ok,false);
  room.removePlayer(a.id);room.ensureBots();assert.equal(room.hostId,b.id);assert.equal(room.botCount,9);assert.equal(room.players.size,10);assert.ok(room.count('T')<=5&&room.count('CT')<=5);
  assert.equal(room.setBots(b.id,0).ok,true);assert.equal(room.botCount,0);
});

test('bot aim uses shortest arcs and bounded speeds, settling before any shot',()=>{
  const dt=1/30,initial={yaw:Math.PI-.01,pitch:0};
  const wrapped=smoothBotAim(initial,{yaw:-Math.PI+.01,pitch:0},dt);assert.ok(Math.abs(angleDifference(wrapped.yaw,initial.yaw))<.02);
  const {room,a,b,advance}=fixture();a.bot=true;a.id='b_100';a.yaw=Math.PI;a.pitch=0;room.visibleToBot=()=>true;a.botAI.path=[];a.botAI.goal=null;
  let fired=false;
  for(let i=0;i<180;i++){
    advance(1000/30);const before={yaw:a.yaw,pitch:a.pitch},input=room.botInput(a,dt);
    assert.ok(Math.abs(angleDifference(input.yaw,before.yaw))<=BOT_AIM.maxYawSpeed*dt+1e-8);assert.ok(Math.abs(input.pitch-before.pitch)<=BOT_AIM.maxPitchSpeed*dt+1e-8);
    if(i<10)assert.equal(input.fire,false);
    if(input.fire){assert.ok(a.botAI.alignedFor>=BOT_AIM.settleSeconds);fired=true;}
    a.yaw=input.yaw;a.pitch=input.pitch;
  }
  assert.equal(fired,true);
});

test('held pin has no fuse; releasing throws once and preserves fast press/release edges',()=>{
  const {room,a,advance}=fixture();room.buy(a.id,'hegrenade');room.selectSlot(a,4,'hegrenade');advance(201);
  room.receiveInput(a.id,packet(1,{slot:4,utilityId:'hegrenade',fire:true}));
  for(let i=0;i<20;i++){advance(100);room.receiveInput(a.id,packet(i+2,{slot:4,utilityId:'hegrenade',fire:true}));room.tick();}
  assert.equal(room.grenades.projectiles.length,0);assert.equal(a.inventory.hegrenade.ammo,1);assert.equal(room.snapshot().players.find(p=>p.id===a.id).grenadeState.state,'primed');
  room.receiveInput(a.id,packet(22,{slot:4,utilityId:'hegrenade'}));room.tick();assert.equal(room.grenades.projectiles.length,1);assert.equal(a.inventory.hegrenade,undefined);assert.equal(room.grenades.projectiles[0].throwMode,'full');
  assert.equal(room.receiveInput(a.id,packet(22,{slot:4,utilityId:'hegrenade',fire:true})),false);room.tick();assert.equal(room.grenades.projectiles.length,1);
  room.buy(a.id,'flashbang');advance(1100);room.receiveInput(a.id,packet(23,{slot:4,utilityId:'flashbang'}));room.tick();advance(201);
  room.receiveInput(a.id,packet(24,{slot:4,utilityId:'flashbang',fire:true}));room.receiveInput(a.id,packet(25,{slot:4,utilityId:'flashbang'}));advance(210);room.tick();assert.equal(a.inventory.flashbang,undefined);
});

test('secondary and chord throws differ; switching, cancel, death and timeout never consume primed ammo',()=>{
  const sim=new GrenadeSimulation();const p={id:'p',team:'T',x:0,y:0,z:0};
  for(const [throwMode,throwStrength]of [['drop',0],['lob',.5],['full',1]])sim.throwGrenade(p,'hegrenade',{yaw:0,pitch:0,throwMode,throwStrength});
  const speeds=sim.projectiles.map(g=>Math.hypot(g.vx,g.vy,g.vz));assert.ok(speeds[0]<speeds[1]&&speeds[1]<speeds[2]);
  for(const action of ['switch','cancel','death','timeout']){
    const {room,a,advance}=fixture();room.buy(a.id,'flashbang');room.selectSlot(a,4,'flashbang');advance(201);room.receiveInput(a.id,packet(1,{slot:4,utilityId:'flashbang',fire2:true}));
    if(action==='switch')room.receiveInput(a.id,packet(2,{slot:1,fire2:true}));
    else if(action==='cancel')room.receiveInput(a.id,packet(2,{slot:4,utilityId:'flashbang',cancelGrenade:true}));
    else if(action==='death')room.kill(a,null);
    else advance(400);
    room.tick();assert.equal(room.grenades.projectiles.length,0,action);assert.equal(a.inventory.flashbang.ammo,1,action);assert.equal(a.grenadeState,null,action);
  }
  const {room,a,advance}=fixture();room.buy(a.id,'hegrenade');room.selectSlot(a,4,'hegrenade');advance(201);
  room.receiveInput(a.id,packet(1,{slot:4,utilityId:'hegrenade',fire:true,fire2:true}));advance(220);room.receiveInput(a.id,packet(2,{slot:4,utilityId:'hegrenade',fire:true,fire2:true}));
  room.receiveInput(a.id,packet(3,{slot:4,utilityId:'hegrenade',fire2:true}));advance(10);room.receiveInput(a.id,packet(4,{slot:4,utilityId:'hegrenade'}));room.tick();assert.equal(room.grenades.projectiles[0].throwMode,'lob');
  assert.equal(sanitizeInput(packet(1,{fire2:'yes'})).fire2,false);
});

test('a grenade press during equip cooldown is buffered until both preparation and release complete',()=>{
  const {room,a,advance}=fixture();room.buy(a.id,'hegrenade');room.selectSlot(a,4,'hegrenade');
  room.receiveInput(a.id,packet(1,{slot:4,utilityId:'hegrenade',fire:true}));room.receiveInput(a.id,packet(2,{slot:4,utilityId:'hegrenade'}));
  room.tick();assert.equal(room.grenades.projectiles.length,0);advance(210);room.tick();assert.equal(room.grenades.projectiles.length,1);assert.equal(a.inventory.hegrenade,undefined);
});

test('dropped guns preserve skin/ammo, allow enemy guns, swap slots and stay bounded',()=>{
  const {room,a,b,advance}=fixture();const skin=room.heldSkin(b);b.inventory.ak47={ammo:7,reserve:32};b.yaw=0;
  const result=room.dropWeapon(b.id);assert.equal(result.ok,true);assert.equal(b.inventory.ak47,undefined);const dropped=room.droppedWeapons.items[0];
  assert.equal(dropped.skinId,skin);assert.equal(dropped.ammo,7);assert.equal(dropped.reserve,32);
  Object.assign(a,{x:dropped.x,y:dropped.y-.5,z:dropped.z,yaw:0});assert.equal(room.buy(a.id,'ak47').ok,false);assert.equal(room.pickupWeapon(a),true);assert.equal(a.weapon,'ak47');assert.equal(a.inventory.ak47.ammo,7);assert.equal(room.heldSkin(a),skin);assert.ok(room.droppedWeapons.items.some(item=>item.weaponId==='m4a1'));
  assert.ok(room.events.filter(e=>e.type==='weapon_dropped'||e.type==='weapon_picked_up').every(e=>e.id.startsWith('MATCHQA:')&&e.droppedId.startsWith('drop_')));
  const blocked=room.droppedWeapons.items[0];Object.assign(a,{x:blocked.x,y:blocked.y-.5,z:blocked.z});room.droppedWeapons.raycastWorld=()=>.01;assert.equal(room.pickupWeapon(a),false);
  for(let i=0;i<100;i++)room.droppedWeapons.drop(a,{weaponId:'ak47',skinId:skin,ammo:1,reserve:0});assert.equal(room.droppedWeapons.items.length,64);advance(120001);room.droppedWeapons.tick(0);assert.equal(room.droppedWeapons.items.length,0);
  const defuse=fixture('defuse');defuse.room.round.phase='live';defuse.room.bomb={state:'planted',x:defuse.a.x,y:defuse.a.y,z:defuse.a.z};defuse.room.droppedWeapons.drop(defuse.a,{weaponId:'ak47',skinId:skin,ammo:1,reserve:0});assert.equal(defuse.room.pickupWeapon(defuse.a),false);
});

test('real sockets enforce owner-only bot changes and drop message bounds',{timeout:15000},async t=>{
  const app=await startGameServer({port:0,host:'127.0.0.1'});t.after(()=>app.close());
  async function peer(settings){const ws=new WebSocket(`ws://127.0.0.1:${app.port}/ws`),messages=[];ws.on('message',raw=>messages.push(JSON.parse(raw)));await once(ws,'open');
    const send=value=>ws.send(JSON.stringify(value));const wait=async predicate=>{for(let i=0;i<300;i++){const index=messages.findIndex(predicate);if(index>=0)return messages.splice(index,1)[0];await delay(10);}throw Error('Socket response timeout');};
    send({type:'join',name:'Rules QA',room:'RULEWIRE',bots:0,...settings});return {ws,send,wait,welcome:await wait(m=>m.type==='welcome')};}
  const owner=await peer({}),other=await peer({});t.after(()=>{owner.ws.terminate();other.ws.terminate();});
  assert.equal(owner.welcome.mode,'defuse');assert.equal(owner.welcome.hostId,owner.welcome.id);assert.equal(other.welcome.hostId,owner.welcome.id);
  other.send({type:'setBots',bots:9});assert.equal((await other.wait(m=>m.type==='error')).code,'BOTS_REJECTED');
  owner.send({type:'setBots',bots:9});const ack=await owner.wait(m=>m.type==='botsUpdated');assert.equal(ack.bots,9);assert.equal(ack.botCount,8);
  const room=app.rooms.get('RULEWIRE');assert.equal(room.players.size,10);owner.send({type:'setBots',bots:0});assert.equal((await owner.wait(m=>m.type==='error')).code,'BOTS_RATE');
  owner.ws.close();await once(owner.ws,'close');await delay(80);assert.equal(room.hostId,other.welcome.id);assert.equal(room.botCount,9);
  await delay(260);other.send({type:'setBots',bots:0});assert.equal((await other.wait(m=>m.type==='botsUpdated')).botCount,0);
  room.round.phase='live';const player=room.players.get(other.welcome.id);player.alive=true;room.giveWeapon(player,'awp');room.selectSlot(player,1);
  other.send({type:'dropWeapon'});assert.equal((await other.wait(m=>m.type==='weaponDropped')).weaponId,'awp');other.send({type:'dropWeapon'});assert.equal((await other.wait(m=>m.type==='error')).code,'DROP_RATE');
});
