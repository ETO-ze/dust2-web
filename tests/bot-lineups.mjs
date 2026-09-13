import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {initPhysics,raycastWorld,raycastWorldContact} from '../shared/physics.js';
import {GrenadeSimulation} from '../server/grenades.js';
import {BOT_LINEUPS} from '../server/bot-lineups.js';
import {simulateThrow,usefulThrow} from '../server/bot-trajectory.js';
initPhysics(JSON.parse(fs.readFileSync('public/assets/map/collision.json','utf8')).positions);
const world=new GrenadeSimulation({raycastWorld,raycastContact:raycastWorldContact});
test('every shipped tactical lineup succeeds on the real map with small stance/aim errors',()=>{
 assert.ok(BOT_LINEUPS.length>=8);
 for(const s of BOT_LINEUPS){
  for(const [x,z,a] of [[0,0,0],[-.1,0,.002],[.1,0,-.002],[0,.1,.002],[0,-.1,-.002]]){
   const result=simulateThrow(world,{...s.stand,x:s.stand.x+x,z:s.stand.z+z},s.weapon,{...s,yaw:s.yaw+a});
   assert.ok(usefulThrow(result,s,world),s.id+' '+[x,z,a]);
  }
  if(s.weapon==='smokegrenade'){assert.ok(s.sight,s.id);assert.ok(world.clearSight(...s.sight),s.id+' reference ray was already blocked by map');}
 }
 assert.equal(world.projectiles.length,0);assert.equal(world.smokes.length,0);assert.equal(world.fires.length,0);
});
test('full, lob and underhand preflight match the production projectile simulation',()=>{
 const stand=BOT_LINEUPS[0].stand;
 for(const [throwMode,throwStrength] of [['full',1],['lob',.5],['drop',0]]){
  const input={yaw:.6,pitch:.4,throwMode,throwStrength},predicted=simulateThrow(world,stand,'hegrenade',input);let now=800000,actual;
  const sim=new GrenadeSimulation({clock:()=>now,raycastWorld,raycastContact:raycastWorldContact,onExplosion:g=>{actual={x:g.x,y:g.y,z:g.z};}});
  sim.throwGrenade({...stand,id:'test',team:'T',inventory:{}},'hegrenade',input);
  for(let i=0;i<240&&!actual;i++){now+=1000/30;sim.tick(1/30);}
  assert.ok(actual);assert.ok(Math.hypot(actual.x-predicted.point.x,actual.y-predicted.point.y,actual.z-predicted.point.z)<.6,throwMode);
 }
});
