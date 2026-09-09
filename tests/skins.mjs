import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {SKINS,DEFAULT_SKINS,getSkin,normalizeSkinLoadout} from '../shared/skins.js';
import {WEAPONS} from '../shared/weapons.js';

test('all 23 guns and the knife have exactly one valid Factory New default',()=>{
  const specs=JSON.parse(fs.readFileSync(new URL('../scripts/weapon-assets/default-skins.json',import.meta.url),'utf8'));
  assert.equal(Object.keys(WEAPONS).length,24);
  assert.equal(Object.keys(DEFAULT_SKINS).length,24);
  assert.equal(new Set(SKINS.map(s=>s.id)).size,SKINS.length);
  for(const weapon of Object.keys(WEAPONS)){
    const entries=SKINS.filter(s=>s.weapon===weapon);
    assert.equal(entries.filter(s=>s.isDefault).length,1,weapon);
    const skin=getSkin(DEFAULT_SKINS[weapon]),spec=specs.find(s=>s.weapon===weapon);
    assert.ok(spec,`Missing audited default specification for ${weapon}`);
    assert.equal(skin.weapon,weapon);assert.equal(skin.paintkit,spec.paintkit);
    assert.equal(skin.condition,'Factory New');assert.equal(skin.wearMin,spec.wearMin);
    assert.ok(skin.wear>=spec.wearMin&&skin.wear<=spec.wearMax&&skin.wear<.07,`${skin.id} must support Factory New`);
  }
  assert.ok(SKINS.some(s=>!s.isDefault),'existing optional skin choices remain available');
  for(const skin of SKINS)assert.ok(Object.hasOwn(WEAPONS,skin.weapon),skin.id);
});
test('skin loadout rejects unknown and cross-weapon IDs without accepting arbitrary asset URLs',()=>{
  const chosen=normalizeSkinLoadout({ak47:'ak47-vulcan',m4a1:'ak47-fire-serpent',knife:'https://invalid.example/x.glb',pistol:'glock-neo-noir'});
  assert.equal(chosen.ak47,'ak47-vulcan');assert.equal(chosen.pistol,'glock-neo-noir');
  assert.equal(chosen.m4a1,DEFAULT_SKINS.m4a1);assert.equal(chosen.knife,DEFAULT_SKINS.knife);
  assert.deepEqual(normalizeSkinLoadout(null),DEFAULT_SKINS);
  assert.equal(getSkin('__proto__'),undefined);
});
test('catalog assets exist, are self-contained GLBs, and match advertised sizes/hashes',()=>{
  for(const skin of SKINS){
    for(const resource of [skin.model,skin.preview]){
      assert.ok(resource.startsWith('assets/weapons/'));assert.ok(!resource.split('/').includes('..'));
      assert.ok(!/[\\?#:]/.test(resource),'catalog must use relative asset paths');
    }
    const bytes=fs.readFileSync(new URL('../public/'+skin.model,import.meta.url));
    assert.equal(bytes.length,skin.bytes);assert.equal(bytes.readUInt32LE(0),0x46546c67);
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),skin.sha256);
    const json=JSON.parse(bytes.toString('utf8',20,20+bytes.readUInt32LE(12)));
    assert.ok(json.nodes.some(n=>n.name==='normalization'));assert.ok(json.skins.length);
    assert.ok(json.images.every(i=>i.bufferView!==undefined&&!i.uri));
    assert.ok(json.buffers.every(b=>!b.uri));
    if(skin.isDefault){
      const paint=json.materials.find(m=>m.extras?.paintkit===skin.paintkit)?.extras;
      assert.ok(paint,`${skin.id}: rendered material carries the selected paintkit`);
      assert.equal(paint.wear,skin.wear,`${skin.id}: rendered wear agrees with the catalog`);
    }
    const image=fs.readFileSync(new URL('../public/'+skin.preview,import.meta.url));
    assert.equal(image.length,skin.previewBytes);
    assert.equal(crypto.createHash('sha256').update(image).digest('hex'),skin.previewSha256);
  }
});

test('default Hedge Maze gloves preserve original skinning and honest Factory New float metadata',()=>{
  const bytes=fs.readFileSync(new URL('../public/assets/viewmodel/arms.glb',import.meta.url));
  const json=JSON.parse(bytes.toString('utf8',20,20+bytes.readUInt32LE(12)));
  const manifest=JSON.parse(fs.readFileSync(new URL('../public/assets/viewmodel/gloves-manifest.json',import.meta.url),'utf8'));
  assert.equal(manifest.gloves,'Sport Gloves | Hedge Maze');assert.equal(manifest.paintkit,10038);
  assert.equal(manifest.exterior,'Factory New');assert.equal(manifest.wear,.06);assert.equal(manifest.normalizedWear,0);
  assert.equal(json.extras.wear,manifest.wear);assert.equal(json.extras.paintkit,manifest.paintkit);
  assert.ok(json.skins.length&&json.skins.every(s=>s.joints.length>20));
  assert.ok(json.materials.filter(m=>m.extras?.paintkit===10038).every(m=>m.extras.wear===.06));
  assert.ok(json.images.every(i=>i.bufferView!==undefined&&!i.uri));
});
