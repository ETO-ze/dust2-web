// Simplify each original component independently, so a distant rail or tread
// can never be welded to another one. Positions are in metres.
import { MeshoptSimplifier } from 'three/addons/libs/meshopt_simplifier.module.js';

await MeshoptSimplifier.ready;
let input = '';
for await (const chunk of process.stdin) input += chunk;

const simplified = JSON.parse(input).map(({ indices, positions }) => {
  // The source woodwork, box-section rails and simple rungs already meet the budget.
  if (indices.length <= 128 * 3) return [indices, 0];
  const [reduced, error] = MeshoptSimplifier.simplify(
    Uint32Array.from(indices), Float32Array.from(positions), 3, 72 * 3, .008, ['ErrorAbsolute']
  );
  return [Array.from(reduced), error];
});
process.stdout.write(JSON.stringify(simplified));
