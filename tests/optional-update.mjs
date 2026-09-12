import test from 'node:test';
import assert from 'node:assert/strict';
import {BoxGeometry} from 'three';
import {createPreferenceStore} from '../client/persistence.js';
import {viewportSize} from '../shared/video-settings.js';
import {GameRoom} from '../server/game.js';
import {initPhysics,createPlayerState} from '../shared/physics.js';
import {MovementStream} from '../shared/movement-commands.js';
import {MAP} from '../shared/map-data.js';
import {tacticalGoal,shareSighting} from '../server/bot-tactics.js';
import {getWeapon} from '../shared/weapons.js';
function fixture(){const floor=new BoxGeometry(400,1,400).toNonIndexed();floor.translate(0,-.5,0);initPhysics(floor.attributes.position.array);floor.dispose();let now=100000;const r=new GameRoom('UPDATE',{bots:0,clock:()=>now});const p=r.addHuman({}, {name:'T',team:'T'}),ct=r.addHuman({}, {name:'CT',team:'CT'});r.round.phase='live';r.round.phaseEndsAt=now+115000;return {r,p,ct,advance:ms=>now+=ms,tick:()=>{now+=1000/30;r.tick(1/30);}};}
const input=(seq,extra={})=>({seq,forward:0,right:0,yaw:0,pitch:0,slot:2,...extra});
test('aspect ratio changes projection independently of stretching and fits portrait windows',()=>{
 assert.deepEqual(viewportSize(1920,1080,{aspect:'4:3',display:'bars'}),{aspect:4/3,width:1440,height:1080,displayWidth:1440,displayHeight:1080});
 const stretched=viewportSize(1920,1080,{aspect:'4:3',display:'stretch'});assert.equal(stretched.aspect,4/3);assert.equal(stretched.displayWidth,1920);
 assert.equal(viewportSize(1920,1080,{aspect:'16:9'}).width,1920);const portrait=viewportSize(600,900,{});assert.ok(portrait.height<900&&portrait.width<=600);
});
test('preferences recover damaged JSON and missing primary, survive blocked writes without throwing',()=>{
 const map=new Map(),storage={getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};
 let store=createPreferenceStore(storage);store.setItem('dust2.config','{"sensitivity":1.8}');map.set('dust2.config','bad');store=createPreferenceStore(storage);assert.equal(store.readJSON('dust2.config').sensitivity,1.8);
 map.delete('dust2.config');assert.equal(createPreferenceStore(storage).readJSON('dust2.config').sensitivity,1.8);
 store=createPreferenceStore({setItem(){throw Error('quota');},getItem(){throw Error('blocked');}});assert.equal(store.setItem('value',7),false);assert.equal(store.getItem('value'),'7');
});
test('refund only unused current-round purchased gun, never fired/dropped/picked up/previous round guns',()=>{
 const {r,p,advance}=fixture();Object.assign(p,MAP.spawns.T[0],{money:16000});
 assert.equal(r.buy(p.id,'ak47').ok,true);assert.equal(r.refund(p.id,'ak47').ok,true);assert.equal(p.money,16000);assert.equal(r.refund(p.id,'ak47').ok,false);
 r.buy(p.id,'ak47');advance(500);r.fire(p,{fire:true,yaw:0,pitch:0});assert.equal(r.refund(p.id,'ak47').ok,false);
 r.buy(p.id,'ak47');r.dropWeapon(p.id);assert.equal(r.refund(p.id,'ak47').ok,false);r.pickupWeapon(p);assert.equal(r.refund(p.id,'ak47').ok,false);
 r.buy(p.id,'galilar');r.round.number++;assert.equal(r.refund(p.id,'galilar').ok,false);
});
test('empty-slot proximity pickup preserves active reload/scope, does not take own immediate drop or replace occupied slot',()=>{
 const {r,p,ct,advance}=fixture();Object.assign(p,{x:0,y:0,z:0});Object.assign(ct,{x:0,y:0,z:0});
 r.droppedWeapons.drop(ct,{weaponId:'awp',ammo:3,reserve:12,skinId:'awp-gungnir'});advance(400);p.reloadEndsAt=200000;p.zoomLevel=1;
 assert.equal(r.pickupWeapon(p,true),true);assert.equal(p.weapon,'pistol');assert.equal(p.inventory.awp.ammo,3);assert.equal(p.reloadEndsAt,200000);assert.equal(p.zoomLevel,1);
 r.droppedWeapons.drop(ct,{weaponId:'ak47',ammo:12,reserve:50});advance(400);assert.equal(r.pickupWeapon(p,true),false);
 r.droppedWeapons.clear();r.selectSlot(p,1);r.dropWeapon(p.id);assert.equal(r.pickupWeapon(p,true),false);
});
test('survivors move after round end and remain frozen during next buy freeze',()=>{
 const {r,p,ct,tick}=fixture();Object.assign(p,createPlayerState({x:0,y:0,z:0}));Object.assign(ct,{x:20,y:0,z:20});r.endRound('T','test');r.receiveInput(p.id,input(1,{forward:1}));for(let i=0;i<6;i++)tick();assert.ok(p.z<-.1);
 r.round.phase='freeze';const z=p.z;r.receiveInput(p.id,input(2,{forward:1}));for(let i=0;i<6;i++)tick();assert.ok(Math.abs(p.z-z)<.3);
});
test('release before the jump command arrives waits for authoritative jump velocity',()=>{
 const {r,p,ct,advance,tick}=fixture();Object.assign(p,createPlayerState({x:0,y:0,z:0}),{grounded:true});Object.assign(ct,{x:40,y:0,z:40});p.movementStream=new MovementStream(p.lifeId);p.movementAt=100000;p.inventory.hegrenade={ammo:1,reserve:0};p.nextShotAt=0;
 r.receiveInput(p.id,input(1,{slot:4,utilityId:'hegrenade'}));r.selectSlot(p,4,'hegrenade');advance(400);
 r.receiveInput(p.id,input(2,{slot:4,utilityId:'hegrenade',fire:true}));advance(400);
 r.receiveInput(p.id,input(3,{slot:4,utilityId:'hegrenade',jumpId:1}));r.stepGrenade(p);assert.equal(r.grenades.projectiles.length,0);
 r.receiveInput(p.id,input(4,{slot:4,utilityId:'hegrenade',jumpId:1,moveId:1,moves:[{id:1,lifeId:p.lifeId,forward:0,right:0,yaw:0,pitch:0,speedScale:1,jump:true,jumpId:1}]}));tick();
 assert.equal(r.grenades.projectiles.length,1);assert.ok(p.vy>0);assert.ok(r.grenades.projectiles[0].vy>7);assert.equal(p.inventory.hegrenade,undefined);
});
test('Dust2 team roles split lanes, anchor both sites, cover one defuser and hold postplant separately',()=>{
 const {r,p,ct}=fixture();r.desiredBots=8;r.ensureBots();r.startRound();
 const ts=[...r.players.values()].filter(p=>p.team==='T'),cts=[...r.players.values()].filter(p=>p.team==='CT');
 const goals=ts.map(p=>tacticalGoal(r,p));assert.ok(new Set(goals.map(p=>JSON.stringify(p))).size>=2);
 cts.forEach(p=>tacticalGoal(r,p));assert.ok(cts.some(p=>p.botAI.role==='anchor-a'));assert.ok(cts.some(p=>p.botAI.role==='anchor-b'));
 shareSighting(r,ct,p);assert.equal(r.teamIntel.CT.observer,ct.id);assert.equal(r.teamIntel.T,undefined);
 Object.assign(r.bomb,{...MAP.sites.B,state:'planted',site:'B'});cts.forEach(p=>tacticalGoal(r,p));assert.equal(cts.filter(p=>p.botAI.role==='defuser').length,1);
 const holds=ts.map(p=>tacticalGoal(r,p));assert.ok(new Set(holds.map(p=>JSON.stringify(p))).size>1);assert.ok(ts.every(p=>p.botAI.role==='postplant'));
});
