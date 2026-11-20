import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Group,Vector3} from 'three';
import {alignC4Viewmodel,c4KeypadText} from '../client/c4-display.js';

function firstTranslation(bytes,doc,clip,bone){
  const channel=clip.channels.find(({target})=>target.path==='translation'&&doc.nodes[target.node].name===bone);
  const sample=doc.accessors[clip.samplers[channel.sampler].output];
  const view=doc.bufferViews[sample.bufferView];
  const offset=28+bytes.readUInt32LE(12)+(view.byteOffset||0)+(sample.byteOffset||0);
  // Valve's weapon joint root cycles the axes of its local Source-space track.
  return new Vector3(bytes.readFloatLE(offset+4),bytes.readFloatLE(offset+8),bytes.readFloatLE(offset));
}

test('both C4 body pivots align with the first-person plant and draw clips',()=>{
  const bytes=readFileSync('public/assets/viewmodel/animations.glb');
  const doc=JSON.parse(bytes.toString('utf8',20,20+bytes.readUInt32LE(12)));
  // Independent glTF-metre bind pivots from the two named MDAT inverse binds.
  const pivots={detonator_switch:[.0849842,.0155408,.0589477],switch_cover:[.0942344,.0157880,.0755016]};
  const held=new Group();alignC4Viewmodel(held);held.updateMatrixWorld(true);
  for(const action of ['draw','idle','plant']){
    const clip=doc.animations.find(c=>c.name==='c4/'+action);
    for(const [bone,pivot] of Object.entries(pivots)){
      const actual=held.localToWorld(new Vector3(...pivot));
      const expected=firstTranslation(bytes,doc,clip,bone);
      assert.ok(expected.distanceTo(actual)<.00025,action+' '+bone+' bind mismatch '+actual.distanceTo(expected));
    }
  }
});

test('C4 LCD changes at the seven authored keypad contacts and holds during lowering',()=>{
  const frames=[20,29,37,44,50,59,65],digits='7355608';
  for(const [index,frame] of frames.entries()){
    assert.equal(c4KeypadText((frame-.01)/120),digits.slice(0,index));
    assert.equal(c4KeypadText(frame/120),digits.slice(0,index+1));
  }
  assert.equal(c4KeypadText(1),digits);
});
