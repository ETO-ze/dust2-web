import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {privateConfig,privateCompatibilityError,clientAssetManifest,privateMapMemoryReason} from '../client/private-game-config.js';
import {decodePrivateMapCollision} from '../shared/private-map-collision.js';
const sha=buffer=>crypto.createHash('sha256').update(buffer).digest('hex');
const signature='a'.repeat(64);
const config=()=>({private:true,id:'de_mirage',mapId:'de_mirage',mapSignature:signature,sourceSha256:signature,physicsSha256:signature,maskSha256:signature,policySha256:signature,navigationSha256:signature,metadataSha256:signature,jumpLinksSha256:signature,movementModel:'source-air-private-v1',
 metadataUrl:'maps/de_mirage/map.json',navUrl:'maps/de_mirage/nav.json',physicsUrl:'maps/de_mirage/physics.f32',maskUrl:'maps/de_mirage/physics-mask.u8',groupsUrl:'maps/de_mirage/physics-groups.json',policyUrl:'maps/de_mirage/entity-collision-policy.json',renderUrl:'/review/maps/de_mirage/render/map.gltf',socketPath:'ws'});
const page='https://cs2.example:8443/review/play/de_mirage/';

test('private client resolves only its own map and same-origin websocket under the isolated prefix',()=>{
 const c=privateConfig(config(),page);assert.equal(c.socketURL,'wss://cs2.example:8443/review/play/de_mirage/ws');
 assert.equal(c.metadataUrl,'https://cs2.example:8443/review/play/de_mirage/maps/de_mirage/map.json');
 assert.equal(new URL('../../../radars/',c.renderUrl).pathname,'/review/radars/');
 assert.throws(()=>privateConfig({...config(),renderUrl:'https://cs2.example/review/maps/de_mirage/render/map.gltf'},page),/资源地址/);
 assert.throws(()=>privateConfig({...config(),physicsUrl:'maps/de_dust2/physics.f32'},page),/资源地址/);
 assert.throws(()=>privateConfig({...config(),socketPath:'../../../ws'},page),/连接地址/);
 assert.throws(()=>privateConfig({...config(),navigationSha256:''},page),/签名/);
 assert.throws(()=>privateConfig({...config(),movementModel:'legacy'},page),/移动模型/);
 assert.throws(()=>privateConfig({...config(),jumpLinksSha256:''},page),/签名/);
});

test('welcome and snapshot require the map and collision identity, production stays unchanged',()=>{
 const c=config(),message={mapId:c.mapId,mapSignature:c.mapSignature,physicsSha256:c.physicsSha256};
 assert.equal(privateCompatibilityError(message,c),null);
 assert.match(privateCompatibilityError({...message,mapId:'de_dust2'},c),/地图/);
 assert.match(privateCompatibilityError({...message,physicsSha256:'b'.repeat(64)},c),/碰撞/);
 assert.equal(privateCompatibilityError({},null),null);
});

test('private base preload preserves weapons/audio and omits both legacy Dust II render and collision assets',()=>{
 const files=[['map','assets/map-cs2/dust2-web.gltf'],['collision','assets/physics.bin'],['interface','assets/valve-dust2/radar.png'],['weapons','assets/weapons/ak47.glb'],['audio','assets/audio/fire.mp3']].map(([group,path])=>({group,path,bytes:10}));
 const original={files,totalBytes:50};assert.equal(clientAssetManifest(original,false),original);
 const filtered=clientAssetManifest(original,true);assert.deepEqual(filtered.files.map(f=>f.group),['weapons','audio']);assert.equal(filtered.totalBytes,20);assert.equal(original.files.length,5);
});

test('original Inferno geometry and low-memory budgets return an explicit guard before decoding',()=>{
 assert.equal(privateMapMemoryReason({renderBytes:104641648,physicsBytes:4850748,deviceMemory:8,remainingHeap:2e9}),null);
 assert.match(privateMapMemoryReason({renderBytes:865375444,physicsBytes:98753364}),/验收/);
 assert.match(privateMapMemoryReason({renderBytes:321965032,physicsBytes:15684660,deviceMemory:4}),/内存/);
});

test('shared Buffer/ArrayBuffer decoder agrees on player, bullet and grenade channels and rejects stale policy',async()=>{
 const bytes=Buffer.from(new Float32Array([0,0,0,1,0,0,0,0,1, 1,0,0,2,0,0,1,0,1, 2,0,0,3,0,0,2,0,1]).buffer),maskBytes=Buffer.from([1,6,7]);
 const groupsText=JSON.stringify([{name:'func_brush',source:'map_physics.gltf',firstTriangle:2,triangles:1}]);
 const map={id:'de_mirage',sourceSha256:signature,physics:{triangles:3}};
 const policy={map:map.id,sourceSha256:signature,physicsSha256:sha(bytes),maskSha256:sha(maskBytes),groupsSha256:sha(groupsText),excludedGroups:[{firstTriangle:2,triangles:1,resolved:true,solid:false,reason:'never-solid',sourceEntities:[{solidity:1}]}]};
 const input={bytes,maskBytes,groupsText,policyText:JSON.stringify(policy),map};
 const r=await decodePrivateMapCollision(input,{channels:[1,2,4]});
 assert.deepEqual([...r.positionsByChannel[1]],[0,0,0,1,0,0,0,0,1]);
 assert.deepEqual([...r.positionsByChannel[2]],[1,0,0,2,0,0,1,0,1]);assert.deepEqual(r.positionsByChannel[2],r.positionsByChannel[4]);
 await assert.rejects(()=>decodePrivateMapCollision({...input,expected:{policySha256:'bad'}}),/server/);
 await assert.rejects(()=>decodePrivateMapCollision(input,{channels:[7]}),/channels/);
 assert.deepEqual([...maskBytes],[1,6,7]);
});

test('private runtime neither registers a worker nor messages an existing worker to replace its shell',async()=>{
 const previous=Object.getOwnPropertyDescriptor(globalThis,'navigator'),before=globalThis.__DUST2_PRIVATE_MAP__;
 let registrations=0,messages=0;
 globalThis.__DUST2_PRIVATE_MAP__=config();
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{onLine:true,serviceWorker:{register(){registrations++;},controller:{postMessage(){messages++;}}}}});
 try{
  const api=await import('../client/offline.js?private-game-isolation');
  const state=await api.initOffline();assert.equal(state.supported,false);assert.equal(state.ready,false);
  assert.equal(await api.refreshOfflineShell(),false);assert.equal(registrations,0);assert.equal(messages,0);
 }finally{if(previous)Object.defineProperty(globalThis,'navigator',previous);else delete globalThis.navigator;if(before===undefined)delete globalThis.__DUST2_PRIVATE_MAP__;else globalThis.__DUST2_PRIVATE_MAP__=before;}
});
