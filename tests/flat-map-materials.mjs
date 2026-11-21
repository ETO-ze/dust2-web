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

test('architectural surfaces share one tiled, mipmapped atlas and preserve opaque coverage', async () => {
  const {loadFlatSurfaceDetail} = await import('../client/flat-surface-detail.js');
  const [first, second] = await Promise.all([loadFlatSurfaceDetail(), loadFlatSurfaceDetail()]);
  assert.equal(first, second);
  assert.equal(first.image.depth, 8);
  assert.equal(first.image.width, 512);
  assert.equal(first.image.height, 512);
  assert.equal(first.image.data.length, first.image.width * first.image.height * first.image.depth);
  assert.equal(first.format, THREE.RedFormat);
  assert.equal(first.wrapS, THREE.RepeatWrapping);
  assert.equal(first.wrapT, THREE.RepeatWrapping);
  assert.equal(first.generateMipmaps, true);
  for (let i = 0; i < first.image.depth; i++) {
    const size = first.image.width * first.image.height;
    assert.ok(new Set(first.image.data.subarray(i * size, (i + 1) * size)).size > 5);
  }

  const architecturalMaterial = {extras:{surfaceMaterialVersion:1}, extensions:{KHR_materials_unlit:{}}};
  const doc = {extras:{surfaceMaterialVersion:1}, materials:[
    architecturalMaterial,
    {...architecturalMaterial, alphaMode:'MASK'},
    {...architecturalMaterial, extras:{}},
  ]};
  flattenMapDocument(doc, {authoredColors:true});
  assert.deepEqual(doc.materials.map(m => m.extras.surfaceMaterialVersion), [1, undefined, undefined]);
  const root = new THREE.Group();
  for (const {extras} of doc.materials) {
    const material = new THREE.MeshBasicMaterial({vertexColors:true});
    Object.assign(material.userData, extras);
    root.add(new THREE.Mesh(new THREE.PlaneGeometry(), material));
  }
  applyFlatMaterials(root, first);
  const shaders = root.children.map(mesh => {
    const shader = {...THREE.ShaderLib.basic, uniforms:{}};
    mesh.material.onBeforeCompile(shader);
    return shader;
  });
  assert.equal(shaders[0].uniforms.uSurfaceDetail.value, first);
  assert.match(shaders[0].vertexShader, /vColor\.a = 1\.0/);
  assert.match(shaders[0].fragmentShader, /textureGrad\(uSurfaceDetail/);
  assert.ok(shaders.slice(1).every(shader => !shader.uniforms.uSurfaceDetail));
  const legacy = {materials:[architecturalMaterial]};
  flattenMapDocument(legacy, {authoredColors:true});
  assert.equal(legacy.materials[0].extras.surfaceMaterialVersion, undefined);
});

test('the repeating metal finish does not imprint the source panel frame on every wall', async () => {
  const {loadFlatSurfaceDetail} = await import('../client/flat-surface-detail.js');
  const {data, width, height} = (await loadFlatSurfaceDetail()).image;
  const metal = data.subarray(width * height, 2 * width * height);
  const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;
  const textureMean = mean(metal);
  const edges = [
    metal.subarray(0, width),
    metal.subarray(-width),
    Array.from({length: height}, (_, y) => metal[y * width]),
    Array.from({length: height}, (_, y) => metal[y * width + width - 1]),
  ];
  for (const edge of edges) {
    // A panel border in the repeated finish visibly darkens an entire sample edge.
    assert.ok(Math.abs(mean(edge) - textureMean) < 12);
  }
});

test('nine arenas share the exact Blender tiles and retain their map palettes without creating geometry', async () => {
  const {createHash} = await import('node:crypto');
  const {loadFlatSurfaceDetail} = await import('../client/flat-surface-detail.js');
  const {sha256} = await import('../client/arena-finishes/shared.js');
  const palettes = new Set();
  let sharedPixels;
  for (const short of ['dust2','mirage','inferno','nuke','ancient','anubis','cache','train','vertigo']) {
    const id = 'de_' + short;
    const texture = await loadFlatSurfaceDetail(id);
    const {width,height,depth,data} = texture.image;
    assert.deepEqual([width,height,depth], [512,512,6]);
    assert.equal(texture.anisotropy,4);
    if (!sharedPixels) {
      sharedPixels = data;
      const encoded = Uint8Array.from(data, byte => Math.round(byte*63/255));
      assert.equal(createHash('sha256').update(encoded).digest('hex'),sha256);
    }
    assert.equal(data, sharedPixels);
    const root = new THREE.Group();
    const geometry = new THREE.BoxGeometry();
    const original = new THREE.MeshBasicMaterial({vertexColors:true});
    Object.assign(original.userData, {bakedSurface:true,surfaceMaterialVersion:1});
    const mesh = new THREE.Mesh(geometry,original);
    root.add(mesh);
    const index = geometry.index, batches = geometry.groups.length;
    applyFlatMaterials(root,texture,id);
    assert.equal(root.children.length,1);
    assert.equal(mesh.geometry,geometry);
    assert.equal(mesh.geometry.index,index);
    assert.equal(mesh.geometry.groups.length,batches);
    assert.equal(mesh.material.customProgramCacheKey(),'dust2-plane-finishes-v3-6');
    const shader = {...THREE.ShaderLib.basic,uniforms:{}};
    mesh.material.onBeforeCompile(shader);
    assert.equal(shader.uniforms.uFinishScale.value.length,6);
    const cuts = shader.uniforms.uSourcePlates.value;
    assert.equal(cuts.length,7);
    assert.ok(cuts.every(c => c.x>0 && c.y>c.x && 1.1*c.y<1));
    const palette = shader.uniforms.uArenaBase.value;
    assert.ok(palette[4].length() < palette[0].length());
    assert.ok(palette[1].z > palette[2].z && palette[1].x < palette[2].x, 'steel and wood must keep distinct hues');
    palettes.add(palette[0].toArray().join(','));
    mesh.material.dispose();
    geometry.dispose();
    texture.dispose();
  }
  assert.equal(palettes.size,9);
});

test('nine map styles use authored finishes, validate the baked rows and work with the JS gzip fallback', async () => {
  const {createHash} = await import('node:crypto');
  const {sha256} = await import('../client/flat-surface-swatches.js');
  const {loadFlatSurfaceDetail,applySurfaceDetail} = await import('../client/flat-surface-detail.js');
  const atlas = await loadFlatSurfaceDetail();
  const levels = Uint8Array.from(atlas.image.data, value => Math.round(value * 63 / 255));
  assert.equal(createHash('sha256').update(levels).digest('hex'), sha256);
  assert.equal(Object.keys(atlas.userData.profiles).length, 9);
  const program = mapId => {
    const mat = new THREE.MeshBasicMaterial();
    applySurfaceDetail(mat, atlas, mapId);
    const shader = {...THREE.ShaderLib.basic,uniforms:{}};
    mat.onBeforeCompile(shader);
    return shader;
  };
  assert.deepEqual(program('de_ancient').uniforms.uMapFinish.value.toArray().slice(0,2), [6,4]);
  assert.deepEqual(program('de_nuke').uniforms.uMapFinish.value.toArray().slice(0,2), [0,7]);
  const native = globalThis.DecompressionStream;
  try {
    globalThis.DecompressionStream = undefined;
    const {loadFlatSurfaceDetail: fallback} = await import('../client/flat-surface-detail.js?gzip-fallback');
    assert.deepEqual((await fallback()).image.data, atlas.image.data);
  } finally {
    globalThis.DecompressionStream = native;
  }
});
