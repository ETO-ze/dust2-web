import test from 'node:test';
import assert from 'node:assert/strict';
import {SOURCE_LADDERS} from '../shared/private-map-ladders-data.js';
import {stepLadder,laddersForMap} from '../shared/ladder-movement.js';
import {createPlayerState} from '../shared/physics.js';
import {NUKE_VENT} from '../shared/private-map-entities.js';
import {PrivateMapBreakables} from '../shared/private-map-breakables.js';

test('source ladder endpoints only activate on their matching VPK',()=>{
  assert.equal(Object.keys(SOURCE_LADDERS).length,9);
  let count=0;
  for(const [id,data] of Object.entries(SOURCE_LADDERS)){
    assert.deepEqual(laddersForMap({id,sourceSha256:'old'}),[]);
    const rails=laddersForMap({id,sourceSha256:data.source});count+=rails.length;
    assert.equal(new Set(rails.map(r=>r.id)).size,rails.length);
    for(const rail of rails){
      assert.ok(Math.abs(Math.hypot(...rail.normal)-1)<.00001);
      assert.ok(rail.width>.3&&rail.top[1]>rail.bottom[1]);
    }
  }
  assert.equal(count,21);
});

test('holding still on a ladder does not drift; a fresh jump releases it into normal airborne movement',()=>{
  const rail={id:1,normal:[0,1],width:1,top:[0,5,0],bottom:[0,0,0],exits:[]};
  const p=createPlayerState({z:.36});
  const io={radius:.30,landings:new Map(),move(s,x,y,z){s.x+=x;s.y+=y;s.z+=z;}};
  for(let i=0;i<18;i++)assert.ok(stepLadder(p,{forward:1},1/60,[rail],io,0,-1));
  assert.equal(p.ladderId,1);
  const previous=[p.x,p.y,p.z];
  for(let i=0;i<60;i++)assert.ok(stepLadder(p,{},1/60,[rail],io,0,0));
  assert.deepEqual([p.x,p.y,p.z],previous);
  p.jumpBufferRemaining=.05;
  assert.equal(stepLadder(p,{jump:true},1/60,[rail],io,0,0),false);
  assert.equal(p.ladderId,0);assert.ok(p.vy>0&&p.vz>0&&p.ladderCooldown>0);
  assert.equal(stepLadder(p,{forward:1},1/60,[rail],io,0,-1),false);
});

test('both intact Nuke louver poses retain the obstruction; destruction disables its button until reset',()=>{
  const def=NUKE_VENT.objects[0],state=new PrivateMapBreakables([def],{1:[def.firstTriangle]});
  assert.equal(state.snapshot()[0].open,true);assert.equal(state.triangleEnabled(1,0),true);
  assert.ok(state.toggle(def.id,1000));assert.equal(state.snapshot()[0].open,false);
  assert.equal(state.toggle(def.id,1699),false);assert.equal(state.triangleEnabled(1,0),true);
  assert.ok(state.toggle(def.id,1700));assert.ok(state.damage(def.id,1));
  assert.equal(state.triangleEnabled(1,0),false);assert.equal(state.toggle(def.id,2500),false);
  const late=new PrivateMapBreakables([def],{1:[def.firstTriangle]});
  late.applySnapshot(state.snapshot());assert.deepEqual(late.snapshot(),state.snapshot());
  state.reset();assert.equal(state.triangleEnabled(1,0),true);assert.equal(state.snapshot()[0].open,true);
});
