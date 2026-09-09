/** Disposable local QA fixture. Control port is loopback-only, never deployed. */
import { createServer } from 'node:http';
import { startGameServer } from '../server/index.js';
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
