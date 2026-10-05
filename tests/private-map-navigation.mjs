import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {BoxGeometry} from 'three';
import {initPhysics,createPlayerState,stepPlayer} from '../shared/physics.js';
import {probeNavEdge,createEdgeController,edgeMovementInput} from '../scripts/maps/navigation-movement.mjs';
import {loadPrivatePhysics} from '../scripts/maps/load-private-physics.mjs';
const box=(x,y,z,w,h,d)=>{const g=new BoxGeometry(w,h,d).toNonIndexed();g.translate(x,y,z);const p=[...g.attributes.position.array];g.dispose();return p;};
const floor=()=>box(0,-.5,0,20,1,20);
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');

test('NAV jump edge uses real jump and can be replayed without moving the character directly',()=>{
 initPhysics(new Float32Array([...floor(),...box(2,.5,0,2,1,3)]),null,{mapPatches:false});
 const a={id:1,x:0,y:0,z:0},b={id:2,x:2,y:1,z:0};
 const plan=probeNavEdge(a,b);
 assert.equal(plan.passed,true);assert(plan.mode.startsWith('jump'));assert(plan.jumps>0);
 const p={...createPlayerState(a),grounded:true},c=createEdgeController(a,b,plan);
 let ticks=0;
 for(;ticks<240;ticks++){const input=edgeMovementInput(c,p);if(!input)break;stepPlayer(p,input,1/30);}
 assert(ticks<240);assert(Math.hypot(p.x-b.x,p.z-b.z)<.18);assert(Math.abs(p.y-b.y)<.1);assert(p.grounded);
});

test('a sealed wall is rejected instead of turning a NAV link into teleportation',()=>{
 initPhysics(new Float32Array([...floor(),...box(1,3,0,.5,6,20)]),null,{mapPatches:false});
 const result=probeNavEdge({id:1,x:0,y:0,z:0},{id:2,x:3,y:0,z:0});
 assert.equal(result.passed,false);assert(result.position.x<1);
});

test('collision overlay accepts source-declared nonsolid brush, rejects stale hashes and world exclusions',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'dustii-entity-policy-')),dir=path.join(root,'compiled');
 fs.mkdirSync(dir);
 try{
  const physics=Buffer.from(new Float32Array([0,0,0,1,0,0,0,0,1]).buffer),mask=Buffer.from([7]);
  const groups=Buffer.from(JSON.stringify([{name:'func_brush',source:'map_physics.gltf',firstTriangle:0,triangles:1}]));
  fs.writeFileSync(path.join(dir,'physics.f32'),physics);fs.writeFileSync(path.join(dir,'physics-mask.u8'),mask);
  fs.writeFileSync(path.join(dir,'physics-groups.json'),groups);fs.writeFileSync(path.join(dir,'map.json'),JSON.stringify({id:'test',sourceSha256:'source'}));
  const policy={map:'test',sourceSha256:'source',physicsSha256:sha(physics),maskSha256:sha(mask),groupsSha256:sha(groups),excludedTriangles:1,
   excludedGroups:[{firstTriangle:0,triangles:1,solid:false,resolved:true,reason:'initially-disabled',sourceEntities:[{solidity:0,startdisabled:true}]}]};
  const save=()=>fs.writeFileSync(path.join(root,'entity-collision-policy.json'),JSON.stringify(policy));
  save();assert.equal(loadPrivatePhysics(root).positions.length,0);
  assert.throws(()=>loadPrivatePhysics(root,7),/channel/);
  policy.physicsSha256='stale';save();assert.throws(()=>loadPrivatePhysics(root),/does not match/);
  policy.physicsSha256=sha(physics);policy.excludedGroups[0].sourceEntities[0].startdisabled=false;save();assert.throws(()=>loadPrivatePhysics(root),/not supported/);
  policy.excludedGroups[0].sourceEntities[0].startdisabled=true;
  const world=Buffer.from(JSON.stringify([{name:'physics_group',source:'world_physics.gltf',firstTriangle:0,triangles:1}]));
  fs.writeFileSync(path.join(dir,'physics-groups.json'),world);policy.groupsSha256=sha(world);save();assert.throws(()=>loadPrivatePhysics(root),/unmatched brush/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
