import fs from 'node:fs';import {GameRoom} from '../server/game.js';import {initPhysics} from '../shared/physics.js';
initPhysics([-200,0,-200,200,0,200,200,0,-200,-200,0,-200,-200,0,200,200,0,200]);
const results=[];let seed=293913;Math.random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/2**32);
for(const difficulty of ['normal','hard'])for(const weapon of ['ak47','m4a1','usp','pistol','awp']){
 let now=100000;const r=new GameRoom('AIMRATE',{mode:'deathmatch',bots:0,botDifficulty:difficulty,clock:()=>now});const bot=r.makePlayer('b_1','Aim sample','CT',true),enemy=r.makePlayer('h_1','Moving target','T',false);r.players.set(bot.id,bot);r.players.set(enemy.id,enemy);r.chooseBotGoal=()=>({x:bot.x,y:bot.y,z:bot.z});r.desiredBots=0;
 let kills=0,headshots=0,shots=0,timeouts=0;const durations=[];
 for(let duel=0;duel<160;duel++){
  r.match.status='live';r.scores={CT:0,T:0};r.respawn(bot);r.respawn(enemy);bot.inventory={};r.giveWeapon(bot,weapon);r.selectSlot(bot,1);bot.weapon=weapon;bot.slot=['usp','pistol'].includes(weapon)?2:1;bot.input.slot=bot.slot;
  Object.assign(bot,{x:0,y:0,z:0,yaw:0,pitch:0,grounded:true,vx:0,vy:0,vz:0,nextShotAt:0,equipReadyAt:0,protectionUntil:0});
  const distance=[8,16,24,32][duel%4],moving=duel%3;Object.assign(enemy,{x:0,y:0,z:-distance,grounded:true,crouch:duel%5===0,armor:100,helmet:true,health:100,alive:true,protectionUntil:0});enemy.input.crouch=enemy.crouch;
  const began=now;let dead=false;
  for(let frame=0;frame<270;frame++){
   now+=1000/30;enemy.x=Math.sin((now-began)/550)*moving*.7;r.tick();
   for(const e of r.events.splice(0)){if(e.type==='shot'&&e.shooterId===bot.id)shots++;if(e.type==='kill'&&e.victimId===enemy.id){kills++;if(e.headshot)headshots++;durations.push(now-began);dead=true;}}
   if(dead)break;
  }
  if(!dead)timeouts++;
 }
 results.push({difficulty,weapon,duels:160,kills,headshots,headshotPercent:+(100*headshots/Math.max(1,kills)).toFixed(1),shots,timeouts,medianKillMs:Math.round(durations.sort((a,b)=>a-b)[Math.floor(durations.length/2)]||0)});
}
fs.mkdirSync('artifacts/bot-social',{recursive:true});fs.writeFileSync('artifacts/bot-social/aim-rates.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results));
