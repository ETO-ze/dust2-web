import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import * as THREE from 'three';
import {prepareFlatSky} from '../client/flat-sky.js';
import skies from '../shared/performance-skies.json' with {type:'json'};
import {PERFORMANCE_MAPS} from '../shared/performance-map-pool.js';

test('each map ships its own native sky with at most a 4K desktop or 2K mobile texture', async () => {
  assert.deepEqual(Object.keys(skies).sort(), PERFORMANCE_MAPS.map(m => m.id).sort());
  const verify = async (relative, expectedWidth, byteBudget) => {
    const data = await readFile(new URL('../client/flat-skies/' + relative, import.meta.url));
    assert.equal(data.toString('ascii', 8, 12), 'WEBP');
    assert.equal(data.toString('ascii', 12, 16), 'VP8 ');
    assert.equal(data.readUInt16LE(26) & 0x3fff, expectedWidth);
    assert.equal(data.readUInt16LE(28) & 0x3fff, expectedWidth / 2);
    assert.ok(data.length <= byteBudget, relative);
  };
  for (const {id} of PERFORMANCE_MAPS) {
    const {sourceWidth} = skies[id];
    await verify(id + '.webp', Math.min(4096, sourceWidth), 256 * 1024);
    if (sourceWidth > 2048) await verify('compact/' + id + '.webp', 2048, 100 * 1024);
  }
});

test('mobile retains native skies up to 2K and fetches a single compact image for larger maps', async t => {
  const paths = [];
  t.mock.method(globalThis, 'fetch', async url => {
    paths.push(new URL(url).pathname);
    return new Response(new Blob(['sky']));
  });
  globalThis.createImageBitmap = async () => ({width:2048, height:1024, close() {}});
  t.after(() => { delete globalThis.createImageBitmap; });
  const scene = new THREE.Scene();
  for (const mapId of ['de_mirage', 'de_ancient']) {
    const sky = await prepareFlatSky(mapId, {compact:true});
    sky.mount(scene);
    assert.equal(scene.userData.sky.source, 'map-panorama');
    assert.equal(scene.userData.sky.resolution, '2048 × 1024');
    sky.dispose();
  }
  assert.match(paths[0], /flat-skies\/de_mirage\.webp$/);
  assert.match(paths[1], /flat-skies\/compact\/de_ancient\.webp$/);
  assert.equal(paths.length, 2);
});

test('only selected panorama is requested, replacement and disposal release GPU and decoded image', async t => {
  const requests = [], images = [];
  t.mock.method(globalThis, 'fetch', async url => {
    requests.push(String(url));
    return new Response(new Blob(['sky']));
  });
  t.before(() => {
    globalThis.createImageBitmap = async () => {
      const image = {width:2048, height:1024, closed:0, close() { this.closed++; }};
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

test('an unavailable 4K sky falls back to its own 2K panorama without interrupting the map', async t => {
  const paths = [];
  t.mock.method(globalThis, 'fetch', async url => {
    const path = new URL(url).pathname;
    paths.push(path);
    return path.includes('/compact/') ? new Response(new Blob(['sky'])) : new Response(null, {status:503});
  });
  globalThis.createImageBitmap = async () => ({width:2048, height:1024, close() {}});
  t.after(() => { delete globalThis.createImageBitmap; });
  const sky = await prepareFlatSky('de_train', {compact:false});
  const scene = new THREE.Scene();
  sky.mount(scene);
  assert.equal(scene.userData.sky.source, 'map-panorama');
  assert.match(paths[0], /flat-skies\/de_train\.webp$/);
  assert.match(paths[1], /compact\/de_train\.webp$/);
  assert.equal(paths.length, 2);
  sky.dispose();
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
