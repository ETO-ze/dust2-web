import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {WebSocket} from 'ws';
import {CLIENT_BUILD,RULES_VERSION,ASSET_VERSION} from '../shared/online-build.js';
import {loadPrivateMapRuntime} from '../server/private-map-runtime.js';
import {createPlayerState} from '../shared/physics.js';

// Source map assets are intentionally not committed. Deployment validation sets
// this explicitly; ordinary CI reports a skip rather than substituting Dust II.
const directory=process.env.DUSTII_PRIVATE_MAP_DIRECTORY;
const available=directory&&fs.existsSync(directory+'/compiled/map.json');
test('private map uses actual GameRoom combat, objective and WSS with 1 human + 9 bots',{skip:!available,timeout:90000},async t=>{
 const context=loadPrivateMapRuntime(directory),{GameRoom}=await import('../server/game.js');
 await t.test('real nine-bot round consumes ammunition, damages and plants with bounded visual aim',()=>{
  let now=100000,randomState=941;const random=Math.random;Math.random=()=>((randomState=(randomState*1664525+1013904223)>>>0)/4294967296);
  try{
   const room=new GameRoom('REALMAP',{bots:9,clock:()=>now,privateMap:context,rules:{freezeSeconds:1}});room.addHuman({},{name:'QA Observer',team:'CT'});
   const starts=new Map([...room.players.values()].map(p=>[p.id,{x:p.x,z:p.z}])),moved=new Set(),shots=[],tickTimes=[];let blindShots=0,maxTurn=0,rounds=0;
   for(let tick=0;tick<30*140;tick++){
    now+=1000/30;const angles=new Map([...room.players.values()].map(p=>[p.id,p.yaw]));const tickStart=performance.now();room.tick(1/30);tickTimes.push(performance.now()-tickStart);
    for(const p of room.players.values()){if(p.bot&&Math.hypot(p.x-starts.get(p.id).x,p.z-starts.get(p.id).z)>5)moved.add(p.id);if(p.bot&&p.alive){const delta=Math.abs(Math.atan2(Math.sin(p.yaw-angles.get(p.id)),Math.cos(p.yaw-angles.get(p.id))));if(room.round.number===rounds)maxTurn=Math.max(maxTurn,delta);}}
    rounds=room.round.number;
    for(const e of room.events){if(e.type==='shot'&&e.weapon!=='knife'){shots.push(e);if(e.time<(room.players.get(e.shooterId)?.flashBlindUntil||0))blindShots++;}}
    room.events=[];
   }
   assert.equal(room.players.size,10);assert.equal(room.botCount,9);assert.ok(moved.size>=8,'bots must traverse the actual source map');assert.ok(shots.length>10);assert.ok(room.privateBots.stats.hits>0);assert.ok(room.privateBots.stats.kills>0);assert.ok(room.privateBots.stats.plants>0);assert.equal(blindShots,0);assert.ok(maxTurn<=3.6/30+.00001,'no instantaneous aim turn');
   assert.equal(room.snapshot().mapSignature,context.mapSignature);assert.equal(room.snapshot().physicsSha256,context.config.physicsSha256);
   console.log('private-map-combat',JSON.stringify({map:context.mapId,moved:moved.size,...room.privateBots.stats,blindShots,maxTurn,tickP95Ms:Number(tickTimes.sort((a,b)=>a-b)[Math.floor(tickTimes.length*.95)].toFixed(3)),rssMiB:Math.round(process.memoryUsage().rss/1048576)}));
  }finally{Math.random=random;}
 });
 await t.test('CT walks from a real NAV guard to the planted C4 and completes standard defuse',()=>{
  let now=100000;const room=new GameRoom('DEFUSE',{bots:1,clock:()=>now,privateMap:context,rules:{freezeSeconds:0}}),human=room.addHuman({},{name:'Objective QA',team:'T'}),bot=[...room.players.values()].find(p=>p.bot);
  const site=context.meta.sites.A,node=context.graph.nearest(site),guard=context.graph.guards('A',3,8).find(n=>Math.hypot(n.x-site.x,n.z-site.z)>6);
  assert.ok(guard);Object.assign(human,createPlayerState(node),{hasBomb:true,protectionUntil:Infinity});Object.assign(bot,createPlayerState(guard));
  room.round.phase='live';room.round.phaseEndsAt=now+115000;room.bomb={...room.emptyBomb(),state:'carried',carrierId:human.id};room.giveWeapon(human,'c4');room.selectSlot(human,5);human.input={yaw:0,pitch:0,forward:0,right:0,interact:true};
  let observedPlant=false,observedLocked=false;
  for(let i=0;i<30*55&&room.bomb.state!=='defused';i++){
   now+=1000/30;human.inputAt=now;room.tick(1/30);if(room.bomb.action==='defuse'&&room.bomb.actorId===bot.id&&bot.objectiveLocked&&bot.crouch)observedLocked=true;
   if(room.bomb.state==='planted'&&!observedPlant){observedPlant=true;human.input.interact=false;Object.assign(human,createPlayerState(context.meta.spawns.T[0]));human.protectionUntil=Infinity;}
  }
  assert.ok(observedPlant);assert.equal(room.bomb.state,'defused');assert.equal(room.round.winner,'CT');assert.equal(room.privateBots.stats.defuses,1);assert.ok(observedLocked);
 });
 await t.test('private WSS identity rejects wrong maps, welcomes matching clients, and enforces one room',async()=>{
  const {startGameServer}=await import('../server/index.js'),app=await startGameServer({port:0,host:'127.0.0.1',privateMap:context,indexFile:'private.html'}),sockets=[];
  const connect=()=>new Promise((resolve,reject)=>{const ws=new WebSocket(`ws://127.0.0.1:${app.port}/ws`);sockets.push(ws);ws.once('open',()=>resolve(ws));ws.once('error',reject);});
  const next=(ws,type)=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>{ws.off('message',receive);reject(Error('No '+type));},5000);const receive=raw=>{const msg=JSON.parse(raw);if(msg.type===type){clearTimeout(timer);ws.off('message',receive);resolve(msg);}};ws.on('message',receive);});
  const join={type:'join',name:'Private QA',bots:9,team:'CT',clientBuild:CLIENT_BUILD,rulesVersion:RULES_VERSION,assetVersion:ASSET_VERSION,mapId:context.mapId,mapSignature:context.mapSignature};
  try{
   const health=await(await fetch(`http://127.0.0.1:${app.port}/health`)).json();assert.equal(health.service,'dust2-private-game');assert.equal(health.mapId,context.mapId);
   const config=await(await fetch(`http://127.0.0.1:${app.port}/private-map.json`)).json();assert.equal(config.mapSignature,context.mapSignature);assert.ok(!JSON.stringify(config).includes(directory));
   const a=await connect();let received=next(a,'error');a.send(JSON.stringify({...join,mapSignature:'wrong'}));assert.equal((await received).code,'MAP_MISMATCH');
   received=next(a,'welcome');a.send(JSON.stringify({...join,room:'FIRST1'}));const welcome=await received;assert.equal(welcome.mapId,context.mapId);assert.equal(welcome.physicsSha256,config.physicsSha256);
   const b=await connect();received=next(b,'error');b.send(JSON.stringify({...join,room:'OTHER2'}));assert.equal((await received).code,'SERVER_FULL');
  }finally{for(const socket of sockets)socket.terminate();await app.close();}
 });
});
