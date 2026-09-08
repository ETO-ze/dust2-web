import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {SKINS,DEFAULT_SKINS,getSkin,normalizeSkinLoadout} from '../shared/skins.js';

test('skin catalog has each weapon default and two distinct optional finishes',()=>{
  assert.equal(SKINS.length,18);
  assert.equal(new Set(SKINS.map(s=>s.id)).size,SKINS.length);
  for(const weapon of ['ak47','m4a1','awp','pistol','usp','knife']){
    const entries=SKINS.filter(s=>s.weapon===weapon);
    assert.equal(entries.length,3);assert.equal(entries.filter(s=>s.isDefault).length,1);
    assert.equal(getSkin(DEFAULT_SKINS[weapon]).weapon,weapon);
  }
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
    assert.ok(!skin.model.startsWith('/'));assert.ok(!skin.preview.startsWith('/'));
    assert.equal(skin.model.includes('/optional/'),!skin.isDefault);
    const bytes=fs.readFileSync(new URL('../public/'+skin.model,import.meta.url));
    assert.equal(bytes.length,skin.bytes);assert.equal(bytes.readUInt32LE(0),0x46546c67);
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),skin.sha256);
    const json=JSON.parse(bytes.toString('utf8',20,20+bytes.readUInt32LE(12)));
    assert.ok(json.nodes.some(n=>n.name==='normalization'));assert.ok(json.skins.length);
    assert.ok(json.images.every(i=>i.bufferView!==undefined&&!i.uri));
    assert.ok(json.buffers.every(b=>!b.uri));
    const image=fs.readFileSync(new URL('../public/'+skin.preview,import.meta.url));
    assert.equal(image.length,skin.previewBytes);
    assert.equal(crypto.createHash('sha256').update(image).digest('hex'),skin.previewSha256);
  }
});
