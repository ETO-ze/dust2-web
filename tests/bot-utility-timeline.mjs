import test from 'node:test';
import assert from 'node:assert/strict';
import {BotUtilityTimeline} from '../server/bot-utility-timeline.js';
import {GameRoom} from '../server/game.js';
const player=(id='support',team='T',site='A',lane='short')=>({id,bot:true,alive:true,team,botAI:{site,lane}});
function fixture(){let now=1000;const p=player(),players=new Map([[p.id,p]]),t=new BotUtilityTimeline(()=>now);return{p,players,t,advance:ms=>now+=ms,throw:(id,weapon)=>t.observe('grenade_thrown',{grenadeId:id,shooterId:p.id,weapon},players)};}
test('actual smoke bloom gates flash, actual flash detonation gates entry',()=>{
 const f=fixture();f.throw('smoke','smokegrenade');assert.equal(f.t.canPrime(f.p,'flashbang'),false);assert.equal(f.t.entryHold(f.p),true);
 f.t.observe('smoke',{grenadeId:'smoke',duration:18},f.players);assert.equal(f.t.canPrime(f.p,'flashbang'),true);assert.equal(f.t.entryHold(f.p),false);
 f.throw('flash','flashbang');assert.equal(f.t.entryHold(f.p),true);f.advance(1600);f.t.observe('flash',{grenadeId:'flash'},f.players);assert.equal(f.t.entryHold(f.p),true);f.advance(210);assert.equal(f.t.entryHold(f.p),false);
});
test('unresolved effects expire, missing smoke never traps entry or flash',()=>{
 const f=fixture();assert.equal(f.t.canPrime(f.p,'flashbang'),true);f.throw('smoke','smokegrenade');f.advance(6501);assert.equal(f.t.canPrime(f.p,'flashbang'),true);assert.equal(f.t.entryHold(f.p),false);assert.equal(f.t.items.size,0);
});
test('other lane, site, enemies and controlled bots never gate the local squad',()=>{
 const f=fixture();f.throw('s','smokegrenade');for(const p of [player('b','CT'),player('b','T','B'),player('b','T','A','long')])assert.equal(f.t.coverPending(p),false);
 f.t.clear();f.p.controllerId='human';f.throw('owned','smokegrenade');assert.equal(f.t.items.size,0);delete f.p.controllerId;f.p.bot=false;f.throw('human','smokegrenade');assert.equal(f.t.items.size,0);
});
test('authoritative room events feed the timeline; new rounds clear it without extra snapshot data',()=>{
 const r=new GameRoom('TIMELINE',{bots:1,mode:'defuse',clock:()=>1000});r.addHuman({},{name:'QA',team:'CT'});const bot=[...r.players.values()].find(p=>p.bot);bot.botAI={site:'A',lane:'short'};
 r.emit('grenade_thrown',{grenadeId:'real',shooterId:bot.id,weapon:'smokegrenade'});assert.equal(r.botUtilityTimeline.coverPending(bot),true);
 r.emit('smoke',{grenadeId:'real',duration:18});assert.equal(r.botUtilityTimeline.coverPending(bot),false);r.startRound();assert.equal(r.botUtilityTimeline.items.size,0);
 assert.equal(JSON.stringify(r.snapshot()).includes('botUtilityTimeline'),false);
});
