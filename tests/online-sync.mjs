import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import WebSocket from 'ws';
import {startGameServer} from '../server/index.js';
import {reportSiteThreat,rotationSite} from '../server/bot-alerts.js';
import {MAP} from '../shared/map-data.js';
import {RULES_VERSION,ASSET_VERSION,compatibilityError} from '../shared/online-build.js';
import {FramePacer} from '../shared/frame-pacer.js';
import {parseLayout,layoutRect} from '../shared/touch-layout.js';
import {connectionTarget} from '../client/connection-target.js';
function fixture(){
 let now=100000;const roles=['anchor-a','anchor-b','rotator','mid'];
 const bots=roles.map((role,i)=>({id:'b'+i,seat:i,bot:true,alive:true,team:'CT',...MAP.sites[role.endsWith('-b')?'B':'A'],botAI:{defenseRole:role,lastSeenAt:0}}));
 const human={id:'human',alive:true,bot:false,team:'CT',...MAP.sites.B};
 const room={clock:()=>now,mode:'defuse',round:{phase:'live'},bomb:{state:'carried'},players:new Map([...bots,human].map(p=>[p.id,p]))};
 reportSiteThreat(room,'CT',MAP.sites.B,'contact');now+=3100;return {room,bots,human};
}
test('mixed teams keep an actual bot anchor and use the human physical site for support',()=>{
 const {room,bots,human}=fixture();assert.equal(rotationSite(room,human),null);
 assert.equal(bots.filter(p=>rotationSite(room,p)==='B').length,1);
 assert.equal(rotationSite(room,bots[0]),null);
 Object.assign(human,MAP.sites.A);assert.equal(bots.filter(p=>rotationSite(room,p)==='B').length,2);
});
test('takeover, disconnect and side switches invalidate rotation allocation without controlling humans',()=>{
 const {room,bots,human}=fixture();Object.assign(human,MAP.sites.A);
 assert.equal(rotationSite(room,bots[2]),'B');bots[2].controllerId=human.id;
 assert.equal(rotationSite(room,bots[2]),null);assert.equal(rotationSite(room,bots[3]),'B');
 bots[0].team='T';assert.equal(rotationSite(room,bots[0]),null);
 // The remaining automated A defender must now stay instead of treating the human as its anchor.
 assert.equal(rotationSite(room,bots[3]),null);
 room.players.delete(human.id);delete bots[2].controllerId;
 assert.equal(bots.filter(p=>rotationSite(room,p)==='B').length,1);
});
test('frame caps select presentation frames only and recover after long idle',()=>{
 for(const rate of [30,60,90,120]){const p=new FramePacer();let count=0;for(let i=0;i<2400;i++)if(p.due(i*1000/240,rate))count++;
 assert.ok(Math.abs(count-rate*10)<=1);assert.equal(p.due(60000,rate),true);assert.equal(p.due(60000,rate),false);}
});
test('imported layouts are bounded, remain touchable and reject unsupported formats',()=>{
 const b=parseLayout('{"version":1,"buttons":{"fire":{"x":3,"y":-2,"size":0,"opacity":2}}}').buttons.fire;
 assert.deepEqual(b,{x:1,y:0,size:.65,opacity:1});
 const rect=layoutRect(b,{width:50,height:50},320,180);assert.equal(rect.width,44);assert.equal(rect.left,276);assert.equal(rect.top,0);
 assert.throws(()=>parseLayout('{"version":2}'));
});
test('installed Android and Windows use remote authority and the public invitation URL',()=>{
 for(const url of ['https://cs2.duskrain.cn/__installed__/index.html','http://127.0.0.1:27185/']){
 const c=connectionTarget(url,{mode:'online',bundledAssets:true,socketURL:'wss://cs2.duskrain.cn/ws'});
 assert.equal(c.socketURL,'wss://cs2.duskrain.cn/ws');assert.equal(c.offline,false);assert.equal(c.inviteBase,'https://cs2.duskrain.cn/');}
 assert.equal(compatibilityError({rulesVersion:RULES_VERSION,assetVersion:ASSET_VERSION}),null);
 assert.ok(compatibilityError({assetVersion:'old-map'}));
});
function message(ws,predicate){return new Promise((resolve,reject)=>{const t=setTimeout(()=>{ws.off('message',on);reject(Error('WS timeout'));},6000);function on(raw){const m=JSON.parse(raw);if(predicate(m)){clearTimeout(t);ws.off('message',on);resolve(m);}}ws.on('message',on);});}
async function join(port,settings={}){const ws=new WebSocket(`ws://127.0.0.1:${port}/ws`);await once(ws,'open');const pending=message(ws,m=>['welcome','error'].includes(m.type));ws.send(JSON.stringify({type:'join',name:'Online sync QA',bots:0,rulesVersion:RULES_VERSION,assetVersion:ASSET_VERSION,...settings}));return {ws,result:await pending};}
test('real sockets cover 1+9, mixed teams, 10 humans, private snapshots and rejected incompatible assets',{timeout:20000},async()=>{
 const app=await startGameServer({port:0,host:'127.0.0.1'}),clients=[];
 try{
 const first=await join(app.port,{bots:9,botDifficulty:'easy',team:'CT'});clients.push(first.ws);assert.equal(first.result.botDifficulty,'easy');
 const room=app.rooms.get(first.result.room);assert.equal(room.botCount,9);
 for(let i=1;i<10;i++){const c=await join(app.port,{room:room.code,existing:true,team:i%2?'T':'CT'});clients.push(c.ws);assert.equal(c.result.type,'welcome');assert.equal(c.result.botDifficulty,'easy');assert.equal(room.players.size,10);}
 assert.equal(room.humanCount,10);assert.equal(room.botCount,0);
 const snapshot=await message(first.ws,m=>m.type==='snapshot');assert.ok(snapshot.players.filter(p=>p.team==='T').every(p=>!('botBuy' in p)&&!('lossIncome' in p)&&!('botAI' in p)));
 const rejected=await join(app.port,{assetVersion:'incompatible'});clients.push(rejected.ws);assert.equal(rejected.result.type,'error');
 const pending=message(clients[1],m=>m.type==='error');clients[1].send(JSON.stringify({type:'setBotDifficulty',botDifficulty:'hard'}));assert.equal((await pending).code,'BOT_DIFFICULTY_REJECTED');
 clients[9].close();await once(clients[9],'close');await new Promise(r=>setTimeout(r,100));assert.equal(room.humanCount,9);assert.equal(room.botCount,1);
 }finally{for(const ws of clients)ws.terminate();await app.close();}
});
