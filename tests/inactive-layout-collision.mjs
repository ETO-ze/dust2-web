import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {applyPrivateCollisionExclusions} from '../shared/private-map-collision.js';
import {loadPrivateMapRuntime} from '../server/private-map-runtime.js';
import {createPlayerState,stepPlayer,floorHeight,raycastWorld,raycastGrenadeWorld} from '../shared/physics.js';

test('only source-proven inactive layout prop ranges leave the three collision channels', () => {
  const group={name:'prop_dynamic',source:'map_physics.gltf',firstTriangle:1,triangles:2};
  const prop={id:'2:61868',targetname:'[PR#]props.2v2',model:'models/props/door.vmdl',startdisabled:true};
  const remove=(mask,entity,geometry=group)=>applyPrivateCollisionExclusions(mask,[geometry],{excludedGroups:[
    {reason:'inactive-layout-prop',firstTriangle:1,triangles:2,solid:false,resolved:true,sourceEntities:[entity]}
  ]});
  const mask=Uint8Array.of(7,7,7,7);
  remove(mask,prop);
  assert.deepEqual([...mask],[7,0,0,7]);
  for (const change of [{startdisabled:false},{targetname:'[PR#]vent_open'},{id:''},{model:''}]) {
    assert.throws(()=>remove(new Uint8Array(4),{...prop,...change}));
  }
  assert.throws(()=>remove(new Uint8Array(4),prop,{...group,name:'world',source:'world_physics.gltf'}));
});

const root=process.env.DUSTII_LAYOUT_MAP_ROOT;
test('Nuke corridor crosses both removed silo doors with live hull, bullet, grenade and bot sight', {skip:!root}, () => {
  const runtime=loadPrivateMapRuntime(path.join(root,'de_nuke'),{id:'de_nuke'});
  const camera={x:16.53,y:-8.84,z:-2.59};
  const floor=floorHeight(camera.x,camera.z,camera.y,3);
  assert.ok(Math.abs(floor+10.5664)<.01);
  for (const direction of [-1,1]) {
    const target={x:camera.x+12*direction,y:camera.y,z:camera.z}, axis={x:direction,y:0,z:0};
    assert.equal(runtime.world.clearSight(camera,target),true);
    assert.equal(raycastWorld(camera,axis,12),null);
    assert.equal(raycastGrenadeWorld(camera,axis,12),null);
    // A real end wall must still stop both channels beyond the old door.
    assert.ok(raycastWorld(camera,axis,17)>12);
    assert.ok(raycastGrenadeWorld(camera,axis,17)>12);
    for (const frequency of [30,60,120]) {
      const player=createPlayerState({x:camera.x,y:floor+.01,z:camera.z});
      for (let i=0; i<3*frequency && direction*(target.x-player.x)>0; i++) {
        stepPlayer(player,{forward:1,yaw:-direction*Math.PI/2},1/frequency);
      }
      assert.ok(direction*(player.x-target.x)>=0, 'passage at '+frequency+' Hz');
      assert.ok(Math.abs(player.y-floor)<.03 && player.grounded);
    }
  }
});
