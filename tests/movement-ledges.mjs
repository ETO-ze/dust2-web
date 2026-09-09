import test from 'node:test';
import assert from 'node:assert/strict';
import {BoxGeometry} from 'three';
import fs from 'node:fs';
import {initPhysics,createPlayerState,stepPlayer,PLAYER_RADIUS,STAND_HEIGHT} from '../shared/physics.js';
const box=(x,y,z,w,h,d)=>{const g=new BoxGeometry(w,h,d).toNonIndexed();g.translate(x,y,z);const p=[...g.attributes.position.array];g.dispose();return p;};
const floor=()=>box(0,-.25,0,100,.5,100);
test('a flat foot remains grounded on the last centimetres of a box without sliding or chattering',()=>{
 initPhysics([...floor(),...box(0,.75,0,1,1.5,3)]);
 for(const x of [.5,.6,.7,.5+PLAYER_RADIUS-.015]){
  const p=createPlayerState({x,y:1.5001});
  for(let frame=0;frame<180;frame++){stepPlayer(p,{},1/60);assert.ok(p.grounded,`lost ledge support at x=${x}, frame=${frame}`);assert.ok(Math.abs(p.y-1.5)<.002);assert.ok(Math.abs(p.x-x)<.002);}
  stepPlayer(p,{jumpId:1},1/60);assert.ok(p.vy>7,'the edge is valid takeoff ground');
 }
});
test('wall corners cannot turn repeated airborne collision into a grounded state',()=>{
 initPhysics([...floor(),...box(1,2,0,1,4,8),...box(0,2,-1,8,4,1)]);
 const p=createPlayerState({x:0,y:2,z:0});
 for(let i=0;i<18;i++){stepPlayer(p,{forward:1,right:1,jumpId:1},1/60);assert.ok(p.x<=.5-PLAYER_RADIUS+.002);assert.ok(p.z>=-.5+PLAYER_RADIUS-.002);assert.equal(p.grounded,false);}
});
test('a marginal-height landing settles once and a low ceiling cancels upward velocity',()=>{
 initPhysics([...floor(),...box(0,.7,0,1,1.4,3)]);const p=createPlayerState({x:.65,y:1.45});p.vy=-.2;
 let transitions=0,previous=false;for(let i=0;i<180;i++){stepPlayer(p,{},1/60);if(p.grounded!==previous)transitions++;previous=p.grounded;}
 assert.equal(transitions,1);assert.ok(Math.abs(p.y-1.4)<.002);
 initPhysics([...floor(),...box(0,2,0,8,.2,8)]);const q=createPlayerState();for(let i=0;i<20;i++)stepPlayer(q,{},1/60);
 let apex=0;for(let i=0;i<60;i++){stepPlayer(q,{jump:i===0},1/60);apex=Math.max(apex,q.y);assert.ok(q.y+STAND_HEIGHT<=1.901);}
 assert.ok(apex>.01);assert.ok(q.grounded);
});
test('real Dust2 box edges hold their support through repeated standing and jumps',()=>{
 const bytes=fs.readFileSync(new URL('../public/assets/map/positions.f32',import.meta.url));initPhysics(new Float32Array(bytes.buffer,bytes.byteOffset,bytes.byteLength/4));
 const probes=JSON.parse(fs.readFileSync(new URL('fixtures/movement-ledges.json',import.meta.url),'utf8'));
 for(const probe of probes){const p=createPlayerState(probe.ledge);for(let cycle=0;cycle<3;cycle++){
  for(let i=0;i<60;i++)stepPlayer(p,{},1/60);assert.ok(p.grounded);assert.ok(Math.abs(p.y-probe.height)<.002);
  stepPlayer(p,{jumpId:cycle+1},1/60);assert.ok(p.vy>7);for(let i=0;i<80;i++)stepPlayer(p,{},1/60);
  assert.ok(p.grounded);assert.ok(Math.abs(p.y-probe.height)<.003);assert.ok(Math.hypot(p.x-probe.ledge.x,p.z-probe.ledge.z)<.02);
 }}
});
