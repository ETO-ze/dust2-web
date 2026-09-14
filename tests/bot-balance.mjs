import test from 'node:test';import assert from 'node:assert/strict';import {BoxGeometry} from 'three';
import {initPhysics,createPlayerState} from '../shared/physics.js';import {GameRoom} from '../server/game.js';import {tacticalGoal,shareSighting} from '../server/bot-tactics.js';import {BOT_AIM,BOT_SKILL} from '../server/bot-aim.js';import {combatMovement} from '../server/bot-combat.js';
function fixture(){const f=new BoxGeometry(200,1,200).toNonIndexed();f.translate(0,-.5,0);initPhysics(f.attributes.position.array);f.dispose();let now=100000;const r=new GameRoom('BALANCE',{mode:'defuse',bots:9,clock:()=>now});const human=r.addHuman({}, {name:'Observer',team:'CT'});r.startRound();r.round.phase='live';r.round.phaseEndsAt=now+90000;return {r,human,advance:ms=>now+=ms};}
test('skill changes are modest and leave turn speed, settle time and weapon damage untouched',()=>{
 assert.equal(BOT_SKILL.reactionMinMs+BOT_SKILL.reactionRangeMs/2,500);assert.ok(BOT_SKILL.aimErrorScale>=.9);assert.equal(BOT_AIM.maxYawSpeed,3.6);assert.equal(BOT_AIM.settleSeconds,.12);
});
test('CT roles survive a teammate death without renumbering every defender',()=>{
 const {r}=fixture();const bots=[...r.players.values()].filter(p=>p.bot&&p.team==='CT');bots.forEach(p=>tacticalGoal(r,p));const roles=new Map(bots.map(p=>[p.id,p.botAI.defenseRole]));bots[0].alive=false;
 bots.slice(1).forEach(p=>{tacticalGoal(r,p);assert.equal(p.botAI.defenseRole,roles.get(p.id));});
});
test('a surviving bot does not pay again for its retained primary rifle',()=>{
 const {r}=fixture(),p=[...r.players.values()].find(p=>p.bot&&p.team==='T');r.giveWeapon(p,'ak47');Object.assign(p,{alive:true,money:5000,armor:100});
 Object.assign(p.inventory,{hegrenade:{ammo:1,reserve:0},smokegrenade:{ammo:1,reserve:0},flashbang:{ammo:2,reserve:0}});r.respawn(p,true);assert.equal(p.money,5000);assert.ok(p.inventory.ak47);
});
test('only the nearest available bot helps a nearby teammate; information expires',()=>{
 const {r,advance}=fixture(),ts=[...r.players.values()].filter(p=>p.team==='T'),ct=[...r.players.values()].find(p=>p.team==='CT');ts.forEach((p,i)=>Object.assign(p,{x:i*4,y:0,z:0,hasBomb:false}));ts[0].botAI.engaging=true;r.attackPlan={round:r.round.number,id:'map-default',tempo:'default',lanes:['long','long','mid','tunnels','tunnels'],offset:0,holdOffset:0,decisionAt:r.clock()+12000};
 shareSighting(r,ts[0],{...ct,x:0,y:0,z:-10});tacticalGoal(r,ts[1]);tacticalGoal(r,ts[2]);assert.equal(ts[1].botAI.phase,'support');assert.notEqual(ts[2].botAI.phase,'support');advance(1800);tacticalGoal(r,ts[1]);assert.notEqual(ts[1].botAI.phase,'support');
});
test('bots sidestep only in burst pauses, avoid a ledge, and settle before firing',()=>{
 fixture();const r={clock:()=>900,visibleToBot:()=>true},p={...createPlayerState({x:0,y:0,z:0}),grounded:true,weapon:'ak47',botAI:{strafe:1}},target={x:0,z:-20},input={yaw:0,fire:false};
 combatMovement(r,p,target,input);assert.equal(input.right,.5);p.x=99.9;const edge={yaw:0,fire:false};combatMovement(r,p,target,edge);assert.equal(edge.right,undefined);p.x=0;p.vx=2;const moving={yaw:0,fire:true};combatMovement(r,p,target,moving);assert.equal(moving.fire,false);
});
test('a visible enemy interrupts a nonurgent bot plant; the last seconds permit a plant attempt',()=>{
 const {r}=fixture(),p=[...r.players.values()].find(p=>p.bot&&p.team==='T'),enemy=[...r.players.values()].find(p=>p.team==='CT');
 Object.assign(p,{x:0,y:0,z:0,hasBomb:true,yaw:0,pitch:0});Object.assign(enemy,{x:0,y:0,z:-10,protectionUntil:0});r.visibleToBot=()=>true;r.siteAt=()=> 'A';p.botAI.targetId=enemy.id;
 assert.equal(r.botInput(p,1/30).interact,false);r.round.phaseEndsAt=r.clock()+3000;assert.equal(r.botInput(p,1/30).interact,true);
});
