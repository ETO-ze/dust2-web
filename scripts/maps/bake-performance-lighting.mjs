/** Bake visibility-dependent light and pack local vertex positions for the low-poly pool.
 * This operates on the flattened export only. Physics and the live renderer never trace these rays.
 */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {BufferAttribute, BufferGeometry, DoubleSide, Ray, Vector3} from 'three';
import {MeshBVH} from 'three-mesh-bvh';
import {reduceSectors} from './reduce-performance-sectors.mjs';

const folder = path.resolve(process.argv[2]);
const jsonPath = path.join(folder, 'render', 'map.gltf');
const binPath = path.join(folder, 'render', 'map.bin');
const doc = JSON.parse(fs.readFileSync(jsonPath));
if (doc.extras?.lightingBakeVersion === 2) process.exit(0);
const bytes = fs.readFileSync(binPath);
const chunks = [];
function arrayFor(id, Type, width) {
  const accessor = doc.accessors[id];
  const view = doc.bufferViews[accessor.bufferView];
  if (view.byteStride || view.buffer !== 0 || accessor.byteOffset || accessor.sparse) {
    throw Error('Expected packed, uncompressed low-poly export');
  }
  return new Type(bytes.buffer, bytes.byteOffset + view.byteOffset, accessor.count * width);
}
for (const node of doc.nodes) {
  if (node.matrix || node.translation || node.scale || node.rotation || node.children) throw Error('Expected flattened source nodes');
  const mesh = doc.meshes[node.mesh];
  if (mesh.primitives.length !== 1) throw Error('Expected one triangle batch per sector');
  const p = mesh.primitives[0];
  const pos = p.attributes.POSITION, col = p.attributes.COLOR_0;
  if (p.mode !== undefined && p.mode !== 4 || doc.accessors[pos].componentType !== 5126 || doc.accessors[col].componentType !== 5121) {
    throw Error('Unsupported primitive format');
  }
  const xyz = arrayFor(pos, Float32Array, 3);
  const rgba = arrayFor(col, Uint8Array, 4);
  const index = arrayFor(p.indices, doc.accessors[p.indices].componentType === 5123 ? Uint16Array : Uint32Array, 1);
  chunks.push({node, pos, col, elements: p.indices, xyz, rgba, index});
}

const beforeReduction = chunks.reduce((n, c) => n + c.index.length / 3, 0);
await reduceSectors(chunks);
const outputTriangles = chunks.reduce((n, c) => n + c.index.length / 3, 0);

// Exclude destructible pieces from the shadow world. Their colour can receive ambient light.
const occluders = chunks.filter(({node}) => /^(?:sector|tile)_/.test(node.name));
if (!occluders.length) throw Error('No static landscape geometry');
const xyz = new Float32Array(occluders.reduce((n, c) => n + c.xyz.length, 0));
const triangles = new Uint32Array(occluders.reduce((n, c) => n + c.index.length, 0));
let xyzOffset = 0, indexOffset = 0;
for (const c of occluders) {
  xyz.set(c.xyz, xyzOffset);
  const start = xyzOffset / 3;
  for (const index of c.index) triangles[indexOffset++] = start + index;
  xyzOffset += c.xyz.length;
}
const geometry = new BufferGeometry();
geometry.setAttribute('position', new BufferAttribute(xyz, 3));
geometry.setIndex(new BufferAttribute(triangles, 1));
const bvh = new MeshBVH(geometry, {targetLeafSize: 7});
const ray = new Ray();
const skyDirections = [[1,.67,.21],[-.54,.78,.75],[-.61,.62,-.87],[.32,.82,-.92],[.05,1,.04]].map(d => new Vector3(...d).normalize());
// Mesh coordinates precede the +90° world rotation. Source key and colour stay consistent across tiles.
const sunlight = new Vector3(-.40, .83, -.37).normalize();
const cache = new Map();
const changes = new Map();
let maxError = 0;
function illumination(x, y, z) {
  const key = [x, y, z].map(v => Math.round(v * 25)).join(',');
  if (cache.has(key)) return cache.get(key);
  ray.origin.set(x, y, z);
  let openness = 0;
  for (const dir of skyDirections) {
    ray.direction.copy(dir);
    const hit = bvh.raycastFirst(ray, DoubleSide, .12, 8);
    openness += hit ? .15 + .85 * Math.sqrt(hit.distance / 8) : 1;
  }
  openness /= skyDirections.length;
  ray.direction.copy(sunlight);
  const sunny = bvh.raycastFirst(ray, DoubleSide, .15, 95) ? 0 : 1;
  const scale = .28 + .45 * openness + .37 * sunny;
  const light = [scale * (.94 + .12 * sunny), scale * (.99 + .025 * sunny), scale * (1.07 - .10 * sunny)];
  cache.set(key, light);
  return light;
}
for (const c of chunks) {
  const a = doc.accessors[c.pos];
  a.count = c.xyz.length / 3;
  const colorAccessor = doc.accessors[c.col], indexAccessor = doc.accessors[c.elements];
  colorAccessor.count = a.count;
  indexAccessor.count = c.index.length;
  indexAccessor.componentType = c.index instanceof Uint16Array ? 5123 : 5125;
  changes.set(a.bufferView, Buffer.from(c.xyz.buffer, c.xyz.byteOffset, c.xyz.byteLength));
  changes.set(colorAccessor.bufferView, Buffer.from(c.rgba.buffer, c.rgba.byteOffset, c.rgba.byteLength));
  changes.set(indexAccessor.bufferView, Buffer.from(c.index.buffer, c.index.byteOffset, c.index.byteLength));
  const lo = a.min, span = a.max.map((v, i) => v - lo[i]);
  const compact = Math.max(...span) / 65535 <= .01;
  const packed = compact ? new Uint16Array(a.count * 4) : null;
  const minimum = [65535,65535,65535], maximum = [0,0,0];
  for (let i = 0; i < a.count; ++i) {
    const j = i * 3;
    const light = illumination(c.xyz[j], c.xyz[j + 1], c.xyz[j + 2]);
    const offset = i * 4;
    const luminance = c.rgba[offset] * .213 + c.rgba[offset + 1] * .715 + c.rgba[offset + 2] * .072;
    for (let k = 0; k < 3; ++k) {
      // Keep distinct paint and stone hues in sunlight. Lift deep shade slightly to help legibility indoors.
      const toned = luminance + 1.10 * (c.rgba[offset + k] - luminance);
      c.rgba[offset + k] = Math.min(255, Math.max(0, Math.round(toned * light[k] + 1)));
      if (packed) {
        const q = span[k] ? Math.round((c.xyz[j + k] - lo[k]) / span[k] * 65535) : 0;
        packed[i * 4 + k] = q;
        minimum[k] = Math.min(minimum[k], q);
        maximum[k] = Math.max(maximum[k], q);
        maxError = Math.max(maxError, Math.abs(c.xyz[j + k] - (lo[k] + q * span[k] / 65535)));
      }
    }
  }
  if (packed) {
    c.node.translation = [...lo];
    c.node.scale = span.map(v => v || 1);
    a.min = minimum;
    a.max = maximum;
    a.componentType = 5123;
    a.normalized = true;
    changes.set(a.bufferView, Buffer.from(packed.buffer));
    doc.bufferViews[a.bufferView].byteStride = 8; // VEC3/uint16, four-byte aligned vertices.
  }
}
geometry.dispose();
let offset = 0;
const result = [];
for (const [i, view] of doc.bufferViews.entries()) {
  const data = changes.get(i) || bytes.subarray(view.byteOffset, view.byteOffset + view.byteLength);
  view.byteOffset = offset;
  view.byteLength = data.length;
  result.push(data);
  offset += data.length;
  const padding = (-offset) & 3;
  if (padding) { result.push(Buffer.alloc(padding)); offset += padding; }
}
if (changes.size) {
  doc.extensionsUsed = [...new Set([...(doc.extensionsUsed || []), 'KHR_mesh_quantization'])];
  doc.extensionsRequired = [...new Set([...(doc.extensionsRequired || []), 'KHR_mesh_quantization'])];
}
doc.buffers[0].byteLength = offset;
Object.assign(doc.extras, {lightingBakeVersion: 2, beforeSectorReduction: beforeReduction, outputTriangles, lightingSamples: cache.size, positionErrorMm: +(maxError * 1000).toFixed(3)});
const json = JSON.stringify(doc);
fs.writeFileSync(binPath + '.part', Buffer.concat(result));
fs.writeFileSync(jsonPath + '.part', json);
fs.renameSync(binPath + '.part', binPath);
fs.renameSync(jsonPath + '.part', jsonPath);
const mappingPath = path.join(folder, 'flat-breakables.json');
if (fs.existsSync(mappingPath)) {
  const mapping = JSON.parse(fs.readFileSync(mappingPath));
  mapping.renderSha256 = createHash('sha256').update(json).digest('hex');
  fs.writeFileSync(mappingPath + '.part', JSON.stringify(mapping));
  fs.renameSync(mappingPath + '.part', mappingPath);
}
console.log(path.basename(folder), cache.size, 'lighting samples;', beforeReduction, '→', outputTriangles, 'triangles;', bytes.length, '->', offset, 'bytes;', doc.extras.positionErrorMm, 'mm');