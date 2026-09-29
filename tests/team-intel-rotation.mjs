import test from 'node:test';
import assert from 'node:assert/strict';
import {MAP} from '../shared/map-data.js';
import {reportSiteThreat,rotationSite} from '../server/bot-alerts.js';
import {updateTeamVision,shareSighting} from '../server/team-intel.js';
import {hearGunshot,lookAt} from '../server/bot-perception.js';
import {eyePosition} from '../shared/aim.js';
import {tacticalGoal} from '../server/bot-tactics.js';

function fixture(){
 let now=100000;
 const bots=['anchor-a','anchor-b','mid','rotator'].map((role,i)=>({id:'b'+i,seat:i,bot:true,alive:true,team:'CT',weapon:'usp',...MAP.sites[role.endsWith('-b')?'B':'A'],botAI:{defenseRole:role,lastSeenAt:0}}));
 const human={id:'human',alive:true,team:'CT',weapon:'usp',...MAP.sites.A};
 const enemies=[0,1,2].map(i=>({id:'e'+i,alive:true,team:'T',...MAP.sites.A,x:MAP.sites.A.x+i-1,z:MAP.sites.A.z-10,hasBomb:i===0}));
 Object.assign(human,lookAt(eyePosition(human),eyePosition(enemies[1])));
 const room={clock:()=>now,mode:'defuse',round:{phase:'live'},bomb:{state:'carried'},visibleToBot:()=>true,players:new Map([...bots,human,...enemies].map(p=>[p.id,p]))};
 return {room,bots,human,enemies,advance(ms){now+=ms;}};
}

test('human witnessed A execute releases the sole B anchor before a plant, without target locks',()=>{
 const f=fixture();updateTeamVision(f.room);f.advance(3100);
 assert.equal(rotationSite(f.room,f.bots[1]),'A');assert.equal(f.room.bomb.state,'carried');
 assert.equal(f.room.botAlerts.A.contacts.size,3);
 assert.ok(f.bots.every(p=>!p.botAI.targetId));assert.equal(rotationSite(f.room,f.human),null);
 // Last known position is copied, not updated when the unseen enemy moves.
 const old={...f.room.teamSightings.CT.get('e0')};f.enemies[0].x+=30;
 assert.deepEqual(f.room.teamSightings.CT.get('e0'),old);
});

test('weak single contact and sound keep the remote anchor; two confirmed attackers release it',()=>{
 const f=fixture();reportSiteThreat(f.room,'CT',MAP.sites.A,'contact',{enemyId:'one'});f.advance(3100);
 assert.equal(rotationSite(f.room,f.bots[1]),null);
 reportSiteThreat(f.room,'CT',MAP.sites.A,'contact',{enemyId:'two'});f.advance(1600);
 assert.equal(rotationSite(f.room,f.bots[1]),null); // Four allies already cover two enemies.
 f.bots[2].alive=false;
 assert.equal(rotationSite(f.room,f.bots[1]),'A');
 const sound=fixture();for(let i=0;i<21;i++){reportSiteThreat(sound.room,'CT',MAP.sites.A);sound.advance(500);}
 assert.equal(rotationSite(sound.room,sound.bots[1]),null);
});

test('strong B execute releases the A anchor too, but recent combat and contested opposite sites stay protected',()=>{
 const f=fixture();for(const id of ['one','two','three'])reportSiteThreat(f.room,'CT',MAP.sites.B,'contact',{enemyId:id});f.advance(3100);
 assert.equal(rotationSite(f.room,f.bots[0]),'B');
 f.bots[0].botAI.engaging=true;assert.equal(rotationSite(f.room,f.bots[0]),null);f.bots[0].botAI.engaging=false;
 reportSiteThreat(f.room,'CT',MAP.sites.A,'contact',{enemyId:'lurker'});f.advance(1600);
 assert.equal(rotationSite(f.room,f.bots[0]),null);
});

test('blocked, blind, rear-facing, dead and scoped-out human views do not create reports',()=>{
 const cases=[f=>f.room.visibleToBot=()=>false,f=>f.human.flashBlindUntil=200000,f=>f.human.yaw+=Math.PI,f=>f.human.pitch=-1.4,f=>f.human.alive=false,f=>{f.human.weapon='awp';f.human.zoomLevel=2;f.human.yaw+=.3;}];
 for(const mutate of cases){const f=fixture();mutate(f);updateTeamVision(f.room);assert.equal(f.room.botAlerts,undefined);}
});

test('human-controlled bot can report contact but never receives autonomous orders',()=>{
 const f=fixture();f.human.bot=true;f.human.controllerId='dead-player';f.human.botAI={defenseRole:'anchor-a'};
 updateTeamVision(f.room);f.advance(3100);
 assert.equal(rotationSite(f.room,f.bots[1]),'A');assert.equal(rotationSite(f.room,f.human),null);
});

test('shots heard by a human share only an approximate site alarm, never unseen bomb or target info',()=>{
 const f=fixture();for(const bot of f.bots)Object.assign(bot,{x:100,y:0,z:100});
 hearGunshot(f.room,f.enemies[0]);assert.ok(f.room.botAlerts.A);assert.equal(f.room.botAlerts.A.contactAt,null);
 assert.equal(f.room.botAlerts.A.contacts,undefined);assert.equal(f.room.teamSightings,undefined);
});

test('expired visual evidence is not upgraded by continuous sound; route commitment expires',()=>{
 const f=fixture();updateTeamVision(f.room);f.advance(3100);assert.equal(rotationSite(f.room,f.bots[1]),'A');
 for(let i=0;i<20;i++){f.advance(1000);reportSiteThreat(f.room,'CT',MAP.sites.A);}
 assert.equal(rotationSite(f.room,f.bots[1]),null);
});

test('one enemy reported by several observers is counted once, and cannot occupy two sites',()=>{
 const f=fixture();for(const p of [f.human,...f.bots])shareSighting(f.room,p,f.enemies[1]);
 assert.equal(f.room.botAlerts.A.contacts.size,1);
 Object.assign(f.enemies[1],MAP.sites.B);shareSighting(f.room,f.human,f.enemies[1]);
 assert.equal(f.room.botAlerts.A.contacts.size,0);assert.equal(f.room.botAlerts.B.contacts.size,1);
});

test('human vision checks are rate bounded and skip rooms without automated CT defenders',()=>{
 const f=fixture();let rays=0;f.room.visibleToBot=()=>{rays++;return true;};
 updateTeamVision(f.room);assert.equal(rays,3);for(let i=0;i<6;i++){f.advance(30);updateTeamVision(f.room);}assert.equal(rays,3);
 f.advance(20);updateTeamVision(f.room);assert.equal(rays,6);
 for(const p of f.bots)p.controllerId='someone';f.advance(200);updateTeamVision(f.room);assert.equal(rays,6);
});

test('a brief fight on a rotation keeps the reinforcement destination rather than returning home',()=>{
 const f=fixture(),p=f.bots[1],{x,y,z}=MAP.sites.A,goal={x,y,z};
 Object.assign(p.botAI,{phase:'rotate',goal,lastSeenAt:f.room.clock(),engaging:true});
 assert.deepEqual(tacticalGoal(f.room,p),goal);assert.equal(p.botAI.phase,'rotate');
 p.botAI.engaging=false;f.advance(1800);assert.deepEqual(tacticalGoal(f.room,p),goal);
});
