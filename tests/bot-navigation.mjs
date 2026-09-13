import test from 'node:test';
import assert from 'node:assert/strict';
import {BoxGeometry} from 'three';
import {initPhysics,createPlayerState,stepPlayer} from '../shared/physics.js';
import {recoverNavigation} from '../server/bot-navigation.js';
import {GameRoom} from '../server/game.js';
import {botUtility} from '../server/bot-utility.js';
import {BOT_LINEUPS} from '../server/bot-lineups.js';
const box=(x,y,z,w,h,d)=>{const g=new BoxGeometry(w,h,d).toNonIndexed();g.translate(x,y,z);const a=Array.from(g.attributes.position.array);g.dispose();return a;};
function fixture(){initPhysics([...box(0,-.5,0,60,1,60),...box(0,2,-2,2,4,1)]);let now=10000;
 const p={...createPlayerState({z:-1.19}),team:'T',grounded:true,botAI:{path:[{x:0,y:0,z:-5,navId:'b',fromNavId:'a'}],wantMove:true,stuckAt:now}};
 const room={clock:()=>now,bomb:{state:'carried'}};return {room,p,advance:ms=>now+=ms};}
test('blocked movement triggers a physical escape and temporarily avoids the failed edge without teleporting',()=>{
 const {room,p,advance}=fixture();assert.equal(recoverNavigation(room,p),false);const start={x:p.x,y:p.y,z:p.z};advance(2300);
 assert.equal(recoverNavigation(room,p),true);assert.deepEqual({x:p.x,y:p.y,z:p.z},start);assert.ok(p.botAI.escape);assert.ok(p.botAI.blockedEdges.get('a>b')>room.clock());assert.equal(p.botAI.recoveries,1);
 const goal=p.botAI.escape,yaw=Math.atan2(-(goal.x-p.x),-(goal.z-p.z));for(let i=0;i<40;i++)stepPlayer(p,{forward:1,yaw,crouch:true,jump:i<2},1/30);
 assert.ok(Math.hypot(p.x-start.x,p.z-start.z)>.5);assert.ok(p.y>-1);
});
test('intentional guarding, objective use and combat never trigger a navigation escape',()=>{
 for(const state of ['guard','objective','combat','throw','freeze']){const {room,p,advance}=fixture();if(state==='guard')p.botAI.wantMove=false;if(state==='objective')p.objectiveLocked=true;if(state==='combat')p.botAI.engaging=true;if(state==='throw')p.botAI.utility={phase:'ready'};if(state==='freeze')room.round={phase:'freeze'};
  recoverNavigation(room,p);advance(10000);assert.equal(recoverNavigation(room,p),false,state);assert.equal(p.botAI.recoveries,undefined,state);
 }
});
test('pathfinding routes around a blocked edge and reports disconnected goals instead of parking at the start',()=>{
 const r=new GameRoom('PATH',{bots:0,clock:()=>10000});r.nav=[{id:'a',x:0,y:0,z:0,neighbors:['b','c']},{id:'b',x:0,y:0,z:-3,neighbors:['d']},{id:'c',x:3,y:0,z:-3,neighbors:['d']},{id:'d',x:0,y:0,z:-6,neighbors:[]}];r.navMap=new Map(r.nav.map(n=>[n.id,n]));
 const p={...r.nav[0],botAI:{blockedEdges:new Map([['a>b',30000]])}};assert.equal(r.planPath(p,r.nav[3])[0].navId,'c');p.botAI.blockedEdges.set('a>c',30000);assert.deepEqual(r.planPath(p,r.nav[3]),[]);
});
test('a timed-out lineup is suppressed on that bot rather than immediately claiming it again',()=>{
 const s=BOT_LINEUPS.find(s=>s.weapon==='smokegrenade'&&s.team==='T');let now=10000;
 const p={...s.stand,id:'b_1',team:'T',alive:true,inventory:{ak47:{ammo:30,reserve:90},smokegrenade:{ammo:1}},botAI:{site:s.site,lane:s.lane,lastSeenAt:0,utility:{...s,key:'T:'+s.id,expiresAt:9000,phase:'approach'}}};
 const room={clock:()=>now,mode:'defuse',bomb:{state:'carried'},round:{phase:'live',phaseEndsAt:200000},players:new Map([[p.id,p]]),utilityClaims:new Map([['T:'+s.id,p.id]]),grenades:{smokes:[],clearSight:()=>true},cancelGrenade(){},planPath:(_,g)=>[g]};
 botUtility(room,p,{forward:0,right:0},1/30);assert.equal(p.botAI.utility,null);assert.ok(p.botAI.utilityFailures.get(s.id)>100000);now+=3000;
 botUtility(room,p,{forward:0,right:0},1/30);assert.notEqual(p.botAI.utility?.id,s.id);assert.equal(p.inventory.smokegrenade.ammo,1);
});
