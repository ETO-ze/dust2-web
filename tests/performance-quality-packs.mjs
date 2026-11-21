import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import {findQualityPacks} from '../server/performance-quality.js';
import {privateEntities,qualityEntityRenderMatches} from '../shared/private-map-entities.js';

test('source-bound Inferno glass accepts only the matched raw or equivalent compact document/buffer pair',()=>{
  const p=privateEntities('de_inferno');
  const original='50443c7652275ece36a13bcf4c8086819531500a1eeaa1802c1a5d9f5a572182';
  const compact='1c66ba44bd14963f0bff76eff454ef60897e6f43c6ecbd32347a6ac5b4a1f480';
  const originalBuffer='d09d92abe035f9800da3fff32fce862033a02abd2c7e798087d6d9d4cc677483';
  const compactBuffer='b86112e47afa4d86388e6f36d88c2314024718b12c89f3e6f1cf8876f1dee50a';
  assert.ok(qualityEntityRenderMatches(p,original,originalBuffer));
  assert.ok(qualityEntityRenderMatches(p,compact,compactBuffer));
  assert.ok(!qualityEntityRenderMatches(p,compact,originalBuffer));
  assert.ok(!qualityEntityRenderMatches(p,original,compactBuffer));
  assert.ok(!qualityEntityRenderMatches(p,compact,undefined));
  assert.ok(!qualityEntityRenderMatches(p,'a'.repeat(64),compactBuffer));
  assert.ok(!qualityEntityRenderMatches(privateEntities('de_mirage'),compact,compactBuffer));
});

const {PERF_MAP_ROOT,PERF_QUALITY_MAP_LIBRARY,PERF_QUALITY_TRANSPORT}=process.env;
test('the local gateway publishes three complete original-quality entries with their verified transport', {
  skip:!(PERF_MAP_ROOT&&PERF_QUALITY_MAP_LIBRARY&&PERF_QUALITY_TRANSPORT),
},()=>{
  const ids=['de_dust2','de_mirage','de_inferno'];
  const packs=findQualityPacks(PERF_MAP_ROOT,new Set(ids),PERF_QUALITY_MAP_LIBRARY,PERF_QUALITY_TRANSPORT);
  assert.deepEqual([...packs.keys()],ids);
  for(const pack of packs.values()){
    const doc=pack.files.get('map.gltf');
    assert.ok(pack.transport?.objects.size>0);
    assert.equal(pack.transport.manifest.originalRenderGltfSha256,doc.sha256);
    assert.ok(pack.files.get('map.bin').bytes<=512*1024*1024);
  }
  assert.equal(path.basename(path.dirname(packs.get('de_inferno').raw)),'derived');
  assert.equal(path.basename(path.dirname(packs.get('de_mirage').raw)),'e66cdf1ae6a9-36f6a0fd');
});

