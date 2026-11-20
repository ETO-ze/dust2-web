import test from 'node:test';
import assert from 'node:assert/strict';
import {recognizeOpponents} from '../server/grid-vision.js';
import {radarBySide, shareSighting, updateTeamVision} from '../server/team-intel.js';
import {snapshotForSide} from '../server/snapshot-view.js';

const observer={id:'alice',x:0,y:0,z:0,yaw:0,pitch:0,alive:true,team:'CT',weapon:'ak47'};
const actor={id:'bob',x:0,y:0,z:-12,yaw:0,pitch:0,team:'T',alive:true,lifeId:1,weapon:'ak47'};
test('a trained grid detection acquires near and midrange visible simulated bodies',()=>{
 const room={clock:()=>200,gridVision:true,visibleToBot:()=>true};
 for(const distance of [1,4,7,12,20]) {
   const enemy={...actor,z:-distance};
   assert.deepEqual(recognizeOpponents(room,observer,[enemy]),[enemy]);
 }
 assert.deepEqual(recognizeOpponents(room,observer,[{...actor,z:12}]),[]);
 assert.deepEqual(recognizeOpponents(room,{...observer,flashBlindUntil:201},[actor]),[]);
 room.visibleToBot=()=>false;
 assert.deepEqual(recognizeOpponents(room,observer,[actor]),[]);
});
test('radar reports the last team sighting, expires and discards a new life',()=>{
 let now=100;
 const enemy={...actor};
 const room={clock:()=>now,players:new Map([[actor.id,enemy],[observer.id,observer]]),mode:'deathmatch',
   gridVision:true,round:{phase:'live'},visibleToBot:()=>true};
 updateTeamVision(room);
 const snapshot={players:[],radarBySide:radarBySide(room)};
 const ct=snapshotForSide(snapshot,'CT'), t=snapshotForSide(snapshot,'T');
 assert.equal(ct.radarContacts[0].id,actor.id);
 assert.deepEqual(t.radarContacts,[]);
 assert.ok(!('radarBySide' in ct));
 enemy.z=-20;room.visibleToBot=()=>false;now+=250;updateTeamVision(room);
 assert.equal(radarBySide(room).CT[0].z,-12);
 now+=1400;assert.deepEqual(radarBySide(room).CT,[]);
 shareSighting(room,observer,enemy);enemy.lifeId++;assert.deepEqual(radarBySide(room).CT,[]);
});
