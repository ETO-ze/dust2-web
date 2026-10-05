import test from 'node:test';
import assert from 'node:assert/strict';
import {BoxGeometry} from 'three';
import {initPhysics,raycastWorld,raycastWorldContact,raycastGrenadeWorld,floorHeight} from '../shared/physics.js';
import {GameRoom} from '../server/game.js';

function floor(y){const geometry=new BoxGeometry(20,.2,20).toNonIndexed();geometry.translate(0,y-.1,0);const positions=geometry.attributes.position.array;geometry.dispose();return positions;}
test('private collision channels remain separate and the default initializer resets all three',()=>{
 initPhysics(floor(0),null,{mapPatches:false,bulletPositions:floor(2),grenadePositions:floor(4),copyPositions:false});
 const origin={x:0,y:10,z:0},direction={x:0,y:-1,z:0};
 assert.ok(Math.abs(floorHeight(0,0,10)-0)<.001);assert.ok(Math.abs(raycastWorld(origin,direction)-8)<.001);assert.ok(Math.abs(raycastGrenadeWorld(origin,direction)-6)<.001);assert.ok(Math.abs(raycastWorldContact(origin,direction).distance-6)<.001);
 initPhysics(floor(0));assert.ok(Math.abs(raycastWorld(origin,direction)-10)<.001);assert.ok(Math.abs(raycastGrenadeWorld(origin,direction)-10)<.001);assert.ok(Math.abs(raycastWorldContact(origin,direction).distance-10)<.001);
});
test('GameRoom only calls an explicitly injected private bot input adapter',()=>{
 let calls=0;const context={mapId:'de_mirage',mapSignature:'a'.repeat(64),config:{physicsSha256:'b'.repeat(64)},createBots:()=>({input:p=>{calls++;return{yaw:p.yaw,pitch:0,forward:0,right:0};},onEvent(){}})};
 const standard=new GameRoom('PUBLIC',{bots:0});assert.equal(standard.privateBots,null);assert.equal(standard.snapshot().mapId,undefined);
 const privateRoom=new GameRoom('PRIVATE',{bots:1,privateMap:context});privateRoom.addHuman({},{name:'Adapter QA',team:'CT'});const bot=[...privateRoom.players.values()].find(p=>p.bot);privateRoom.botInput(bot,1/30);assert.equal(calls,1);assert.equal(privateRoom.snapshot().mapId,'de_mirage');assert.equal(privateRoom.snapshot().physicsSha256,context.config.physicsSha256);
});
