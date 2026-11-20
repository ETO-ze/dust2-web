import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { startGameServer } from '../server/index.js';
import { queryRoomAppearance,queryRoomSkins,preloadRoomSkins,prepareRoomWeapons,readRoomAppearance,reserveWarmIds } from '../client/room-skin-preload.js';
import { getSkin, SKINS } from '../shared/skins.js';

test('real preflight lists active and dropped finishes without joining, then real client uses the cached manifest', async t => {
  const server=await startGameServer({port:0,host:'127.0.0.1'});
  const url='ws://127.0.0.1:'+server.port+'/ws';
  const owner=new WebSocket(url);
  t.after(async()=>{owner.terminate();await server.close();});
  await once(owner,'open');
  const welcome=once(owner,'message');
  owner.send(JSON.stringify({type:'join',name:'Skin test',room:'SKIN71',team:'T',primary:'ak47',mode:'deathmatch',bots:0,agents:{T:'t-miami'},skins:{ak47:'ak47-studio-tideline'}}));
  assert.equal(JSON.parse((await welcome)[0]).type,'welcome');
  const room=server.rooms.get('SKIN71');
  const player=[...room.players.values()][0];
  const unowned=SKINS.find(s=>s.weapon==='awp'&&!s.isDefault);
  player.skins.awp=unowned.id;
  player.weaponLoadout={T:{rifles:['awp']}};
  room.droppedWeapons.drop([...room.players.values()][0],{weaponId:'knife',skinId:'m9-vanilla',ammo:0,reserve:0});
  const ids=await queryRoomSkins(url,'SKIN71',{Socket:WebSocket});
  assert(ids.includes('ak47-wild-lotus'));assert(!ids.includes('ak47-studio-tideline'));assert(ids.includes('m9-vanilla'));
  assert(ids.every(id=>getSkin(id)));
  const appearance=await queryRoomAppearance(url,'SKIN71',{Socket:WebSocket});
  assert.deepEqual(appearance.agentIds,['t-miami']);
  assert.deepEqual(appearance.skinIds,ids);
  assert.deepEqual(appearance.activeSkinIds,['ak47-wild-lotus']);
  assert(!appearance.carriedSkinIds.includes('m9-vanilla'),'dropped knife is cached but does not take up a reserve decode slot');
  assert.equal(appearance.mode,'deathmatch');
  assert.equal(ids[0],appearance.activeSkinIds[0]);
  assert(!ids.includes(unowned.id));
  assert.equal(room.humanCount,1);assert.equal(server.rooms.size,1);
  await assert.rejects(queryRoomSkins(url,'NOSUCH',{Socket:WebSocket}),/房间/);
  assert.equal(server.rooms.size,1);
  const cached=new Set(),network=[];
  const deps={pageURL:'https://example.test/game/',saved:async hash=>cached.has(hash),fetchAsset:async(url,options)=>{
    assert(url.pathname.startsWith('/game/assets/weapons/'));
    network.push(options.sha256);
    options.onProgress({fromCache:false,cached:true});
    cached.add(options.sha256);return new Response();
  }};
  // Old and migrated loadouts share a single verified model before joining.
  const result=await preloadRoomSkins([...ids,'ak47-studio-tideline'],deps);
  assert.equal(new Set(network).size,network.length);
  assert(network.includes(getSkin('m9-vanilla').animation.sha256));
  assert(result.downloadBytes>0);
  const repeated=await preloadRoomSkins(ids,deps);
  assert.equal(repeated.downloadBytes,0);assert.equal(repeated.cached,result.total);
  const cancelled=AbortSignal.abort();
  await assert.rejects(preloadRoomSkins(ids,{...deps,signal:cancelled}),{name:'AbortError'});

  const joiner=new WebSocket(url);
  t.after(()=>joiner.terminate());
  await once(joiner,'open');
  const join={type:'join',room:'SKIN71',existing:true,name:'New player',team:'CT',appearanceRevision:appearance.revision};
  room.giveWeapon(player,'awp');player.weapon='awp';player.slot=1;
  let next=once(joiner,'message');
  joiner.send(JSON.stringify(join));
  const changed=JSON.parse((await next)[0]);
  assert.equal(changed.type,'roomCosmeticsChanged');
  assert(changed.activeSkinIds.includes(unowned.id));
  assert.equal(room.humanCount,1);
  next=once(joiner,'message');
  joiner.send(JSON.stringify({...join,appearanceRevision:changed.revision}));
  assert.equal(JSON.parse((await next)[0]).type,'welcome');
  assert.equal(room.humanCount,2);
});

test('reserve decoding has separate phone and desktop budgets and excludes visible weapons',()=>{
  const carried=SKINS.filter(s=>s.bytes<4*1024*1024).slice(0,15).map(s=>s.id);
  const active=carried.slice(0,2);
  for(const mobile of [true,false]){
    const warm=reserveWarmIds([...carried,...carried],active,mobile);
    assert(warm.length>0 && warm.length<=(mobile?1:4));
    assert(warm.every(id=>!active.includes(id)));
    assert.equal(new Set(warm).size,warm.length);
    assert(warm.reduce((sum,id)=>{const s=getSkin(id);return sum+s.bytes+(s.animation?.bytes||0);},0)<=(mobile?4:12)*1024*1024);
  }
});

test('preparation decodes visible weapons first, fetches carried files once and skips completed work on refresh',async()=>{
  const a=getSkin('ak47-wild-lotus'), b=getSkin('m9-vanilla'), c=getSkin('ak47-vulcan');
  const prepared={hands:new Set(),files:new Set()},order=[];
  const opts={prepared,signal:new AbortController().signal,warm:async id=>{order.push(id);},
    preload:async(ids,{readyHashes})=>{order.push(ids);assert(readyHashes.has(a.sha256));return {total:ids.length};}};
  await prepareRoomWeapons({...opts,active:[a.id,a.id],carried:[a.id,b.id,c.id]});
  assert.deepEqual(order,[a.id,[b.id,c.id]]);
  order.length=0;
  await prepareRoomWeapons({...opts,active:[b.id,a.id],carried:[a.id,b.id,c.id]});
  assert.deepEqual(order,[b.id,[]]);
  const controller=new AbortController();
  const incomplete={hands:new Set(),files:new Set()};
  await assert.rejects(prepareRoomWeapons({...opts,active:[b.id,c.id],carried:[],prepared:incomplete,signal:controller.signal,warm:()=>controller.abort()}),{name:'AbortError'});
  assert.equal(incomplete.hands.size,0);
  assert.deepEqual(readRoomAppearance({skinIds:[a.id,'bad'],activeSkinIds:[b.id,'bad',a.id,a.id]}).activeSkinIds,[a.id]);
});

test('retired finishes always resolve to an approved Valve model on the original weapon',()=>{
  for(const [id,weapon] of [['ak47-studio-tideline','ak47'],['m4a1-studio-porcelain','m4a1'],['awp-studio-aurora','awp'],['pistol-studio-ember','pistol'],['usp-studio-inkwash','usp'],['m4a4-studio-gridlight','m4a4'],['mp9-studio-neon-mint','mp9'],['deagle-studio-sunstone','deagle']]){
    const skin=getSkin(id);
    assert.equal(skin.weapon,weapon);assert.ok(skin.paintkit>0);assert.ok(!skin.id.includes('-studio-'));
    assert.ok(SKINS.includes(skin));
  }
  assert.ok(SKINS.every(s=>!s.baseId&&!s.id.includes('-studio-')));
});
