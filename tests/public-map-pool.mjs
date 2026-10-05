import test from 'node:test';
import assert from 'node:assert/strict';
import {PUBLIC_MAPS,publicMapForPage,publicMapPage} from '../shared/public-map-pool.js';
import {connectionTarget} from '../client/connection-target.js';
import {privateConfig,privateCompatibilityError} from '../client/private-game-config.js';
import {privateMapDownloads,privateMapDownloadURL} from '../client/private-map-download.js';
test('public pool has two maps, defaults to the existing Dust II and isolates invites and sockets',()=>{
 assert.deepEqual(PUBLIC_MAPS.map(map=>map.id),['de_dust2','de_mirage']);
 assert.equal(publicMapForPage('https://cs2.example/').id,'de_dust2');
 assert.equal(publicMapForPage('https://cs2.example/play/de_mirage/?room=ABC').id,'de_mirage');
 const page=publicMapPage('https://cs2.example/?room=OLD#old','de_mirage',{room:'MIR123'});
 assert.equal(page.href,'https://cs2.example/play/de_mirage/?room=MIR123');
 assert.equal(connectionTarget(page).socketURL,'wss://cs2.example/play/de_mirage/ws');
 assert.equal(publicMapPage(page,'de_dust2').href,'https://cs2.example/play/de_dust2/');
 assert.throws(()=>publicMapPage(page,'de_inferno'),/未开放/);
 assert.ok(Object.isFrozen(PUBLIC_MAPS)&&Object.isFrozen(PUBLIC_MAPS[0]));
});
test('public Mirage keeps map identity checks and routes only its own transfers to the CDN',()=>{
 const hash='a'.repeat(64),page='https://cs2.example/play/de_mirage/';
 const input={private:true,publicPool:true,id:'de_mirage',mapId:'de_mirage',socketPath:'ws',movementModel:'source-air-private-v1',renderUrl:'/maps/de_mirage/render/map.gltf',...Object.fromEntries(['mapSignature','sourceSha256','physicsSha256','maskSha256','policySha256','navigationSha256','metadataSha256','jumpLinksSha256'].map(key=>[key,hash])),...Object.fromEntries([['metadataUrl','map.json'],['navUrl','nav.json'],['physicsUrl','physics.f32'],['maskUrl','physics-mask.u8'],['groupsUrl','physics-groups.json'],['policyUrl','entity-collision-policy.json']].map(([key,file])=>[key,'maps/de_mirage/'+file]))};
 const config=privateMapDownloads(privateConfig(input,page),{mapBaseURL:'https://downloads.example/releases/one/maps/',fallbackToGameServer:false});
 assert.equal(config.publicPool,true);
 assert.equal(privateMapDownloadURL(config.navUrl,config).href,'https://downloads.example/releases/one/maps/de_mirage/nav.json');
 assert.equal(privateMapDownloadURL(config.renderUrl,config).href,'https://downloads.example/releases/one/maps/de_mirage/render/map.gltf');
 assert.equal(privateMapDownloadURL('https://cs2.example/maps/de_inferno/nav.json',config).origin,'https://cs2.example');
 assert.equal(privateCompatibilityError({mapId:config.id,mapSignature:hash,physicsSha256:hash},config),null);
 assert.ok(privateCompatibilityError({mapId:'de_dust2',mapSignature:hash,physicsSha256:hash},config));
});
