import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {initPhysics,createPlayerState,stepPlayer,hullFor,raycastWorld} from '../shared/physics.js';
import {patchMapCollision} from '../shared/map-collision-patch.js';
const bytes=fs.readFileSync(new URL('../public/assets/map/positions.f32',import.meta.url)),positions=new Float32Array(bytes.buffer,bytes.byteOffset,bytes.byteLength/4);
test('B window no longer collides with confirmed empty space beside the visible broken brickwork',()=>{
 const probes=[[-34.2,3.26,-67.6],[-34.1,3.26,-67.6],[-32.9,3.26,-68.5],[-32.5,3.26,-68.8]];
 const old=initPhysics(positions,null,{mapPatches:false});for(const [x,y,z]of probes)assert.ok(old.hullIntersect(hullFor(createPlayerState({x,y,z})))?.depth>.02);
 const fixed=initPhysics(positions);for(const [x,y,z]of probes)assert.ok(!(fixed.hullIntersect(hullFor(createPlayerState({x,y,z})))?.depth>.02));
});
test('crouch-jumps cross the real B window in both directions; the adjacent intact wall still blocks',()=>{
 initPhysics(positions);
 for(const reverse of [false,true])for(const z of [-68.2,-68,-67.8]){
  const p=createPlayerState({x:reverse?-35:-29.5,y:4,z});for(let i=0;i<90;i++)stepPlayer(p,{},1/60);
  for(let i=0;i<360;i++)stepPlayer(p,{forward:1,yaw:reverse?-Math.PI/2:Math.PI/2,crouch:i%60>8,jump:i%60<15},1/60);
  assert.ok(reverse?p.x>-30:p.x< -36,JSON.stringify({reverse,z,p}));assert.ok(Number.isFinite(p.x+p.y+p.z));
 }
 assert.ok(raycastWorld({x:-31,y:4,z:-66},{x:-1,y:0,z:0},4)!==null);
});
test('JSON server geometry and binary client geometry patch identically and preserve unrelated materials',()=>{
 const json=JSON.parse(fs.readFileSync(new URL('../public/assets/map/collision.json',import.meta.url))).positions;
 const materials=new Uint8Array(positions.length/9);materials[100]=2;materials[200]=3;
 const a=patchMapCollision(positions,materials),b=patchMapCollision(json,materials);
 assert.deepEqual(a.positions,b.positions);assert.deepEqual(a.materials,b.materials);assert.equal(a.materials[100],2);assert.equal(a.materials[200],3);assert.equal(a.materials.length,a.positions.length/9);
 const fixture=[0,0,0,1,0,0,0,0,1];assert.equal(patchMapCollision(fixture,null).positions,fixture);
});

// Unlike repeated jump input, this catches a single landing on the rubble lip.
test('one crouch-jump traverses all 49 rubble approaches at client and server rates',()=>{
 initPhysics(positions);
 for(const hz of [30,60])for(const reverse of [false,true])for(const z of [-68.3,-68.2,-68.1,-68,-67.9,-67.8,-67.7])for(const x of reverse?[-35,-34.7]:[-30.5,-30.8,-31,-31.2,-31.5]){
  const p=createPlayerState({x,y:4,z});for(let i=0;i<hz*1.5;i++)stepPlayer(p,{},1/hz);
  for(let i=0;i<hz*3;i++)stepPlayer(p,{forward:1,yaw:reverse?-Math.PI/2:Math.PI/2,crouch:i>=hz*.1,jump:i<hz*.13},1/hz);
  assert.ok(reverse?p.x> -31:p.x< -35,JSON.stringify({hz,reverse,x,z,end:p}));
 }
});
