import test from 'node:test';
import assert from 'node:assert/strict';
import {GameRoom,applyArmorDamage} from '../server/game.js';
import {initPhysics} from '../shared/physics.js';
import {getWeapon} from '../shared/weapons.js';
import {traceBullet} from '../server/bullet-penetration.js';

initPhysics([-200,0,-200,200,0,200,200,0,-200,-200,0,-200,-200,0,200,200,0,200]);
const packet=(seq,extra={})=>({seq,forward:0,right:0,yaw:0,pitch:0,...extra});
function fixture(mode='deathmatch'){
 let now=100000;const room=new GameRoom('REVIEW',{mode,bots:0,clock:()=>now});
 const a=room.addHuman({}, {name:'Shooter',team:'CT'}),b=room.addHuman({}, {name:'First',team:'T'}),c=room.addHuman({}, {name:'Second',team:'T'});
 for(const p of [a,b,c])Object.assign(p,{x:0,y:0,z:0,grounded:true,protectionUntil:0,nextShotAt:0});
 return {room,a,b,c,advance:ms=>now+=ms};
}

test('the 100th kill stops a penetrating shot before it changes another target health OR armor',()=>{
 const {room,a,b,c}=fixture();room.scores.CT=99;b.health=1;
 room.traceBullet=()=>({end:{x:0,y:1,z:-6},hits:[{playerId:b.id,distance:3},{playerId:c.id,distance:6,wallbang:true,penetrations:1}]});
 const before={health:c.health,armor:c.armor,deaths:c.deaths};room.fire(a,{fire:true,yaw:0,pitch:0});
 assert.equal(room.match.status,'ended');assert.equal(room.scores.CT,100);
 assert.deepEqual({health:c.health,armor:c.armor,deaths:c.deaths},before);
 assert.equal(room.events.filter(e=>e.type==='kill').length,1);
 assert.deepEqual(room.events.filter(e=>e.type==='hit').map(e=>e.targetId),[b.id]);
});

test('shotgun pellets still consume armor in order before applying one aggregate health hit',()=>{
 const {room,a,b}=fixture();room.buy(a.id,'nova');a.nextShotAt=0;b.armor=6;
 const w=getWeapon('nova'),expected={armor:b.armor,helmet:b.helmet};let damage=0;
 for(let i=0;i<w.pellets;i++)damage+=applyArmorDamage(w.damage,expected,{armorRatio:w.armorRatio}).damage;
 room.traceBullet=()=>({end:{x:0,y:1,z:0},hits:[{playerId:b.id,distance:0}]});room.fire(a,{fire:true,yaw:0,pitch:0});
 assert.equal(b.armor,expected.armor);assert.equal(b.health,Math.max(0,100-damage));
 assert.equal(room.events.filter(e=>e.type==='hit'&&e.targetId===b.id).length,1);
});

test('unknown concrete entry cannot use a different material face as its exit',()=>{
 const result=traceBullet({origin:{x:0,y:1,z:0},direction:{x:0,y:0,z:1},weapon:getWeapon('ak47'),shooter:{id:'a',team:'CT'},players:[{id:'b',alive:true,team:'T'}],now:100,rayHitPlayer:()=>({distance:5}),surfaces:[{distance:2,normal:{x:0,y:0,z:-1},material:0},{distance:2.05,normal:{x:0,y:0,z:1},material:1}]});
 assert.equal(result.hits.length,0);assert.equal(result.hitWorld,true);assert.equal(result.end.z,2);
});

test('a tap of E between simulation ticks picks up once and cannot repeatedly swap while held',()=>{
 const {room,a,b}=fixture();room.droppedWeapons.raycastWorld=()=>null;
 b.yaw=0;const result=room.dropWeapon(b.id),drop=room.droppedWeapons.items.find(d=>d.id===result.id);
 Object.assign(a,{x:drop.x,y:drop.y-.5,z:drop.z});
 room.receiveInput(a.id,packet(1,{interact:true}));room.receiveInput(a.id,packet(2,{interact:false}));room.tick();
 assert.equal(a.weapon,'ak47');assert.equal(room.events.filter(e=>e.type==='weapon_picked_up').length,1);
 room.tick();assert.equal(room.events.filter(e=>e.type==='weapon_picked_up').length,1);
 room.receiveInput(a.id,packet(3,{interact:true}));room.tick();
 const picks=room.events.filter(e=>e.type==='weapon_picked_up').length;
 for(let i=4;i<8;i++){room.receiveInput(a.id,packet(i,{interact:true}));room.tick();}
 assert.equal(room.events.filter(e=>e.type==='weapon_picked_up').length,picks);
});

test('waiting and freeze discard short fire/jump edges instead of replaying them on live start',()=>{
 const {room,a,advance}=fixture('defuse');room.maybeStart=()=>{};
 for(const phase of ['waiting','freeze']){
  room.round.phase=phase;room.round.phaseEndsAt=200000;
  room.giveWeapon(a,'hegrenade');room.giveWeapon(a,'m4a1');room.selectSlot(a,1);a.nextShotAt=0;
  const before=room.events.filter(e=>e.type==='shot'||e.type==='grenade_thrown').length;
  room.receiveInput(a.id,packet(phase==='waiting'?1:4,{slot:4,utilityId:'hegrenade',fire:true,jumpId:7,forward:1}));
  room.receiveInput(a.id,packet(phase==='waiting'?2:5,{slot:1,jumpId:7}));room.tick();
  assert.equal(a.grenadeState,null);assert.equal(a.pendingFire,false);assert.equal(a.lastJumpId,7);
  advance(250);room.round.phase='live';room.receiveInput(a.id,packet(phase==='waiting'?3:6,{slot:1,jumpId:7}));room.tick();
  assert.equal(room.events.filter(e=>e.type==='shot'||e.type==='grenade_thrown').length,before);
  assert.equal(a.vy,0);assert.equal(a.inventory.hegrenade.ammo,1);
 }
});

test('a held grenade cannot resume through respawn, side swap or a new player connection',()=>{
 const {room,a,advance}=fixture();room.buy(a.id,'flashbang');room.selectSlot(a,4,'flashbang');advance(500);
 room.receiveInput(a.id,packet(1,{slot:4,utilityId:'flashbang',fire:true}));assert.ok(a.grenadeState);
 room.kill(a,null);room.respawn(a);advance(500);
 room.receiveInput(a.id,packet(2,{slot:4,utilityId:'flashbang',fire:true}));room.tick();assert.equal(a.grenadeState,null);
 room.receiveInput(a.id,packet(3,{slot:4,utilityId:'flashbang'}));room.receiveInput(a.id,packet(4,{slot:4,utilityId:'flashbang',fire:true}));assert.ok(a.grenadeState);
 room.mode='defuse';room.pendingTransition={swapSides:true,resetMoney:800};room.startRound();assert.equal(a.team,'T');assert.equal(a.grenadeState,null);assert.equal(a.inventory.flashbang,undefined);
 const id=a.id;room.removePlayer(id);const joined=room.addHuman({}, {name:'Reconnect',team:'T'});
 assert.notEqual(joined.id,id);assert.equal(joined.lastReceivedSeq,-1);assert.equal(joined.grenadeState,null);assert.equal(joined.teamId,a.teamId);
});

test('freeze allows dropping and a single E pickup while movement, fire and bomb use stay blocked',()=>{
 const {room,a,b}=fixture('defuse');room.round.phase='freeze';room.round.phaseEndsAt=200000;
 room.giveWeapon(b,'ak47');room.selectSlot(b,1);b.nextShotAt=0;
 const ack=room.dropWeapon(b.id);assert.equal(ack.ok,true);assert.equal(b.inventory.ak47,undefined);
 const drop=room.droppedWeapons.items.find(item=>item.id===ack.id);room.droppedWeapons.raycastWorld=()=>null;
 Object.assign(a,{x:drop.x,y:0,z:drop.z,pitch:0,nextShotAt:0});const x=a.x,z=a.z,ammo=a.inventory.usp.ammo;
 room.receiveInput(a.id,packet(1,{forward:1,right:1,fire:true,interact:true}));room.tick();
 assert.equal(a.weapon,'ak47');assert.ok(Math.abs(a.x-x)<1e-7);assert.ok(Math.abs(a.z-z)<1e-7);
 assert.equal(a.inventory.usp.ammo,ammo);assert.equal(room.events.some(e=>e.type==='shot'),false);
 assert.equal(room.bomb.action,null);assert.equal(room.events.filter(e=>e.type==='weapon_picked_up').length,1);
 room.receiveInput(a.id,packet(2,{interact:true}));room.tick();assert.equal(room.events.filter(e=>e.type==='weapon_picked_up').length,1);
 room.round.phase='waiting';assert.equal(room.dropWeapon(a.id).ok,false);
});
