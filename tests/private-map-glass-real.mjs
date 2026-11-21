import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {once} from 'node:events';
import {Vector3, Scene, Group} from 'three';
import WebSocket from 'ws';
import {loadPrivateMapRuntime} from '../server/private-map-runtime.js';
import {createPlayerState,raycastWorldHit,raycastGrenadeWorld} from '../shared/physics.js';
import {expandGlassState} from '../shared/private-map-breakables.js';
import {PrivateMapBreakables} from '../client/private-map-breakables.js';
import {STANDING_EYE_HEIGHT} from '../shared/aim.js';
import {lookAt} from '../server/bot-perception.js';

const directory=process.env.DUSTII_PRIVATE_MAP_DIRECTORY;
const map=directory && fs.existsSync(directory+'/compiled/map.json') && JSON.parse(fs.readFileSync(directory+'/compiled/map.json')).id;
const counts={de_nuke:14,de_mirage:1,de_inferno:32};

function testRay(state,def){
  const a=new Vector3().fromArray(def.pane),b=new Vector3().fromArray(def.pane,3),c=new Vector3().fromArray(def.pane,6);
  const normal=b.clone().sub(a).cross(c.clone().sub(a)).normalize();
  const center=a.clone().add(b).add(c).multiplyScalar(1/3);
  const game=v=>new Vector3(v.z,v.y,-v.x);
  for(const sign of [1,-1]){
    const direction=game(normal).multiplyScalar(sign);
    const origin=game(center).addScaledVector(direction,-.14);
    const hit=raycastWorldHit(origin,direction,.29);
    if(hit&&state.atTriangle(2,hit.triangle)?.id===def.id)return {origin,direction,hit};
  }
  throw Error('Original glass and collider do not line up: '+def.id);
}

async function connect(app,ctx,team){
  const socket=new WebSocket('ws://127.0.0.1:'+app.port+'/ws');
  const messages=[];
  socket.on('message',packet=>messages.push(JSON.parse(packet)));
  await once(socket,'open');
  socket.send(JSON.stringify({type:'join',room:'GLASS',team,bots:0,name:team+' window test',mapId:ctx.mapId,mapSignature:ctx.mapSignature}));
  const next=async predicate=>{
    const end=Date.now()+4000;
    while(Date.now()<end){
      const failure=messages.find(e=>e.type==='error');if(failure)throw Error(JSON.stringify(failure));
      const i=messages.findIndex(predicate);if(i>=0)return messages.splice(i,1)[0];
      await new Promise(res=>setTimeout(res,10));
    }
    throw Error('Missing WebSocket message for '+team+': '+JSON.stringify(messages.map(e=>e.type)));
  };
  await next(m=>m.type==='welcome');
  return {socket,next};
}

test('actual source windows on '+map+' have independent render, collision and authoritative network state',{skip:!counts[map]},async()=>{
  const ctx=loadPrivateMapRuntime(directory);
  const {startGameServer}=await import('../server/index.js');
  const definitions=ctx.config.breakables,glass=definitions.filter(d=>d.material==='glass');
  assert.equal(glass.length,counts[map]);
  const scene=new Scene(),root=new Group();scene.add(root);
  const visuals=new PrivateMapBreakables({gltf:{scene:root},scene,definitions:glass.map(d=>({...d,proceduralPane:true,nodeNames:[],nodeIndices:[]}))});
  const project=snap=>{expandGlassState(snap,definitions);visuals.sync(snap);return snap;};
  const app=await startGameServer({privateMap:ctx,port:0,host:'127.0.0.1'});
  const sockets=[];
  try{
    const first=await connect(app,ctx,'CT');sockets.push(first.socket);
    const other=await connect(app,ctx,'T');sockets.push(other.socket);
    const room=app.rooms.get('GLASS'),shooter=[...room.players.values()].find(p=>p.team==='CT');
    // Each intact frame stays in the static model. Only the exact pane's three collision ranges become disabled.
    for(const def of glass){
      ctx.activate(room);
      const {origin,direction,hit}=testRay(room.mapBreakables,def);
      assert.ok(raycastGrenadeWorld(origin,direction,.29)!==null);
      const through=origin.clone().addScaledVector(direction,hit.distance+.05);
      assert.ok(ctx.world.clearSight(origin,through),def.id+' must transmit sight');
      const behindWindow=origin.clone().addScaledVector(direction,.5);
      const sightBeyond=ctx.world.clearSight(origin,behindWindow);
      assert.ok(room.damageMapBreakable(hit,40,shooter));
      assert.deepEqual([...room.mapBreakables.broken],[def.id]);
      for(const channel of [1,2,4]){
        const owned=[...room.mapBreakables.owners[channel]].filter(([,id])=>id===def.id);
        assert.ok(owned.length>0);assert.ok(owned.every(([i])=>!room.mapBreakables.triangleEnabled(channel,i)));
      }
      assert.notEqual(room.mapBreakables.atTriangle(2,raycastWorldHit(origin,direction,.29)?.triangle)?.id,def.id);
      assert.equal(raycastGrenadeWorld(origin,direction,hit.distance+.025),null,def.id+' should clear the projectile path');
      assert.equal(ctx.world.clearSight(origin,behindWindow),sightBeyond,def.id+' must preserve the backing wall');
      const snap=project(room.snapshot({drainEvents:false}));
      assert.deepEqual(visuals.status().broken,[def.id]);assert.equal(root.getObjectByName(def.id).visible,false);
      for(const otherDef of glass.filter(d=>d.id!==def.id))assert.equal(root.getObjectByName(otherDef.id).visible,true);
      assert.equal(snap.mapBreakables.filter(s=>s.broken).length,1);
      assert.ok(root.getObjectByName(def.id).material.transparent);
      room.startRound();project(room.snapshot({drainEvents:false}));
      assert.equal(root.getObjectByName(def.id).visible,true);
      assert.equal(room.mapBreakables.atTriangle(2,testRay(room.mapBreakables,def).hit.triangle).id,def.id);
    }
    // The actual firing path must emit a snapshot consumed by both teams and a later joiner.
    const def=glass.find(d=>d.id==='glass-2-61814-42406')||glass[0];
    const {origin,direction}=testRay(room.mapBreakables,def);
    Object.assign(shooter,createPlayerState({...origin,y:origin.y-STANDING_EYE_HEIGHT}),{alive:true,nextShotAt:0,reloadEndsAt:0,triggerWasDown:false});
    room.giveWeapon(shooter,'ak47');shooter.weapon='ak47';
    room.fire(shooter,{fire:true,...lookAt(origin,origin.clone().add(direction))});
    assert.ok(room.mapBreakables.broken.has(def.id),'normal fire broke the pane');
    const broken=s=>s.type==='snapshot'&&s.glassState?.[glass.indexOf(def)]==='1';
    for(const client of [first,other]){const snap=await client.next(broken);assert.ok(project(snap).mapBreakables.find(e=>e.id===def.id)?.broken);}
    const late=await connect(app,ctx,'CT');sockets.push(late.socket);
    assert.equal(project(await late.next(broken)).mapBreakables.find(e=>e.id===def.id).broken,true);
    room.startRound();
    for(const client of [first,other,late])await client.next(s=>s.type==='snapshot'&&s.round?.number===room.round.number&&s.glassState=== '0'.repeat(glass.length));
  }finally{for(const s of sockets)s.terminate();await app.close();visuals.dispose();}
});

