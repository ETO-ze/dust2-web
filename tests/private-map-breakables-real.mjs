import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {loadPrivateMapRuntime} from '../server/private-map-runtime.js';
import {createPlayerState,raycastWorldHit,raycastGrenadeWorld} from '../shared/physics.js';
import {STANDING_EYE_HEIGHT} from '../shared/aim.js';
import {lookAt} from '../server/bot-perception.js';

const directory=process.env.DUSTII_PRIVATE_MAP_DIRECTORY;
const available=directory&&fs.existsSync(directory+'/compiled/map.json')&&JSON.parse(fs.readFileSync(directory+'/compiled/map.json')).id==='de_mirage';
test('actual Mirage source panels break by gun and knife, preserve other collision and restore each round',{skip:!available},async()=>{
 const context=loadPrivateMapRuntime(directory),{GameRoom}=await import('../server/game.js');let now=10000;
 const room=new GameRoom('PANELS',{bots:0,privateMap:context,clock:()=>now}),p=room.addHuman({},{name:'Breakable QA',team:'CT'});
 assert.equal(context.config.breakables.length,3);const results=[];
 const random=Math.random;Math.random=()=>0;
 try{for(const object of context.config.breakables){
  const center=Object.fromEntries(['x','y','z'].map(a=>[a,(object.bounds.min[a]+object.bounds.max[a])/2]));let found;
  for(const axis of ['x','z'])for(const sign of [-1,1]){
   if(found)break;const origin={...center,[axis]:object.bounds[sign>0?'max':'min'][axis]+sign*.45},direction={x:0,y:0,z:0,[axis]:-sign},hit=raycastWorldHit(origin,direction,1);
   if(hit&&room.mapBreakables.atTriangle(2,hit.triangle)?.id===object.id)found={origin,direction,hit};
  }
  assert.ok(found,object.id+' must have a real unobstructed face');
  const {origin,direction,hit}=found,aim=lookAt(origin,center);
  Object.assign(p,createPlayerState({...origin,y:origin.y-STANDING_EYE_HEIGHT}),{alive:true,nextShotAt:0,reloadEndsAt:0,weapon:'ak47',triggerWasDown:false});room.giveWeapon(p,'ak47');p.weapon='ak47';room.fire(p,{fire:true,...aim});
  assert.equal(room.mapBreakables.broken.has(object.id),true);assert.ok(!room.mapBreakables.atTriangle(2,raycastWorldHit(origin,direction,1)?.triangle));
  assert.ok(raycastGrenadeWorld(origin,direction,hit.distance+.02)===null,'grenades must pass former panel');
  const afterGun=room.snapshot({drainEvents:false}).mapBreakables.find(s=>s.id===object.id);assert.equal(afterGun.broken,true);
  room.startRound();assert.equal(room.mapBreakables.broken.size,0);assert.equal(room.mapBreakables.atTriangle(2,raycastWorldHit(origin,direction,1).triangle).id,object.id);
  now+=1000;Object.assign(p,createPlayerState({...origin,y:origin.y-STANDING_EYE_HEIGHT}),{alive:true,nextShotAt:0,reloadEndsAt:0,weapon:'knife'});room.giveWeapon(p,'knife');p.weapon='knife';room.swingKnife(p,{fire2:true,...aim});assert.equal(room.mapBreakables.broken.has(object.id),true);
  results.push({id:object.id,gun:true,knife:true,grenadePass:true,reset:true,exactTriangles:object.triangles});room.startRound();
 }}finally{Math.random=random;}
 console.log('private-map-breakables',JSON.stringify({map:context.mapId,objects:results,breakablesSha256:context.config.breakablesSha256}));
});
