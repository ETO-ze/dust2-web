import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {GameRoom} from '../server/game.js';
import {MAP} from '../shared/map-data.js';
import {initPhysics,isHullClear} from '../shared/physics.js';
import {botSkill,headIntent,normalizeBotDifficulty} from '../shared/bot-difficulty.js';
import {effectiveBotSkill,adaptAfterRound} from '../server/bot-adaptation.js';
import {reportSiteThreat,rotationSite} from '../server/bot-alerts.js';
import {hearGunshot} from '../server/bot-perception.js';
import {tacticalGoal} from '../server/bot-tactics.js';
import {validHoldPosts,chooseHoldPost} from '../server/bot-posts.js';
import {carrierCanSupport,utilityApproach,botUtility} from '../server/bot-utility.js';
import {accuracyForShot,aimPitch} from '../shared/aim.js';
import {getWeapon} from '../shared/weapons.js';
initPhysics(JSON.parse(fs.readFileSync('public/assets/map/collision.json','utf8')).positions);

function defense(){
 let now=100000;
 const roles=['anchor-a','anchor-b','rotator','mid','short'];
 const players=roles.map((role,i)=>({id:'b_'+i,seat:i,alive:true,bot:true,team:'CT',teamId:'A',...MAP.sites[role.endsWith('-b')?'B':'A'],botAI:{defenseRole:role,lastSeenAt:0}}));
 const room={mode:'defuse',round:{phase:'live',number:1},bomb:{state:'carried'},clock:()=>now,players:new Map(players.map(p=>[p.id,p]))};
 return {room,players,advance(ms){now+=ms;}};
}
test('easy is accepted without changing ordinary or hard baseline, and never receives a losing boost',()=>{
 assert.equal(normalizeBotDifficulty('easy'),'easy');assert.ok(botSkill('easy').reactionMinMs>botSkill('normal').reactionMinMs);
 assert.ok(headIntent('easy')<headIntent('normal'));assert.equal(botSkill('normal').reactionMinMs,390);
 const r=new GameRoom('EASY',{bots:0,botDifficulty:'easy'}),p=r.addHuman({},{team:'CT'});
 adaptAfterRound(r,'T');adaptAfterRound(r,'T');assert.equal(r.botMomentum.A.boosted,true);assert.deepEqual(effectiveBotSkill(r,p),botSkill('easy'));
 r.setBotDifficulty(p.id,'hard');assert.equal(effectiveBotSkill(r,p).reactionMinMs,botSkill('hard').reactionMinMs/1.5);
 adaptAfterRound(r,'CT');adaptAfterRound(r,'CT');assert.deepEqual(effectiveBotSkill(r,p),botSkill('hard'));
});
test('a full team gets five separate spawn positions even when enemy proximity favors a single slot',()=>{
 const r=new GameRoom('SPAWN',{bots:0});
 for(let i=0;i<5;i++){const p=r.makePlayer('b_'+i,'Spawn '+i,'CT',true);r.players.set(p.id,p);}
 const enemy=r.makePlayer('enemy','Enemy','T',false);r.players.set(enemy.id,enemy);
 for(let round=0;round<8;round++){
  r.startRound();const team=[...r.players.values()].filter(p=>p.team==='CT');
  assert.equal(new Set(team.map(p=>`${p.x}:${p.z}`)).size,5);
  for(const p of team)assert.ok(MAP.spawns.CT.some(n=>n.x===p.x&&n.z===p.z));
 }
});
test('continuous heard gunfire cannot reset the first alarm, and only two rotate while the other anchor stays',()=>{
 const f=defense();for(let i=0;i<=20;i++){reportSiteThreat(f.room,'CT',MAP.sites.B);if(i<20)f.advance(500);}
 const rotating=f.players.filter(p=>rotationSite(f.room,p)==='B');assert.equal(rotating.length,2);
 assert.ok(rotating.every(p=>!p.botAI.defenseRole.startsWith('anchor')));assert.equal(rotationSite(f.room,f.players[0]),null);
 f.advance(17000);assert.ok(f.players.every(p=>rotationSite(f.room,p)===null));
});
test('hearing and radio reports never use a remote unseen enemy, nor grant a target lock',()=>{
 const f=defense(),shooter={id:'enemy',team:'T',...MAP.sites.B};
 for(const p of f.players)Object.assign(p,{x:100,y:0,z:100});
 hearGunshot(f.room,shooter);assert.equal(f.room.botAlerts,undefined);
 Object.assign(f.players[1],MAP.sites.B);hearGunshot(f.room,shooter);
 assert.ok(f.room.botAlerts.B);assert.ok(f.players.every(p=>!p.botAI.targetId));
 assert.equal(f.room.botAlerts.B.x,undefined);
});
test('contact and casualties shorten the decision, recent engagements and planted objectives take priority',()=>{
 const f=defense();reportSiteThreat(f.room,'CT',MAP.sites.B,'contact');f.advance(3100);
 assert.equal(f.players.filter(p=>rotationSite(f.room,p)==='B').length,2);
 f.players[2].botAI.engaging=true;assert.equal(rotationSite(f.room,f.players[2]),null);
 f.room.bomb.state='planted';assert.ok(f.players.every(p=>rotationSite(f.room,p)===null));
 const d=defense();reportSiteThreat(d.room,'CT',MAP.sites.B,'death');d.advance(4900);assert.equal(rotationSite(d.room,d.players[2]),null);d.advance(200);assert.equal(rotationSite(d.room,d.players[2]),'B');
});
test('a fresh B alert is not hidden behind an expired A alert and round restart discards reports',()=>{
 const f=defense();reportSiteThreat(f.room,'CT',MAP.sites.A);f.advance(20000);reportSiteThreat(f.room,'CT',MAP.sites.B);f.advance(10000);assert.equal(rotationSite(f.room,f.players[2]),'B');
 const r=new GameRoom('RESET',{bots:0});r.botAlerts={B:{firstAt:1}};r.botRotation={ids:new Set(['old'])};r.startRound();assert.deepEqual(r.botAlerts,{});assert.equal(r.botRotation,null);
});
test('real-map holding posts have standing clearance, reachable goals and stable within-round assignments',()=>{
 const r=new GameRoom('POSTS',{bots:0,clock:()=>100000});r.round.phase='live';r.round.number=1;r.strategyRandom=()=>0;
 const p=r.makePlayer('b_1','Guard','CT',true);r.players.set(p.id,p);
 for(const site of ['A','B']){
  p.botAI.defenseRole='anchor-'+site.toLowerCase();p.weapon='m4a1';tacticalGoal(r,p);
  const posts=validHoldPosts(r,p,site);assert.ok(posts.length>=3,site+': too few safe posts: '+posts.length);
  for(const n of posts)assert.ok(isHullClear({...n,y:n.y+.015}),site+JSON.stringify(n));
  const distinct=new Set();
  for(let round=1;round<=8;round++){r.round.number=round;p.botAI.holdPost=null;const n=chooseHoldPost(r,p,site);assert.deepEqual(chooseHoldPost(r,p,site),n);assert.ok(r.planPath(p,n).length);distinct.add(`${n.x}:${n.z}`);}
  assert.ok(distinct.size>=3,site+': repeated one post');
 }
});
test('utility approach expands nearby choices but rejects wall detours and long carrier diversions',()=>{
 const p={x:0,y:0,z:0},stand={x:12,y:0,z:0};
 assert.ok(utilityApproach({planPath:()=>[stand]},p,stand));
 assert.equal(utilityApproach({planPath:()=>[{x:0,y:0,z:30},stand]},p,stand),null);
 assert.equal(utilityApproach({planPath:()=>[stand]},{...p,hasBomb:true},stand),null);
 assert.equal(utilityApproach({planPath:()=>[]},p,stand),null);
});
test('carrier only throws with time and armed support, and cancels when the protector dies',()=>{
 let now=100000;const p={id:'b_1',team:'T',x:0,y:0,z:0,hasBomb:true,inventory:{ak47:{ammo:20,reserve:30}},botAI:{lastSeenAt:0,utility:{id:'test',key:'T:test'}}};
 const q={id:'b_2',alive:true,team:'T',x:3,y:0,z:0,inventory:{ak47:{ammo:20,reserve:30}}};
 const room={mode:'defuse',round:{phase:'live',phaseEndsAt:now+60000},clock:()=>now,players:new Map([[p.id,p],[q.id,q]]),siteAt:()=>null,cancelGrenade:()=>{}};
 assert.equal(carrierCanSupport(room,p),true);room.siteAt=()=> 'A';assert.equal(carrierCanSupport(room,p),false);room.siteAt=()=>null;
 now+=30000;assert.equal(carrierCanSupport(room,p),false);now-=30000;
 q.alive=false;assert.equal(carrierCanSupport(room,p),false);const out=botUtility(room,p,{},1/30);assert.equal(out.cancelGrenade,true);assert.equal(p.botAI.utility,null);assert.equal(p.inventory.ak47.ammo,20);
});
test('querying bot accuracy cannot change another shooter recoil or mutate burst state',()=>{
 const p={bot:true,grounded:true,vx:0,vz:0,vy:0},before={...p};
 for(let i=0;i<100;i++)accuracyForShot(getWeapon('ak47'),p);
 assert.deepEqual(p,before);assert.equal(aimPitch(0,.1),.1);
});
