import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {BoxGeometry} from 'three';
import {GameRoom} from '../server/game.js';
import {GrenadeSimulation} from '../server/grenades.js';
import {EQUIPMENT,UTILITY_IDS,teamUtilities} from '../shared/equipment.js';
import {initPhysics,createPlayerState,stepPlayer,raycastWorld,raycastWorldContact} from '../shared/physics.js';
import {MovementStream,movementState,simulateMove} from '../shared/movement-commands.js';
import {MovementPrediction} from '../client/movement-prediction.js';
import {MAP} from '../shared/map-data.js';
import {UTILITY_ASSETS} from '../shared/utility-assets.js';
const box=(x,y,z,w,h,d)=>{const g=new BoxGeometry(w,h,d).toNonIndexed();g.translate(x,y,z);const a=[...g.attributes.position.array];g.dispose();return a;};
function world(){initPhysics([...box(0,-.5,0,200,1,200),...box(5,2,0,.2,4,20)]);}
function sim(){let now=100000;const events=[],damage=[];const s=new GrenadeSimulation({clock:()=>now,raycastWorld,raycastContact:raycastWorldContact,emit:(type,e)=>events.push({type,...e}),onFire:f=>damage.push(f.id)});return {s,events,damage,tick:(seconds)=>{for(let i=0;i<Math.ceil(seconds*120);i++){now+=1000/120;s.tick(1/120);}},advance:ms=>now+=ms};}
const player={id:'t',team:'T',x:0,y:0,z:0,vx:0,vy:0,vz:0,loadoutPrimary:'awp'};
function room(){let now=100000;const r=new GameRoom('UTILQA',{mode:'defuse',bots:0,clock:()=>now});const t=r.addHuman({}, {name:'T',team:'T'}),ct=r.addHuman({}, {name:'CT',team:'CT'});r.round.phase='live';r.round.phaseEndsAt=now+115000;return {r,t,ct,step:(p,input)=>{now+=1000/30;r.receiveInput(p.id,{seq:(p.seq||0)+1,forward:0,right:0,yaw:0,pitch:0,slot:p.slot,...input});r.tick(1/30);}};}

test('each side has five utility types, exact local Valve prices, actual models and kit team restriction',()=>{
  world();const {r,t,ct}=room();r.mode='deathmatch';
  assert.equal(teamUtilities('T').length,5);assert.equal(teamUtilities('CT').length,5);
  assert.deepEqual(['molotov','incgrenade','decoy','defusekit'].map(id=>EQUIPMENT[id].price),[400,500,50,400]);
  for(const p of [t,ct])for(const id of teamUtilities(p.team)){for(const u of UTILITY_IDS)delete p.inventory[u];assert.equal(r.buy(p.id,id).ok,true,id);assert.equal(p.inventory[id].ammo,1);}
  assert.equal(r.buy(t.id,'incgrenade').ok,false);assert.equal(r.buy(ct.id,'molotov').ok,false);assert.equal(r.buy(t.id,'defusekit').ok,false);assert.equal(r.buy(ct.id,'defusekit').ok,true);
  for(const id of [...UTILITY_IDS,'defusekit']){const a=UTILITY_ASSETS[id];assert.ok(a.bytes>10000);assert.equal(fs.statSync(new URL('../public/'+a.model,import.meta.url)).size,a.bytes);}
});

test('all six grenade variants support full/lob/drop and inherit running/jumping momentum',()=>{
  world();for(const id of UTILITY_IDS){const speeds=[];for(const strength of [0,.5,1]){const {s}=sim();s.throwGrenade(player,id,{yaw:0,pitch:0,throwStrength:strength});const g=s.projectiles[0];speeds.push(Math.hypot(g.vx,g.vy,g.vz));assert.ok(g.vy>0);}
    assert.ok(speeds[0]<speeds[1]&&speeds[1]<speeds[2]);assert.ok(Math.abs(speeds[2]-17.145)<.001);
  }
  const {s}=sim();s.throwGrenade({...player,vx:4,vy:5},'hegrenade',{yaw:0,pitch:0});assert.equal(s.projectiles[0].vx,5);assert.ok(s.projectiles[0].vy>6.25);
});

test('swept projectile follows the analytic arc, reflects the surface normal and never crosses a wall',()=>{
  world();const {s}=sim();s.throwGrenade(player,'hegrenade',{yaw:0,pitch:.2});const g=s.projectiles[0],initial={...g};
  for(let i=0;i<30;i++)s.advance(g,1/120);assert.ok(Math.abs(g.z-(initial.z+initial.vz*.25))<1e-7);assert.ok(Math.abs(g.y-(initial.y+initial.vy*.25-.5*8.128*.25**2))<1e-7);
  Object.assign(g,{x:4.7,y:2,z:0,vx:12,vy:0,vz:5});s.advance(g,.03);assert.ok(g.x<4.9);assert.ok(g.vx<0&&g.vz>0,'normal reflects, tangent stays forward');
  for(let i=0;i<240;i++){s.advance(g,1/120);assert.ok(g.x<4.91&&g.y>=.05);}
});

test('smoke waits for landing; flash/HE timers start after release; fire lands and smoke extinguishes it',()=>{
  world();let {s,tick,events,damage}=sim();s.throwGrenade({...player,y:35},'smokegrenade',{yaw:0,pitch:1});tick(3.5);assert.equal(s.smokes.length,0);assert.equal(s.projectiles.length,1);
  ({s,tick,events,damage}=sim());s.throwGrenade(player,'molotov',{yaw:0,pitch:-.5});tick(.5);assert.equal(s.projectiles.length,0);assert.equal(s.fires.length,1);assert.ok(s.fires[0].cells.length>5);assert.ok(damage.length>0);
  const f=s.fires[0];assert.ok(f.cells.every(c=>c.x<4.9&&Math.abs(c.y-.025)<.01));s.detonate({id:'smoke',ownerId:'ct',team:'CT',weapon:'smokegrenade',x:f.x,y:0,z:f.z});assert.equal(s.fires.length,0);assert.ok(events.some(e=>e.type==='fire_extinguished'));
});

test('decoy produces bounded real-weapon pulses after landing, expires and round cleanup releases all effects',()=>{
  world();const {s,tick,events}=sim();s.throwGrenade(player,'decoy',{yaw:0,pitch:-.7,throwStrength:0});tick(4);assert.equal(s.decoys.length,1);assert.ok(events.some(e=>e.type==='decoy_pulse'&&e.weapon==='awp'));tick(16);assert.equal(s.decoys.length,0);assert.equal(events.filter(e=>e.type==='explosion'&&e.weapon==='decoy').length,1);assert.ok(events.filter(e=>e.type==='decoy_pulse').length<20);s.clear();assert.deepEqual([s.smokes,s.fires,s.decoys,s.projectiles],[[],[],[],[]]);
});

test('fire damage bypasses armor, respects cover/team/height and credits the owner',()=>{
  world();const {r,t,ct}=room();Object.assign(ct,{x:0,y:0,z:0,health:100,armor:100,alive:true,protectionUntil:0});Object.assign(t,{x:10,y:0,z:0,health:100,protectionUntil:0});
  const f={id:'f',ownerId:t.id,team:'T',weapon:'molotov',cells:[{x:0,y:.025,z:0}]};r.burnPlayers(f,EQUIPMENT.molotov);assert.equal(ct.health,92);assert.equal(ct.armor,100);ct.y=2;r.burnPlayers(f,EQUIPMENT.molotov);assert.equal(ct.health,92);
  Object.assign(ct,{y:0,health:8});r.burnPlayers(f,EQUIPMENT.molotov);assert.equal(ct.alive,false);assert.equal(t.roundKills,1);
});

test('plant/defuse force a fixed crouch; turning and movement/jump keys preserve progress; release cancels',()=>{
  const bytes=fs.readFileSync(new URL('../public/assets/map/positions.f32',import.meta.url));initPhysics(new Float32Array(bytes.buffer,bytes.byteOffset,bytes.byteLength/4));
  for(const kit of [false,true]){
    const {r,t,ct,step}=room(),site=MAP.sites.B;Object.assign(t,site,{grounded:true,vx:4,vy:0,vz:2});r.selectSlot(t,5);
    step(t,{fire:true});const start={x:t.x,y:t.y,z:t.z};assert.equal(r.bomb.action,'plant');assert.ok(t.crouch&&t.objectiveLocked);
    for(let i=0;i<30;i++)step(t,{fire:true,yaw:i*.2,pitch:1.4,forward:1,right:1,jump:true,jumpId:i+1});
    assert.deepEqual({x:t.x,y:t.y,z:t.z},start);assert.ok(r.bomb.progress>.3);assert.equal(t.height,1.1);assert.ok(t.pitch>1);
    step(t,{fire:false});assert.equal(r.bomb.progress,0);assert.equal(t.objectiveLocked,false);
    // Complete the plant and approach the planted C4 from the other side.
    Object.assign(t,start,{grounded:true});for(let i=0;i<91;i++)step(t,{fire:true,slot:5});assert.equal(r.bomb.state,'planted');
    Object.assign(ct,{x:r.bomb.x+.5,y:r.bomb.y,z:r.bomb.z,grounded:true,defuseKit:kit,vx:3,vy:0,vz:0});
    const defuseStart={x:ct.x,y:ct.y,z:ct.z};for(let i=0;i<60;i++)step(ct,{interact:true,yaw:i*.3,pitch:1.4,forward:1,jump:true,jumpId:i+1});
    assert.equal(r.bomb.action,'defuse');assert.ok(ct.crouch&&ct.objectiveLocked);assert.deepEqual({x:ct.x,y:ct.y,z:ct.z},defuseStart);assert.ok(Math.abs(r.bomb.progress-(kit?.4:.2))<.005);
    step(ct,{interact:false});assert.equal(r.bomb.progress,0);assert.equal(ct.objectiveLocked,false);
  }
});

test('server movement queue cannot break an objective lock, and prediction replays the same stationary crouch',()=>{
  world();const p={...createPlayerState(),lifeId:1,grounded:true,objectiveLocked:true},client={...p},prediction=new MovementPrediction(),stream=new MovementStream(1);prediction.reset(client);
  for(let i=0;i<90;i++){const input={forward:1,right:1,yaw:i*.1,pitch:1.2,speedScale:1,jump:true,jumpId:i+1,crouch:false,walk:false};prediction.step(client,input);stream.receive(prediction.packet());stream.advance(p,1/60,{canMove:true});prediction.reconcile(client,{movementState:movementState(p),movementAck:stream.ack});assert.equal(client.y,0);assert.equal(client.x,0);assert.equal(client.height,1.1);}
  p.objectiveLocked=false;simulateMove(p,{forward:1,right:0,yaw:0,pitch:0,speedScale:1,jump:false,jumpId:90});assert.ok(p.z<0);assert.equal(p.jumpBufferRemaining,0);
});

test('a dropped defuse kit can be recovered by a living CT but never a T or duplicate owner',()=>{
  world();const {r,t,ct}=room(),ct2=r.addHuman({}, {name:'CT2',team:'CT'});Object.assign(ct,{x:0,y:0,z:0,alive:true,defuseKit:true});Object.assign(t,{x:0,y:0,z:0});Object.assign(ct2,{x:10,y:0,z:0,alive:true});r.kill(ct,t);assert.equal(r.defuseKits.length,1);r.pickupKits();assert.equal(t.defuseKit,false);assert.equal(r.defuseKits.length,1);ct2.x=0;r.pickupKits();assert.equal(ct2.defuseKit,true);assert.equal(r.defuseKits.length,0);r.startRound();assert.equal(r.defuseKits.length,0);
});
