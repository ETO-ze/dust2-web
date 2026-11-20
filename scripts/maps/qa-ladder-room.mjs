/** Real WS packet/ack test. Only the initial spawn is positioned by the local test harness. */
import assert from 'node:assert/strict';
import path from 'node:path';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {WebSocket} from 'ws';
import {loadPrivateMapRuntime} from '../../server/private-map-runtime.js';
import {createPlayerState,floorHeight} from '../../shared/physics.js';
import {MovementPrediction} from '../../client/movement-prediction.js';
import {laddersForMap} from '../../shared/ladder-movement.js';
import {movementState} from '../../shared/movement-commands.js';
import {CLIENT_BUILD,RULES_VERSION,ASSET_VERSION} from '../../shared/online-build.js';

const mapId=process.argv[2]||'de_mirage';
const runtime=loadPrivateMapRuntime(path.resolve('artifacts/performance-maps/maps-v1',mapId));
const {startGameServer}=await import('../../server/index.js');
const app=await startGameServer({port:0,host:'127.0.0.1',privateMap:runtime});
const socket=new WebSocket('ws://127.0.0.1:'+app.port+'/ws');
const model=runtime.config.movementModel;
try {
  await once(socket,'open');
  let welcome,snapshot,highestAck=0,maxError=0,predicted=null;
  const prediction=new MovementPrediction(),history=new Map();
  socket.on('message',data=>{
    const msg=JSON.parse(data);
    if(msg.type==='welcome')welcome=msg;
    if(msg.type!=='snapshot')return;
    snapshot=msg;
    const peer=msg.players?.find(p=>p.id===welcome?.id);
    if(!peer?.movementState||!predicted)return;
    const ack=peer.movementAck||0,expected=history.get(ack);
    if(expected){maxError=Math.max(maxError,Math.hypot(...['x','y','z'].map(k=>expected[k]-peer.movementState[k])));
      highestAck=Math.max(highestAck,ack);prediction.reconcile(predicted,peer);}
  });
  socket.send(JSON.stringify({type:'join',name:'Ladder QA',clientBuild:CLIENT_BUILD,rulesVersion:RULES_VERSION,assetVersion:ASSET_VERSION,
    mapId,mapSignature:runtime.mapSignature,physicsSha256:runtime.config.physicsSha256,bots:0,mode:'deathmatch',team:'T',movementProtocol:1}));
  async function until(condition,label){for(let i=0;i<180;i++){if(condition())return;await delay(20);}throw Error(label);}
  await until(()=>welcome&&snapshot,'join');
  const room=app.rooms.get(welcome.room),p=room.players.get(welcome.id);
  const rail=laddersForMap(runtime.meta)[0],[nx,nz]=rail.normal,[bx,by,bz]=rail.bottom;
  const x=bx+nx*.54,z=bz+nz*.54;
  Object.assign(p,createPlayerState({x,z,y:floorHeight(x,z,by+.65,1.6)??by}));
  predicted={...movementState(p),lifeId:p.lifeId};prediction.reset(predicted);
  const yaw=Math.atan2(nx,nz);
  let seq=0,state='up',up=false,down=false,jumped=false,pause=0,mounted=false;
  for(let packet=0;packet<240&&!jumped;packet++){
    let input;
    for(let i=0;i<3;i++){
      input={forward:1,right:0,yaw,pitch:.12,jump:false,jumpId:0,walk:false,crouch:false,speedScale:.6};
      if(state==='pause'){input.forward=0;if(++pause>=24){state='down';mounted=false;}}
      if(state==='down'){
        input.pitch=-.83;
        if(!predicted.ladderId)input.yaw=Math.atan2(-(rail.top[0]+nx*.338-predicted.x),-(rail.top[2]+nz*.338-predicted.z));
      }
      if(state==='jump'&&predicted.ladderId&&predicted.y>by+.6){input.jump=true;input.jumpId=1;}
      prediction.step(predicted,input);history.set(prediction.nextId,movementState(predicted));
      if(state==='up'){
        mounted||=predicted.ladderId===rail.id;
        if(mounted&&!predicted.ladderId&&predicted.y>rail.top[1]-.55){up=true;state='pause';}
      }else if(state==='down'){
        mounted||=predicted.ladderId===rail.id;
        if(mounted&&!predicted.ladderId&&predicted.y<=by+.27){down=true;state='jump';}
      }else if(state==='jump'&&input.jump){assert.ok(!predicted.ladderId&&predicted.vy>0);jumped=true;}
    }
    socket.send(JSON.stringify({type:'input',seq:++seq,...input,moves:prediction.packet()}));await delay(50);
  }
  const last=prediction.nextId;await until(()=>highestAck>=last,'final server acknowledgement');
  assert.ok(up&&down&&jumped,'climb, descend and jump away via real input packets');
  assert.ok(maxError<.003,`prediction differed by ${maxError} metres`);
  const result={mapId,model,commands:last,highestAck,maxPredictionErrorMetres:maxError,up,down,jumped};
  if(mapId==='de_nuke'){
    predicted=null;
    Object.assign(p,createPlayerState({x:11.38,y:-10.56,z:36.40}));
    const send=fields=>socket.send(JSON.stringify({type:'input',seq:++seq,forward:0,right:0,yaw:0,pitch:0,...fields}));
    const vent=()=>snapshot.mapBreakables?.find(b=>b.id==='nuke-vent-slats');
    assert.ok(vent()?.open&&!vent().broken);
    send({interact:true});await until(()=>vent()?.open===false,'E closes source vent');
    send({interact:false});await delay(730);
    send({interact:true});await until(()=>vent()?.open===true,'E reopens source vent');
    send({interact:false,slot:2});await delay(600);
    send({fire:true});await until(()=>vent()?.broken===true,'normal bullet breaks one-HP grille');
    send({fire:false});
    result.vent={closedWithUse:true,reopenedWithUse:true,brokenWithFire:true};
  }
  console.log(JSON.stringify(result));
} finally {socket.terminate();await app.close();}
