/** Disposable local QA fixture. Control port is loopback-only, never deployed. */
import { createServer } from 'node:http';
import { startGameServer } from '../server/index.js';
import {MAP} from '../shared/map-data.js';
import {raycastWorld} from '../shared/physics.js';
import {eyePosition} from '../shared/aim.js';
import {getWeapon} from '../shared/weapons.js';
import fs from 'node:fs';
const movementLedges=JSON.parse(fs.readFileSync(new URL('../tests/fixtures/movement-ledges.json',import.meta.url),'utf8'));
const movementFlat=JSON.parse(fs.readFileSync(new URL('../tests/fixtures/movement-flat.json',import.meta.url),'utf8'));
function setupMovement(room,kind){
 const p=[...room.players.values()].find(p=>!p.bot),probe=movementLedges[0];
 room.mode='deathmatch';room.round.phase='live';room.round.number++;room.match.status='live';
 room.botInput=b=>({...b.input,forward:0,right:0,fire:false,fire2:false,jump:false,interact:false});
 room.respawn(p);
 const position=kind==='sky'?{...MAP.sites.A,yaw:-.45,pitch:.43}:kind==='flat'?movementFlat:kind==='ledge'?probe.ledge:probe.lower;
 Object.assign(p,position,{vx:0,vy:0,vz:0,grounded:false,pitch:position.pitch||0,protectionUntil:Infinity});
 p.input={...p.input,forward:0,right:0,jump:false,fire:false,yaw:p.yaw,pitch:p.pitch};
 room.poseHistory.clear();room.recordPoses();for(const socket of room.clients.values())socket.send(JSON.stringify(room.snapshot({drainEvents:false})));
 return {kind,lifeId:p.lifeId,position,ledgeHeight:probe.height,lowerHeight:probe.lower.y};
}
let aimLane;
function setupAimLane(room,weapon){
 if(!aimLane){
  const nodes=MAP.nav.filter(n=>n.neighbors?.length>=3);
  outer:for(const a of nodes)for(const b of nodes){const dx=b.x-a.x,dz=b.z-a.z,d=Math.hypot(dx,dz);if(d<25||d>40||Math.abs(a.y-b.y)>.1)continue;
   const direction={x:dx/d,y:0,z:dz/d};if(raycastWorld({x:a.x,y:a.y+1.62,z:a.z},direction,d)!==null)continue;
   aimLane={a,b,d,yaw:Math.atan2(-dx,-dz)};break outer;
  }
  if(!aimLane)throw Error('No unobstructed scope QA lane');
 }
 const human=[...room.players.values()].find(p=>!p.bot),team=weapon==='sg553'?'T':'CT';
 room.mode='deathmatch';room.match.status='live';room.round.phase='live';room.round.number++;
 room.setBots(human.id,9);room.botInput=p=>({...p.input,forward:0,right:0,fire:false,jump:false,interact:false});
 const target=[...room.players.values()].find(p=>p.bot),{a,b,d,yaw}=aimLane;
 for(const p of room.players.values()){room.respawn(p);p.protectionUntil=0;p.nextShotAt=0;}
 Object.assign(human,{x:a.x,y:a.y,z:a.z,vx:0,vy:0,vz:0,yaw,pitch:0,team,teamId:room.teamForSide(team),agentId:human.agents[team],grounded:true,zoomLevel:0,fireQueue:[],triggerWasDown:false,nextShotAt:0});
 for(const id of Object.keys(human.inventory))if(getWeapon(id).slot===1)delete human.inventory[id];
 room.giveWeapon(human,weapon);room.selectSlot(human,1);human.weapon=weapon;human.slot=1;human.nextShotAt=0;
 Object.assign(target,{x:b.x,y:b.y,z:b.z,vx:0,vy:0,vz:0,yaw:yaw+Math.PI,pitch:0,team:team==='CT'?'T':'CT',teamId:room.teamForSide(team==='CT'?'T':'CT'),health:100,armor:0,helmet:false,grounded:true,name:'QA target · 100 HP'});target.agentId=target.agents[target.team];
 room.poseHistory.clear();room.recordPoses();
 for(const socket of room.clients.values())socket.send(JSON.stringify(room.snapshot({drainEvents:false})));
 return {weapon,distance:d,origin:eyePosition(human),target:{id:target.id,x:target.x,y:target.y+1.62,z:target.z},yaw,pitch:0};
}
const app = await startGameServer({port:3003,host:'127.0.0.1',rules:{respawnSeconds:3,protectionSeconds:0}});
let soakTimer = null;
function killHumans() {
  for (const room of app.rooms.values()) {
    for (const p of room.players.values()) if (!p.bot && p.alive) {
      const killer = [...room.players.values()].find(other => other.team !== p.team);
      room.kill(p,killer,'ak47',true);
    }
  }
}
function churn() {
  for (const room of app.rooms.values()) {
    for (const p of [...room.players.values()]) if(p.bot) room.removePlayer(p.id);
    room.ensureBots();
  }
}
function matchCase(room,kind){
  const human=[...room.players.values()].find(p=>!p.bot),humanTeam=human?.teamId||'A';
  room.mode='defuse';room.botInput=p=>({...p.input,forward:0,right:0,fire:false,fire2:false,interact:false});
  Object.assign(room.match,{status:'live',period:'regulation',overtimeNumber:0,winTarget:13,winnerTeamId:null,reason:'',endedAt:null});
  room.pendingTransition=null;
  const preset=(a,b,rounds)=>{room.scores={ [room.teamSides.A]:a,[room.teamSides.B]:b };room.match.roundsPlayed=rounds;Object.assign(room.round,{number:rounds+1,phase:'live',phaseEndsAt:Date.now()+120000});};
  if(kind==='halftime'){
    preset(6,5,11);room.endRound(room.teamSides.B,'QA 第 12 回合结束');room.startRound();
  }else if(kind==='overtime'){
    preset(14,12,26);Object.assign(room.match,{period:'overtime',overtimeNumber:1,winTarget:16});room.endRound(room.teamSides.B,'QA 加时第 3 回合结束');room.startRound();
  }else{
    const winner=kind==='victory'?humanTeam:humanTeam==='A'?'B':'A';preset(winner==='A'?12:8,winner==='B'?12:8,20);
    room.endRound(room.teamSides[winner],kind==='victory'?'QA 比赛胜利':'QA 比赛失利');
  }
}
const control=createServer((req,res)=>{
  if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)){res.writeHead(403);res.end();return;}
  if(req.method!=='POST'){res.writeHead(405);res.end();return;}
  if(req.url==='/qa/reload'||req.url==='/qa/c4'){
    const results=[];
    for(const room of app.rooms.values()){
      const p=[...room.players.values()].find(p=>!p.bot);room.match.status='live';room.round.phase='live';room.pendingTransition=null;
      room.takeSeat(p.id,'T',room.players.get(p.id).team==='T'?p.seat:room.freeSeat('T'));
      room.botInput=b=>({...b.input,forward:0,right:0,fire:false,fire2:false,jump:false,interact:false});
      room.mode=req.url.endsWith('c4')?'defuse':'deathmatch';room.respawn(p);p.protectionUntil=Infinity;
      room.round.phaseEndsAt=Date.now()+120000;room.round.number++;p.nextShotAt=0;
      if(room.mode==='defuse'){
        room.rules.bombSeconds=14;Object.assign(p,MAP.sites.A,{vx:0,vy:0,vz:0,grounded:true,pitch:0,yaw:0});
        room.bomb={...room.emptyBomb(),state:'carried',carrierId:p.id,...MAP.sites.A};p.hasBomb=true;room.giveWeapon(p,'c4');room.selectSlot(p,5);p.input.slot=5;
      }else{room.giveWeapon(p,'ak47');room.selectSlot(p,1);p.input.slot=1;p.inventory.ak47.ammo=1;p.inventory.ak47.reserve=90;}
      room.poseHistory.clear();room.recordPoses();results.push({id:p.id,weapon:p.weapon});
      for(const socket of room.clients.values())socket.send(JSON.stringify(room.snapshot({drainEvents:false})));
    }
    res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(results));return;
  }
  if(/^\/qa\/movement\/(flat|ledge|jump|sky)$/.test(req.url)){
    clearInterval(soakTimer);soakTimer=null;const result=[...app.rooms.values()].map(room=>setupMovement(room,req.url.split('/').at(-1)));
    res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(result));return;
  }
  if(/^\/qa\/aim-lane\/(awp|ssg08|scar20|sg553)$/.test(req.url)){
    clearInterval(soakTimer);soakTimer=null;
    try{const results=[...app.rooms.values()].map(room=>setupAimLane(room,req.url.split('/').at(-1)));res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(results));}catch(error){res.writeHead(500);res.end(error.message);}return;
  }
  if(/^\/qa\/(halftime|overtime|victory|defeat)$/.test(req.url)){
    clearInterval(soakTimer);soakTimer=null;for(const room of app.rooms.values())matchCase(room,req.url.split('/').at(-1));
  }else if(req.url==='/kill')killHumans();
  else if(req.url==='/hold'){for(const room of app.rooms.values())room.botInput=p=>({...p.input,forward:0,right:0,fire:false});}
  else if(req.url==='/team/CT'||req.url==='/team/T'){for(const room of app.rooms.values())for(const p of room.players.values())if(!p.bot){p.team=req.url.endsWith('/CT')?'CT':'T';p.teamId=room.teamForSide(p.team);p.agentId=p.agents[p.team];p.loadoutPrimary=p.team==='CT'?'m4a1':'ak47';p.inventory={};room.giveWeapon(p,p.team==='CT'?'usp':'pistol');room.giveWeapon(p,'knife');room.giveWeapon(p,p.loadoutPrimary);room.respawn(p);}}
  else if(req.url==='/churn')churn();
  else if(req.url==='/soak'){
    clearInterval(soakTimer);let ticks=0;
    soakTimer=setInterval(()=>{ticks++;killHumans();if(ticks%3===0)churn();},7000);
  } else if(req.url==='/stop-soak'){clearInterval(soakTimer);soakTimer=null;}
  else if(req.url==='/defuse'){
    clearInterval(soakTimer);soakTimer=null;
    for(const room of app.rooms.values()){room.mode='defuse';room.round.phase='live';room.round.phaseEndsAt=Date.now()+120000;room.botInput=p=>({...p.input,forward:0,right:0,fire:false});}
  } else if(req.url==='/respawn'){
    for(const room of app.rooms.values()){room.mode='deathmatch';room.round.phase='live';room.match={status:'live',period:'regulation',roundsPlayed:0,overtimeNumber:0,winTarget:100,winnerTeamId:null};room.scores={T:0,CT:0};room.pendingTransition=null;room.botInput=Object.getPrototypeOf(room).botInput.bind(room);for(const p of room.players.values())if(!p.bot){p.alive=false;p.respawnAt=Date.now()+50;}}
  } else {res.writeHead(404);res.end();return;}
  res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({ok:true,rooms:app.rooms.size}));
});
await new Promise(resolve=>control.listen(3004,'127.0.0.1',resolve));
console.log('Stability QA ready at http://127.0.0.1:3003; loopback control :3004');
const stop=()=>{clearInterval(soakTimer);control.close();app.close().then(()=>process.exit(0));};
process.once('SIGINT',stop);process.once('SIGTERM',stop);
