import test from 'node:test';
import assert from 'node:assert/strict';
import { MatchView } from '../client/match-view.js';
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
