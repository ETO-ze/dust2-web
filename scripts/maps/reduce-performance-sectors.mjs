import {MeshoptSimplifier} from 'three/addons/libs/meshopt_simplifier.module.js';

// Preserve common boundaries across independently culled sectors, including polygon splits
// whose centroids fall in different cells. Seam vertices within one sector can still collapse.
function positionKey(points, i) {
  return Math.round(points[i] * 1000) + ',' + Math.round(points[i + 1] * 1000) + ',' + Math.round(points[i + 2] * 1000);
}

export async function reduceSectors(chunks, targetTriangles = 260000) {
  const total = chunks.reduce((n, c) => n + c.index.length / 3, 0);
  if (total <= targetTriangles) return;
  await MeshoptSimplifier.ready;
  const owners = new Map();
  for (const [sector, c] of chunks.entries()) {
    for (let i = 0; i < c.xyz.length; i += 3) {
      const k = positionKey(c.xyz, i), previous = owners.get(k);
      if (previous === undefined) owners.set(k, sector);
      else if (previous !== sector && previous >= 0) owners.set(k, -1);
    }
  }
  const ratio = targetTriangles / total;
  for (const c of chunks) {
    if (!/^(tile|sector)_/.test(c.node.name) || c.index.length < 1000) continue;
    const rgba = [], points = [], weld = new Map();
    const remapped = new Uint32Array(c.xyz.length / 3), locked = [];
    for (let v = 0; v < remapped.length; ++v) {
      const xyzOffset = v * 3, colorOffset = v * 4;
      const key = positionKey(c.xyz, xyzOffset);
      const colorKey = ((c.rgba[colorOffset] >> 1) << 14) | ((c.rgba[colorOffset + 1] >> 1) << 7) | (c.rgba[colorOffset + 2] >> 1);
      const vertexKey = key + '#' + colorKey;
      let index = weld.get(vertexKey);
      if (index === undefined) {
        index = points.length / 3;
        points.push(c.xyz[xyzOffset], c.xyz[xyzOffset + 1], c.xyz[xyzOffset + 2]);
        rgba.push(c.rgba[colorOffset], c.rgba[colorOffset + 1], c.rgba[colorOffset + 2], 255);
        locked.push(owners.get(key) === -1 ? 1 : 0);
        weld.set(vertexKey, index);
      }
      remapped[v] = index;
    }
    const positions = Float32Array.from(points);
    const n = positions.length / 3, colors = new Float32Array(n * 3);
    for (let v = 0; v < n; ++v) {
      for (let k = 0; k < 3; ++k) colors[v * 3 + k] = Math.sqrt(rgba[v * 4 + k] / 255);
    }
    const indices = Uint32Array.from(c.index, ix => remapped[ix]);
    // RGB error competes with shape error. This preserves signs and painted details
    // on a planar wall without requiring a texture or a material split.
    const [simplified] = MeshoptSimplifier.simplifyWithAttributes(indices, positions, 3, colors, 3,
      [.42, .60, .42], Uint8Array.from(locked), Math.max(12, 3 * Math.floor(indices.length / 3 * ratio)),
      .078, ['ErrorAbsolute', 'Permissive']);
    const [map, count] = MeshoptSimplifier.compactMesh(simplified);
    c.xyz = new Float32Array(count * 3);
    c.rgba = new Uint8Array(count * 4);
    for (let i = 0; i < map.length; ++i) {
      const v = map[i];
      if (v === 0xffffffff) continue;
      c.xyz.set(positions.subarray(i * 3, i * 3 + 3), v * 3);
      c.rgba.set(rgba.slice(i * 4, i * 4 + 4), v * 4);
    }
    c.index = count <= 65535 ? Uint16Array.from(simplified) : simplified;
  }
}