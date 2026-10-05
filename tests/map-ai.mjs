import test from 'node:test';
import assert from 'node:assert/strict';
import {MapPerception,MapSquadDirector,MapRouteFollower,validateMapThrow,MapUtilityCoordinator,visibleFireSolution} from '../server/map-ai.js';
import {MapTacticalGraph} from '../server/map-tactical-graph.js';
const p=(id,team,x=0,z=0)=>({id,team,x,y:0,z,yaw:0,pitch:0,bot:true,alive:true});
const nodes=[{id:1,x:0,y:0,z:0,hull:0,neighbors:[2,4]},{id:2,x:10,y:0,z:0,hull:0,neighbors:[1,3]},{id:3,x:20,y:0,z:0,hull:0,neighbors:[2,4]},{id:4,x:0,y:0,z:10,hull:0,neighbors:[1,3]}];
const graph=()=>new MapTacticalGraph({id:'test',sites:{A:nodes[2],B:nodes[3]}},nodes,{standAllowed:()=>true,edgeAllowed:()=>true});
test('sound is range-limited, attenuated by cover, uncertain and team isolated',()=>{
 let now=0;const senses=new MapPerception({clock:()=>now,clearSight:()=>false});
 const shooter=p('enemy','T',11,1),near=p('ct','CT'),far=p('far','CT',40);
 assert.deepEqual(senses.gunshot(shooter,[near,far]).heardBy,['ct']);
 const report=senses.snapshot('CT')[0];assert.equal(report.enemyId,null);assert.equal(report.kind,'sound');assert.equal(report.uncertainty,6);assert.equal(report.point.x,12);assert.equal(senses.snapshot('T').length,0);
 shooter.x=19;assert.equal(senses.snapshot('CT')[0].point.x,12);
 now=2000;senses.gunshot({...shooter,x:11},[near]);assert.equal(senses.snapshot('CT')[0].firstAt,0);
 now=5600;assert.deepEqual(senses.snapshot('CT'),[]);
});
test('visual radar needs FOV, clear sight, no smoke and no flash',()=>{
 let blocked=false;const senses=new MapPerception({clock:()=>10,clearSight:()=>true,smokeBlocked:()=>blocked}),observer=p('ct','CT'),enemy=p('t','T',0,-10);
 assert(senses.observe(observer,enemy));assert.equal(senses.observe(observer,{...enemy,z:10}),null);
 blocked=true;assert.equal(senses.observe(observer,enemy),null);blocked=false;observer.flashBlindUntil=100;assert.equal(senses.observe(observer,enemy),null);
 observer.flashBlindUntil=0;assert.equal(senses.observe(observer,{...enemy,y:30,z:-1}),null);observer.pitch=1.45;assert(senses.observe(observer,{...enemy,y:30,z:-1}));
 const denied=new MapPerception({clock:()=>10});assert.equal(denied.observe(p('ct','CT'),enemy),null);
});
test('holding does not freeze gravity and aims with a bounded smooth turn',()=>{
 let stepped=0;const f=new MapRouteFollower(graph(),{stepIdle:(p,dt)=>{stepped++;p.y+=p.vy*dt;p.vy-=20*dt;}}),player={...p('bot','T'),y:3,vy:-1},order={revision:1,route:[nodes[0],nodes[1]],goal:nodes[1],state:'advance'};
 f.tick(player,order,1/30,{hold:true,lookAt:{x:10,y:3,z:0}});assert.equal(stepped,1);assert(player.y<3);assert(Math.abs(player.yaw)<=3.6/30+1e-8);assert(Math.abs(player.yaw)>0);
});
test('heard or stale target reports never grant a firing solution',()=>{
 let blocked=false;const senses=new MapPerception({clock:()=>0,clearSight:()=>!blocked}),observer=p('ct','CT'),enemy=p('t','T',0,-10);
 observer.pitch=Math.atan2(1.2-1.62,10);assert(visibleFireSolution(observer,enemy,senses));blocked=true;senses.gunshot(enemy,[observer]);assert.equal(visibleFireSolution(observer,enemy,senses),null);
 blocked=false;observer.yaw=.3;assert.equal(visibleFireSolution(observer,enemy,senses),null);const frozen=senses.snapshot('CT').find(r=>r.kind==='visual').point.z;enemy.z=-15;assert.equal(senses.snapshot('CT').find(r=>r.kind==='visual').point.z,frozen);
});
test('squad roles ignore humans and takeovers, while noise leaves the other anchor',()=>{
 let now=0;const senses=new MapPerception({clock:()=>now,clearSight:()=>true}),director=new MapSquadDirector(graph(),{clock:()=>now,perception:senses});
 const players=[...Array.from({length:5},(_,i)=>p('ct'+i,'CT',0,10)),...Array.from({length:5},(_,i)=>p('t'+i,'T')),{...p('human','CT',20),bot:false},{...p('taken','CT'),controllerId:'human'}];
 director.begin(players,{site:'A'});assert.equal(director.orders.size,10);assert.equal(director.orders.get('t2').role,'utility');assert.equal(director.orders.get('t1').buddyId,'t0');
 senses.publish('CT',{kind:'sound',point:{...nodes[2]},ttl:3500,confidence:.7});now=2200;director.update(players);
 assert.equal(director.orders.get('ct1').site,'B');assert.equal(director.orders.get('ct1').role,'anchor');
 assert(director.events.filter(e=>e.kind==='rotation').length<=1);
 players[0].controllerId='human';director.update(players);assert(!director.orders.has('ct0'));
});
test('route following blocks unverified edges and replans around a failed one',()=>{
 const g=graph(),order={revision:1,route:g.route(1,3),goal:nodes[2],state:'advance'},player=p('bot','T');
 const noProof=new MapRouteFollower(g,{edgePlans:new Map()});assert.equal(noProof.tick(player,order,1/30).state,'await-edge-validation');
 const follower=new MapRouteFollower(g,{createMovement:()=>({}),stepMovement:()=>({failed:true}),edgePlans:new Map([['1>2',{mode:'walk'}]])});
 const state=follower.tick(player,order,1/30);assert.equal(state.replans,1);assert.deepEqual(state.path.map(n=>n.id),[1,4,3]);assert.equal(follower.failures[0].key,'1>2');
 player.controllerId='human';assert.equal(follower.tick(player,order,1/30),null);
});
const flatWorld={raycastWorld:(o,d,max)=>d.y<0&&o.y/-d.y<=max?o.y/-d.y:null,raycastContact:(o,d,max)=>d.y<0&&o.y/-d.y<=max?{distance:o.y/-d.y,normal:{x:0,y:1,z:0}}:null,clearSight:()=>true};
test('utility probes use real simulation and reject missing evidence and bad targets',()=>{
 const params={world:flatWorld,player:p('t','T'),weapon:'flashbang',input:{yaw:0,pitch:.15,throwStrength:1},target:{x:0,y:1,z:-25},sourceSha256:'source',physicsSha256:'physics'};
 const trial=validateMapThrow(params);assert(trial.trajectory.length>10);assert(trial.result.seconds>=1.5);
 const exact=validateMapThrow({...params,target:{...trial.impact,y:trial.impact.y-1.3}});assert.equal(exact.passed,true);assert.equal(exact.validation.scope,'same-physics-private-probe');
 assert.equal(validateMapThrow({...params,sourceSha256:null}).passed,false);
 assert.equal(validateMapThrow({...params,target:{x:100,y:0,z:100}}).passed,false);
 const friend={...p('friend','T',trial.impact.x,trial.impact.z),y:trial.impact.y-1.3};assert.equal(validateMapThrow({...params,target:exact.target,players:[friend]}).reason,'friendly-risk');
});
test('utility coordination checks ownership, release point, carrier and cover timing',()=>{
 let now=1000;const player=p('utility','T'),other=p('friend','T',10),coordinator=new MapUtilityCoordinator({clock:()=>now,world:flatWorld,sourceSha256:'s',physicsSha256:'p'});
 const trial={passed:true,weapon:'smokegrenade',playerId:player.id,team:player.team,release:{x:0,y:0,z:0},releaseState:{x:0,y:0,z:0,vx:0,vy:0,vz:0,crouch:false,grounded:false,height:1.8},input:{yaw:0,pitch:0},sight:[{x:0,y:1,z:-10},{x:0,y:1,z:-30}],result:{point:{x:0,y:0,z:-20},seconds:2,cells:[]},validation:{sourceSha256:'s',physicsSha256:'p'}};
 assert.equal(coordinator.reserve({...player,hasBomb:true},trial,{players:[player],site:'A'}).reason,'carrier-priority');
 assert.equal(coordinator.reserve({...player,x:1},trial,{players:[player,other],site:'A'}).accepted,false);
 const reservation=coordinator.reserve(player,trial,{players:[player,other],site:'A'});assert(reservation.accepted);assert.equal(coordinator.reserve(other,trial,{players:[player,other],site:'A'}).accepted,false);
 assert.equal(coordinator.release({...player,id:'impostor'},reservation.claim,[player,other],{throwGrenade:()=>true}),false);
 assert.equal(coordinator.release({...player,vx:6},reservation.claim,[player,other],{throwGrenade:()=>true}),false);
 assert.equal(coordinator.release({...player,crouch:true},reservation.claim,[player,other],{throwGrenade:()=>true}),false);
 assert(coordinator.release(player,reservation.claim,[player,other],{throwGrenade:()=>true}));
 const flash={...trial,weapon:'flashbang'};assert.equal(coordinator.reserve(player,flash,{players:[],site:'A'}).reason,'wait-for-cover');
 now=3100;const fr=coordinator.reserve(player,flash,{players:[],site:'A'});assert(fr.accepted);assert(coordinator.release(player,fr.claim,[],{throwGrenade:()=>true}));assert.equal(coordinator.entryReady('T','A'),false);now=5200;assert.equal(coordinator.entryReady('T','A'),true);
});
test('a flash warning needs real teammate turn-away before release, never controls a human',()=>{
 let now=1000;const coordinator=new MapUtilityCoordinator({clock:()=>now,world:flatWorld,sourceSha256:'s',physicsSha256:'p'}),thrower=p('thrower','T'),friend=p('friend','T',1);
 const trial={weapon:'flashbang',passed:false,trajectoryPassed:true,release:{x:0,y:0,z:0},impact:{x:0,y:1,z:-12},result:{point:{x:0,y:1,z:-12},seconds:1.5,cells:[]},validation:{sourceSha256:'s',physicsSha256:'p'}};
 assert(coordinator.prepareFlash(thrower,trial,[thrower,friend]));assert.equal(coordinator.turnInstruction(thrower),null);assert(coordinator.turnInstruction(friend));
 assert.equal(coordinator.flashSafe(thrower,trial,[thrower,friend]),false);friend.yaw=Math.PI;assert.equal(coordinator.flashSafe(thrower,trial,[thrower,friend]),true);
 friend.controllerId='human';assert.equal(coordinator.turnInstruction(friend),null);friend.yaw=0;assert.equal(coordinator.flashSafe(thrower,trial,[thrower,friend]),false);
 now=7000;assert.equal(coordinator.turnInstruction(thrower),null);
});
