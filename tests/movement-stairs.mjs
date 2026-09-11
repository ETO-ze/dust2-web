import test from 'node:test';
import assert from 'node:assert/strict';
import {BoxGeometry} from 'three';
import {readFileSync} from 'node:fs';
import {initPhysics,createPlayerState,stepPlayer} from '../shared/physics.js';
const box=(x,y,z,w,h,d,rot=0)=>{const g=new BoxGeometry(w,h,d).toNonIndexed();g.translate(x,y,z);g.rotateY(rot);const a=[...g.attributes.position.array];g.dispose();return a;};
test('135 stair heights, narrow treads, rotated faces and edge approaches climb without jumping or a trapped foot',()=>{
 for(const height of [.12,.2,.3,.4,.45])for(const tread of [.3,.5,.8])for(const angle of [0,.35,.7854])for(const offset of [0,.95,1.19]){
  const points=[...box(0,-.2,0,100,.4,100)];for(let i=0;i<8;i++)points.push(...box(0,(i+1)*height/2,-i*tread-tread/2,2.4,(i+1)*height,tread,angle));
  initPhysics(points);const p=createPlayerState({x:offset*Math.cos(angle)+Math.sin(angle)*1.5,z:-offset*Math.sin(angle)+Math.cos(angle)*1.5});
  for(let i=0;i<30;i++)stepPlayer(p,{},1/60);
  let stalled=0,last=0,maxY=0;
  for(let i=0;i<180;i++){stepPlayer(p,{forward:1,yaw:angle,walk:true},1/60);const progress=-Math.sin(angle)*p.x-Math.cos(angle)*p.z;
   if(i>30&&progress<8*tread-.15&&progress-last<.004)stalled++;last=progress;maxY=Math.max(maxY,p.y);
  }
  assert.equal(stalled,0,JSON.stringify({height,tread,angle,offset,p}));assert.ok(maxY>=height*5-.01);
 }
});
test('a riser above step height and a low overhead beam still block passage',()=>{
 for(const ceiling of [false,true]){
  initPhysics([...box(0,-.2,0,20,.4,20),...box(0,ceiling?.1:.4,-1,4,ceiling?.2:.8,2),...(ceiling?box(0,2,0,5,.1,4):[])]);
  const p=createPlayerState({z:1});for(let i=0;i<120;i++)stepPlayer(p,{forward:1},1/60);
  assert.ok(p.z>=.299);assert.ok(p.y<.01);
 }
});
test('real Dust2 A-short stairs climb from four centre and edge lanes without jumping',()=>{
 const b=readFileSync(new URL('../public/assets/map/positions.f32',import.meta.url));initPhysics(new Float32Array(b.buffer,b.byteOffset,b.byteLength/4));
 for(const x of [6.6,7.2,8,9]){
  const p=createPlayerState({x,y:.2,z:-40});for(let i=0;i<60;i++)stepPlayer(p,{},1/60);
  let stalled=0,last=p.z;for(let i=0;i<210;i++){stepPlayer(p,{forward:1,walk:true},1/60);if(i>30&&p.z>-47.5&&Math.abs(p.z-last)<.004)stalled++;last=p.z;}
  assert.equal(stalled,0,`A short lane ${x}`);assert.ok(p.z<-48&&p.y>2.3,JSON.stringify(p));
 }
});
