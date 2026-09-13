import {MovementStream} from '../shared/movement-commands.js';

export function controlledPlayer(room,id){
  const owner=room.players.get(id),body=room.players.get(owner?.controlledBotId);
  return body?.controllerId===id?body:owner;
}

function clearCommands(room,body,owner=null){
  if(body.botAI?.utility&&!body.botAI.utility.released)room.utilityClaims?.delete(body.botAI.utility.key);
  room.cancelGrenade(body,'control');
  if(room.bomb.actorId===body.id)Object.assign(room.bomb,{actorId:null,action:null,progress:0});
  body.objectiveLocked=false;
  body.input={forward:0,right:0,yaw:body.yaw,pitch:body.pitch,jump:false,crouch:body.crouch,
    walk:false,fire:false,fire2:false,interact:false,reload:false,slot:0,
    jumpId:owner?.input.jumpId||0,reloadId:owner?.input.reloadId||0,zoomLevel:body.zoomLevel||0};
  body.inputAt=room.clock();body.fireQueue=[];body.shotCommands=false;body.lastShotId=0;
  body.pendingInteract=false;body.interactWasDown=false;body.triggerWasDown=false;
  body.lastJumpId=body.input.jumpId;body.lastReloadId=body.input.reloadId;body.jumpBufferRemaining=0;
  body.lifeId++; // Discard movement and rewind history from the previous driver.
  body.seq=body.lastReceivedSeq=owner?.lastReceivedSeq??-1;
  body.movementStream=owner?.movementStream?new MovementStream(body.lifeId):null;
  body.movementAt=room.clock();
  Object.assign(body.botAI,{utility:null,path:[],goal:null,targetId:null,nextThinkAt:0});
}

export function releaseBot(room,id){
  const owner=room.players.get(id),body=room.players.get(owner?.controlledBotId);
  if(body?.controllerId===id){delete body.controllerId;clearCommands(room,body);}
  if(owner)delete owner.controlledBotId;
}

export function takeBot(room,id,botId){
  const owner=room.players.get(id),body=room.players.get(botId);
  const reject=message=>({ok:false,message});
  if(!owner||owner.bot||!room.clients.has(id))return reject('请先加入房间。');
  if(room.mode!=='defuse'||room.round.phase!=='live'||room.match.status==='ended')return reject('只能在爆破回合进行中控制人机。');
  if(owner.alive||controlledPlayer(room,id)?.alive)return reject('阵亡后才可以控制人机。');
  if(!body?.bot||!body.alive||body.team!==owner.team)return reject('请选择一名存活的己方人机。');
  if(body.controllerId)return reject('这名人机已被队友控制。');
  releaseBot(room,id);
  clearCommands(room,body,owner);
  body.controllerId=id;owner.controlledBotId=body.id;
  room.emit('bot_controlled',{playerId:id,botId:body.id,name:owner.name,botName:body.name});
  return {ok:true,botId:body.id,lifeId:body.lifeId};
}
