import test from 'node:test';import assert from 'node:assert/strict';
import {GameRoom} from '../server/game.js';import {initPhysics} from '../shared/physics.js';import {MAP} from '../shared/map-data.js';
import {snapshotForSide} from '../server/snapshot-view.js';import {botSharing} from '../server/team-social.js';
initPhysics([-200,0,-200,200,0,200,200,0,-200,-200,0,-200,-200,0,200,200,0,200]);
function fixture(){let now=100000;const room=new GameRoom('SOCIAL',{bots:0,clock:()=>now});const a=room.addHuman({}, {name:'真人',team:'CT'}),b=room.makePlayer('b_1','需要枪','CT',true),enemy=room.makePlayer('b_2','敌人','T',true);for(const p of [b,enemy])room.players.set(p.id,p);room.startRound();for(const [i,p]of [a,b].entries())Object.assign(p,MAP.spawns.CT[0],{x:MAP.spawns.CT[0].x+i*2,money:i?100:16000,alive:true});return {room,a,b,enemy,advance:ms=>now+=ms};}
test('team text and request lists never reach opponents, dead author state and literal markup are retained',()=>{
 const {room,a,b}=fixture();a.alive=false;assert.ok(room.chat(a.id,'<img src=x onerror=1> 中文','team').ok);const e=room.events.at(-1);assert.equal(e.dead,true);assert.equal(e.name,'真人');assert.ok(snapshotForSide(room.snapshot({drainEvents:false}),'CT').events.some(e=>e.type==='chat'));assert.ok(!snapshotForSide(room.snapshot({drainEvents:false}),'T').events.some(e=>e.type==='chat'));
 a.alive=true;room.requestWeapon(b.id,'m4a1');assert.equal(snapshotForSide(room.snapshot({drainEvents:false}),'T').weaponRequests.length,0);
});
test('chat validates channels, strips control chars, bounds length and rate limits each author',()=>{
 const {room,a,advance}=fixture();assert.equal(room.chat(a.id,'hello','invalid').ok,false);room.chat(a.id,'你'.repeat(180)+'\n','all');assert.equal([...room.events.at(-1).text].length,160);room.chat(a.id,'2','all');room.chat(a.id,'3','all');assert.equal(room.chat(a.id,'4','all').ok,false);advance(2000);assert.equal(room.chat(a.id,'再来','all').ok,true);
});
test('donation spends real cash once and drops a skinned gun without replacing donor inventory',()=>{
 const {room,a,b}=fixture();room.giveWeapon(a,'awp');room.selectSlot(a,1);const inventory=structuredClone(a.inventory);assert.ok(room.requestWeapon(b.id,'m4a1').ok);const result=room.donateWeapon(a.id,b.id,'m4a1');assert.ok(result.ok);assert.equal(a.money,13100);assert.deepEqual(a.inventory,inventory);assert.equal(a.weapon,'awp');const drop=room.droppedWeapons.items.find(i=>i.id===result.droppedId);assert.equal(drop.intendedFor,b.id);assert.equal(drop.skinId,a.skins.m4a1);assert.equal(room.donateWeapon(a.id,b.id,'m4a1').ok,false);
});
test('enemies, dead/outside buyers, invalid requests and insufficient funds cannot donate',()=>{
 const {room,a,b,enemy}=fixture();room.requestWeapon(b.id,'m4a1');assert.equal(room.donateWeapon(enemy.id,b.id,'ak47').ok,false);a.money=100;assert.equal(room.donateWeapon(a.id,b.id,'m4a1').ok,false);a.money=16000;b.alive=false;assert.equal(room.donateWeapon(a.id,b.id,'m4a1').ok,false);b.alive=true;a.x+=100;assert.equal(room.donateWeapon(a.id,b.id,'m4a1').ok,false);
});
test('Ctrl-style generic donation creates a ground gun and bots request and fulfil equipment with their own funds',()=>{
 const {room,a,b,advance}=fixture();assert.ok(room.donateWeapon(a.id,null,'m4a1').ok);a.bot=true;room.giveWeapon(a,'m4a1');a.armor=100;room.teamBuys.CT={kind:'full'};advance(1000);botSharing(room);assert.equal(room.weaponRequests.get(b.id).status,'dropped');assert.ok(b.botAI.donationDrop);const count=room.droppedWeapons.items.length;botSharing(room);assert.equal(room.droppedWeapons.items.length,count);
});

test('bots cancel obsolete requests when they already picked up a rifle',()=>{
 const {room,a,b}=fixture();room.requestWeapon(b.id,'m4a1');room.giveWeapon(b,'m4a1');a.bot=true;room.giveWeapon(a,'awp');a.armor=100;const cash=a.money;botSharing(room);assert.equal(room.weaponRequests.get(b.id).status,'cancelled');assert.equal(a.money,cash);
});
