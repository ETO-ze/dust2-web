import {PRIVATE_BREAKABLES} from './private-map-breakables-data.js';
import {GLASS_MAPS} from './private-map-glass-data.js';

// de_nuke VPK, Hammer entity 2:61814:42349, model nuke_vent_slats.vmdl.
// Its 1 HP model starts with the ten louvers tilted. Both intact poses span the
// opening; only breaking the grille clears its VPK hull and disables its button.
export const NUKE_VENT = {
  schemaVersion:1,mapId:'de_nuke',
  sourceSha256:'ab56860b13c86ead3f0f17f1488e4cec44ac0208dbfdda9f1fecb5d5e769d4a7',
  physicsSha256:'9daae8f8ecfb52c92edfc10d096701e51f3ea24897b050158826bca9136082ab',
  maskSha256:'6cce2497ac50c45ed9b1ea4b72ca53915a962c7288d7a8243c2afa3e2f7b59ab',
  groupsSha256:'404f3abc71678d0212ed2456231b11240227bab24f9a6ceaee7f375e2e2305b0',
  renderSha256:'c735572f522ec5316862cca209361da37b08c2ae947df6e1374624fe2903f659',
  initialHiddenNodeIndices:[],
  objects:[{id:'nuke-vent-slats',firstTriangle:191834,triangles:20,material:'metal',health:1,
    nodeIndices:[8594],nodeNames:['nuke_vent_slats.nuke_vent_slats_bg_body_lod0'],restoredNodeIndices:[],
    initialOpen:true,openNodeName:'nuke-vent-slats-open',
    button:{min:[10.5664,-10.5664,35.50919],max:[12.192,-8.4836,35.83939]},
    slab:{min:[10.56639,-10.56641,35.56242],max:[12.192,-8.4836,35.66160]}}],
};
const policies = {...GLASS_MAPS};
for (const base of [PRIVATE_BREAKABLES, NUKE_VENT]) {
  const glass = GLASS_MAPS[base.mapId];
  for (const key of ['sourceSha256','renderSha256','physicsSha256','groupsSha256','maskSha256']) {
    if (glass[key] !== base[key]) throw Error('Glass policy has a different source: ' + base.mapId);
  }
  policies[base.mapId] = {...base, objects: [...base.objects, ...glass.objects]};
}
export function privateEntities(id){ return policies[id] || null; }

// A compact document addresses a different binary layout. Never accept the
// document and geometry hashes independently, even when both are known.
export function qualityEntityRenderMatches(policy, documentHash, bufferHash) {
  if (documentHash === policy.renderSha256) return !policy.renderBufferSha256 || bufferHash === policy.renderBufferSha256;
  return !!policy.alternateRenderSha256 && documentHash === policy.alternateRenderSha256 && bufferHash === policy.alternateBufferSha256;
}
