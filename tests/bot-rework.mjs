import test from 'node:test';
import assert from 'node:assert/strict';
import {visibleAimPoint,observationPoint,lookAt,hearGunshot} from '../server/bot-perception.js';
import {botUtility,combatSlot} from '../server/bot-utility.js';
import {teammateRisk,usefulThrow} from '../server/bot-trajectory.js';
import {tacticalGoal} from '../server/bot-tactics.js';
import {BOT_AIM,angleDifference} from '../server/bot-aim.js';

test('aims only at a visible body sample; smoke and cover reject every sample',()=>{
 const p={x:0,y:0,z:0,yaw:0},enemy={x:0,y:0,z:-10};
 const room={visibleToBot:(_,to)=>to.y>1.5};
 assert.equal(visibleAimPoint(room,p,enemy).y,1.62);
 room.visibleToBot=(_,to)=>to.y<1.4;
 assert.equal(visibleAimPoint(room,p,enemy).y,1.8*.67);
 room.visibleToBot=()=>false;assert.equal(visibleAimPoint(room,p,enemy),null);
});
test('cannot acquire enemies behind the bot; tracked targets still need visibility',()=>{
 const room={visibleToBot:()=>true},p={x:0,y:0,z:0,yaw:0},enemy={x:0,y:0,z:10};
 assert.equal(visibleAimPoint(room,p,enemy,{acquire:true}),null);
 assert.ok(visibleAimPoint(room,p,enemy));room.visibleToBot=()=>false;
 assert.equal(visibleAimPoint(room,p,enemy),null);
});
test('observation holds the same angle across tactical replans and looks ahead above feet',()=>{
 let now=10000;const room={clock:()=>now,visibleToBot:()=>true};
 const p={x:0,y:0,z:0,seat:0,botAI:{lastSeenAt:0,watchPoints:[{x:0,y:1.5,z:-12},{x:10,y:1.5,z:-12}]}};
 const first=observationPoint(room,p);now+=100;p.botAI.watchPoints=p.botAI.watchPoints.map(n=>({...n}));
 assert.deepEqual(observationPoint(room,p),first);now+=1200;assert.notDeepEqual(observationPoint(room,p),first);
 p.botAI.watchPoints=[];p.botAI.path=[{x:0,y:0,z:-1},{x:0,y:0,z:-8}];
 assert.deepEqual(observationPoint(room,p,p.botAI.path[0]),{x:0,y:1.45,z:-8});
 assert.ok(lookAt({x:0,y:0,z:0},{x:0,y:3,z:-10}).pitch>0);
});
function utilityFixture(){
 let now=10000;const room={clock:()=>now,mode:'defuse',round:{phase:'live'},utilityClaims:new Map(),cancelGrenade(p){p.grenadeState=null;},emit(){},grenades:{clearSight:()=>true},players:new Map()};
 const p={id:'b_1',team:'T',x:0,y:0,z:0,yaw:0,pitch:0,grounded:true,alive:true,nextShotAt:0,inventory:{ak47:{ammo:30,reserve:90},smokegrenade:{ammo:1,reserve:0}},botAI:{lastSeenAt:0,utilityAfter:1e9,utility:{id:'fixture',key:'T:fixture',phase:'ready',stand:{x:0,y:0,z:0},origin:{x:0,y:0,z:0},weapon:'smokegrenade',yaw:Math.PI,pitch:.3,throwMode:'full',throwStrength:1,expiresAt:now+10000,result:{kind:'smoke',point:{x:0,y:1.3,z:-15},cells:[]}}}};
 room.players.set(p.id,p);room.utilityClaims.set('T:fixture',p.id);
 return {room,p,advance(ms=1000/30){now+=ms;},input:()=>({yaw:p.yaw,pitch:p.pitch,forward:0,right:0,fire:false,fire2:false})};
}
test('nearby gunfire prompts an approximate visual check without revealing a target through cover',()=>{
 let now=10000;const p={id:'b_1',bot:true,alive:true,team:'CT',x:0,y:0,z:0,yaw:0,botAI:{targetId:null,path:[]}},shooter={id:'h_1',alive:true,team:'T',x:5.2,y:0,z:12.8};
 const room={clock:()=>now,players:new Map([[p.id,p],[shooter.id,shooter]]),visibleToBot:()=>false};
 hearGunshot(room,shooter);assert.deepEqual(observationPoint(room,p),{x:6,y:1.3,z:12});assert.equal(p.botAI.targetId,null);
 assert.equal(visibleAimPoint(room,p,shooter),null);now+=2500;assert.equal(observationPoint(room,p),null);
 p.botAI.heardPoint=null;shooter.x=100;hearGunshot(room,shooter);assert.equal(p.botAI.heardPoint,null);
});
test('utility does not release on a fixed timer during a 180 degree turn; aim speed remains bounded',()=>{
 const f=utilityFixture();
 for(let i=0;i<24;i++){f.advance();const previous=f.p.yaw,out=botUtility(f.room,f.p,f.input(),1/30);assert.equal(out.fire,false);assert.ok(Math.abs(angleDifference(out.yaw,previous))<=BOT_AIM.maxYawSpeed/30+1e-9);f.p.yaw=out.yaw;f.p.pitch=out.pitch;}
 assert.equal(f.p.botAI.utility.phase,'ready');
 for(let i=0;i<120&&f.p.botAI.utility.phase!=='prime';i++){f.advance();const out=botUtility(f.room,f.p,f.input(),1/30);f.p.yaw=out.yaw;f.p.pitch=out.pitch;}
 assert.equal(f.p.botAI.utility.phase,'prime');assert.ok(Math.abs(angleDifference(Math.PI,f.p.yaw))<.003);
});
test('combat, damage, motion and expired plans cancel utility without consuming inventory',()=>{
 for(const reason of ['combat','damage','motion','timeout']){
  const f=utilityFixture();if(reason==='combat')f.p.botAI.engaging=true;
  if(reason==='damage')f.p.botAI.hurtAt=f.room.clock();
  if(reason==='motion'){f.p.botAI.utility.phase='prime';f.p.vx=.2;}
  if(reason==='timeout')f.advance(11000);
  const out=botUtility(f.room,f.p,f.input(),1/30);assert.equal(f.p.botAI.utility,null,reason);assert.equal(out.cancelGrenade,true);assert.equal(out.slot,1);assert.equal(f.p.inventory.smokegrenade.ammo,1);assert.equal(f.room.utilityClaims.size,0);
 }
});
test('preflight work is capped per room tick even when several bots validate together',()=>{
 const f=utilityFixture();let steps=0;
 const bots=[f.p,{...f.p,id:'b_2',botAI:{...f.p.botAI,utility:{...f.p.botAI.utility}}}];
 for(const p of bots){p.botAI.utility.phase='validate';p.botAI.utility.probe={step(n){steps+=n;return null;}};botUtility(f.room,p,f.input(),1/30);}
 assert.equal(steps,4);f.advance();botUtility(f.room,bots[1],f.input(),1/30);assert.equal(steps,8);
});
test('safe grenade types and teammate facing are checked at the effect point',()=>{
 const world={clearSight:()=>true},p={team:'T'},q={alive:true,team:'T',x:0,y:0,z:0,yaw:0,pitch:0};
 const flash={point:{x:0,y:1.6,z:-10},cells:[]};
 assert.equal(teammateRisk(world,p,flash,[q],'flashbang'),true);q.yaw=Math.PI;
 assert.equal(teammateRisk(world,p,flash,[q],'flashbang'),false);
 world.clearSight=()=>false;assert.equal(teammateRisk(world,p,flash,[{...q,yaw:0}],'flashbang'),false);
 assert.equal(teammateRisk(world,p,{point:{x:0,y:0,z:-10},cells:[{x:.5,y:0,z:0}]},[q],'molotov'),true);
 assert.equal(usefulThrow({kind:'smoke',point:{x:5,y:1.3,z:0}},{weapon:'smokegrenade',target:{x:0,y:0,z:0}},world),false);
 assert.equal(combatSlot({inventory:{hegrenade:{ammo:1},pistol:{ammo:12,reserve:24}}}),2);
});
test('entry gathering has a deadline when no teammate can arrive',()=>{
 let now=10000;const p={id:'b_1',bot:true,alive:true,team:'T',seat:0,x:40,y:0,z:-31,botAI:{}};
 const room={clock:()=>now,players:new Map([[p.id,p]]),bomb:{state:'carried'},round:{number:1},nearestNav:x=>x,siteAt:()=>null};
 tacticalGoal(room,p);assert.equal(p.botAI.phase,'gather');now+=4300;tacticalGoal(room,p);assert.equal(p.botAI.phase,'advance');
});
