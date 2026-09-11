import test from 'node:test';
import assert from 'node:assert/strict';
import {BoxGeometry} from 'three';
import {GameRoom,rayHitPlayer} from '../server/game.js';
import {initPhysics,raycastWorld} from '../shared/physics.js';
import {traceKnife,knifeDamage,KNIFE} from '../shared/melee.js';
import {killCardState} from '../client/kill-cards.js';
import {GameAudio} from '../client/audio.js';
const floor=[-30,0,-30,30,0,30,30,0,-30,-30,0,-30,-30,0,30,30,0,30];
const box=(x,y,z,w,h,d)=>{const g=new BoxGeometry(w,h,d).toNonIndexed();g.translate(x,y,z);const a=[...g.attributes.position.array];g.dispose();return a;};
function fixture(mode='deathmatch'){
 initPhysics(floor);let now=100000;const room=new GameRoom('MELEE',{mode,bots:0,clock:()=>now});
 const a=room.addHuman({}, {name:'Attacker',team:'T'}),b=room.addHuman({}, {name:'Target',team:'CT'});
 room.round.phase='live';room.selectSlot(a,3);
 Object.assign(a,{x:0,y:0,z:0,yaw:0,pitch:0,nextShotAt:0,protectionUntil:0});Object.assign(b,{x:.57,y:0,z:-1,yaw:Math.PI,pitch:0,protectionUntil:0});
 return{room,a,b,time:ms=>now+=ms};
}
test('swept knife catches nearby off-reticle target while preserving front, range, cover and one-target limits',()=>{
 const {a,b}=fixture(),origin={x:0,y:1.62,z:0},direction={x:0,y:0,z:-1};
 assert.equal(rayHitPlayer(origin,direction,b,3),null);
 const trace=(players=[b],heavy=false)=>traceKnife({origin,direction,shooter:a,players,heavy,now:100000,raycastWorld});
 assert.equal(trace().hitId,b.id);
 assert.equal(trace([{...b,z:1}]).hitId,null);
 assert.equal(trace([{...b,z:-2.2}]).hitId,null);
 assert.equal(trace([{...b,x:.9}]).hitId,null);
 assert.equal(trace([{...b,z:-1.7}],true).hitId,null,'heavy stab has a shorter reach');
 const near={...b,id:'near',z:-.8},far={...b,id:'far',z:-1.3};assert.equal(trace([far,near]).hitId,'near');
 initPhysics([...floor,...box(.28,1,-.5,1,2,.08)]);assert.equal(trace().hitId,null,'the expanded hull must not stab through a wall');
});
test('right-click queue retains a released heavy stab, uses armor and shares cooldown with slash and switching',()=>{
 const {room,a,b,time}=fixture();
 const input={seq:1,forward:0,right:0,yaw:0,pitch:0,slot:3,fire:false,fire2:true,shotId:1,shotWeapon:'knife'};
 assert.ok(room.receiveInput(a.id,input));room.receiveInput(a.id,{...input,seq:2,fire2:false,shotId:0});
 room.fireQueued(a);assert.equal(b.health,45);assert.equal(room.events.findLast(e=>e.type==='shot').heavy,true);
 room.fire(a,{...input,fire:true,fire2:false});assert.equal(b.health,45);
 room.selectSlot(a,2);room.selectSlot(a,3);time(600);room.fire(a,{...input,fire:true,fire2:false});assert.equal(b.health,45);
 time(401);room.fire(a,{...input,fire:true,fire2:false});assert.equal(b.health,11);
 time(501);room.fire(a,{...input,fire:true,fire2:false});assert.equal(b.alive,false);
 assert.equal(a.kills,1);assert.equal(a.lifeKills,1);assert.equal(a.killCards[0].weapon,'knife');
});
test('backstab is directional, has no headshot multiplier and can kill an armored enemy',()=>{
 const {room,a,b}=fixture();b.yaw=0;room.fire(a,{yaw:0,pitch:0,fire2:true,fire:false});
 assert.equal(b.alive,false);assert.equal(room.events.findLast(e=>e.type==='hit').damage,153);
 assert.equal(room.events.findLast(e=>e.type==='kill').backstab,true);assert.equal(room.events.findLast(e=>e.type==='kill').headshot,false);
 assert.equal(knifeDamage({armor:100}),34);assert.equal(knifeDamage({armor:100,first:false}),21);assert.equal(knifeDamage({heavy:true}),65);
});
test('persistent round cards survive gaps, duplicate death events and snapshots, then reset at the next round',()=>{
 const {room,a,b,time}=fixture('defuse');
 room.kill(b,a,'ak47',true);time(15000);room.respawn(b);room.kill(b,a,'knife',false,{backstab:true});room.kill(b,a,'knife');
 const snapshot=room.snapshot({drainEvents:false}),me=snapshot.players.find(p=>p.id===a.id),state=killCardState(snapshot,me);
 assert.equal(state.count,2);assert.equal(state.cards.length,2);assert.equal(state.cards[0].headshot,true);assert.equal(state.cards[1].backstab,true);
 a.alive=false;assert.equal(killCardState(room.snapshot(),room.snapshot().players.find(p=>p.id===a.id)).count,2);
 room.startRound();const next=room.snapshot();assert.equal(killCardState(next,next.players.find(p=>p.id===a.id)).count,0);assert.equal(a.killCards.length,0);
});
test('deathmatch keeps the exact life count above five while bounding cards and clears it on respawn',()=>{
 const {room,a,b}=fixture();for(let i=0;i<8;i++){room.respawn(b);room.kill(b,a,'ak47');}
 assert.equal(a.lifeKills,8);assert.equal(a.killCards.length,5);room.respawn(a);assert.equal(a.lifeKills,0);assert.equal(a.kills,8);assert.equal(a.killCards.length,0);
});
test('equipment draw and heavy knife choose original sample banks and cancel superseded equip voices',()=>{
 const audio=new GameAudio(),calls=[];audio.ctx={currentTime:1};audio.play=(bank,options)=>{calls.push({bank,...options});return{};};
 const stale={channel:'draw'};audio.voices.add(stale);audio.stopVoice=voice=>audio.voices.delete(voice);
 audio.draw('pistol');assert.equal(audio.voices.has(stale),false);assert.equal(audio.lastDraw.bank,'glockDraw');
 audio.draw('knife');audio.draw('c4');audio.knife('heavySwing');audio.knife('heavyHit');
 assert.deepEqual(calls.map(c=>c.bank),['glockDraw','knifeDraw','bombDraw','knifeHeavySwing','knifeHeavyHit']);
 assert.equal(audio.drawCount,3);assert.equal(audio.heavySwingCount,1);
});
