import test from 'node:test';
import assert from 'node:assert/strict';
import {hearNoise,hearingPoint,movementNoise,hearEvent} from '../server/bot-hearing.js';
import {observationPoint} from '../server/bot-perception.js';
function fixture(){let now=10000,blocked=false;const shooter={id:'t',team:'T',alive:true,x:10,y:0,z:0,lifeId:1,weapon:'ak47',vx:5,vz:0,grounded:true};const listener={id:'ct',team:'CT',bot:true,alive:true,x:0,y:0,z:0,botAI:{},yaw:0,weapon:'m4a1'};const human={...listener,id:'human',bot:false,botAI:{}},taken={...listener,id:'taken',controllerId:'human',botAI:{}};const reports=[];const room={mode:'defuse',round:{phase:'live'},botDifficulty:'normal',clock:()=>now,players:new Map([shooter,listener,human,taken].map(p=>[p.id,p])),privateBots:{world:{clearSight:()=>!blocked},perception:{publish:(team,r)=>reports.push({team,...r})}}};return{room,shooter,listener,human,taken,reports,advance:ms=>now+=ms,wall:()=>blocked=true};}
test('heard gunfire becomes a delayed uncertain aiming direction, without exposing a target identity or controlling a human',()=>{
 const f=fixture();hearEvent(f.room,'shot',{shooterId:'t',weapon:'ak47'});assert.equal(hearingPoint(f.room,f.listener),null);const ready=f.listener.botAI.heardReadyAt;f.advance(100);hearNoise(f.room,f.shooter);assert.equal(f.listener.botAI.heardReadyAt,ready);
 f.shooter.x=35;f.advance(150);const point=observationPoint(f.room,f.listener);assert.equal(point.x,10);assert.equal(point.y,1.62);assert.equal(f.listener.botAI.action,'check-gunshot');assert.equal(f.human.botAI.heardPoint,undefined);assert.equal(f.taken.botAI.heardPoint,undefined);assert(f.reports.every(r=>r.enemyId===null));f.advance(3100);assert.equal(hearingPoint(f.room,f.listener),null);
});
test('cover attenuates sound range and flash interrupts the check; decoys can mislead both sides',()=>{
 const f=fixture();f.wall();f.shooter.x=35;assert.deepEqual(hearNoise(f.room,f.shooter),[]);f.shooter.x=12;assert(hearNoise(f.room,f.shooter).includes('ct'));assert.equal(f.listener.botAI.heardUncertainty,4);f.advance(250);f.listener.flashBlindUntil=12000;assert.equal(hearingPoint(f.room,f.listener),null);
 hearEvent(f.room,'decoy_pulse',{origin:{x:12,y:1,z:0}});assert(f.reports.some(r=>r.team==='T'&&r.sound==='decoy'));
});
test('actual running makes footsteps while walking, crouching, spawn and teleport remain silent',()=>{
 const f=fixture(),run=(input={},count=18)=>{for(let i=0;i<count;i++){f.shooter.x+=.11;f.advance(34);movementNoise(f.room,f.shooter,input);}};
 movementNoise(f.room,f.shooter,{});assert.equal(f.listener.botAI.heardPoint,undefined);run({walk:true});assert.equal(f.listener.botAI.heardPoint,undefined);f.shooter.crouch=true;run();assert.equal(f.listener.botAI.heardPoint,undefined);f.shooter.crouch=false;run();assert.equal(f.listener.botAI.heardKind,'footstep');
 const heard=f.listener.botAI.heardCount;f.shooter.x+=100;movementNoise(f.room,f.shooter,{});assert.equal(f.listener.botAI.heardCount,heard);
});
