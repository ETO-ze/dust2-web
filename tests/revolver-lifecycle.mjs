import test from 'node:test';
import assert from 'node:assert/strict';
import {GameRoom} from '../server/game.js';
import {initPhysics} from '../shared/physics.js';
import {getWeapon,normalizeWeapon} from '../shared/weapons.js';
import {loadoutCandidates,normalizeWeaponLoadout,canReplaceLoadoutSlot,replaceLoadoutSlot} from '../shared/weapon-loadout.js';
import {reloadProfile} from '../shared/reload-profiles.js';
import {REVOLVER_PRIMARY_FIRE_DELAY_MS} from '../shared/revolver.js';

// A local floor and deterministic bullet traces avoid optional downloaded assets.
initPhysics([-200,0,-200,200,0,200,200,0,-200,-200,0,-200,-200,0,200,200,0,200]);

const trigger={fire:true,fire2:false,yaw:0,pitch:0};
function fixture(team='CT'){
  let time=100000;
  const room=new GameRoom('R8QA',{mode:'defuse',bots:0,clock:()=>time});
  room.round.phase='freeze';room.round.buyEndsAt=time+30000;
  const player=room.makePlayer('shooter','R8 QA',team,false,'auto',normalizeWeaponLoadout(null));
  room.players.set(player.id,player);player.money=16000;player.protectionUntil=0;
  room.traceBullet=()=>({end:{x:0,y:1,z:-10},hitWorld:false,hits:[]});
  return {room,player,now:()=>time,advance:ms=>time+=ms};
}
function equip(f,alias='revolver'){
  const {room,player}=f;
  assert.equal(room.setWeaponLoadout(player.id,replaceLoadoutSlot(player.weaponLoadout,player.team,'pistols',1,'revolver')).ok,true);
  assert.equal(room.buy(player.id,alias).ok,true);
  f.advance(200);player.nextShotAt=0;room.round.phase='live';
  return player.inventory.revolver;
}
function shotCount(room){return room.events.filter(e=>e.type==='shot'&&e.weapon==='revolver').length;}
function firePrimary(f){
  f.room.fire(f.player,trigger);
  f.advance(REVOLVER_PRIMARY_FIRE_DELAY_MS);
  f.room.fire(f.player,trigger);
}

test('R8 is selectable by both teams in a non-starting pistol slot and requires configuration before purchase',()=>{
  for(const team of ['CT','T']){
    const {room,player}=fixture(team);
    assert(loadoutCandidates(team,'pistols').includes('revolver'),team);
    assert(!player.weaponLoadout[team].pistols.includes('revolver'),team);
    assert.equal(canReplaceLoadoutSlot(team,'pistols',0,'revolver'),false,team);
    for(const index of [1,2,3,4])assert.equal(canReplaceLoadoutSlot(team,'pistols',index,'revolver'),true,team);
    const rejected=room.buy(player.id,'revolver');
    assert.equal(rejected.ok,false);assert.match(rejected.message,/未加入/);
    assert.equal(player.money,16000);assert.equal(player.inventory.revolver,undefined);
  }
});

test('configured R8 and its aliases purchase for $600 with eight loaded and sixteen reserve rounds on both teams',()=>{
  for(const team of ['CT','T'])for(const alias of ['revolver','r8','r8-revolver']){
    assert.equal(normalizeWeapon(alias),'revolver');
    const f=fixture(team),ammo=equip(f,alias),{player,room}=f;
    assert.equal(player.weapon,'revolver');assert.equal(player.slot,2);
    assert.equal(player.money,15400);assert.deepEqual(ammo,{ammo:8,reserve:16});
    assert(room.events.some(e=>e.type==='buy'&&e.weapon==='revolver'&&e.money===15400));
    assert(room.events.every(e=>e.weapon!=='r8'&&e.weapon!=='r8-revolver'));
  }
});

test('R8 primary fire waits for the hammer, consumes one round, obeys its 500 ms cooldown, and stops when empty',()=>{
  const f=fixture(),ammo=equip(f),{room,player}=f;
  room.fire(player,trigger);assert.equal(ammo.ammo,8);assert.equal(shotCount(room),0);
  f.advance(249);room.fire(player,trigger);assert.equal(ammo.ammo,8);
  f.advance(1);room.fire(player,trigger);assert.equal(ammo.ammo,7);assert.equal(ammo.reserve,16);assert.equal(shotCount(room),1);
  room.fire(player,trigger);f.advance(499);room.fire(player,trigger);
  assert.equal(ammo.ammo,7);assert.equal(shotCount(room),1);
  f.advance(1);room.fire(player,trigger);assert.equal(ammo.ammo,6);assert.equal(shotCount(room),2);
  for(let i=0;i<6;i++){room.fire(player,trigger);f.advance(500);room.fire(player,trigger);}
  assert.equal(ammo.ammo,0);assert.equal(shotCount(room),8);
  f.advance(500);room.fire(player,trigger);
  assert.equal(ammo.ammo,0);assert.equal(ammo.reserve,16);assert.equal(shotCount(room),8);
});

test('R8 reload commits eight rounds at its milestone and cannot fire before reload completion',()=>{
  const f=fixture(),ammo=equip(f),{room,player}=f;ammo.ammo=0;
  const start=f.now(),weapon=getWeapon('revolver');room.reload(player);
  const end=player.reloadEndsAt,commit=player.reloadAmmoAt;
  assert.equal(end,start+weapon.reloadTime*1000);
  assert.equal(commit,start+reloadProfile('revolver',true).commitFraction*weapon.reloadTime*1000);
  f.advance(commit-f.now()-1);room.commitReload(player);room.fire(player,trigger);
  assert.equal(ammo.ammo,0);assert.equal(ammo.reserve,16);assert.equal(shotCount(room),0);
  f.advance(1);room.commitReload(player);room.commitReload(player);
  assert.equal(ammo.ammo,8);assert.equal(ammo.reserve,8);assert.equal(ammo.reloadReadyAt,end);
  room.fire(player,trigger);assert.equal(ammo.ammo,8);assert.equal(shotCount(room),0);
  f.advance(end-f.now());room.finishReload(player);firePrimary(f);
  assert.equal(player.reloadEndsAt,0);assert.equal(ammo.ammo,7);assert.equal(ammo.reserve,8);assert.equal(shotCount(room),1);
});

test('canceling R8 reload preserves early ammo and cannot bypass the committed reload attack lock',()=>{
  const f=fixture(),ammo=equip(f),{room,player}=f;ammo.ammo=1;
  room.reload(player);f.advance(player.reloadAmmoAt-f.now()-1);room.cancelReload(player);
  assert.equal(ammo.ammo,1);assert.equal(ammo.reserve,16);
  room.reload(player);const end=player.reloadEndsAt;f.advance(player.reloadAmmoAt-f.now());
  room.selectSlot(player,3);assert.equal(ammo.ammo,8);assert.equal(ammo.reserve,8);
  room.selectSlot(player,2);player.nextShotAt=0;room.fire(player,trigger);
  assert.equal(ammo.ammo,8);assert.equal(shotCount(room),0);
  f.advance(end-f.now()-1);room.fire(player,trigger);assert.equal(ammo.ammo,8);
  f.advance(1);firePrimary(f);assert.equal(ammo.ammo,7);assert.equal(shotCount(room),1);
});

test('an authoritative R8 trace applies 86 close-range unarmored body damage and emits matching hit evidence',()=>{
  const f=fixture(),ammo=equip(f),{room,player}=f;
  const target=room.makePlayer('target','Target','T',false);
  Object.assign(target,{health:100,armor:0,helmet:false,protectionUntil:0});room.players.set(target.id,target);
  room.traceBullet=()=>({end:{x:0,y:1,z:0},hitWorld:false,hits:[{playerId:target.id,distance:0,headshot:false}]});
  firePrimary(f);
  assert.equal(ammo.ammo,7);assert.equal(target.health,14);assert.equal(target.alive,true);
  const hits=room.events.filter(e=>e.type==='hit');assert.equal(hits.length,1);
  assert.equal(hits[0].weapon,'revolver');assert.equal(hits[0].targetId,target.id);assert.equal(hits[0].damage,86);
  assert.equal(hits[0].headshot,false);assert.equal(hits[0].armor,false);
});
