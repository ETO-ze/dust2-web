/** Exercise all official ladder routes with original physics and normal player inputs. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createPlayerState,initPhysics,stepPlayer,floorHeight} from '../../shared/physics.js';
import {laddersForMap} from '../../shared/ladder-movement.js';
import {privateEntities} from '../../shared/private-map-entities.js';
import {PrivateMapBreakables} from '../../shared/private-map-breakables.js';
import {loadPrivatePhysics} from './load-private-physics.mjs';

const root=path.resolve(process.argv[2]||'artifacts/performance-maps/maps-v1');
const result=[];
for(const {id} of JSON.parse(fs.readFileSync(path.join(root,'catalog.json'))).maps){
  const directory=path.join(root,id),meta=JSON.parse(fs.readFileSync(path.join(directory,'compiled/map.json')));
  const rails=laddersForMap(meta);
  if(!rails.length)continue;
  const {positions,sourceTriangles}=loadPrivatePhysics(directory);
  const props=new PrivateMapBreakables(privateEntities(id)?.objects||[],{1:sourceTriangles});
  initPhysics(positions,null,{map:meta,mapPatches:false,copyPositions:false,airMovement:'source',
    triangleEnabled:(channel,index)=>props.triangleEnabled(channel,index),collisionKey:()=>props.collisionKey()});
  for(const rail of rails){
    const [nx,nz]=rail.normal,[bx,by,bz]=rail.bottom,[tx,ty,tz]=rail.top;
    const x=bx+nx*.54,z=bz+nz*.54;
    const player=createPlayerState({x,z,y:floorHeight(x,z,by+.65,1.6)??by});
    const forward={forward:1,yaw:Math.atan2(nx,nz),pitch:.12};
    function climb(steps){
      let mounted=player.ladderId===rail.id;
      for(let i=0;i<steps;i++){
        stepPlayer(player,forward,1/60);
        mounted||=player.ladderId===rail.id;
        if(mounted&&!player.ladderId&&player.y>ty-.55)return true;
      }
      return false;
    }
    if(id==='de_nuke'&&rail.id===2){
      assert.equal(climb(250),false,'intact metal slats must block this exit');
      assert.ok(Math.abs(player.y-ty)<.2,'player reaches the top inside the enclosed shaft');
      props.damage('nuke-vent-slats',1);
    }
    assert.ok(climb(360),id+' #'+rail.id+' climb and top dismount');
    for(let i=0;i<24;i++)stepPlayer(player,{forward:0},1/60);
    assert.ok(player.grounded,id+' #'+rail.id+' upper deck support');
    let down=false,mounted=false;
    for(let i=0;i<450;i++){
      const ax=tx+nx*.338,az=tz+nz*.338;
      const yaw=player.ladderId?forward.yaw:Math.atan2(-(ax-player.x),-(az-player.z));
      stepPlayer(player,{forward:1,yaw,pitch:-.83},1/60);
      mounted||=player.ladderId===rail.id;
      if(mounted&&!player.ladderId&&player.y<=by+.26){down=true;break;}
    }
    assert.ok(down,id+' #'+rail.id+' descend and release');
    result.push({map:id,ladder:rail.id,heightMetres:+(ty-by).toFixed(2),ascent:true,upperDismount:true,descent:true});
  }
}
assert.equal(result.length,21);
console.log(JSON.stringify(result,null,2));
