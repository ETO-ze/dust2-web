import test from 'node:test';
import assert from 'node:assert/strict';
import {GameRoom} from '../server/game.js';
import {initPhysics} from '../shared/physics.js';
import * as THREE from 'three';
import {aimPitch,eyePosition,accuracyForShot,sampleShotDirection} from '../shared/aim.js';
import {getWeapon} from '../shared/weapons.js';
import {cs2FovToVertical} from '../shared/cs2-settings.js';
import {PlayerTimeline,MAX_REWIND_MS} from '../shared/player-timeline.js';

initPhysics([-200,0,-200,200,0,200,200,0,-200,-200,0,-200,-200,0,200,200,0,200]);
const packet=(seq,extra={})=>({seq,forward:0,right:0,yaw:0,pitch:0,slot:1,...extra});
function fixture(){
 let now=100000;const traces=[],room=new GameRoom('AIMQA',{mode:'deathmatch',bots:0,clock:()=>now});
 const p=room.addHuman({}, {name:'Scope QA',team:'CT',primary:'awp'});
 Object.assign(p,{x:0,y:0,z:0,grounded:true,protectionUntil:0,nextShotAt:0});
 room.traceBullet=args=>{traces.push(args);return {end:{x:args.direction.x*40,y:args.origin.y+args.direction.y*40,z:args.direction.z*40},hits:[]};};
 return {room,p,traces,advance:ms=>now+=ms};
}
test('scoped click retains its aim and zoom when release and recoil arrive before the tick',()=>{
 const {room,p,traces}=fixture();
 room.receiveInput(p.id,packet(1,{fire:true,zoomLevel:2}));
 room.receiveInput(p.id,packet(2,{fire:false,zoomLevel:0,yaw:.4,pitch:.1}));room.tick();
 assert.equal(traces.length,1);
 assert.ok(Math.abs(traces[0].direction.x)<.003,'shot must retain click yaw and scoped accuracy');
 assert.ok(Math.abs(traces[0].direction.y)<.003,'shot must retain click pitch');
 assert.equal(room.events.find(e=>e.type==='shot')?.zoomLevel,2);
});
test('a scoped click followed by a weapon switch still fires the clicked weapon once',()=>{
 const {room,p,traces}=fixture(),before=p.inventory.awp.ammo;
 room.receiveInput(p.id,packet(1,{fire:true,zoomLevel:1}));
 room.receiveInput(p.id,packet(2,{fire:false,slot:3,zoomLevel:0}));room.tick();
 assert.equal(traces.length,1);assert.equal(traces[0].weapon.id,'awp');
 assert.equal(p.inventory.awp.ammo,before-1);assert.equal(p.weapon,'knife');
});
test('explicit shot IDs are immutable, bounded, and held fire does not invent additional shots',()=>{
 const {room,p,traces,advance}=fixture();
 room.receiveInput(p.id,packet(1,{fire:true,zoomLevel:2,shotId:1,shotWeapon:'awp'}));
 room.receiveInput(p.id,packet(2,{fire:true,zoomLevel:0,shotId:1,shotWeapon:'awp',yaw:.8}));room.tick();
 assert.equal(traces.length,1);assert.ok(Math.abs(traces[0].direction.x)<.003);
 advance(1500);room.receiveInput(p.id,packet(3,{fire:true}));room.tick();assert.equal(traces.length,1);
 room.receiveInput(p.id,packet(4,{fire:true,shotId:2,shotWeapon:'awp',zoomLevel:1}));room.tick();assert.equal(traces.length,2);
 for(let i=5;i<100;i++)room.receiveInput(p.id,packet(i,{fire:true,shotId:i,shotWeapon:'awp'}));
 assert.ok(p.fireQueue.length<=4);advance(200);room.tick();assert.equal(p.fireQueue.length,0);assert.equal(traces.length,2);
});
test('queued shots cannot bypass rate limits, reload, death or the available inventory',()=>{
 const {room,p,traces,advance}=fixture();p.nextShotAt=100100;
 room.receiveInput(p.id,packet(1,{fire:true,shotId:1,shotWeapon:'awp',zoomLevel:1}));room.tick();assert.equal(traces.length,0);
 advance(100);room.tick();assert.equal(traces.length,1);
 room.receiveInput(p.id,packet(2,{fire:true,shotId:2,shotWeapon:'ak47'}));assert.equal(p.fireQueue.length,0);
 advance(1500);p.reloadEndsAt=103000;room.receiveInput(p.id,packet(3,{fire:true,shotId:3,shotWeapon:'awp'}));room.tick();assert.equal(traces.length,1);
 p.reloadEndsAt=0;p.alive=false;room.receiveInput(p.id,packet(4,{fire:true,shotId:4,shotWeapon:'awp'}));room.tick();assert.equal(traces.length,1);
 room.respawn(p);assert.equal(p.fireQueue.length,0);
});
test('aim and view projection share a center at every sniper magnification and aspect ratio',()=>{
 for(const aspect of [4/3,16/9,21/9])for(const fov of [90,45,40,15,10])for(const pitch of [-1,.2,1]){
  const yaw=.4,punch=.02,angle=aimPitch(pitch,punch),camera=new THREE.PerspectiveCamera(cs2FovToVertical(fov),aspect,.04,400);
  camera.rotation.set(angle,yaw,0,'YXZ');camera.updateMatrixWorld();
  const direction=sampleShotDirection(yaw,angle,{spread:0,inaccuracy:0},()=>.5),point=new THREE.Vector3(direction.x,direction.y,direction.z).multiplyScalar(40).project(camera);
  assert.ok(Math.abs(point.x)<1e-10&&Math.abs(point.y)<1e-10);
 }
 assert.equal(eyePosition({x:0,y:2,z:0,crouch:false}).y,3.62);assert.equal(eyePosition({x:0,y:2,z:0,crouch:true}).y,2.95);
});
test('original scoped stance accuracy uses a circular cone and increases continuously with movement',()=>{
 let seed=937;const rng=()=>((seed=(seed*1664525+1013904223)>>>0)/2**32);
 for(const id of ['awp','ssg08','scar20','sg553']){
  const w=getWeapon(id),p={grounded:true,vx:0,vz:0,crouch:false},standing=accuracyForShot(w,p,1),crouched=accuracyForShot(w,{...p,crouch:true},1);
  assert.ok(crouched.total<standing.total);assert.ok(standing.total<.005);
  for(let i=0;i<1000;i++){const d=sampleShotDirection(0,0,standing,rng);assert.ok(Math.hypot(d.x,d.y)/-d.z<=standing.total+1e-9);assert.ok(Math.abs(Math.hypot(d.x,d.y,d.z)-1)<1e-10);}
  const slow=accuracyForShot(w,{...p,vx:.8},1),next=accuracyForShot(w,{...p,vx:.81},1);assert.ok(next.total-slow.total<.001);
 }
});
test('bounded rewind follows the rendered target time and never resurrects a prior life',()=>{
 const {room,p,advance}=fixture(),target=room.addHuman({}, {name:'Moving target',team:'T'});
 Object.assign(target,{x:0,y:0,z:-20,alive:true,protectionUntil:0});room.recordPoses();
 advance(100);target.x=1;room.recordPoses();advance(100);target.x=2;room.recordPoses();
 let sample=room.shotTargets(100050,100200);assert.equal(sample.players.find(x=>x.id===target.id).x,.5);assert.equal(sample.rewindMs,150);
 assert.equal(room.shotTargets(0,100200).rewindMs,MAX_REWIND_MS);
 room.respawn(target);sample=room.shotTargets(100050,100200);assert.equal(sample.players.find(x=>x.id===target.id).x,target.x);
 assert.equal(room.shotTargets(null,100200).rewindMs,0);
 const timeline=new PlayerTimeline(3);for(let i=0;i<10;i++)timeline.push(i,[{id:p.id,x:i,y:0,z:0,lifeId:1,alive:true}]);assert.equal(timeline.frames.length,3);assert.equal(timeline.sample(8.5)[0].x,8.5);
});
test('automatic scoped shot commands retain their cadence across 30 Hz tick boundaries',()=>{
 const {room,p,traces,advance}=fixture();delete p.inventory.awp;room.giveWeapon(p,'scar20');p.weapon='scar20';p.nextShotAt=0;
 let elapsed=0;
 for(let i=0;i<16;i++){
  const received=i*250;advance(received-elapsed);elapsed=received;
  room.receiveInput(p.id,packet(i+1,{fire:true,shotId:i+1,shotWeapon:'scar20',zoomLevel:1}));
  const tick=Math.ceil((received+.01)/(1000/30))*(1000/30);advance(tick-elapsed);elapsed=tick;room.tick();
  assert.equal(traces.length,i+1,'each legal fire interval must produce exactly one shot');
 }
 assert.equal(p.inventory.scar20.ammo,4);
});
test('a shot at the displayed moving target hits its historical pose, not its later position',()=>{
 const oldRandom=Math.random;Math.random=()=>0;
 try{for(const rewind of [false,true]){
  const {room,p,advance}=fixture();room.traceBullet=null;
  const target=room.addHuman({}, {name:'Moving target',team:'T'});
  Object.assign(target,{x:0,y:0,z:-20,health:100,armor:0,helmet:false,grounded:true,protectionUntil:0});room.recordPoses();
  advance(150);target.x=2;room.recordPoses();
  room.receiveInput(p.id,packet(1,{fire:true,shotId:1,shotWeapon:'awp',zoomLevel:2,...(rewind?{viewTime:100000}:{})}));room.tick();
  const shot=room.events.find(e=>e.type==='shot');assert.equal(shot.hitId,rewind?target.id:null);assert.equal(target.alive,!rewind);
 }}finally{Math.random=oldRandom;}
});
