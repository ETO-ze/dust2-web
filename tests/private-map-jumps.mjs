import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {BoxGeometry} from 'three';
import {initPhysics,createPlayerState,stepPlayer,JUMP_SPEED,GRAVITY,isHullClear} from '../shared/physics.js';
import {MovementPrediction} from '../client/movement-prediction.js';
import {MovementStream,movementState,sanitizeMoves} from '../shared/movement-commands.js';
import {loadPrivatePhysics} from '../scripts/maps/load-private-physics.mjs';
import {probeNavEdge} from '../scripts/maps/navigation-movement.mjs';
import {MIRAGE_JUMP_IDENTITY,MIRAGE_JUMP_LINKS,createJumpLinkController,jumpLinkInput,jumpLinkLanded} from '../shared/private-map-jump-links.js';
import {PRIVATE_BREAKABLES} from '../shared/private-map-breakables-data.js';
import {PrivateMapBreakables} from '../shared/private-map-breakables.js';
const floor=()=>{const g=new BoxGeometry(200,1,200).toNonIndexed();g.translate(0,-.5,0);const a=g.attributes.position.array.slice();g.dispose();return a;};
const settle=(spawn,dt=1/30)=>{const p=createPlayerState(spawn);for(let i=0;i<10;i++)stepPlayer(p,{},dt);return p;};

test('private air movement preserves released-W and crouched momentum without altering jump impulse',()=>{
 initPhysics(floor(),null,{mapPatches:false,airMovement:'source'});
 for(const hz of [30,60,120]){
  const p=settle({x:0,y:.002,z:0},1/hz);p.vz=-6;let apex=p.y;
  for(let i=0;i<hz*.5;i++){stepPlayer(p,{jump:i===0,crouch:i>=hz*.1,yaw:i*.04},1/hz);assert.ok(Math.abs(p.vz+6)<1e-8);assert.equal(p.vx,0);apex=Math.max(apex,p.y);}
  assert.ok(apex<1.91);assert.ok(apex>1.89);
 }
 const p=settle();stepPlayer(p,{jump:true},1/30);assert.ok(Math.abs(p.vy-(JUMP_SPEED-GRAVITY/30))<1e-8);
 initPhysics(floor(),null,{mapPatches:false});const legacy=settle();legacy.vz=-6;stepPlayer(legacy,{jump:true,crouch:true},1/30);assert.ok(legacy.vz>-6,'Production keeps its pre-existing air model by default');
});

test('air strafe builds a gradual arc and does not instantly rotate velocity with the view',()=>{
 initPhysics(floor(),null,{mapPatches:false,airMovement:'source'});const p=settle();p.vz=-6;
 stepPlayer(p,{jump:true,right:-1,yaw:0},1/60);assert.ok(p.vx<0&&p.vx>-.8);assert.equal(p.vz,-6);
 const firstX=p.vx;for(let i=1;i<18;i++)stepPlayer(p,{right:-1,yaw:i/60*2,crouch:i>=6},1/60);
 assert.ok(p.vx<firstX-1);assert.ok(p.vz<0);assert.ok(Math.hypot(p.vx,p.vz)<8);
});

test('private source-air commands predict and reconcile identically on the shared network chain',()=>{
 initPhysics(floor(),null,{mapPatches:false,airMovement:'source'});const client={...settle(),lifeId:1},server={...client},prediction=new MovementPrediction(),stream=new MovementStream(1);prediction.reset(client);
 for(let i=0;i<180;i++){
  const input={forward:i<24?1:0,right:i>=24&&i<70?-1:0,yaw:i>=24?(i-24)/60*2:0,pitch:0,jump:i===24,jumpId:i>=24?1:0,crouch:i>=30&&i<95,speedScale:1};
  prediction.step(client,input);stream.receive(sanitizeMoves(prediction.packet()));stream.advance(server,1/60,{canMove:true,speedLimit:1});
  prediction.reconcile(client,{movementState:movementState(server),movementAck:stream.ack});
  assert.ok(Math.hypot(client.x-server.x,client.y-server.y,client.z-server.z)<1e-8);
 }
});

test('shortcut controller fails closed when support or bot ownership is lost or vent remains intact',()=>{
 const link=MIRAGE_JUMP_LINKS.at(-1),p={...createPlayerState(link.from),grounded:true};
 const blocked=createJumpLinkController(link);jumpLinkInput(blocked,p,1/30);assert.equal(blocked.failed,'breakable-closed');
 const takeover=createJumpLinkController(link);jumpLinkInput(takeover,p,1/30,{broken:()=>true,controlled:true});assert.equal(takeover.failed,'control-lost');
 const falling=createJumpLinkController(link);jumpLinkInput(falling,{...p,grounded:false},1/30,{broken:()=>true});assert.equal(falling.failed,'start-not-supported');
});

const directory=process.env.DUSTII_MIRAGE_DIRECTORY||'E:/CodexBuilds/dust2-map-library/de_mirage/e66cdf1ae6a9-36f6a0fd';
test('actual Mirage shortcuts, NAV connectors and intact vent collision',{skip:!fs.existsSync(directory+'/compiled/map.json')},async t=>{
 const map=JSON.parse(fs.readFileSync(directory+'/compiled/map.json')),physics=loadPrivatePhysics(directory),audit=JSON.parse(fs.readFileSync(directory+'/navigation-audit.json'));
 assert.equal(map.sourceSha256,MIRAGE_JUMP_IDENTITY.sourceSha256);assert.equal(physics.physicsSha256,MIRAGE_JUMP_IDENTITY.physicsSha256);
 const breakables=new PrivateMapBreakables(PRIVATE_BREAKABLES.objects,{1:physics.sourceTriangles});
 initPhysics(physics.positions,null,{mapPatches:false,copyPositions:false,airMovement:'source',triangleEnabled:(channel,index)=>breakables.triangleEnabled(channel,index)});
 const stands=new Map(audit.standPoints.map(p=>[p.id,p])),evidence=[];
 const run=(link,p,dt)=>{const control=createJumpLinkController(link),inputs=[];for(let i=0;i<1000&&!control.done&&!control.failed;i++){const input=jumpLinkInput(control,p,dt,{broken:id=>breakables.broken.has(id)});inputs.push(input);stepPlayer(p,input,dt);}return {control,p,inputs};};
 breakables.damage('mirage-ladder-vent',1);
 for(const hz of [30,60,120])for(const link of MIRAGE_JUMP_LINKS)await t.test(link.id+' at '+hz+' Hz',()=>{
  const p=settle({...link.from,y:link.from.y+.002},1/hz),r=run(link,p,1/hz);
  assert.equal(r.control.done,true,r.control.failed);assert.equal(r.control.jumps,1);assert.ok(jumpLinkLanded(link,p));assert.ok(isHullClear({...p,y:p.y+.004},p.height));
  evidence.push({id:link.id,hz,ticks:r.inputs.length,end:{x:p.x,y:p.y,z:p.z}});
 });
 for(const link of MIRAGE_JUMP_LINKS)await t.test(link.id+' NAV → start → jump → NAV with continuous player state',()=>{
  const a=stands.get(link.navFrom),b=stands.get(link.navTo),initial=probeNavEdge(a,{...link.from,id:link.id+'-start'});assert.ok(initial.passed);
  const r=run(link,{...initial.endState},1/30);assert.ok(r.control.done,r.control.failed);
  const final=probeNavEdge({...r.p,id:link.id+'-landed'},b,{initialState:r.p});assert.ok(final.passed,JSON.stringify(final));
 });
 for(const indexes of [[0,1],[2,3]])await t.test('consecutive shortcuts '+indexes.join(' → ')+' retain landing momentum and stance',()=>{
  let p=settle({...MIRAGE_JUMP_LINKS[indexes[0]].from,y:MIRAGE_JUMP_LINKS[indexes[0]].from.y+.002});
  for(const index of indexes){const r=run(MIRAGE_JUMP_LINKS[index],p,1/30);assert.ok(r.control.done,r.control.failed);p=r.p;}
 });
 await t.test('exact successful inputs cannot cross the unbroken vent; round reset restores it',()=>{
  const link=MIRAGE_JUMP_LINKS.at(-1),start=settle({...link.from,y:link.from.y+.002}),open=run(link,{...start},1/30);assert.ok(open.control.done);
  breakables.reset();const closed={...start};let crossed=false;
  for(const input of open.inputs){stepPlayer(closed,input,1/30);crossed||=closed.z<10.8&&closed.y>-1.7;}
  assert.equal(crossed,false);assert.ok(closed.z>11.3);
 });
 if(process.env.DUSTII_JUMP_REPORT)fs.writeFileSync(process.env.DUSTII_JUMP_REPORT,JSON.stringify({identity:MIRAGE_JUMP_IDENTITY,links:MIRAGE_JUMP_LINKS,evidence},null,2));
});
