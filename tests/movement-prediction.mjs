import test from 'node:test';
import assert from 'node:assert/strict';
import {BoxGeometry} from 'three';
import {initPhysics,createPlayerState,stepPlayer} from '../shared/physics.js';
import {MovementStream,simulateMove,movementState,sanitizeMoves,MAX_MOVE_QUEUE} from '../shared/movement-commands.js';
import {MovementPrediction} from '../client/movement-prediction.js';
import {GameRoom} from '../server/game.js';
const box=(x,y,z,w,h,d)=>{const g=new BoxGeometry(w,h,d).toNonIndexed();g.translate(x,y,z);const p=[...g.attributes.position.array];g.dispose();return p;};
const init=()=>initPhysics([...box(0,-.25,0,100,.5,100),...box(2,.7,0,1,1.4,3)]);
const spawn=()=>{const p={...createPlayerState({x:-1}),lifeId:1};for(let i=0;i<60;i++)stepPlayer(p,{},1/60);return p;};
const input=(frame)=>({forward:0,right:frame<210?1:0,yaw:0,pitch:0,speedScale:.7,jump:frame===28,jumpId:frame>=28?1:0,crouch:frame>=36&&frame<60,walk:false});
const delta=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
test('60 Hz commands replay exactly through delayed, jittered 15 Hz acknowledgements and box landings',()=>{
 for(const oneWayFrames of [0,2,5,9]){
  init();const client=spawn(),server={...client},expected={...client},prediction=new MovementPrediction(),stream=new MovementStream(1);prediction.reset(client);
  const inbound=[],outbound=[];let previousDelivery=-1,maxError=0;
  for(let frame=0;frame<360;frame++){
   prediction.step(client,input(frame));simulateMove(expected,{...input(frame)});
   if(frame%2===1){const at=Math.max(previousDelivery,frame+oneWayFrames+(frame%46===1?6:0));previousDelivery=at;inbound.push({at,moves:prediction.packet()});}
   while(inbound[0]?.at<=frame)stream.receive(sanitizeMoves(inbound.shift().moves));
   if(frame%2===1)stream.advance(server,1/30,{canMove:true,speedLimit:.7});
   if(frame%4===3)outbound.push({at:frame+oneWayFrames,packet:{movementState:movementState(server),movementAck:stream.ack}});
   while(outbound[0]?.at<=frame)prediction.reconcile(client,outbound.shift().packet);
   maxError=Math.max(maxError,delta(client,expected));assert.ok(prediction.history.length<=64);
  }
  assert.ok(maxError<1e-7,JSON.stringify({oneWayFrames,maxError,status:prediction.status()}));
 }
});
test('144 Hz camera positions interpolate fixed simulation ticks without repeated walking frames',()=>{
 initPhysics(box(0,-.25,0,100,.5,100));const p=spawn(),prediction=new MovementPrediction();p.vx=6;prediction.reset(p);let accumulator=0,previous=null,min=Infinity,max=0;
 for(let frame=0;frame<120;frame++){
  accumulator+=1/144;while(accumulator>=1/60){prediction.step(p,{...input(0),speedScale:1});accumulator-=1/60;}
  const view=prediction.render(p,accumulator*60,1/144);
  if(frame>4){const movement=view.x-previous.x;min=Math.min(min,movement);max=Math.max(max,movement);}previous=view;
 }
 assert.ok(min>.03,`walking repeats/backs up: ${min}`);assert.ok(max-min<.001,`${min}..${max}`);
});
test('movement budget, queue, deduplication and life IDs bound malformed or forged commands',()=>{
 init();const p=spawn(),stream=new MovementStream(1);
 assert.deepEqual(sanitizeMoves(Array(9).fill({...input(0),id:1,lifeId:1})),[]);
 assert.deepEqual(sanitizeMoves([{...input(0),id:1,lifeId:1,yaw:Infinity}]),[]);
 for(let start=1;start<200;start+=8)stream.receive(sanitizeMoves(Array.from({length:8},(_,i)=>({...input(0),id:start+i,lifeId:1,dt:20}))));
 assert.equal(stream.queue.length,MAX_MOVE_QUEUE);assert.equal(stream.advance(p,1/30,{speedLimit:.7}),2);assert.equal(stream.ack,2);
 stream.receive(sanitizeMoves([{...input(0),id:1,lifeId:1}]));assert.equal(stream.ack,2);
 stream.reset(2);stream.receive(sanitizeMoves([{...input(0),id:999,lifeId:1}]));assert.equal(stream.queue.length,0);
 stream.receive(sanitizeMoves([{...input(0),id:1,lifeId:2}]));assert.equal(stream.advance(p,1/30,{canMove:false}),1);assert.equal(p.lastJumpId,0);
});
test('a movement-aware shot uses its command position before a later move and quick switch',()=>{
 init();let now=100000;const room=new GameRoom('MOVESHOT',{mode:'deathmatch',bots:0,clock:()=>now}),p=room.addHuman({}, {name:'Movement QA',team:'CT',primary:'awp',movementProtocol:1});
 Object.assign(p,spawn(),{x:0,weapon:'awp',slot:1,nextShotAt:0});p.movementStream.reset(p.lifeId);
 const first={...input(0),id:1,lifeId:p.lifeId,speedScale:.7},second={...first,id:2};
 const expected={...p};simulateMove(expected,first,{speedLimit:.7});
 room.traceBullet=({origin})=>({end:{...origin,z:origin.z-10},hits:[]});
 room.receiveInput(p.id,{seq:1,...input(0),slot:1,fire:true,shotId:1,shotWeapon:'awp',zoomLevel:1,moveId:1,moves:[first]});
 room.receiveInput(p.id,{seq:2,...input(0),slot:3,fire:false,moveId:2,moves:[second]});now+=1000/30;room.tick();
 const shot=room.events.find(e=>e.type==='shot');assert.ok(shot);assert.ok(Math.abs(shot.origin.x-expected.x)<1e-8);assert.equal(shot.zoomLevel,1);assert.equal(p.weapon,'knife');assert.equal(p.movementStream.ack,2);
});
test('late server timers accrue wall time without building a permanent movement queue',()=>{
 init();let now=100000;const room=new GameRoom('MOVETIME',{mode:'deathmatch',bots:0,clock:()=>now}),p=room.addHuman({}, {name:'Timer QA',team:'CT',movementProtocol:1});
 assert.equal(p.lifeId,1);assert.equal(p.movementStream.lifeId,1);Object.assign(p,spawn());
 let id=0,seq=0,generated=0;
 for(let tick=0;tick<90;tick++){
  now+=40;const due=Math.floor((now-100000)*.06);const moves=[];while(generated<due){generated++;moves.push({...input(0),id:++id,lifeId:1});}
  room.receiveInput(p.id,{seq:++seq,...input(0),moves});room.tick();
  assert.ok(p.movementStream.queue.length<=1,'40 ms callbacks must not fall behind 60 Hz input');
 }
 assert.ok(p.movementStream.ack>=215);
});
