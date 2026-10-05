import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {PrivateMapBreakables} from '../client/private-map-breakables.js';

function fixture(definitions=[{id:'metal-panel',nodeIndices:[10],restoredNodeIndices:[12],material:'metal'}]){
  const scene=new THREE.Scene(),root=new THREE.Group(),board=new THREE.Group(),frame=new THREE.Group(),remains=new THREE.Group();
  board.name='source panel';frame.name='window frame';remains.name='broken edge';root.add(board,frame,remains);scene.add(root);
  const associations=new Map([[board,{nodes:10}],[frame,{nodes:11}],[remains,{nodes:12}]]),feedback=[];
  const view=new PrivateMapBreakables({gltf:{scene:root,parser:{associations}},scene,definitions,onBroken:e=>feedback.push(e)});
  return{scene,board,frame,remains,view,feedback};
}
const state=(broken,round=1)=>({round:{number:round},mapBreakables:[{id:'metal-panel',broken}]});
const event={id:1,type:'map_breakable_broken',breakableId:'metal-panel',origin:{x:1,y:2,z:3}};

test('only the exact original panel and broken-edge nodes change; frame stays intact',()=>{
  const f=fixture();assert.equal(f.board.visible,true);assert.equal(f.remains.visible,false);
  f.view.sync(state(true));assert.equal(f.board.visible,false);assert.equal(f.remains.visible,true);assert.equal(f.frame.visible,true);
  f.view.sync(state(false,2));assert.equal(f.board.visible,true);assert.equal(f.remains.visible,false);assert.equal(f.frame.visible,true);f.view.dispose();
});
test('late join uses authoritative complete state without replaying debris or sound',()=>{
  const f=fixture();f.view.sync(state(true,4));assert.equal(f.board.visible,false);assert.equal(f.feedback.length,0);assert.equal(f.view.status().fragments,0);
  f.view.reset();assert.equal(f.board.visible,true);assert.deepEqual(f.view.status().broken,[]);f.view.dispose();
});
test('stale or unknown events cannot hide geometry or emit an effect',()=>{
  const f=fixture();assert.equal(f.view.event(event),false);assert.equal(f.board.visible,true);
  f.view.sync(state(true));assert.equal(f.view.event({...event,breakableId:'frame'}),false);assert.equal(f.view.event({...event,origin:{x:NaN,y:0,z:0}}),false);
  assert.equal(f.view.event(event,{x:1000,y:0,z:0}),false);assert.equal(f.feedback.length,0);f.view.dispose();
});
test('actual break feedback is bounded and disappears, including on round reset',()=>{
  const f=fixture();f.view.sync(state(true));for(let i=0;i<20;i++)assert.equal(f.view.event({...event,id:i}),true);
  assert.equal(f.view.status().fragments,48);assert.equal(f.view.fragmentMesh.count,48);
  f.view.sync(state(false,2));assert.equal(f.view.status().fragments,0);assert.equal(f.view.fragmentMesh.visible,false);
  f.view.sync(state(true,2));f.view.event(event);for(let i=0;i<20;i++)f.view.update(.05);
  assert.equal(f.view.status().fragments,0);assert.equal(f.view.fragmentMesh.visible,false);f.view.dispose();
});
test('unavailable or duplicate source nodes fail before changing the scene',()=>{
  assert.throws(()=>fixture([{id:'bad',nodeIndices:[999]}]),/节点缺失/);
  assert.throws(()=>fixture([{id:'a',nodeIndices:[10]},{id:'b',nodeIndices:[10]}]),/节点重叠/);
});
