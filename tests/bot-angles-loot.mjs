import test from 'node:test';import assert from 'node:assert/strict';
import {GameRoom} from '../server/game.js';import {initPhysics,createPlayerState,stepPlayer,raycastWorld} from '../shared/physics.js';import {effectiveBotSkill} from '../server/bot-adaptation.js';import {botSkill} from '../shared/bot-difficulty.js';import {snapshotForSide} from '../server/snapshot-view.js';import {shouldLoot,lootGoal} from '../server/bot-loot.js';import {botPeek} from '../server/bot-peek.js';import {standingAimPoint,observationPoint} from '../server/bot-perception.js';
const flat=[-100,0,-100,100,0,100,100,0,-100,-100,0,-100,-100,0,100,100,0,100];
function roomFixture(){initPhysics(flat);let now=100000;const room=new GameRoom('ANG',{bots:0,clock:()=>now}),a=room.makePlayer('b_1','CT','CT',true),b=room.makePlayer('b_2','T','T',true);room.players.set(a.id,a);room.players.set(b.id,b);const win=side=>{room.round.phase='live';room.endRound(side,'test');now+=10000;};return {room,a,b,win,advance:ms=>now+=ms};}
test('two losses boost one stable team once; two consecutive wins restore, with own-team-only announcement',()=>{
 const {room,a,b,win}=roomFixture(),normal=botSkill('normal');win('T');assert.deepEqual(effectiveBotSkill(room,a),normal);win('T');assert.equal(effectiveBotSkill(room,a).aimErrorScale,normal.aimErrorScale/1.5);assert.deepEqual(effectiveBotSkill(room,b),normal);
 const chat=snapshotForSide(room.snapshot({drainEvents:false}),'CT').events.filter(e=>e.type==='chat'&&e.text.includes('50%'));assert.equal(chat.length,1);assert.equal(snapshotForSide(room.snapshot({drainEvents:false}),'T').events.filter(e=>e.type==='chat'&&e.text.includes('50%')).length,0);
 for(let i=0;i<3;i++)win('T');assert.equal(effectiveBotSkill(room,a).aimErrorScale,normal.aimErrorScale/1.5);win('CT');assert.equal(room.botMomentum.A.boosted,true);win('T');win('CT');assert.equal(room.botMomentum.A.boosted,true);win('CT');assert.equal(room.botMomentum.A.boosted,false);
});
test('streak follows players across sides, duplicate round completion cannot boost twice, hard keeps smooth-aim speed unchanged',()=>{
 const {room,a,b,win}=roomFixture();room.botDifficulty='hard';win('T');room.endRound('T','duplicate');assert.equal(room.botMomentum.A.losses,1);win('T');const skill=effectiveBotSkill(room,a);assert.equal(skill.reactionMinMs,botSkill('hard').reactionMinMs/1.5);
 room.teamSides={A:'T',B:'CT'};a.team='T';b.team='CT';win('T');assert.equal(room.botMomentum.A.boosted,true);win('T');assert.equal(room.botMomentum.A.boosted,false);assert.equal(room.botMomentum.B.boosted,true);
});
test('loot preference upgrades weaker guns, fills empty slots, rejects downgrades and empty weapons',()=>{
 const p={inventory:{mp9:{ammo:30,reserve:90},usp:{ammo:12,reserve:24}}};const item=weaponId=>({weaponId,ammo:30,reserve:90});assert.ok(shouldLoot(p,item('ak47')));assert.ok(shouldLoot(p,item('awp')));assert.equal(shouldLoot(p,item('nova')),false);assert.equal(shouldLoot(p,{...item('ak47'),ammo:0,reserve:0}),false);assert.ok(shouldLoot({inventory:{}},item('usp')));assert.equal(shouldLoot(p,item('knife')),false);
});
test('bot walks to a generic thrown rifle, exchanges its SMG, retains the skin and does not cycle pickups',()=>{
 const {room,a,advance}=roomFixture();Object.assign(a,createPlayerState({x:0,y:.001,z:0}),{alive:true,grounded:true});a.inventory={};room.giveWeapon(a,'mp9');room.giveWeapon(a,'knife');room.selectSlot(a,1);room.round.phase='live';room.planPath=(_,to)=>[to];
 const item=room.droppedWeapons.drop({id:'human',x:3,y:0,z:0,yaw:0},{weaponId:'ak47',skinId:'ak47-wild-lotus',ammo:17,reserve:55});Object.assign(item,{x:3,y:.08,z:0,vx:0,vy:0,vz:0});advance(500);
 for(let i=0;i<180&&!a.inventory.ak47;i++){const goal=lootGoal(room,a);if(goal){const d=Math.hypot(goal.x-a.x,goal.z-a.z);stepPlayer(a,{right:(goal.x-a.x)/d,forward:-(goal.z-a.z)/d,yaw:0},1/30);}advance(1000/30);}
 assert.ok(a.inventory.ak47);assert.equal(a.inventory.ak47.ammo,17);assert.equal(a.inventory.ak47.skinId,'ak47-wild-lotus');assert.equal(a.weapon,'ak47');assert.ok(!a.inventory.mp9);assert.ok(room.droppedWeapons.items.some(d=>d.weaponId==='mp9'));assert.equal(a.botAI.lootCount,1);advance(2000);assert.equal(lootGoal(room,a),null);
});
test('loot never sees through cover, steals a reserved donation, or interrupts an active objective',()=>{
 const {room,a,advance}=roomFixture();Object.assign(a,createPlayerState({x:0,y:0,z:0}),{alive:true,grounded:true});room.round.phase='live';room.planPath=(_,to)=>[to];const drop=room.droppedWeapons.drop({id:'human',x:1,y:0,z:0},{weaponId:'ak47',ammo:30,reserve:90});Object.assign(drop,{x:1,y:.08,z:0,intendedFor:'b_2',reservedUntil:200000});advance(500);assert.equal(lootGoal(room,a),null);drop.intendedFor=null;advance(1000);room.visibleToBot=()=>false;assert.equal(lootGoal(room,a),null);room.visibleToBot=()=>true;a.objectiveLocked=true;advance(1000);assert.equal(lootGoal(room,a),null);assert.ok(!a.inventory.ak47);
});
test('preaim uses real standable ground height and refuses blocked or absent navigation anchors',()=>{
 initPhysics([...flat,-2,0,-10,2,3,-10,2,0,-10,-2,0,-10,-2,3,-10,2,3,-10]);const node={id:1,x:0,y:0,z:-8},room={nav:[node],nearestNav:()=>node};assert.deepEqual(standingAimPoint(room,{x:0,y:1.62,z:-8}),{x:0,y:1.62,z:-8});assert.equal(standingAimPoint(room,{x:20,y:1.62,z:-8}),null);
 const bad={id:2,x:0,y:0,z:-10};room.nav=[bad];room.nearestNav=()=>bad;assert.equal(standingAimPoint(room,{x:0,y:1.62,z:-10}),null);
});
test('moving bot does not rotate to an unrelated rear watch point',()=>{
 const p={x:0,y:0,z:0,yaw:0,weapon:'ak47',botAI:{path:[{x:0,y:0,z:-10}],watchPoints:[{x:0,y:1.62,z:15}]}};const room={clock:()=>100000,visibleToBot:()=>true};assert.deepEqual(observationPoint(room,p,p.botAI.path[0]),{x:0,y:1.62,z:-10});
});
test('cover peek actually strafes out, settles before firing and returns without enemy position queries',()=>{
 initPhysics([...flat,-5,0,-4,0,3,-4,0,0,-4,-5,0,-4,-5,3,-4,0,3,-4]);let now=100000;
 const room={nav:[],round:{phase:'live'},clock:()=>now,visibleToBot:(a,b)=>{const d=Math.hypot(b.x-a.x,b.y-a.y,b.z-a.z),hit=raycastWorld(a,{x:b.x-a.x,y:b.y-a.y,z:b.z-a.z},d);return hit===null||hit>d-.05;}};
 const p={...createPlayerState({x:-.45,y:.0001,z:-2}),grounded:true,botAI:{strafe:1}},watch={x:1,y:1.62,z:-14};let maxX=p.x,shots=0;const phases=new Set();
 for(let i=0;i<190;i++){const input={yaw:Math.atan2(-(watch.x-p.x),-(watch.z-p.z)),pitch:0,fire:true};botPeek(room,p,input,watch,true);phases.add(p.botAI.peek?.phase);if(p.botAI.peek&&input.fire){assert.equal(p.botAI.peek.phase,'shoot');assert.ok(Math.hypot(p.vx,p.vz)<.45);shots++;}stepPlayer(p,input,1/30);maxX=Math.max(maxX,p.x);now+=1000/30;if(p.botAI.peekCompleted)break;}
 assert.ok(p.botAI.peekCount>0);assert.ok(maxX>.4);assert.ok(shots>0);assert.ok(p.botAI.peekCompleted>0);assert.ok(Math.abs(p.x+.45)<.2);assert.ok(phases.has('settle'));
});

test('a missing or unreachable loot target is released and does not keep the bot stuck in a pickup loop',()=>{
 const {room,a,advance}=roomFixture();Object.assign(a,createPlayerState({x:0,y:.001,z:0}),{alive:true,grounded:true});room.round.phase='live';room.planPath=(_,to)=>[to];const d=room.droppedWeapons.drop({id:'h',x:5,y:0,z:0},{weaponId:'ak47',ammo:30,reserve:90});Object.assign(d,{x:5,y:.08,z:0});advance(500);assert.ok(lootGoal(room,a));advance(7000);assert.equal(lootGoal(room,a),null);assert.equal(a.botAI.lootId,null);advance(1000);assert.equal(lootGoal(room,a),null);
 a.botAI.lootId='gone';assert.equal(lootGoal(room,a),null);assert.equal(a.botAI.lootId,null);
});
test('picking up the first rifle updates the bot input slot in the same tick',()=>{
 const {room,a,advance}=roomFixture();Object.assign(a,createPlayerState({x:0,y:.001,z:0}),{alive:true,grounded:true});room.round.phase='live';room.planPath=(_,to)=>[to];a.botAI.nextThinkAt=Infinity;const d=room.droppedWeapons.drop({id:'h',x:.5,y:0,z:0},{weaponId:'ak47',ammo:30,reserve:90});Object.assign(d,{x:.5,y:.08,z:0});advance(500);const input=room.botInput(a,1/30);assert.equal(a.weapon,'ak47');assert.equal(input.slot,1);
});
