import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {applyFlatMaterials} from '../client/flat-map-renderer.js';
import {cutoutImagePaths, flatMatchManifest, flattenMapDocument} from '../client/flat-map-materials.js';

test('flat mode removes albedo, lighting and vertex colour data while retaining cutout UVs and alpha', () => {
  const pbr = index => ({baseColorTexture: {index}});
  const scene = {
    images: [{uri:'wall.webp'}, {uri:'grate.webp'}],
    textures: [{source:0}, {extensions:{EXT_texture_webp:{source:1}}}],
    materials: [{name:'wall',pbrMetallicRoughness:pbr(0)}, {name:'fence',alphaMode:'MASK',
      alphaCutoff:0.48,doubleSided:true,pbrMetallicRoughness:pbr(1),normalTexture:{index:0}}],
    meshes: [{primitives:[0,1].map(material=>({material,attributes:{POSITION:0,NORMAL:1,TEXCOORD_0:2,COLOR_0:3}}))}],
    nodes:[{name:'breakable',mesh:0}], buffers:[{uri:'map.bin'}],
  };
  const paths = cutoutImagePaths(scene,'assets/map-cs2/dust2-web.gltf');
  const manifest = {files:['assets/map-cs2/wall.webp','assets/map-cs2/grate.webp','assets/map/positions.f32',
    'assets/sky/daylight.hdr','assets/characters/ct.png'].map(path=>({path,bytes:5}))};
  assert.deepEqual(flatMatchManifest(manifest,paths).files.map(f=>f.path),
    ['assets/map-cs2/grate.webp','assets/map/positions.f32','assets/characters/ct.png']);
  flattenMapDocument(scene);
  assert.deepEqual(scene.images,[{uri:'grate.webp'}]);
  assert.equal(scene.textures[0].extensions.EXT_texture_webp.source,0);
  assert.equal(scene.materials[1].pbrMetallicRoughness.baseColorTexture.index,0);
  assert.equal(scene.materials[1].normalTexture,undefined);
  assert.equal(scene.materials[1].alphaCutoff,0.48);
  assert.equal(scene.materials[1].doubleSided,true);
  assert.deepEqual(scene.meshes[0].primitives.map(p=>p.attributes),[{POSITION:0,NORMAL:1},{POSITION:0,NORMAL:1,TEXCOORD_0:2}]);
  assert.deepEqual(scene.nodes,[{name:'breakable',mesh:0}]);
});

test('authored flat packages keep the compiled palette, vertex colours and untextured geometry', () => {
  const doc={materials:[{pbrMetallicRoughness:{baseColorFactor:[0.26,0.39,0.40,1]}}],
    meshes:[{primitives:[{attributes:{POSITION:0,COLOR_0:1},material:0}]}]};
  flattenMapDocument(doc,{authoredColors:true});
  assert.deepEqual(doc.materials[0].pbrMetallicRoughness.baseColorFactor,[0.26,0.39,0.40,1]);
  assert.equal(doc.meshes[0].primitives[0].attributes.COLOR_0,1);
  assert.deepEqual(doc.images,[]);
});

test('only explicitly tagged wire panels receive the untextured cutout, keeping posts and signs opaque', () => {
  const source = {extensions:{KHR_materials_unlit:{}}};
  const doc = {
    materials:[{...source, name:'steel fence post'}, {...source, extras:{performanceFence:true}}],
    meshes:[{primitives:[0,1].map(material => ({material, attributes:{POSITION:0}}))}],
  };
  flattenMapDocument(doc, {authoredColors:true});
  assert.equal(doc.materials.length, 2);
  const root = new THREE.Group(), geometry = new THREE.PlaneGeometry();
  const original = doc.materials.map(({extras}) => {
    const material = new THREE.MeshBasicMaterial();
    Object.assign(material.userData, extras);
    return material;
  });
  const [post, near, far] = [0,1,1].map(id => new THREE.Mesh(geometry, original[id]));
  root.add(post, near, far);
  applyFlatMaterials(root);
  assert.equal(post.material.transparent, false);
  assert.equal(near.material, far.material);
  assert.equal(near.material.userData.performanceFence, true);
  assert.equal(near.material.transparent, true);
  assert.equal(near.material.depthWrite, false);
  assert.equal(near.material.side, THREE.DoubleSide);
  assert.equal(near.material.forceSinglePass, true);
  assert.equal(near.material.map, null);
  const shader = {...THREE.ShaderLib.basic};
  near.material.onBeforeCompile(shader);
  assert.match(shader.vertexShader, /modelMatrix \* vec4\(transformed/);
  assert.match(shader.fragmentShader, /diffuseColor\.a \*= fenceCoverage\(\)/);
});
