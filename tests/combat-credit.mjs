import test from 'node:test';
import assert from 'node:assert/strict';
import {GameRoom,rayHitPlayer} from '../server/game.js';
import {initPhysics} from '../shared/physics.js';
import {recordFlash} from '../server/combat-credit.js';
initPhysics([-200,0,-200,200,0,200,200,0,-200,-200,0,-200,-200,0,200,200,0,200]);
function fixture(){
 let now=100000;const room=new GameRoom('CREDIT',{mode:'deathmatch',bots:0,clock:()=>now});
 const [a,b,v]=['a','b','v'].map((name,i)=>room.addHuman({}, {name,team:i===2?'T':'CT',primary:'awp'}));
 for(const [i,p]of [a,b,v].entries())Object.assign(p,{x:i===1?5:0,y:0,z:i===2?-10:0,health:100,armor:0,helmet:false,grounded:true,protectionUntil:0,nextShotAt:0});
 return {room,a,b,v,advance:ms=>now+=ms};
}
test('head and torso rays are distinct and only a lethal headshot increments headshot kills',()=>{
 const {room,a,v}=fixture();assert.equal(rayHitPlayer({x:0,y:1.62,z:0},{x:0,y:0,z:-1},v,20).headshot,true);
 assert.equal(rayHitPlayer({x:0,y:.9,z:0},{x:0,y:0,z:-1},v,20).headshot,false);
 room.traceBullet=()=>({end:{x:0,y:1.62,z:-10},hits:[{playerId:v.id,distance:10,headshot:true}]});
 room.fire(a,{fire:true,yaw:0,pitch:0});assert.equal(a.headshots,1);assert.equal(a.kills,1);assert.equal(room.events.find(e=>e.type==='kill').headshot,true);
 room.kill(v,a,'awp',true);assert.equal(a.headshots,1);assert.equal(room.snapshot().players.find(p=>p.id===a.id).headshots,1);
});
test('40 actual damage earns one assist, below threshold does not, and assists do not add team kills',()=>{
 for(const damage of [39,40]){const {room,a,b,v}=fixture();room.damagePlayer(v,a,damage,'ak47');room.damagePlayer(v,b,100,'m4a1');
 assert.equal(a.assists,damage===40?1:0);assert.equal(b.assists,0);assert.equal(room.scores.CT,1);const kill=room.events.find(e=>e.type==='kill');assert.equal(kill.assisterId,damage===40?a.id:undefined);}
});
test('damage accumulates during a life, armor-absorbed damage does not count, and respawn clears contributions',()=>{
 const {room,a,b,v}=fixture();v.armor=100;room.damagePlayer(v,a,40,'ak47',false,1);assert.ok(v.damageContributions.get(a.id).damage<40);
 room.respawn(v);v.armor=0;room.damagePlayer(v,a,20,'ak47');room.damagePlayer(v,a,20,'ak47');room.damagePlayer(v,b,100,'m4a1');assert.equal(a.assists,1);
 room.respawn(v);v.armor=0;room.damagePlayer(v,b,100,'m4a1');assert.equal(a.assists,1);
});
test('flash assists require meaningful enemy exposure and expire, with damage credit taking priority',()=>{
 for(const age of [2000,5000]){const {room,a,b,v,advance}=fixture();recordFlash(room,v,a,2);advance(age);room.damagePlayer(v,b,100,'m4a1');const kill=room.events.find(e=>e.type==='kill');assert.equal(a.assists,age===2000?1:0);assert.equal(kill.flashAssist,age===2000?true:undefined);}
 const {room,a,b,v}=fixture();recordFlash(room,v,b,3);room.damagePlayer(v,a,40,'ak47');room.damagePlayer(v,b,100,'m4a1');assert.equal(a.assists,1);assert.equal(room.events.find(e=>e.type==='kill').flashAssist,false);
});
test('friendly damage, environment deaths and a killer own flash never produce an assist',()=>{
 const {room,a,b,v}=fixture();recordFlash(room,v,b,3);room.damagePlayer(v,b,100,'m4a1');assert.equal(b.assists,0);
 room.damagePlayer(b,a,50,'ak47');room.kill(b,null);assert.equal(a.assists,0);
});
test('controlled bot contribution is credited to its human controller even after release',()=>{
 const {room,a,b,v}=fixture(),bot=room.makePlayer('bot_credit','controlled bot','CT',true);room.players.set(bot.id,bot);bot.controllerId=a.id;
 room.damagePlayer(v,bot,40,'ak47');delete bot.controllerId;room.damagePlayer(v,b,100,'m4a1');assert.equal(a.assists,1);assert.equal(bot.assists,0);
});
