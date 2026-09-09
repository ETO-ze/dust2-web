import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { WebSocket } from 'ws';
import { startGameServer } from '../server/index.js';
import { AGENT_CATALOG, DEFAULT_AGENT_IDS, getAgent, normalizeAgentLoadout } from '../shared/agents.js';
import { rayHitPlayer, directionFromAngles } from '../server/game.js';

async function peer(port){
  const socket=new WebSocket(`ws://127.0.0.1:${port}/ws`),messages=[],listeners=new Set();let number=0;
  socket.on('message',raw=>{messages.push({number:++number,value:JSON.parse(raw)});for(const fn of listeners)fn();});
  await once(socket,'open');
  return {socket,lastEquip:0,mark:()=>number,send:value=>socket.send(JSON.stringify(value)),waitFor(predicate,after=0){
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{listeners.delete(check);reject(Error('Agent WebSocket timeout'));},4000);
      function check(){const found=messages.find(m=>m.number>after&&predicate(m.value));if(!found)return;clearTimeout(timer);listeners.delete(check);resolve(found.value);}
      listeners.add(check);check();
    });
  }};
}
async function equip(peer,agent,extra={}){
  await delay(Math.max(0,peer.lastEquip+280-Date.now()));const after=peer.mark();peer.lastEquip=Date.now();
  peer.send({type:'equipAgent',agent,...extra});
  const response=await peer.waitFor(m=>m.type==='agentEquipped'||m.type==='error',after);
  // Pace from the acknowledgement: a busy test runner can delay delivery long
  // enough that two send timestamps 280 ms apart still arrive inside the limit.
  peer.lastEquip=Date.now();return response;
}
const playerIn=(message,id)=>message.players?.find(p=>p.id===id);
const waitPlayer=(peer,id,predicate,after=0)=>peer.waitFor(m=>m.type==='snapshot'&&playerIn(m,id)&&predicate(playerIn(m,id)),after);

test('agent catalog has stable side-specific defaults and rejects path or wrong-team substitutions',()=>{
  assert.equal(AGENT_CATALOG.length,4);assert.equal(new Set(AGENT_CATALOG.map(a=>a.id)).size,4);
  assert.deepEqual(DEFAULT_AGENT_IDS,{CT:'ct-sas',T:'t-phoenix'});
  for(const team of ['CT','T']){
    const agents=AGENT_CATALOG.filter(a=>a.team===team);assert.equal(agents.length,2);assert.equal(agents.filter(a=>a.isDefault).length,1);
  }
  assert.deepEqual(normalizeAgentLoadout({CT:'ct-ava',T:'t-miami'}),{CT:'ct-ava',T:'t-miami'});
  for(const invalid of [null,[],{CT:'t-miami',T:'ct-ava'},{CT:'../agent.glb',T:'https://invalid.example/agent.glb'},{CT:{toString:null},T:'__proto__'}])assert.deepEqual(normalizeAgentLoadout(invalid),DEFAULT_AGENT_IDS);
  assert.equal(getAgent('__proto__'),undefined);assert.equal(getAgent({toString:null}),undefined);
});

test('agent cosmetics synchronize through real sockets without changing authoritative gameplay',{timeout:20000},async t=>{
  const app=await startGameServer({port:0,host:'127.0.0.1'}),peers=[];
  t.after(async()=>{for(const p of peers)p.socket.terminate();await app.close();});
  async function join(settings){const p=await peer(app.port);peers.push(p);p.send({type:'join',name:'Agent QA',room:'AGENTQA',mode:'deathmatch',bots:0,...settings});p.welcome=await p.waitFor(m=>m.type==='welcome');return p;}
  const selected={CT:'ct-ava',T:'t-miami'},owner=await join({team:'T',agents:selected}),observer=await join({team:'CT',agents:selected});
  const room=app.rooms.get('AGENTQA'),player=room.players.get(owner.welcome.id),other=room.players.get(observer.welcome.id);

  await t.test('join chooses the assigned side and another client sees the chosen model ID',async()=>{
    for(const p of [owner,observer]){const snap=await waitPlayer(p,player.id,state=>state.agentId==='t-miami');assert.equal(playerIn(snap,player.id).team,'T');}
    await waitPlayer(owner,other.id,state=>state.agentId==='ct-ava');assert.deepEqual(player.agents,selected);assert.deepEqual(other.agents,selected);
    const bad=await join({room:'AGENTBAD',team:'CT',agents:{CT:'t-miami',T:'../../assets/a.glb'}});
    await waitPlayer(bad,bad.welcome.id,state=>state.agentId==='ct-sas');
    assert.deepEqual(app.rooms.get('AGENTBAD').players.get(bad.welcome.id).agents,DEFAULT_AGENT_IDS);
  });

  await t.test('equip ACK and broadcast change only appearance, preserving ammo, health, armor and hit geometry',async()=>{
    player.inventory.ak47={ammo:13,reserve:61};player.health=77;player.armor=42;player.money=1234;
    const inventory=structuredClone(player.inventory),before={health:player.health,armor:player.armor,money:player.money,kills:player.kills,deaths:player.deaths,team:player.team};
    const hit=()=>rayHitPlayer({x:player.x,y:player.y+1,z:player.z+5},directionFromAngles(0,0),player);
    const beforeHit=hit(),mark=observer.mark();
    const ack=await equip(owner,'t-phoenix',{health:999,armor:999,money:999,team:'CT',playerId:other.id,model:'https://invalid.example/agent.glb'});
    assert.equal(ack.type,'agentEquipped');assert.equal(ack.agent,'t-phoenix');assert.equal(ack.team,'T');
    const snapshot=await waitPlayer(observer,player.id,p=>p.agentId==='t-phoenix',mark),p=playerIn(snapshot,player.id);
    assert.deepEqual({health:p.health,armor:p.armor,money:p.money,kills:p.kills,deaths:p.deaths,team:p.team},before);
    assert.deepEqual(player.inventory,inventory);assert.deepEqual(hit(),beforeHit);assert.equal(other.agentId,'ct-ava');
  });

  await t.test('live updates reject opposite-side agents, unknown IDs, objects and arbitrary locations',async()=>{
    const before=player.agentId,loadout=structuredClone(player.agents);
    for(const agent of ['ct-ava','ct-sas','missing-agent','https://invalid.example/a.glb','../public/agent.glb','__proto__',{toString:null}]){
      const response=await equip(owner,agent);assert.equal(response.type,'error');assert.equal(response.code,'AGENT_REJECTED');
      assert.equal(player.agentId,before);assert.deepEqual(player.agents,loadout);
    }
    const accepted=await equip(owner,'t-miami');assert.equal(accepted.type,'agentEquipped');
  });

  await t.test('rapid repeated equipment messages cannot overwrite the acknowledged selection',async()=>{
    await delay(Math.max(0,owner.lastEquip+280-Date.now()));const mark=owner.mark();owner.lastEquip=Date.now();
    owner.send({type:'equipAgent',agent:'t-phoenix'});owner.send({type:'equipAgent',agent:'t-miami'});
    const ack=await owner.waitFor(m=>m.type==='agentEquipped',mark),error=await owner.waitFor(m=>m.type==='error',mark);
    assert.equal(ack.agent,'t-phoenix');assert.equal(error.code,'AGENT_RATE');assert.equal(player.agentId,'t-phoenix');
  });

  await t.test('position input cannot forge agent choice, and death and respawn preserve appearance',async()=>{
    const mark=owner.mark();owner.send({type:'input',seq:1,forward:0,right:0,yaw:0,pitch:0,agentId:'ct-ava',agents:{T:'t-miami'},health:999});
    await waitPlayer(owner,player.id,p=>p.seq>=1,mark);assert.equal(player.agentId,'t-phoenix');assert.equal(player.agents.T,'t-phoenix');
    room.kill(player,other,'m4a1');await waitPlayer(observer,player.id,p=>!p.alive&&p.agentId==='t-phoenix',observer.mark());
    player.respawnAt=Date.now()-1;await waitPlayer(observer,player.id,p=>p.alive&&p.agentId==='t-phoenix',observer.mark());
    assert.equal(player.health,100);assert.equal(player.agents.CT,'ct-ava');
  });

  await t.test('saved per-team loadouts can be reused on a new join and bots retain team defaults',async()=>{
    const next=await join({room:'AGENTNEW',team:'CT',agents:player.agents,bots:2});
    const snapshot=await waitPlayer(next,next.welcome.id,p=>p.agentId==='ct-ava');
    for(const bot of snapshot.players.filter(p=>p.bot))assert.equal(bot.agentId,DEFAULT_AGENT_IDS[bot.team]);
  });
});
