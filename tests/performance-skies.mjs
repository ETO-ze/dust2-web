import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import * as THREE from 'three';
import {prepareFlatSky} from '../client/flat-sky.js';
import skies from '../shared/performance-skies.json' with {type:'json'};
import {PERFORMANCE_MAPS} from '../shared/performance-map-pool.js';

test('each playable map has its own small, correctly proportioned panorama', async () => {
  assert.deepEqual(Object.keys(skies).sort(), PERFORMANCE_MAPS.map(m => m.id).sort());
  const sizes = [];
  for (const {id} of PERFORMANCE_MAPS) {
    const data = await readFile(new URL('../client/flat-skies/' + id + '.webp', import.meta.url));
    assert.equal(data.toString('ascii', 8, 12), 'WEBP');
    assert.equal(data.toString('ascii', 12, 16), 'VP8 ');
    const width = data.readUInt16LE(26) & 0x3fff;
    const height = data.readUInt16LE(28) & 0x3fff;
    assert.equal(width, height * 2);
    assert.ok(width <= 1536 && width >= 1024);
    assert.ok(data.length < 65536);
    sizes.push(data.length);
  }
  assert.equal(new Set(sizes).size, PERFORMANCE_MAPS.length);
});

test('only selected panorama is requested, replacement and disposal release GPU and decoded image', async t => {
  const requests = [], images = [];
  t.mock.method(globalThis, 'fetch', async url => {
    requests.push(String(url));
    return new Response(new Blob(['sky']));
  });
  t.before(() => {
    globalThis.createImageBitmap = async () => {
      const image = {width:1536, height:768, closed:0, close() { this.closed++; }};
      images.push(image);
      return image;
    };
  });
  t.after(() => { delete globalThis.createImageBitmap; });
  const scene = new THREE.Scene();
  const first = await prepareFlatSky('de_dust2');
  first.mount(scene);
  const [mesh] = scene.children, {panorama} = mesh.material.uniforms;
  let releases = 0;
  for (const item of [mesh.material, mesh.geometry, panorama.value]) {
    item.addEventListener('dispose', () => { releases++; });
  }
  assert.equal(mesh.geometry.attributes.position.count, 3);
  assert.equal(mesh.material.depthWrite, false);
  assert.equal(panorama.value.isCubeTexture, undefined);
  assert.equal(panorama.value.generateMipmaps, false);
  assert.equal(panorama.value.flipY, false);
  assert.equal(panorama.value.image, images[0]);
  const second = await prepareFlatSky('de_anubis');
  second.mount(scene);
  assert.equal(scene.children.length, 1);
  assert.equal(releases, 3);
  assert.equal(images[0].closed, 1);
  assert.equal(scene.children[0].material.uniforms.yawTurns.value, .75);
  second.dispose();
  second.dispose();
  assert.equal(images[1].closed, 1);
  assert.equal(scene.children.length, 0);
  assert.deepEqual(requests.map(r => r.split('/').pop()), ['de_dust2.webp','de_anubis.webp']);
});

test('network failure preserves map entry and caller abort discards late decoded pixels', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => new Response(null, {status:404}));
  const scene = new THREE.Scene();
  const fallback = await prepareFlatSky('de_mirage');
  fallback.mount(scene);
  assert.equal(scene.userData.sky.source, 'fallback');
  assert.equal(scene.children.length, 0);
  fallback.dispose();

  fetch.mock.mockImplementation(async () => new Response(new Blob(['sky'])));
  const decoding = Promise.withResolvers(), started = Promise.withResolvers();
  globalThis.createImageBitmap = () => { started.resolve(); return decoding.promise; };
  t.after(() => { delete globalThis.createImageBitmap; });
  const controller = new AbortController();
  const preparation = prepareFlatSky('de_nuke', {signal:controller.signal});
  await started.promise;
  controller.abort();
  await assert.rejects(preparation, {name:'AbortError'});
  let closed = false;
  decoding.resolve({close() { closed = true; }});
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(closed);
});
