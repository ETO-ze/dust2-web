import test from 'node:test';
import assert from 'node:assert/strict';
import { MatchView, canWatchBomb } from '../client/match-view.js';
import { RuntimeDiagnostics, disconnectMessage } from '../client/runtime-diagnostics.js';

test('death and respawn edges occur once; deathmatch keeps the death camera', () => {
  const view = new MatchView(), player = {id:'self', team:'T', alive:true};
  const snapshot = {mode:'deathmatch', players:[player,{id:'friend',team:'T',alive:true}]};
  view.update(player,snapshot,0); player.alive=false;
  assert.equal(view.update(player,snapshot,100).died,true);
  assert.equal(view.update(player,snapshot,200).died,false);
  assert.equal(view.spectating(player,snapshot,2000),null);
  player.alive=true;assert.equal(view.update(player,snapshot,3100).respawned,true);
  assert.equal(view.update(player,snapshot,3200).respawned,false);
});
test('defuse waits for death camera, observes only living teammates and follows target changes', () => {
  const view = new MatchView(), player = {id:'self',team:'T',alive:true};
  const a={id:'a',team:'T',alive:true},b={id:'b',team:'T',alive:true};
  const snapshot={mode:'defuse',players:[player,{id:'enemy',team:'CT',alive:true},a,b]};
  view.update(player,snapshot,0);player.alive=false;view.update(player,snapshot,10);
  assert.equal(view.spectating(player,snapshot,500),null);
  assert.equal(view.spectating(player,snapshot,1600).id,'a');
  view.cycle(player,snapshot);assert.equal(view.spectating(player,snapshot,1600).id,'b');
  b.alive=false;assert.equal(view.update(player,snapshot,2000).spectating.id,'a');
  a.alive=false;assert.equal(view.update(player,snapshot,2100).spectating,null);
  view.reset();assert.equal(view.targetId,null);
});
test('diagnostic history is bounded and previous reload data does not recursively grow', () => {
  let stored;const storage={getItem:()=>stored,setItem:(_,value)=>{stored=value;}};
  const d=new RuntimeDiagnostics(storage);
  for(let i=0;i<200;i++){d.event('sample',{i});d.sample({i});}
  assert.equal(d.report().events.length,40);assert.equal(d.report().samples.length,60);
  const second=new RuntimeDiagnostics(storage);second.event('boot');
  const third=new RuntimeDiagnostics(storage);
  assert.equal(third.previous.events.length,1);assert.equal(third.previous.previous,undefined);
  assert.match(disconnectMessage(1008,'Client too slow'),/接收积压/);
  const denied=new RuntimeDiagnostics({getItem(){throw Error();},setItem(){throw Error();}});
  assert.doesNotThrow(()=>denied.sample({fps:60}));
});

test('team elimination switches to the planted C4 after the death transition and keeps the camera through settlement',()=>{
  const view=new MatchView(),self={id:'me',team:'T',alive:true,x:0,y:0,z:0,yaw:0,pitch:0};
  const friend={id:'friend',team:'T',alive:true};
  const snapshot={mode:'defuse',players:[self,friend,{id:'enemy',team:'CT',alive:true}],round:{phase:'live',number:4},bomb:{state:'planted',x:12,y:1,z:18,plantedAt:500}};
  view.update(self,snapshot,0);self.alive=false;view.update(self,snapshot,100);
  assert.equal(view.bombCamera(self,snapshot,2000),null);
  friend.alive=false;view.update(self,snapshot,1100);
  assert.equal(view.bombCamera(self,snapshot,1200),null);
  const pose=view.bombCamera(self,snapshot,1800);assert.ok(pose);assert.equal(pose.roll,0);
  const dx=snapshot.bomb.x-pose.x,dz=snapshot.bomb.z-pose.z;
  assert.ok(Math.abs(Math.atan2(-dx,-dz)-pose.yaw)<1e-10);
  snapshot.bomb.state='exploded';snapshot.round.phase='ended';
  assert.equal(view.bombCamera(self,snapshot,5000),pose);
  snapshot.round.phase='freeze';assert.equal(view.bombCamera(self,snapshot,6000),null);
  self.alive=true;view.update(self,snapshot,6100);assert.equal(view.bombPose,null);
});

test('bomb spectator never exposes carried or dropped C4 and clamps its viewpoint before walls',()=>{
  const self={id:'me',team:'CT',alive:false},snapshot={mode:'defuse',players:[self],round:{phase:'live',number:1},bomb:{state:'carried',x:0,y:0,z:0}};
  for(const state of ['none','carried','dropped']){snapshot.bomb.state=state;assert.equal(canWatchBomb(self,snapshot),false);}
  snapshot.bomb.state='planted';const view=new MatchView();view.update(self,snapshot,0);
  let casts=0;const pose=view.bombCamera(self,snapshot,1600,()=>{casts++;return 1.2;});
  assert.equal(casts,5);assert.ok(Math.abs(Math.hypot(pose.x,pose.y-.32,pose.z)-.95)<1e-10);
  snapshot.mode='deathmatch';assert.equal(view.bombCamera(self,snapshot,1700),null);
  snapshot.mode='defuse';snapshot.bomb.x=NaN;assert.equal(view.bombCamera(self,snapshot,1800),null);
});
