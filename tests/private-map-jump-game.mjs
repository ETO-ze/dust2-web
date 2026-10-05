import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {loadPrivateMapRuntime} from '../server/private-map-runtime.js';
import {createPlayerState} from '../shared/physics.js';
import {MIRAGE_JUMP_LINKS} from '../shared/private-map-jump-links.js';
const directory=process.env.DUSTII_PRIVATE_MAP_DIRECTORY;
const available=directory&&fs.existsSync(directory+'/compiled/map.json')&&JSON.parse(fs.readFileSync(directory+'/compiled/map.json')).id==='de_mirage';

test('Mirage bot traverses both shortcut chains with normal GameRoom input, smooth aim and a real vent shot',{skip:!available},async()=>{
 const context=loadPrivateMapRuntime(directory),{GameRoom}=await import('../server/game.js');const results=[];
 for(const links of [MIRAGE_JUMP_LINKS.slice(0,2),MIRAGE_JUMP_LINKS.slice(2)]){
  let now=100000;const room=new GameRoom('BOTJUMP',{mode:'deathmatch',bots:1,privateMap:context,clock:()=>now}),human=room.addHuman({},{team:'T',name:'Input QA'}),bot=[...room.players.values()].find(p=>p.bot),ai=room.privateBots;
  human.protectionUntil=Infinity;const start=context.graph.nodes.get(links[0].navFrom),end=context.graph.nodes.get(links.at(-1).navTo);Object.assign(bot,createPlayerState(start),{grounded:true});
  ai.refresh();const order=ai.director.orders.get(bot.id),path=[start,...links.map(l=>context.graph.nodes.get(l.navTo))];Object.assign(order,{goal:end,route:path,role:'trade',state:'rotate',revision:999});ai.director.nextReview=Infinity;
  const state=ai.state(bot);Object.assign(state,{revision:999,goal:end,path,index:0});let maxTurn=0;
  for(let tick=0;tick<30*25;tick++){
   now+=1000/30;const yaw=bot.yaw;room.tick(1/30);maxTurn=Math.max(maxTurn,Math.abs(Math.atan2(Math.sin(bot.yaw-yaw),Math.cos(bot.yaw-yaw))));
   if(ai.stats.jumpLinksCompleted===links.length&&state.index>=path.length-1)break;
  }
  assert.equal(ai.stats.jumpLinksCompleted,links.length,links.map(l=>l.id).join(' -> '));assert.equal(ai.stats.routeFailures,0);assert.ok(maxTurn<=3.6/30+.00001);assert.ok(Math.hypot(bot.x-end.x,bot.y-end.y,bot.z-end.z)<.5);assert.ok(bot.grounded);
  if(links.some(l=>l.requiresBroken)){assert.ok(room.mapBreakables.broken.has('mirage-ladder-vent'));assert.ok(room.events.some(e=>e.type==='map_breakable_broken'&&e.actorId===bot.id));assert.ok(ai.stats.shots>0);}
  results.push({links:links.map(l=>l.id),completed:ai.stats.jumpLinksCompleted,routeFailures:ai.stats.routeFailures,maxTurn,shots:ai.stats.shots,broken:[...room.mapBreakables.broken]});
 }
 console.log('private-map-bot-jumps',JSON.stringify(results));
});
