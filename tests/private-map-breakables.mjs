import test from 'node:test';
import assert from 'node:assert/strict';
import {BoxGeometry} from 'three';
import {initPhysics,raycastWorld,raycastWorldHit,raycastWorldSurfaces,raycastGrenadeWorld,raycastWorldContact,isHullClear,createPlayerState,stepPlayer} from '../shared/physics.js';
import {PrivateMapBreakables} from '../shared/private-map-breakables.js';
import {GameRoom} from '../server/game.js';

function box(x,y,z,w,h,d){const g=new BoxGeometry(w,h,d).toNonIndexed();g.translate(x,y,z);const a=g.attributes.position.array.slice();g.dispose();return a;}
function fixture({occluded=false}={}){
 const slab=box(0,1.4,-.8,2,2.8,.1),floor=box(0,-.1,0,20,.2,20),wall=occluded?box(0,1.4,-.4,2,2.8,.1):new Float32Array();
 const positions=new Float32Array([...slab,...floor,...wall]),indices=Uint32Array.from({length:positions.length/9},(_,i)=>i);
 const definitions=[{id:'panel',firstTriangle:0,triangles:12,health:1,material:'metal'}];let active;
 const context={mapId:'fixture',config:{physicsSha256:'a'.repeat(64)},createBots:()=>null,createBreakables(){active=new PrivateMapBreakables(definitions,{1:indices,2:indices,4:indices});return active;},activate(room){active=room.mapBreakables;}};
 context.createBreakables();initPhysics(positions,null,{mapPatches:false,triangleEnabled:(c,i)=>active.triangleEnabled(c,i)});
 return {context,get state(){return active;}};
}
const origin={x:0,y:1.62,z:0},direction={x:0,y:0,z:-1};

test('breaking exact triangles removes player, bullet, penetration and grenade collision; reset restores all',()=>{
 const f=fixture();const before=raycastWorldHit(origin,direction,2);assert.ok(before);assert.equal(f.state.atTriangle(2,before.triangle).id,'panel');
 assert.equal(isHullClear({...createPlayerState({z:-.8}),y:0}),false);
 assert.ok(raycastGrenadeWorld(origin,direction,2)<1);assert.ok(raycastWorldContact(origin,direction,2));assert.ok(raycastWorldSurfaces(origin,direction,2).length);
 f.state.damage('panel',1);assert.equal(raycastWorld(origin,direction,2),null);assert.equal(raycastGrenadeWorld(origin,direction,2),null);assert.equal(raycastWorldContact(origin,direction,2),null);assert.equal(raycastWorldSurfaces(origin,direction,2).length,0);assert.equal(isHullClear({...createPlayerState({z:-.8}),y:0}),true);
 const p=createPlayerState();for(let i=0;i<20;i++)stepPlayer(p,{yaw:0,forward:1},1/30);assert.ok(p.z<-1.5,'player must walk through the removed slab');
 f.state.reset();assert.ok(raycastWorld(origin,direction,2)<1);assert.equal(isHullClear({...createPlayerState({z:-.8}),y:0}),false);
});

test('authority comes from accepted GameRoom ammunition and knife inputs, with late join and round reset',()=>{
 const f=fixture();let now=10000;const room=new GameRoom('BRK',{bots:0,privateMap:f.context,clock:()=>now}),p=room.addHuman({},{team:'CT',name:'QA'});
 Object.assign(p,createPlayerState(),{alive:true,nextShotAt:0,reloadEndsAt:0,protectionUntil:0,weapon:'ak47'});room.giveWeapon(p,'ak47');p.weapon='ak47';const ammo=p.inventory.ak47.ammo;
 room.fire(p,{fire:true,yaw:0,pitch:0});assert.equal(p.inventory.ak47.ammo,ammo-1);assert.deepEqual(room.snapshot({drainEvents:false}).mapBreakables,[{id:'panel',broken:true}]);assert.equal(room.events.filter(e=>e.type==='map_breakable_broken').length,1);
 room.startRound();assert.equal(room.snapshot().mapBreakables[0].broken,false);
 Object.assign(p,createPlayerState(),{alive:true,nextShotAt:0,reloadEndsAt:0,weapon:'knife'});room.giveWeapon(p,'knife');p.weapon='knife';now+=1000;
 room.swingKnife(p,{fire2:true,yaw:0,pitch:0});assert.equal(room.mapBreakables.snapshot()[0].broken,true);
 room.mapBreakables.reset();p.nextShotAt=now+1000;room.swingKnife(p,{fire2:true,yaw:0,pitch:0});assert.equal(room.mapBreakables.snapshot()[0].broken,false,'cooldown must not break anything');
});

test('solid foreground blocks knife and bullets from destroying a hidden panel',()=>{
 const f=fixture({occluded:true});const room=new GameRoom('BLOCK',{bots:0,privateMap:f.context,clock:()=>10000}),p=room.addHuman({},{team:'CT'});
 Object.assign(p,createPlayerState(),{alive:true,nextShotAt:0,reloadEndsAt:0,weapon:'ak47'});room.giveWeapon(p,'ak47');p.weapon='ak47';room.fire(p,{fire:true,yaw:0,pitch:0});assert.equal(room.mapBreakables.snapshot()[0].broken,false);
 p.nextShotAt=0;p.weapon='knife';room.giveWeapon(p,'knife');room.swingKnife(p,{fire:true,yaw:0,pitch:0});assert.equal(room.mapBreakables.snapshot()[0].broken,false);
});

test('breakable state belongs to its room and full snapshots repair missed changes',()=>{
 const f=fixture(),a=new GameRoom('A',{bots:0,privateMap:f.context}),b=new GameRoom('B',{bots:0,privateMap:f.context});
 a.mapBreakables.damage('panel',1);f.context.activate(a);assert.equal(raycastWorld(origin,direction,2),null);f.context.activate(b);assert.ok(raycastWorld(origin,direction,2)<1);
 b.mapBreakables.applySnapshot(a.mapBreakables.snapshot());assert.equal(raycastWorld(origin,direction,2),null);b.mapBreakables.applySnapshot([{id:'unknown',broken:true}]);assert.ok(raycastWorld(origin,direction,2)<1);
 initPhysics(box(0,1.4,-.8,2,2.8,.1),null,{mapPatches:false});a.mapBreakables.damage('panel',1);assert.ok(raycastWorld(origin,direction,2)<1,'default production initializer must clear the filter');
});
