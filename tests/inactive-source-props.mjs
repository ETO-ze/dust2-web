import test from 'node:test';
import assert from 'node:assert/strict';
import {inactiveVisualPropNodes} from '../scripts/maps/inactive-source-props.mjs';

const entity=(origin,name='[PR#]props.2v2',state=true)=>[
  'classname "prop_dynamic"', 'model resource_name:"models/props/door.vmdl"',
  'origin '+JSON.stringify(origin), 'targetname "'+name+'"','startdisabled '+state].join('\n');
const doc={scenes:[{nodes:[0,2,3]}],nodes:[
  {translation:[.254,0,0],children:[1]}, {name:'door.body_lod0',mesh:0,translation:[0,0,2.54]},
  {name:'door.body_lod0',mesh:0,translation:[.508,0,2.54]},
  {name:'frame.body_lod0',mesh:1,translation:[.254,0,2.54]},
]};
const join=(...entries)=>entries.map((s,i)=>'===='+i+'====\n'+s).join('\n');

test('excludes only the positioned, inactive alternate-layout door, including parent transforms',()=>{
  const text=join(entity([100,10,0]),entity([100,20,0],'hallway',false));
  assert.deepEqual([...inactiveVisualPropNodes(doc,text)],[1]);
});
test('retains ambiguous copies, stateful objects and source output targets',()=>{
  for(const text of [
    join(entity([100,10,0]),entity([100,10,0],'baseline',false)),
    join(entity([100,10,0],'[PR#]shutter.l.remainder')),
    join(entity([100,10,0]),'@OnPressed Delay=1 Enable [PR#]props.*'),
    join(entity([100,30,0])), ''
  ]) assert.deepEqual([...inactiveVisualPropNodes(doc,text)],[]);
});
