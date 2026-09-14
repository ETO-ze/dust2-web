import test from 'node:test';
import assert from 'node:assert/strict';
import {GameRoom} from '../server/game.js';
import {initPhysics} from '../shared/physics.js';
import {combatPhase,equipmentPhase} from '../shared/round-actions.js';
initPhysics([-200,0,-200,200,0,200,200,0,-200,-200,0,-200,-200,0,200,200,0,200]);
function fixture(){let now=100000;const room=new GameRoom('AFTERROUND',{bots:0,clock:()=>now}),a=room.addHuman({}, {name:'a',team:'CT',shotProtocol:1}),b=room.addHuman({}, {name:'b',team:'T'});
 room.round.phase='live';room.giveWeapon(a,'awp');room.selectSlot(a,1);
 for(const [i,p]of [a,b].entries())Object.assign(p,{x:0,y:0,z:-10*i,health:100,armor:0,helmet:false,grounded:true,protectionUntil:0,nextShotAt:0,equipReadyAt:0});
 room.endRound('CT','time expired');return {room,a,b,advance:ms=>now+=ms};}
const input=(seq,extra={})=>({seq,forward:0,right:0,yaw:0,pitch:0,slot:1,...extra});
test('the result period allows shooting and damage while the declared winner and round score stay fixed',()=>{
 const {room,a,b,advance}=fixture();room.traceBullet=()=>({end:{x:0,y:1,z:-10},hits:[{playerId:b.id,distance:10,headshot:true}]});
 const scores={...room.scores},rounds=room.match.roundsPlayed;room.receiveInput(a.id,input(1,{fire:true,shotId:1,shotWeapon:'awp',zoomLevel:1}));advance(34);room.tick();
 assert.equal(a.inventory.awp.ammo,4);assert.equal(b.alive,false);assert.equal(room.round.winner,'CT');assert.deepEqual(room.scores,scores);assert.equal(room.match.roundsPlayed,rounds);
});
test('players can drop and manually recover a gun near the resolved bomb after the round',()=>{
 const {room,a,advance}=fixture();const drop=room.dropWeapon(a.id);assert.equal(drop.ok,true);room.bomb={state:'planted',x:a.x,y:a.y,z:a.z};
 room.droppedWeapons.candidate=()=>room.droppedWeapons.items[0];room.droppedWeapons.autoCandidate=()=>null;
 room.receiveInput(a.id,input(1,{slot:2,interact:true}));advance(34);room.tick();assert.ok(a.inventory.awp);assert.equal(room.bomb.action,undefined);assert.equal(a.objectiveLocked,false);
});
test('freeze and completed matches remain locked; late result shots cannot leak into the next round',()=>{
 const {room,a,advance}=fixture();for(const phase of ['freeze','matchEnded'])assert.equal(combatPhase(phase),false);assert.equal(equipmentPhase('ended'),true);
 room.round.phase='freeze';room.round.phaseEndsAt=110000;room.receiveInput(a.id,input(1,{fire:true,shotId:1,shotWeapon:'awp'}));advance(34);room.tick();assert.equal(a.inventory.awp.ammo,5);assert.equal(a.fireQueue.length,0);
 room.round.phase='ended';room.round.phaseEndsAt=100035;room.receiveInput(a.id,input(2,{fire:true,shotId:2,shotWeapon:'awp'}));advance(34);room.tick();assert.equal(room.round.phase,'freeze');assert.equal(a.inventory.awp.ammo,5);
 room.match.status='ended';assert.equal(room.dropWeapon(a.id).ok,false);
});
