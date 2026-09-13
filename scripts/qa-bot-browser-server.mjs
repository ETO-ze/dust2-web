// Disposable loopback-only observer. Never included in public/portable builds.
import {createServer} from 'node:http';
import {startGameServer} from '../server/index.js';
import fs from 'node:fs';
fs.mkdirSync('artifacts/bot-rework',{recursive:true});
const app=await startGameServer({port:3003,host:'127.0.0.1'}),events=[];
const control=createServer((req,res)=>{
 res.setHeader('Content-Type','application/json');
 if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)){res.writeHead(403);res.end('{}');return;}
 if(req.method==='POST'&&req.url==='/observe'){
  for(const room of app.rooms.values()){
   if(!room.qaOriginalEmit){room.qaOriginalEmit=room.emit.bind(room);room.emit=(type,data)=>{room.qaOriginalEmit(type,data);if(['bot_utility_validated','grenade_thrown','smoke','flash','fire_started','kill','bomb_planted','bomb_defused'].includes(type)){events.push({at:Date.now(),room:room.code,type,...data});if(events.length>500)events.shift();}};}
   for(const p of room.players.values())p.money=16000;
   room.mode='defuse';room.round.number=2;room.startRound();
   for(const p of room.players.values())if(!p.bot){room.kill(p,null,'world');p.respawnAt=0;}
  }
  res.end(JSON.stringify({ok:true}));return;
 }
 if(req.method==='GET'&&req.url==='/state'){
  const state={events,rooms:[...app.rooms.values()].map(r=>({code:r.code,round:r.round,stats:r.botUtilityStats,players:[...r.players.values()].map(p=>({id:p.id,name:p.name,bot:p.bot,alive:p.alive,team:p.team,x:p.x,y:p.y,z:p.z,yaw:p.yaw,pitch:p.pitch,weapon:p.weapon,action:p.botAI.action,role:p.botAI.role,aimPoint:p.botAI.aimPoint,lineup:p.botAI.utility?.id,phase:p.botAI.utility?.phase}))}))};
  fs.writeFileSync('artifacts/bot-rework/browser-server.json',JSON.stringify(state,null,2));res.end(JSON.stringify(state));return;
 }
 res.writeHead(404);res.end('{}');
});
await new Promise(resolve=>control.listen(3004,'127.0.0.1',resolve));
console.log('Bot observer: http://127.0.0.1:3003; loopback control :3004');
async function stop(){await app.close();control.close(()=>process.exit(0));}process.on('SIGINT',stop);process.on('SIGTERM',stop);
