import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { BoxGeometry } from 'three';
import { MAP } from '../shared/map-data.js';
import { initPhysics, createPlayerState, stepPlayer, GRAVITY, JUMP_SPEED, CROUCH_JUMP_LIFT, STAND_HEIGHT, CROUCH_HEIGHT } from '../shared/physics.js';

const plane=(degrees=0)=>{
  const k=Math.tan(degrees*Math.PI/180),d=100;
  return [-d,-d*k,-d,d,d*k,d,d,d*k,-d,-d,-d*k,-d,-d,-d*k,d,d,d*k,d];
};
function box(x,y,z,w,h,d){const g=new BoxGeometry(w,h,d).toNonIndexed();g.translate(x,y,z);const a=Array.from(g.attributes.position.array);g.dispose();return a;}
function settle(spawn={},dt=1/60){const p=createPlayerState(spawn);for(let i=0;i<120;i++)stepPlayer(p,{},dt);assert.ok(p.grounded,'Fixture has a walkable floor');return p;}
function jumpArc(p,dt=1/60,crouchAt=Infinity){
  const origin=p.y;let apex=0,landedAt=null;
  for(let frame=0;frame<3/dt;frame++){
    stepPlayer(p,{jump:frame===0,crouch:frame>=crouchAt},dt);
    apex=Math.max(apex,p.y-origin);
    assert.ok([p.x,p.y,p.z,p.vx,p.vy,p.vz].every(Number.isFinite));
    if(frame>0&&p.grounded){landedAt=(frame+1)*dt;break;}
  }
  assert.notEqual(landedAt,null,'Jump returns to a supporting floor');
  return {apex,landedAt};
}

test('jump arc is CS-scaled and consistent at client/server tick rates',()=>{
  initPhysics(plane());const arcs=[1/30,1/60,1/120].map(dt=>jumpArc(settle({},dt),dt));
  const theoretical=JUMP_SPEED*JUMP_SPEED/(2*GRAVITY);
  for(const arc of arcs)assert.ok(Math.abs(arc.apex-theoretical)<.002,JSON.stringify(arc));
  assert.ok(Math.max(...arcs.map(a=>a.apex))-Math.min(...arcs.map(a=>a.apex))<.002);
  console.log('Jump metres / seconds:',arcs);
});

test('short jumpId pulses survive released state; one id never auto-repeats',()=>{
  initPhysics(plane());const p=settle();
  stepPlayer(p,{jump:false,jumpId:1},1/30);assert.ok(Math.abs(p.vy-(JUMP_SPEED-GRAVITY/30))<.001);assert.equal(p.lastJumpId,1);
  for(let i=0;i<100;i++)stepPlayer(p,{jump:false,jumpId:1},1/30);
  assert.ok(p.grounded);assert.ok(p.y<.001);assert.equal(p.vy,0);
  stepPlayer(p,{jump:false,jumpId:2},1/30);assert.ok(Math.abs(p.vy-(JUMP_SPEED-GRAVITY/30))<.001);
});

test('held Space is one jump, release and press makes a repeatable second jump',()=>{
  initPhysics(plane());const p=settle();let takeoffs=0,previous=true;
  for(let frame=0;frame<180;frame++){
    stepPlayer(p,{jump:true},1/60);if(previous&&!p.grounded)takeoffs++;previous=p.grounded;
  }
  assert.equal(takeoffs,1);assert.ok(p.grounded);
  stepPlayer(p,{jump:false},1/60);stepPlayer(p,{jump:true},1/60);assert.ok(p.vy>7);
});

test('a press just before landing is buffered; stale grounded cannot grant an air jump',()=>{
  initPhysics(plane());const p=createPlayerState({y:.02});p.vy=-2;
  stepPlayer(p,{jumpId:1},1/30);assert.ok(p.vy>7,'Landing consumes the queued edge within the tick');
  const stale=createPlayerState({y:1});Object.assign(stale,{grounded:true,vy:3});
  stepPlayer(stale,{jumpId:1},1/60);assert.ok(stale.vy<3);assert.equal(stale.grounded,false);
});

test('air crouch retracts at most 18 Source units and cannot create repeated vertical boosts',()=>{
  initPhysics(plane());const normal=jumpArc(settle()),duck=jumpArc(settle(),1/60,6);
  assert.ok(Math.abs((duck.apex-normal.apex)-CROUCH_JUMP_LIFT)<.002);
  assert.ok(duck.apex<1.91);
  const a=settle(),b=settle();
  for(let frame=0;frame<35;frame++){
    stepPlayer(a,{jump:frame===0},1/60);
    stepPlayer(b,{jump:frame===0,crouch:frame>=6&&frame<30&&frame%2===0},1/60);
  }
  assert.equal(b.crouch,false);assert.ok(Math.abs(a.y-b.y)<.002,'Repeated crouch/uncrouch conserves the jump arc');
});

test('crouched player cannot stand through a ceiling, and head impacts do not create ground',()=>{
  initPhysics([...plane(),...box(0,1.65,0,5,.3,5)]);
  const p=createPlayerState();Object.assign(p,{crouch:true,height:CROUCH_HEIGHT});
  for(let i=0;i<60;i++)stepPlayer(p,{crouch:true},1/60);
  stepPlayer(p,{crouch:false},1/60);assert.equal(p.crouch,true);
  let maxHead=0;
  for(let i=0;i<90;i++){stepPlayer(p,{jump:i===0,crouch:true},1/60);maxHead=Math.max(maxHead,p.y+CROUCH_HEIGHT);if(p.vy>0)assert.equal(p.grounded,false);}
  assert.ok(maxHead<=1.501);assert.ok(p.grounded);
});

test('walkable downhill slope keeps support without landing-generated horizontal speed',()=>{
  initPhysics(plane(25));const p=settle({y:1});let airborne=0,maxSpeed=0;
  for(let i=0;i<120;i++){stepPlayer(p,{right:-1},1/60);if(!p.grounded)airborne++;maxSpeed=Math.max(maxSpeed,Math.hypot(p.vx,p.vz));}
  assert.equal(airborne,0);assert.ok(maxSpeed<=6.001);assert.equal(p.vy,0);
  stepPlayer(p,{right:-1,jumpId:1},1/60);assert.ok(p.vy>7,'Jump responds on a descending ramp');
});

test('steep slopes and walls do not count as jumpable ground',()=>{
  initPhysics(plane(60));const p=createPlayerState({y:.5});let groundedFrames=0;
  for(let i=0;i<60;i++){stepPlayer(p,{},1/60);if(p.grounded)groundedFrames++;}
  assert.equal(groundedFrames,0);
  initPhysics([...plane(),...box(.5,3,0,.2,6,20)]);
  const wall=createPlayerState({x:.05,y:2});wall.vx=4;
  for(let i=0;i<15;i++){stepPlayer(wall,{right:1,jumpId:1},1/60);assert.equal(wall.grounded,false);}
});

const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
function navPath(from,to){
  const nodes=new Map(MAP.nav.map(n=>[n.id,n]));
  const nearest=p=>MAP.nav.reduce((a,b)=>distance(a,p)<distance(b,p)?a:b);
  const start=nearest(from),end=nearest(to),open=new Set([start.id]),cost=new Map([[start.id,0]]),prev=new Map();
  while(open.size){
    let id=null,best=Infinity;for(const candidate of open){const score=cost.get(candidate)+distance(nodes.get(candidate),end);if(score<best){id=candidate;best=score;}}
    if(id===end.id){const path=[end];while(path[0].id!==start.id)path.unshift(nodes.get(prev.get(path[0].id)));return path;}
    open.delete(id);const n=nodes.get(id);
    for(const key of n.neighbors){const next=nodes.get(key);if(!next)continue;const score=cost.get(id)+distance(n,next)+Math.max(0,next.y-n.y-.35)*30;if(score<(cost.get(key)??Infinity)){cost.set(key,score);prev.set(key,id);open.add(key);}}
  }
  throw new Error('NAV route not found');
}

test('real Dust2: spawn jumps, repeated landing, and long/mid/catwalk/tunnel routes', {timeout:120000},async t=>{
  const bytes=fs.readFileSync(new URL('../public/assets/map/positions.f32',import.meta.url));
  initPhysics(new Float32Array(bytes.buffer,bytes.byteOffset,bytes.byteLength/4));
  await t.test('all real T/CT spawns take off and land with zero sideways kick',()=>{
    for(const team of ['T','CT'])for(const [index,spawn]of MAP.spawns[team].entries()){
      const p=settle(spawn);for(let repeat=0;repeat<3;repeat++){
        const arc=jumpArc(p);assert.ok(arc.apex>1.40&&arc.apex<1.46,`${team}${index} ${JSON.stringify(arc)}`);
        assert.ok(Math.hypot(p.vx,p.vz)<.01,`${team}${index}: landing added horizontal speed`);
        stepPlayer(p,{},1/60);
      }
    }
  });
  const routes={
    'A long':[{x:8,y:0,z:5},{x:16,y:0,z:-8},{x:20,y:0,z:-18},{x:38,y:0,z:-28},{x:37,y:1,z:-54},MAP.sites.A],
    'mid':[{x:-7,y:-1,z:-10},{x:-10,y:-2,z:-27},{x:-10,y:-3,z:-45},MAP.spawns.CT[0]],
    'A short stairs':[{x:-7,y:-1,z:-10},{x:-3,y:0,z:-27},{x:4,y:0,z:-41},{x:9,y:2.4,z:-51},MAP.sites.A],
    'B upper tunnel':[{x:-42,y:1,z:7},{x:-44,y:1,z:-19},{x:-43,y:1,z:-29},{x:-40,y:0,z:-47},MAP.sites.B],
    'B lower tunnel':[{x:-42,y:1,z:7},{x:-44,y:1,z:-19},{x:-35,y:0,z:-29},{x:-26,y:-2,z:-32},{x:-14,y:-3,z:-35}],
  };
  for(const [name,goals]of Object.entries(routes))await t.test(name,()=>{
    const p=settle(MAP.spawns.T[0]);const path=[];let from=p;
    for(const goal of goals){path.push(...navPath(from,goal).slice(path.length?1:0));from=goal;}
    let index=0,anchor={x:p.x,z:p.z},lastMovement=0,frame=0;
    for(;frame<10800;frame++){
      while(index<path.length&&Math.hypot(p.x-path[index].x,p.z-path[index].z)<.26&&Math.abs(p.y-path[index].y)<1.1)index++;
      if(index===path.length)break;
      const target=path[index],yaw=Math.atan2(p.x-target.x,p.z-target.z),blocked=(frame-lastMovement)/60;
      stepPlayer(p,{forward:1,yaw,speedScale:.7,jump:(target.y-p.y>.4||blocked>1.2)&&frame%42<3},1/60);
      if(Math.hypot(p.x-anchor.x,p.z-anchor.z)>.2){anchor={x:p.x,z:p.z};lastMovement=frame;}
      if(blocked>8||p.outOfWorld)break;
    }
    assert.equal(index,path.length,`${name} stopped at ${index}/${path.length}: ${JSON.stringify({p,next:path[index]})}`);
    console.log(`Dust2 ${name}: ${(frame/60).toFixed(2)} s`);
  });
});
