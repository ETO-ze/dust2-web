import test from 'node:test';
import assert from 'node:assert/strict';
import {createRadarView,radarFloor,bombRadarMarker} from '../client/radar-view.js';
import {updateBombSpotting,isBombSpotted} from '../server/bomb-radar.js';
import {snapshotForSide} from '../server/snapshot-view.js';
import {readFileSync} from 'node:fs';
import {BoxGeometry} from 'three';
import {GameRoom} from '../server/game.js';
import {initPhysics} from '../shared/physics.js';
import {renderMatchRadar} from '../client/match-radar.js';
import {MatchView} from '../client/match-view.js';

test('all four camera headings project forward to twelve o’clock; texture pixels and markers coincide',()=>{
  const focus={x:24,y:0,z:-9},overview={scale:5,pos_x:-2314,pos_y:3100,size:1024},units=.0254;
  for(const yaw of [0,Math.PI/2,Math.PI,Math.PI*1.5,Math.PI-.001,-Math.PI+.001]){
    const view=createRadarView({focus,yaw,width:260,height:260,overview,units});
    const world={x:focus.x-Math.sin(yaw)*10,z:focus.z-Math.cos(yaw)*10},marker=view.point(world);
    assert(Math.abs(marker.x-130)<1e-7);assert(marker.y<130);
    let transform,draw;
    view.background({save(){},restore(){},translate(){},rotate(a){transform=a;},drawImage(...args){draw=args;}},{});
    const u=(world.x/units-overview.pos_x)/overview.scale/1024;
    const v=(overview.pos_y+world.z/units)/overview.scale/1024;
    const x=draw[1]+u*draw[3],y=draw[2]+v*draw[4];
    assert(Math.abs(marker.x-(130+x*Math.cos(transform)-y*Math.sin(transform)))<1e-7);
    assert(Math.abs(marker.y-(130+x*Math.sin(transform)+y*Math.cos(transform)))<1e-7);
    const far=view.edge({x:world.x*400,z:world.z*400});assert(far.atEdge);assert(Math.abs(Math.hypot(far.x-130,far.y-130)-114)<1e-7);
  }
});

test('original altitude boundaries pick the two Nuke floors and the correct shared boundary',()=>{
  const ov={verticalsections:{lower:{AltitudeMax:'-495'}}};
  assert.equal(radarFloor(ov,-19.47),'lower');assert.equal(radarFloor(ov,-10.33),'default');
  assert.equal(radarFloor(ov,-495*.0254),'default');assert.equal(radarFloor({},-25),'default');
});

test('team sharing and round transitions govern stationary C4, including smoked, flashed or turned defenders',()=>{
  const ct={team:'CT',alive:true,x:0,y:0,z:0,yaw:0,pitch:0,weapon:'ak47'};
  const b={state:'dropped',x:0,y:0,z:-8};
  let visible=false;
  const room={bomb:b,players:new Map([['one',ct]]),visibleToBot:()=>visible};
  updateBombSpotting(room,100);assert.equal(isBombSpotted(room),false);
  visible=true;ct.yaw=Math.PI;updateBombSpotting(room,300);assert.equal(isBombSpotted(room),false);
  ct.yaw=0;ct.flashBlindUntil=600;updateBombSpotting(room,500);assert.equal(isBombSpotted(room),false);
  updateBombSpotting(room,700);assert.equal(isBombSpotted(room),true);
  const raw={ctSpottedBomb:true,players:[],bomb:b,mode:'defuse'};
  const spotted=snapshotForSide(raw,'CT');
  assert.equal(bombRadarMarker(spotted,ct).kind,'dropped');assert.equal(spotted.ctSpottedBomb,undefined);
  assert.equal(bombRadarMarker({...spotted,bombSpotted:false},ct),null);
  assert.equal(bombRadarMarker(spotted,{team:'T'}).kind,'dropped');
  b.state='carried';updateBombSpotting(room,900);assert.equal(isBombSpotted(room),false);
  b.carrierId='mate';const mate={id:'mate',alive:true,team:'T',x:1,z:2};
  assert.deepEqual(bombRadarMarker({...raw,players:[mate]},{team:'T'}),{kind:'carried',point:mate});
  assert.equal(bombRadarMarker({...raw,players:[mate]},ct),null);
  b.state='planted';assert.equal(bombRadarMarker({...raw,bombSpotted:false},ct,{bombCamera:true}).kind,'planted');
  for(const state of ['none','defused','exploded'])assert.equal(bombRadarMarker({...raw,bomb:{state}},{team:'T'}),null);
});

const fixtureMap={id:'de_mirage',metersPerSourceUnit:.0254,overview:{scale:5,size:1024,pos_x:-2250,pos_y:1900},sites:{A:{x:23,y:4,z:-4},B:{x:-65,y:0,z:48}}};

function renderFixture({snapshot,viewer,focus,bombCamera=false,rotate=true,overview=fixtureMap.overview}) {
  // Canvas commands, not screenshots, keep the regression runnable on a clean CI checkout.

  const operations=[];
  let alpha=1;
  const ctx=new Proxy({get globalAlpha(){return alpha;},set globalAlpha(v){alpha=v;}},{
    get(target,key){
      if(key in target)return target[key];
      return (...args)=>{operations.push([key,...args]);};
    }
  });
  renderMatchRadar({canvas:{width:260,height:260},ctx,map:{...fixtureMap,overview},image:{id:'overview'},snapshot,viewer,focus,
    time:5000,receivedAt:5000,revealed:new Map(),rotate,bombCamera});
  return operations;
}

test('the radar uses the rendered player, teammate or C4 camera in both shared client entries',()=>{
  const source=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
  assert.match(source('index.html'),/src="\/client\/home-entry\.js"/);
  assert.match(source('private.html'),/src="\/client\/private-main\.js"/);
  for(const entry of ['client/home-entry.js','client/private-main.js'])assert.match(source(entry),/import\('\.\/main\.js'\)/);
  const main=source('client/main.js'),at=main.indexOf('hud.radarFrame(');
  for(const update of ['matchView.bombCamera(', 'spectating=matchView.spectating(']){
    const index=main.indexOf(update);assert(index>=0&&at>index);
  }
  assert.match(main.slice(at,at+290),/x:camera\.position\.x,z:camera\.position\.z,[\s\S]+yaw:camera\.rotation\.y/);
  const hud=source('client/hud.js');
  assert.match(hud,/radarFrame\([^)]+\)\{[\s\S]+?renderMatchRadar\(/);
  assert.doesNotMatch(hud,/this\.drawRadar\(/);
});

test('rotated and fixed-north views draw different map angles, an upright C4, off-screen indicators and a camera-relative self arrow',t=>{
  const previous=globalThis.Image;globalThis.Image=class {};t.after(()=>{if(previous===undefined)delete globalThis.Image;else globalThis.Image=previous;});
  const viewer={id:'local',alive:true,team:'T',x:10,y:1,z:15};
  const focus={...viewer,yaw:Math.PI/2};
  const bomb={state:'dropped',x:300,y:8,z:15};
  const snapshot={mode:'defuse',time:5000,players:[viewer],bomb};
  const capture=rotate=>renderFixture({snapshot,viewer,focus,rotate});
  const turning=capture(true),north=capture(false);
  const angles=ops=>ops.filter(([op])=>op==='rotate').map(a=>a[1]);
  assert.deepEqual(angles(turning).slice(0,2),[Math.PI/2,0]);
  assert.deepEqual(angles(north).slice(0,2),[0,-Math.PI/2]);
  const glyph=ops=>ops.find(([op,s])=>op==='fillText'&&s==='C4');
  const a=glyph(turning),b=glyph(north);
  assert(a&&b);assert(a[3]>230&&b[2]>230);
  const edge=ops=>ops.filter(([op])=>op==='translate').at(-2);
  assert(edge(turning)&&edge(north));
});

test('CT receives the announced site until a teammate sees the exact plant; a dead team can spectate the exact C4',()=>{
  const ct={id:'ct',team:'CT',alive:false,x:-8,y:0,z:0};
  const teammate={id:'ct2',team:'CT',alive:true,x:3,y:0,z:0};
  const bomb={state:'planted',site:'B',x:20,y:2,z:30};
  const snapshot={mode:'defuse',time:5000,round:{phase:'live',number:7},bomb,players:[ct,teammate]};
  const obs=new MatchView();obs.update(ct,snapshot,100);
  assert.equal(obs.spectating(ct,snapshot,3000).id,'ct2');
  assert.equal(obs.bombCamera(ct,snapshot,3000),null);
  const publicMark=bombRadarMarker(snapshot,ct,{sites:fixtureMap.sites});
  assert.equal(publicMark.kind,'site');assert.deepEqual(publicMark.point,fixtureMap.sites.B);
  assert.notEqual(publicMark.point.x,bomb.x);
  assert.equal(bombRadarMarker({...snapshot,bombSpotted:true},ct).point,bomb);
  teammate.alive=false;
  assert(obs.bombCamera(ct,snapshot,3000));
  assert.equal(bombRadarMarker(snapshot,ct,{bombCamera:true}).point,bomb);
});

test('spectating or controlling the allied carrier marks its rendered position, without showing it to the opposition',()=>{
  const carrier={id:'bot',team:'T',alive:true,x:7,y:2,z:6},own={id:'human',team:'T',alive:false};
  const snapshot={time:3,mode:'defuse',players:[carrier,own],bomb:{state:'carried',carrierId:carrier.id}};
  const focus={id:'bot',x:7.7,y:2,z:6.8,yaw:.85};
  assert.equal(bombRadarMarker(snapshot,own,{focus}).point,focus);
  assert.equal(bombRadarMarker(snapshot,{...carrier,alive:true},{focus}).point,focus);
  assert.equal(bombRadarMarker(snapshot,{...own,team:'CT'},{focus}),null);
  assert.equal(bombRadarMarker({...snapshot,mode:'deathmatch'},own,{focus}),null);
  assert.equal(bombRadarMarker({...snapshot,players:[own]},own,{focus}),null);
});


test('the live server tick sends stationary C4 sightings only to defenders and resets them on a new drop',()=>{
  const floor=new BoxGeometry(500,1,500).toNonIndexed();
  floor.translate(0,-.5,0);initPhysics(floor.attributes.position.array);floor.dispose();
  let now=100000;
  const room=new GameRoom('RADAR',{bots:0,clock:()=>now});
  const ct=room.addHuman({},{name:'Defender',team:'CT'});
  const attacker=room.addHuman({},{name:'Carrier',team:'T'});
  room.startRound();room.round.phase='live';room.round.phaseEndsAt=now+100000;
  Object.assign(ct,{x:0,y:0,z:0,yaw:0,pitch:0});
  Object.assign(attacker,{x:0,y:0,z:-12});
  Object.assign(room.bomb,{carrierId:attacker.id,state:'carried'});
  room.dropBomb(attacker);attacker.z=30;
  let visible=false;room.visibleToBot=()=>visible;
  const tick=()=>{now+=250;room.tick();return room.snapshot({drainEvents:false});};
  assert.equal(snapshotForSide(tick(),'CT').bombSpotted,false);
  visible=true;
  let state=tick();assert.equal(snapshotForSide(state,'CT').bombSpotted,true);
  assert.equal(snapshotForSide(state,'T').bombSpotted,false);
  assert(!Object.hasOwn(snapshotForSide(state,'CT'),'ctSpottedBomb'));
  // A new drop at exactly the old location can happen between two vision samples.
  attacker.z=-12;room.dropBomb(attacker);attacker.z=30;visible=false;
  assert.equal(snapshotForSide(room.snapshot(),'CT').bombSpotted,false);
  state=tick();assert.equal(bombRadarMarker(snapshotForSide(state,'CT'),ct),null);
  assert.equal(bombRadarMarker(snapshotForSide(state,'T'),attacker).kind,'dropped');
});
