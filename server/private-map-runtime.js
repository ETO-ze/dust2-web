import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createReadStream} from 'node:fs';
import {configurePrivateMap} from '../shared/private-map-context.js';
import {initPhysics,raycastWorld,raycastGrenadeWorld,raycastWorldContact} from '../shared/physics.js';
import {loadPrivatePhysics} from '../scripts/maps/load-private-physics.mjs';
import {MapTacticalGraph} from './map-tactical-graph.js';
import {PrivateMapBots} from './private-map-bots.js';
import {PRIVATE_BREAKABLES} from '../shared/private-map-breakables-data.js';
import {PrivateMapBreakables} from '../shared/private-map-breakables.js';
import {MIRAGE_JUMP_IDENTITY,MIRAGE_JUMP_LINKS} from '../shared/private-map-jump-links.js';

const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
export function loadPrivateMapRuntime(directory,{id,libraryUrl=''}={}) {
 const compiled=path.join(directory,'compiled'),metadataBytes=fs.readFileSync(path.join(compiled,'map.json')),meta=JSON.parse(metadataBytes);
 if(id&&meta.id!==id)throw Error('Private map ID mismatch');
 const navBytes=fs.readFileSync(path.join(compiled,'nav.json')),nav=JSON.parse(navBytes),auditBytes=fs.readFileSync(path.join(directory,'navigation-audit.json')),audit=JSON.parse(auditBytes);
 const player=loadPrivatePhysics(directory,1),bullet=loadPrivatePhysics(directory,2),grenade=loadPrivatePhysics(directory,4);
 const navigationSha256=sha(navBytes),auditSha256=sha(auditBytes);
 if(audit.schemaVersion!==2||audit.sourceSha256!==meta.sourceSha256||audit.physicsSha256!==player.physicsSha256||audit.maskSha256!==player.maskSha256||audit.policySha256!==player.policySha256||audit.navigationSha256!==navigationSha256)throw Error('Private navigation evidence does not match current source, geometry, and collision policy');
 const breakablePolicy=meta.id===PRIVATE_BREAKABLES.mapId?PRIVATE_BREAKABLES:null;
 if(breakablePolicy&&(breakablePolicy.sourceSha256!==meta.sourceSha256||breakablePolicy.physicsSha256!==player.physicsSha256||breakablePolicy.maskSha256!==player.maskSha256||breakablePolicy.groupsSha256!==sha(fs.readFileSync(path.join(compiled,'physics-groups.json')))))throw Error('Breakable policy does not match original map');
 const breakables=breakablePolicy?.objects||[],sourceTrianglesByChannel={1:player.sourceTriangles,2:bullet.sourceTriangles,4:grenade.sourceTriangles};
 let activeBreakables=new PrivateMapBreakables(breakables,sourceTrianglesByChannel);
 const jumpLinks=meta.id===MIRAGE_JUMP_IDENTITY.mapId&&meta.sourceSha256===MIRAGE_JUMP_IDENTITY.sourceSha256&&player.physicsSha256===MIRAGE_JUMP_IDENTITY.physicsSha256?MIRAGE_JUMP_LINKS:[];
 const identity={mapId:meta.id,metadataSha256:sha(metadataBytes),sourceSha256:meta.sourceSha256,physicsSha256:player.physicsSha256,maskSha256:player.maskSha256,policySha256:player.policySha256,navigationSha256,auditSha256,movementModel:'source-air-private-v1',jumpLinksSha256:sha(JSON.stringify(jumpLinks)),...(breakablePolicy?{breakablesSha256:sha(JSON.stringify(breakablePolicy))}:{})};
 const mapSignature=sha(JSON.stringify(identity));
 configurePrivateMap(meta,nav,{...identity,mapSignature});
 initPhysics(player.positions,null,{mapPatches:false,bulletPositions:bullet.positions,grenadePositions:grenade.positions,copyPositions:false,airMovement:'source',triangleEnabled:(channel,index)=>activeBreakables.triangleEnabled(channel,index)});
 const stands=new Map(audit.standPoints.map(n=>[n.id,n])),accepted=new Set(audit.acceptedEdges),nodes=nav.map(n=>({...n,...stands.get(n.id)}));
 const jumpEdges=new Set(jumpLinks.map(link=>`${link.navFrom}>${link.navTo}`));
 for(const link of jumpLinks){const from=nodes.find(n=>n.id===link.navFrom),to=nodes.find(n=>n.id===link.navTo);if(!from||!to||!stands.has(from.id)||!stands.has(to.id))throw Error('Jump link has no validated navigation anchor');if(!from.neighbors.includes(to.id))from.neighbors=[...from.neighbors,to.id];}
 const graph=new MapTacticalGraph(meta,nodes,{standAllowed:n=>stands.has(n.id),edgeAllowed:(a,b)=>accepted.has(`${a.id}>${b.id}`)||jumpEdges.has(`${a.id}>${b.id}`)});
 const plans=new Map(audit.edgePlans.map(p=>[p.key,p]));
 for(const link of jumpLinks)plans.set(`${link.navFrom}>${link.navTo}`,{mode:'scripted-jump',link});
 const base=`maps/${meta.id}/`,config={private:true,id:meta.id,name:meta.name,...identity,mapSignature,breakables,initialHiddenNodeIndices:breakablePolicy?.initialHiddenNodeIndices||[],metadataUrl:base+'map.json',navUrl:base+'nav.json',physicsUrl:base+'physics.f32',maskUrl:base+'physics-mask.u8',groupsUrl:base+'physics-groups.json',policyUrl:base+'entity-collision-policy.json',renderUrl:`${libraryUrl.replace(/\/$/,'')}/maps/${meta.id}/render/map.gltf`,socketPath:'ws'};
 const allowed=new Map(['map.json','nav.json','physics.f32','physics-mask.u8','physics-groups.json'].map(f=>['/'+base+f,path.join(compiled,f)]));allowed.set('/'+base+'entity-collision-policy.json',path.join(directory,'entity-collision-policy.json'));
 const world={raycastWorld:raycastGrenadeWorld,raycastContact:raycastWorldContact,clearSight(a,b){const d=Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);return d<.01||raycastWorld(a,{x:(b.x-a.x)/d,y:(b.y-a.y)/d,z:(b.z-a.z)/d},d-.03)===null;}};
 return {mapId:meta.id,mapSignature,config,meta,graph,plans,identity,world,createBots:room=>new PrivateMapBots(room,{graph,plans,world}),
  createBreakables(){activeBreakables=new PrivateMapBreakables(breakables,sourceTrianglesByChannel);return activeBreakables;},
  activate(room){if(room?.mapBreakables)activeBreakables=room.mapBreakables;},
  handleRequest(req,res,pathname){
   if(pathname==='/private-map.json'){res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(req.method==='HEAD'?undefined:JSON.stringify(config));return true;}
   const file=allowed.get(pathname);if(!file)return false;
   const stat=fs.statSync(file);res.writeHead(200,{'Content-Type':file.endsWith('.json')?'application/json':'application/octet-stream','Content-Length':stat.size,'Cache-Control':'private, max-age=3600'});
   if(req.method==='HEAD')res.end();else{const stream=createReadStream(file);stream.on('error',()=>res.destroy());stream.pipe(res);}return true;
  }
 };
}
