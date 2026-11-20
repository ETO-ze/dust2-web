import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {loadPrivateMapRuntime} from '../../server/private-map-runtime.js';
import {legacyBombSiteAt} from '../../shared/bomb-zones.js';
import {floorHeight,createPlayerState} from '../../shared/physics.js';

const root=path.resolve(process.argv[2]||'artifacts/performance-maps/maps-v1'),id=process.argv[3];
if(!id){
  const results=[];
  for(const entry of JSON.parse(fs.readFileSync(path.join(root,'catalog.json'))).maps){
    const p=spawnSync(process.execPath,[process.argv[1],root,entry.id],{encoding:'utf8'});
    if(p.status!==0)throw Error(p.stderr||p.stdout);
    results.push(JSON.parse(p.stdout.trim().split('\n').at(-1)));
  }
  console.log(JSON.stringify(results,null,2));
}else{
  const ctx=loadPrivateMapRuntime(path.join(root,id),{id}),{GameRoom}=await import('../../server/game.js');
  const room=new GameRoom('PLANT',{mode:'defuse',bots:0,privateMap:ctx});
  const carrier=room.addHuman({},{team:'T',name:'Plant QA'});
  room.addHuman({},{team:'CT'});
  const sites=[];
  for(const [site,anchor] of Object.entries(ctx.meta.sites)){
    const nav=ctx.graph.nodes.get(anchor.navId);
    Object.assign(carrier,createPlayerState(nav),{hasBomb:true,grounded:true,alive:true,effectiveInput:{interact:true}});
    room.giveWeapon(carrier,'c4');room.selectSlot(carrier,5);
    room.bomb={...room.emptyBomb(),state:'carried',carrierId:carrier.id};
    room.round.phase='live';
    const snap=room.snapshot({drainEvents:false});
    assert.equal(snap.players.find(p=>p.id===carrier.id).plantSite,site);
    room.stepBomb(.5);assert.equal(room.bomb.action,'plant');
    room.stepBomb(room.rules.plantSeconds);assert.equal(room.bomb.state,'planted');
    assert.equal(room.bomb.site,site);
    const floor=floorHeight(room.bomb.x,room.bomb.z,room.bomb.y+.1,.2);
    assert.ok(Number.isFinite(floor)&&Math.abs(room.bomb.y-floor)<.001,id+' '+site+' supporting contact');
    const placementOffsetMetres=Number(Math.hypot(nav.x-room.bomb.x,nav.z-room.bomb.z).toFixed(3));
    const rejected=Array.from(ctx.graph.nodes.values());
    const rejectedNodes=rejected.filter(n=>ctx.graph.standAllowed(n)&&legacyBombSiteAt(ctx.meta,n)===site&&room.siteAt(n)===null);
    if(rejectedNodes.length){
      Object.assign(carrier,createPlayerState(rejectedNodes[0]),{hasBomb:true,grounded:true,alive:true,effectiveInput:{interact:true}});
      room.bomb={...room.emptyBomb(),state:'carried',carrierId:carrier.id};
      room.stepBomb(room.rules.plantSeconds);assert.equal(room.bomb.state,'carried');assert.equal(room.bomb.progress,0);
    }
    sites.push({site,navId:anchor.navId,plantedAtFloor:true,oldFalsePositiveWalkableNavPoints:rejectedNodes.length,placementOffsetMetres});
  }
  console.log(JSON.stringify({id,sites}));
}