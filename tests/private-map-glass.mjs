import assert from 'node:assert/strict';
import test from 'node:test';
import {Scene,Group,Mesh,MeshStandardMaterial,PlaneGeometry,AdditiveBlending} from 'three';
import {PrivateMapBreakables as Visuals} from '../client/private-map-breakables.js';
import {PrivateMapBreakables as Colliders,expandGlassState} from '../shared/private-map-breakables.js';
import {privateEntities} from '../shared/private-map-entities.js';

test('quality keeps the original window and its UVs, fades the source additive tint, and preserves the surrounding frame',()=>{
  const def=privateEntities('de_nuke').objects.find(d=>d.pane&&d.nodeIndices.length===2);
  const root=new Group(),scene=new Scene(),glassMaterial=new MeshStandardMaterial(),frameMaterial=new MeshStandardMaterial();
  const geometry=new PlaneGeometry(1,1),uv=geometry.getAttribute('uv');
  const pane=new Mesh(geometry,glassMaterial),overlay=new Mesh(geometry,frameMaterial),frame=new Mesh(geometry,frameMaterial);
  root.add(pane,overlay,frame);scene.add(root);
  const nodes=[],associations=new Map();
  [pane,overlay].forEach((obj,k)=>{const id=def.nodeIndices[k];nodes[id]={name:def.nodeNames[k]};associations.set(obj,{nodes:id});});
  const visuals=new Visuals({gltf:{scene:root,parser:{json:{nodes},associations}},scene,definitions:[def]});
  assert.equal(root.children.length,3);assert.equal(pane.geometry.getAttribute('uv'),uv);
  assert.ok(pane.material.transparent);assert.equal(pane.material.depthWrite,false);
  assert.equal(overlay.material.blending,AdditiveBlending);assert.equal(overlay.material.depthWrite,false);
  assert.equal(frame.material,frameMaterial);assert.equal(frameMaterial.transparent,false);
  visuals.sync({round:{number:2},mapBreakables:[{id:def.id,broken:true}]});
  assert.equal(pane.visible,false);assert.equal(overlay.visible,false);assert.equal(frame.visible,true);
  visuals.sync({round:{number:3},mapBreakables:[{id:def.id,broken:false}]});
  assert.equal(pane.visible,true);assert.equal(overlay.visible,true);
  visuals.dispose();assert.equal(pane.material,glassMaterial);assert.equal(overlay.material,frameMaterial);
  geometry.dispose();frameMaterial.dispose();glassMaterial.dispose();
});

test('all imported panes make an independent late-join snapshot at bounded size',()=>{
  for(const name of ['de_mirage','de_nuke','de_inferno']){
    const definitions=privateEntities(name).objects,glass=definitions.filter(d=>d.pane);
    const state=new Colliders(definitions);
    for(let i=0;i<glass.length;i+=2)state.damage(glass[i].id,200);
    const wire=state.networkSnapshot();
    assert.equal(wire.glassState.length,glass.length);
    assert.ok(!wire.mapBreakables.some(d=>d.id.startsWith('glass-')));
    expandGlassState(wire,definitions);
    assert.deepEqual(wire.mapBreakables,state.snapshot());
    const late=new Colliders(definitions);late.applySnapshot(wire.mapBreakables);
    assert.deepEqual(late.collisionKey(),state.collisionKey());
    assert.throws(()=>expandGlassState({glassState:'x',mapBreakables:[]},definitions));
    state.reset();assert.ok(state.networkSnapshot().glassState.split('').every(c=>c==='0'));
  }
});

