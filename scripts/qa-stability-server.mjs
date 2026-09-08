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
const control=createServer((req,res)=>{
  if(req.method!=='POST'){res.writeHead(405);res.end();return;}
  if(req.url==='/kill')killHumans();
  else if(req.url==='/churn')churn();
  else if(req.url==='/soak'){
    clearInterval(soakTimer);let ticks=0;
    soakTimer=setInterval(()=>{ticks++;killHumans();if(ticks%3===0)churn();},7000);
  } else if(req.url==='/stop-soak'){clearInterval(soakTimer);soakTimer=null;}
  else if(req.url==='/defuse'){
    clearInterval(soakTimer);soakTimer=null;
    for(const room of app.rooms.values()){room.mode='defuse';room.round.phase='live';room.round.phaseEndsAt=Date.now()+120000;room.botInput=p=>({...p.input,forward:0,right:0,fire:false});}
  } else if(req.url==='/respawn'){
    for(const room of app.rooms.values()){room.mode='deathmatch';room.round.phase='live';room.botInput=Object.getPrototypeOf(room).botInput.bind(room);for(const p of room.players.values())if(!p.bot){p.alive=false;p.respawnAt=Date.now()+50;}}
  } else {res.writeHead(404);res.end();return;}
  res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({ok:true,rooms:app.rooms.size}));
});
await new Promise(resolve=>control.listen(3004,'127.0.0.1',resolve));
console.log('Stability QA ready at http://127.0.0.1:3003; loopback control :3004');
const stop=()=>{clearInterval(soakTimer);control.close();app.close().then(()=>process.exit(0));};
process.once('SIGINT',stop);process.once('SIGTERM',stop);
