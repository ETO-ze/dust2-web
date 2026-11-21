import {MeshoptSimplifier} from 'three/addons/libs/meshopt_simplifier.module.js';

// Sectors are culled independently at runtime. Batches within a sector may
// share one draw, but an edge collapse must not transfer a material ID or fold
// a thin steel rim into an adjacent wall.
function positionKey(points, i) {
  return Math.round(points[i] * 1000) + ',' + Math.round(points[i + 1] * 1000) + ',' + Math.round(points[i + 2] * 1000);
}

function partitionVertices(chunk) {
  const groups = new Uint16Array(chunk.rgba.length / 4);
  for (let i = 0; i < groups.length; i++) groups[i] = chunk.rgba[i * 4 + 3];
  const ranges = chunk.fittedRanges || [];
  for (let i = 0; i < ranges.length; i += 2) {
    for (let v = ranges[i]; v < ranges[i + 1]; v++) groups[v] += 256;
  }
  const paint=chunk.paintRanges || [];
  for(let i=0;i<paint.length;i+=2)groups.fill(767,paint[i],paint[i+1]);
  return groups;
}

function reducePart(chunk, indices, owners, label, ratio) {
  const positions = [], colors = [], locks = [], weld = new Map(), remap = new Map();
  for (let j = 0; j < indices.length; j++) {
    const source = indices[j];
    let index = remap.get(source);
    if (index === undefined) {
      const p = source * 3, c = source * 4;
      const key = positionKey(chunk.xyz, p);
      const rgb = ((chunk.rgba[c] >> 1) << 14) | ((chunk.rgba[c + 1] >> 1) << 7) | (chunk.rgba[c + 2] >> 1);
      const vertex = key + '#' + rgb;
      index = weld.get(vertex);
      if (index === undefined) {
        index = positions.length / 3;
        positions.push(chunk.xyz[p], chunk.xyz[p + 1], chunk.xyz[p + 2]);
        colors.push(chunk.rgba[c], chunk.rgba[c + 1], chunk.rgba[c + 2], chunk.rgba[c + 3]);
        locks.push(owners.get(key) === -1 ? 1 : 0);
        weld.set(vertex, index);
      }
      remap.set(source, index);
    }
    indices[j] = index;
  }
  const points = Float32Array.from(positions);
  const attributes = new Float32Array(points.length);
  for (let i = 0; i < attributes.length; i++) {
    attributes[i] = Math.sqrt(colors[Math.floor(i / 3) * 4 + i % 3] / 255);
  }
  const target = Math.max(3, 3 * Math.floor(indices.length / 3 * ratio));
  // Broad textured surfaces carry their fine grain in the shared material.
  // Colour-only simplification can be looser there than on untextured signs.
  const weights=(label & 255) === 255 ? [.32, .45, .32] : [.14, .20, .14];
  const result = label === 767 ? indices : MeshoptSimplifier.simplifyWithAttributes(indices, points, 3, attributes, 3,
    weights, Uint8Array.from(locks), target, label >= 256 ? .018 : .078, ['ErrorAbsolute', 'Permissive'])[0];
  const [used, count] = MeshoptSimplifier.compactMesh(result);
  const xyz = new Float32Array(count * 3), rgba = new Uint8Array(count * 4);
  for (let i = 0; i < used.length; i++) {
    if (used[i] === 0xffffffff) continue;
    xyz.set(points.subarray(i * 3, i * 3 + 3), used[i] * 3);
    rgba.set(colors.slice(i * 4, i * 4 + 4), used[i] * 4);
  }
  return {xyz, rgba, index: result};
}

export async function reduceSectors(chunks, targetTriangles = 260000) {
  const total = chunks.reduce((n, c) => n + c.index.length / 3, 0);
  if (total <= targetTriangles) return;
  await MeshoptSimplifier.ready;
  const owners = new Map();
  const partitions = chunks.map(partitionVertices);
  for (const [sector, chunk] of chunks.entries()) {
    for (let v = 0; v < partitions[sector].length; v++) {
      const key = positionKey(chunk.xyz, v * 3);
      const part = sector * 1024 + partitions[sector][v], previous = owners.get(key);
      if (previous === undefined) owners.set(key, part);
      else if (previous !== part && previous >= 0) owners.set(key, -1);
    }
  }
  const ratio = targetTriangles / total;
  for (const [sector, chunk] of chunks.entries()) {
    if (!/^(tile|sector)_/.test(chunk.node.name) || chunk.index.length < 1000) continue;
    const groups = new Map(), labels = partitions[sector];
    for (let i = 0; i < chunk.index.length; i += 3) {
      const a = chunk.index[i], b = chunk.index[i + 1], c = chunk.index[i + 2];
      const label = labels[a];
      if (labels[b] !== label || labels[c] !== label) throw Error('Source triangle crosses a material');
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label).push(a, b, c);
    }
    const parts = [];
    for (const [label, list] of groups) {
      parts.push(reducePart(chunk, Uint32Array.from(list), owners, label, ratio));
    }
    const vertices = parts.reduce((n, p) => n + p.xyz.length / 3, 0);
    chunk.xyz = new Float32Array(vertices * 3);
    chunk.rgba = new Uint8Array(vertices * 4);
    const Index = vertices <= 65535 ? Uint16Array : Uint32Array;
    chunk.index = new Index(parts.reduce((n, p) => n + p.index.length, 0));
    let vertex = 0, index = 0;
    for (const part of parts) {
      chunk.xyz.set(part.xyz, vertex * 3);
      chunk.rgba.set(part.rgba, vertex * 4);
      for (const local of part.index) chunk.index[index++] = vertex + local;
      vertex += part.xyz.length / 3;
    }
  }
}
