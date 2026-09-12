import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { disposeInstanceAnimation, disposeInstanceSkeletons } from '../client/resource-lifecycle.js';
import { PlayerModel, Effects, ViewWeapon } from '../client/models.js';
import { registerDefaultSkin } from '../client/skin-assets.js';
import { GameAudio } from '../client/audio.js';

function countDisposals(resource) {
  const count = { value: 0 };
  resource.addEventListener('dispose', () => count.value++);
  return count;
}

function skeletalAsset() {
  const scene = new THREE.Group();
  const geometry = new THREE.BoxGeometry(.1, .1, .5);
  const count = geometry.attributes.position.count;
  const weights = new Float32Array(count * 4);
  for (let index = 0; index < count; index++) weights[index * 4] = 1;
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(count * 4), 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
  const texture = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  const material = new THREE.MeshStandardMaterial({ map: texture });
  const mesh = new THREE.SkinnedMesh(geometry, material);
  const bone = new THREE.Bone();
  bone.name = 'testBone';
  mesh.add(bone);
  mesh.bind(new THREE.Skeleton([bone]));
  scene.add(mesh);
  scene.updateMatrixWorld(true);
  return { scene, mesh, animations: [] };
}

test('cloned skeleton textures are disposed while shared library materials and geometry survive', () => {
  const source = skeletalAsset();
  source.mesh.skeleton.computeBoneTexture();
  const sourceBoneDisposed = countDisposals(source.mesh.skeleton.boneTexture);
  const sharedGeometry = countDisposals(source.mesh.geometry);
  const sharedMaterial = countDisposals(source.mesh.material);
  const sharedTexture = countDisposals(source.mesh.material.map);
  const instance = clone(source.scene);
  const mesh = instance.children[0];
  assert.notEqual(mesh.skeleton, source.mesh.skeleton);
  assert.equal(mesh.geometry, source.mesh.geometry);
  assert.equal(mesh.material, source.mesh.material);
  mesh.skeleton.computeBoneTexture();
  const disposed = countDisposals(mesh.skeleton.boneTexture);
  disposeInstanceSkeletons(instance);
  disposeInstanceSkeletons(instance);
  assert.equal(disposed.value, 1);
  assert.equal(mesh.skeleton.boneTexture, null);
  assert.equal(sourceBoneDisposed.value, 0);
  assert.equal(sharedGeometry.value + sharedMaterial.value + sharedTexture.value, 0);
});

test('removed player instances release active and cached weapons plus their own marker', () => {
  const source = skeletalAsset();
  for (const weapon of ['ak47', 'm4a1', 'awp', 'pistol', 'usp', 'knife']) registerDefaultSkin(weapon, source);
  const scene = new THREE.Scene();
  const sharedDisposals = [source.mesh.geometry, source.mesh.material, source.mesh.material.map].map(countDisposals);
  let created = 0;
  let released = 0;
  for (let cycle = 0; cycle < 80; cycle++) {
    const actor = new PlayerModel(cycle % 2 ? 'T' : 'CT', scene);
    const ringGeometry = countDisposals(actor.ring.geometry);
    const ringMaterial = countDisposals(actor.ring.material);
    for (const weapon of ['ak47', 'awp', 'pistol', 'knife']) actor.setWeapon(weapon);
    for (const item of actor.weaponCache.values()) item.visual.traverse(object => {
      if (object.isSkinnedMesh) {
        object.skeleton.computeBoneTexture();
        created++;
        object.skeleton.boneTexture.addEventListener('dispose', () => released++);
      }
    });
    actor.dispose(scene);
    actor.dispose(scene);
    assert.equal(actor.weaponCache.size, 0);
    assert.equal(ringGeometry.value, 1);
    assert.equal(ringMaterial.value, 1);
    assert.equal(scene.children.length, 0);
  }
  assert.ok(created >= 320);
  assert.equal(released, created);
  assert.deepEqual(sharedDisposals.map(count => count.value), [0, 0, 0]);
});

test('instance animation disposal releases mixer actions and property bindings', () => {
  const root = new THREE.Group();
  const mixer = new THREE.AnimationMixer(root);
  const clip = new THREE.AnimationClip('moving', 1, [new THREE.NumberKeyframeTrack('.position[x]', [0, 1], [0, 1])]);
  mixer.clipAction(clip).play();
  mixer.update(.1);
  assert.equal(mixer.stats.actions.total, 1);
  assert.equal(mixer.stats.bindings.total, 1);
  disposeInstanceAnimation(mixer, root);
  assert.equal(mixer.stats.actions.total, 0);
  assert.equal(mixer.stats.bindings.total, 0);
});

test('viewmodel disposal handles inactive cached rigs and their flash resources', () => {
  const source = skeletalAsset();
  const camera = new THREE.PerspectiveCamera();
  const group = new THREE.Group();
  const rig = new THREE.Group();
  group.add(rig);camera.add(group);
  const cache = new Map();
  const counters = [];
  for (let index = 0; index < 3; index++) {
    const root = clone(source.scene);
    const skeleton = root.children[0].skeleton;
    skeleton.computeBoneTexture();
    const flash = new THREE.Mesh(new THREE.ConeGeometry(.01, .04), new THREE.MeshBasicMaterial());
    root.add(flash);
    const mixer = new THREE.AnimationMixer(root);
    mixer.clipAction(new THREE.AnimationClip('idle', 1, [])).play();
    cache.set(index, { root, mixer, flash });
    counters.push(countDisposals(skeleton.boneTexture), countDisposals(flash.geometry), countDisposals(flash.material));
  }
  rig.add(cache.get(0).root);
  const view = Object.assign(Object.create(ViewWeapon.prototype), { camera, group, rig, cache, active: cache.get(0) });
  view.dispose();view.dispose();
  assert.deepEqual(counters.map(count => count.value), Array(9).fill(1));
  assert.equal(cache.size, 0);
  assert.equal(camera.children.length, 0);
  assert.equal(view.active, null);
});

test('effect cleanup removes transient allocations and preserves reusable impact geometry', () => {
  const scene = new THREE.Scene();
  const effects = new Effects(scene);
  const sharedGeometry = countDisposals(effects.impactGeo);
  for (let cycle = 0; cycle < 100; cycle++) {
    for (let shot = 0; shot < 6; shot++) effects.shot({ x: 0, y: 1, z: 0 }, { x: 1, y: 1, z: 5 });
    const materials = effects.items.map(item => countDisposals(item.obj.material));
    const lineGeometry = effects.items.filter(item => item.dispose).map(item => countDisposals(item.obj.geometry));
    effects.clear();effects.clear();
    assert.equal(effects.items.length, 0);
    assert.equal(scene.children.length, 0);
    assert.ok([...materials, ...lineGeometry].every(count => count.value === 1));
  }
  assert.equal(sharedGeometry.value, 0);
  effects.dispose();
  assert.equal(sharedGeometry.value, 1);
});

test('audio cancellation disconnects immediately even when onended is delayed', () => {
  const audio = new GameAudio();
  let stopped = 0;
  let disconnected = 0;
  const source = { stop() { stopped++; }, disconnect() { disconnected++; }, onended: null };
  const gain = { disconnect() { disconnected++; } };
  const voice = { source, nodes: [source, gain], channel: 'reload' };
  const ended = () => audio.releaseVoice(voice);
  source.onended = ended;
  audio.voices.add(voice);
  audio.cancelReload();
  assert.equal(stopped, 1);
  assert.equal(disconnected, 2);
  assert.equal(audio.voices.size, 0);
  assert.equal(source.onended, null);
  ended();audio.stopVoice(voice);
  assert.equal(stopped, 1);
  assert.equal(disconnected, 2);
});

test('real multi-primitive character, AWP and arm clones release every independent skeleton texture', async () => {
  // Keep the shipped meshes, bones, skin bindings and animation data. Remove
  // only image/material references so this Node test needs no browser/GPU.
  async function loadSkeletonFixture(relative) {
    const original = await readFile(new URL(relative, import.meta.url));
    const originalJSONLength = original.readUInt32LE(12);
    const gltf = JSON.parse(original.toString('utf8', 20, 20 + originalJSONLength));
    gltf.materials = gltf.materials?.map(() => ({}));
    delete gltf.textures;delete gltf.images;
    let json = Buffer.from(JSON.stringify(gltf));
    json = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 32)]);
    const binaryChunk = original.subarray(20 + originalJSONLength);
    const header = Buffer.from(original.subarray(0, 20));
    header.writeUInt32LE(20 + json.length + binaryChunk.length, 8);
    header.writeUInt32LE(json.length, 12);
    const buffer = Buffer.concat([header, json, binaryChunk]);
    return new GLTFLoader().parseAsync(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), '');
  }
  const fixtures = [
    ['../public/assets/characters/swat.glb', 12],
    ['../public/assets/characters/hoodie.glb', 10],
    ['../public/assets/weapons/cs2-skins/awp-gungnir.glb', 2],
    ['../public/assets/viewmodel/arms.glb', 3],
  ];
  for (const [file, expectedSkeletons] of fixtures) {
    const source = await loadSkeletonFixture(file);
    let allocated = 0;
    let released = 0;
    for (let cycle = 0; cycle < 50; cycle++) {
      const instance = clone(source.scene);
      const skeletons = new Set();
      instance.traverse(object => { if (object.isSkinnedMesh) skeletons.add(object.skeleton); });
      assert.equal(skeletons.size, expectedSkeletons, file);
      for (const skeleton of skeletons) {
        skeleton.computeBoneTexture();allocated++;
        skeleton.boneTexture.addEventListener('dispose', () => released++);
      }
      disposeInstanceSkeletons(instance);
      assert.ok([...skeletons].every(skeleton => skeleton.boneTexture === null));
    }
    assert.equal(allocated, expectedSkeletons * 50);
    assert.equal(released, allocated, file);
  }
});

test('cancelled lazy audio cannot restart when its decode completes', async () => {
  for(const cancel of ['cancelReload','cancelDraw','stopAll']){
    const audio=new GameAudio();audio.ready=true;audio.sampleManifest={banks:{fixture:['fixture']}};
    let complete;audio.loadBank=()=>new Promise(resolve=>{complete=resolve;});
    audio.play('fixture',{channel:cancel==='cancelDraw'?'draw':'reload',delay:2});
    audio[cancel]();let replayed=false;audio.play=()=>{replayed=true;};
    complete(true);await new Promise(resolve=>setImmediate(resolve));
    assert.equal(replayed,false,cancel);
  }
});
