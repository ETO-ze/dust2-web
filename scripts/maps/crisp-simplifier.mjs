// Persistent meshoptimizer worker. Each binary request contains a single Blender
// sector in metres, colour attributes, and indices. Nothing leaves this process.
import fs from 'node:fs';
import {MeshoptSimplifier} from 'three/addons/libs/meshopt_simplifier.module.js';

await MeshoptSimplifier.ready;

function input(length) {
  const bytes = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    const n = fs.readSync(0, bytes, offset, length - offset);
    if (!n && !offset) return null;
    if (!n) throw Error('Incomplete sector payload');
    offset += n;
  }
  return bytes;
}
function output(bytes) {
  let sent = 0;
  while (sent < bytes.byteLength) sent += fs.writeSync(1, bytes, sent, bytes.byteLength - sent);
}

for (;;) {
  const header = input(8);
  if (!header) break;
  const nv = header.readUInt32LE(0), count = header.readUInt32LE(4);
  const xyz = new Float32Array(input(nv * 12).buffer);
  const colors = new Uint8Array(input(nv * 4).buffer);
  const locks = new Uint8Array(input(nv).buffer);
  const point = new Uint32Array(input(nv * 4).buffer);
  const indices = new Uint32Array(input(count * 4).buffer);
  const attrs = Float32Array.from({length: nv * 3}, (_, k) => colors[((k / 3) | 0) * 4 + k % 3] / 255);
  const byMaterial = new Map();
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i], b = indices[i+1], c = indices[i+2], id = colors[4*a+3];
    if (colors[4*b+3] !== id || colors[4*c+3] !== id) throw Error('Mixed surface class');
    if (!byMaterial.has(id)) byMaterial.set(id, []);
    byMaterial.get(id).push(a, b, c);
  }
  // Preserve all dynamic meshes upstream. Protect borders, hard edges and at
  // least one entire original triangle in every disconnected surface island.
  // A small target allows work up to the absolute 15 mm error cost. Blender
  // independently checks edited surfaces and discards failing batches.
  const parts = [];
  for (const group of byMaterial.values()) {
    const src = Uint32Array.from(group);
    const parent = Int32Array.from({length:nv}, (_,i)=>i);
    function root(v) {
      while (parent[v] !== v) { parent[v] = parent[parent[v]]; v = parent[v]; }
      return v;
    }
    for(let i=0;i<src.length;i+=3) {
      const a=root(point[src[i]]);
      parent[root(point[src[i+1]])]=a;
      parent[root(point[src[i+2]])]=a;
    }
    const pinned=new Set();
    for(let i=0;i<src.length;i+=3) {
      const container=root(point[src[i]]);
      if (pinned.has(container)) continue;
      pinned.add(container);
      locks[src[i]]=1; locks[src[i+1]]=1; locks[src[i+2]]=1;
    }
    const [result] = MeshoptSimplifier.simplifyWithAttributes(src, xyz, 3, attrs, 3,
      [.18, .26, .18], locks, Math.max(3, Math.floor(src.length/3*.60)*3),
      .015, ['ErrorAbsolute', 'Permissive']);
    parts.push(result);
  }
  const total = parts.reduce((n,p)=>n+p.length,0);
  const response = Buffer.alloc(4);
  response.writeUInt32LE(total);
  output(response);
  for(const part of parts) output(Buffer.from(part.buffer, part.byteOffset, part.byteLength));
}
