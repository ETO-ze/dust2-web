/** Collapse the welded triangle soup before baking industrial surface details. */
import fs from 'node:fs';
import {MeshoptSimplifier} from 'three/addons/libs/meshopt_simplifier.module.js';

const [input, output, limit] = process.argv.slice(2);
const file = fs.readFileSync(input);
if (file.byteLength % 36 || !Number.isSafeInteger(Number(limit)) || Number(limit) < 1) {
  throw new Error('Expected float32 triangles and a positive triangle budget');
}
const points = new Float32Array(file.buffer, file.byteOffset, file.byteLength / 4);
await MeshoptSimplifier.ready;
const sourceIndices = MeshoptSimplifier.generatePositionRemap(points, 3);
const [reduced] = MeshoptSimplifier.simplify(sourceIndices, points, 3,
  Math.min(sourceIndices.length, Number(limit) * 3), .15, ['ErrorAbsolute', 'Permissive']);
const faces = new Float32Array(reduced.length * 3);
for (let i = 0; i < reduced.length; ++i) {
  const from = reduced[i] * 3;
  faces.set(points.subarray(from, from + 3), i * 3);
}
fs.writeFileSync(output, Buffer.from(faces.buffer));
console.log('Visibility surface reduction:', sourceIndices.length / 3, '→', reduced.length / 3, 'triangles');