import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {omitInactiveQualityMeshes} from '../client/quality-map-layout.js';
import {privateEntities} from '../shared/private-map-entities.js';
import {inactiveVisualPropNodes} from '../scripts/maps/inactive-source-props.mjs';
import {disabledBrushModels, sourceBrushHidden} from '../scripts/maps/source-brush-visibility.mjs';

const compactInferno = '1c66ba44bd14963f0bff76eff454ef60897e6f43c6ecbd32347a6ac5b4a1f480';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

test('detaching a layout instance keeps child hierarchy, shared meshes and original indices', () => {
  const nodes = Array.from({length:6595}, () => ({mesh:7}));
  const parent = nodes[6563] = {mesh:7, children:[6594], translation:[1,2,3]};
  const doc = {nodes, meshes:[{}], scenes:[{nodes:[6562, 6563]}]};
  assert.equal(omitInactiveQualityMeshes(doc, 'de_inferno', 'f'.repeat(64)), 0);
  assert.equal(omitInactiveQualityMeshes(doc, 'de_dust2', compactInferno), 0);
  assert.equal(parent.mesh, 7);
  assert.equal(omitInactiveQualityMeshes(doc, 'de_inferno', compactInferno), 31);
  assert.equal(doc.nodes.length, 6595);
  assert.equal(doc.nodes[6563], parent);
  assert.deepEqual(parent, {children:[6594], translation:[1,2,3]});
  assert.equal(doc.nodes[6562].mesh, 7);
  assert.equal(doc.nodes[6594].mesh, 7);
});

const library = process.env.PERF_QUALITY_MAP_LIBRARY;
const archives = [
  ['de_dust2', '51d6bb432b65-36f6a0fd', 'raw', 0],
  ['de_mirage', 'e66cdf1ae6a9-36f6a0fd', 'raw', 15],
  ['de_inferno', 'bfe3d8a996fe-36f6a0fd', 'raw', 31],
  ['de_inferno', 'bfe3d8a996fe-36f6a0fd', 'derived/raw', 31],
];
for (const [mapId, build, variant, count] of archives) {
  test(mapId + ' ' + variant + ' matches its original layout entity and breakable definitions', {skip:!library}, () => {
    const root = path.join(library, mapId, build);
    const entities = readFileSync(path.join(root, 'source', 'entities.txt'), 'utf8');
    const bytes = readFileSync(path.join(root, variant, 'map.gltf')), doc = JSON.parse(bytes);
    const before = doc.nodes.map(node => node.mesh);
    const expected = inactiveVisualPropNodes(doc, entities);
    const brushes = disabledBrushModels(entities, mapId);
    doc.nodes.forEach((node, index) => {
      if (node.mesh !== undefined && sourceBrushHidden(node.name, brushes)) expected.add(index);
    });
    assert.equal(expected.size, count);
    assert.equal(omitInactiveQualityMeshes(doc, mapId, hash(bytes)), count);
    assert.deepEqual(doc.nodes.map(node => node.mesh), before.map((mesh, i) => expected.has(i) ? undefined : mesh));
    const breakables = privateEntities(mapId);
    for (const object of breakables?.objects || []) {
      for (const i of [...object.nodeIndices, ...(object.restoredNodeIndices || [])]) {
        assert.ok(!expected.has(i), object.id);
        assert.equal(doc.nodes[i].mesh, before[i]);
      }
      assert.deepEqual(object.nodeIndices.map(i => doc.nodes[i].name), object.nodeNames);
    }
    for (const i of breakables?.initialHiddenNodeIndices || []) assert.ok(!expected.has(i));
  });
}
