import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {WebSocket} from 'ws';
import {BoxGeometry} from 'three';
import {botSkill,normalizeBotDifficulty} from '../shared/bot-difficulty.js';
import {BOT_AIM,angleDifference} from '../server/bot-aim.js';
import {initPhysics} from '../shared/physics.js';
import {GameRoom} from '../server/game.js';
import {startGameServer} from '../server/index.js';
import {attackPlan,tacticalGoal} from '../server/bot-tactics.js';

function flat(){const g=new BoxGeometry(500,1,500).toNonIndexed();g.translate(0,-.5,0);initPhysics(g.attributes.position.array);g.dispose();}
test('hard improves reaction and aim precision by 1.3x while retaining normal defaults',()=>{
 for(const value of [null,{},'HARD','cheat',undefined])assert.equal(normalizeBotDifficulty(value),'normal');
 const normal=botSkill('normal'),hard=botSkill('hard');for(const key of Object.keys(normal))assert.ok(Math.abs(normal[key]/hard[key]-1.3)<1e-12);
 assert.equal(normal.reactionMinMs+normal.reactionRangeMs/2,500);assert.ok(Object.isFrozen(hard));
});
test('both difficulty levels acquire only visible enemies and keep identical turn-speed bounds',()=>{
 flat();for(const botDifficulty of ['easy','normal','hard']){
  let now=100000;const r=new GameRoom('AIMTEST',{mode:'deathmatch',bots:1,botDifficulty,clock:()=>now});const enemy=r.addHuman({},{team:'CT'}),p=[...r.players.values()].find(q=>q.bot);
  Object.assign(p,{x:0,y:0,z:0,yaw:1,pitch:0,grounded:true});Object.assign(enemy,{x:0,y:0,z:-10,team:'CT',protectionUntil:0});p.team='T';r.visibleToBot=()=>false;
  r.botInput(p,1/30);assert.equal(p.botAI.targetId,null);r.visibleToBot=()=>true;p.botAI.nextThinkAt=0;
  for(let i=0;i<120;i++){now+=1000/30;const old=p.yaw,out=r.botInput(p,1/30);assert.ok(Math.abs(angleDifference(out.yaw,old))<=BOT_AIM.maxYawSpeed/30+1e-9);p.yaw=out.yaw;p.pitch=out.pitch;}
  assert.equal(p.botAI.targetId,enemy.id);r.visibleToBot=()=>false;now+=1000;assert.equal(r.botInput(p,1/30).fire,false);
 }
});
test('room difficulty is host-owned, survives ownership transfer, and plans change on the next round',()=>{
 flat();const room=new GameRoom('HOSTQA',{bots:0}),host=room.addHuman({},{team:'CT'}),guest=room.addHuman({},{team:'T'});
 assert.equal(room.botDifficulty,'normal');const plan=attackPlan(room);
 assert.equal(room.setBotDifficulty(guest.id,'hard').ok,false);for(const v of [null,{},1,'HARD','impossible'])assert.equal(room.setBotDifficulty(host.id,v).ok,false);
 assert.equal(room.setBotDifficulty(host.id,'hard').ok,true);assert.equal(room.snapshot().botDifficulty,'hard');assert.equal(attackPlan(room),plan);
 room.round.number++;assert.equal(attackPlan(room).coordinated,true);room.removePlayer(host.id);assert.equal(room.hostId,guest.id);assert.equal(room.botDifficulty,'hard');assert.equal(room.setBotDifficulty(guest.id,'normal').ok,true);
});
test('hard A-short execute sends a group through catwalk, retains a second approach and a carrier',()=>{
 const players=Array.from({length:5},(_,seat)=>({id:'b_'+seat,seat,bot:true,alive:true,team:'T',hasBomb:seat===2,x:0,y:0,z:20,botAI:{}}));
 const room={strategyRandom:()=>0,botDifficulty:'hard',clock:()=>100000,round:{number:1},bomb:{state:'carried'},players:new Map(players.map(p=>[p.id,p])),nearestNav:p=>p,siteAt:()=>null};
 players.forEach(p=>tacticalGoal(room,p));assert.equal(players.filter(p=>p.botAI.lane==='short').length,4);assert.equal(players[4].botAI.lane,'long');assert.equal(players[2].botAI.role,'carrier');
  const p=players[0];p.botAI.routeVariant=1;p.botAI.routeKey=null;tacticalGoal(room,p);assert.equal(p.botAI.lane,'long');
});
test('attack lanes and completed route legs remain stable after an entry teammate dies',()=>{
 const players=Array.from({length:5},(_,seat)=>({id:'b_'+seat,seat,bot:true,alive:true,team:'T',x:0,y:0,z:20,botAI:{}}));
 const room={strategyRandom:()=>0,botDifficulty:'hard',clock:()=>100000,round:{number:1},bomb:{state:'carried'},players:new Map(players.map(p=>[p.id,p])),nearestNav:p=>p,siteAt:()=>null};
 players.forEach(p=>{tacticalGoal(room,p);p.botAI.routeIndex=1;});const keys=players.map(p=>p.botAI.routeKey);players[0].alive=false;
 players.slice(1).forEach((p,i)=>{tacticalGoal(room,p);assert.equal(p.botAI.routeKey,keys[i+1]);assert.equal(p.botAI.routeIndex,1);});
});

function message(ws,match){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{ws.off('message',on);reject(Error('Protocol response timed out'));},5000);function on(raw){const m=JSON.parse(raw);if(match(m)){clearTimeout(timer);ws.off('message',on);resolve(m);}}ws.on('message',on);});}
async function join(port,settings){const ws=new WebSocket(`ws://127.0.0.1:${port}/ws`);await once(ws,'open');const pending=message(ws,m=>m.type==='welcome');ws.send(JSON.stringify({type:'join',name:'Difficulty QA',bots:0,...settings}));return {ws,welcome:await pending};}
test('websocket creation, existing-room join and host changes agree on authoritative difficulty',{timeout:15000},async()=>{
 const app=await startGameServer({port:0,host:'127.0.0.1'});try{
  const host=await join(app.port,{botDifficulty:'hard'}),guest=await join(app.port,{room:host.welcome.room,botDifficulty:'normal'});
  assert.equal(host.welcome.botDifficulty,'hard');assert.equal(guest.welcome.botDifficulty,'hard');
  let pending=message(guest.ws,m=>m.type==='error');guest.ws.send(JSON.stringify({type:'setBotDifficulty',botDifficulty:'normal'}));assert.equal((await pending).code,'BOT_DIFFICULTY_REJECTED');
  const peerUpdate=message(guest.ws,m=>m.type==='snapshot'&&m.botDifficulty==='normal');pending=message(host.ws,m=>m.type==='botDifficultyUpdated');host.ws.send(JSON.stringify({type:'setBotDifficulty',botDifficulty:'normal'}));assert.equal((await pending).botDifficulty,'normal');await peerUpdate;
  await delay(270);pending=message(host.ws,m=>m.type==='error');host.ws.send(JSON.stringify({type:'setBotDifficulty',botDifficulty:'impossible'}));assert.equal((await pending).code,'BOT_DIFFICULTY_REJECTED');
  host.ws.close();guest.ws.close();
 }finally{await app.close();}
});
