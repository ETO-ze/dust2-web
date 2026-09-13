import {B_WINDOW_PATCH as patch} from './b-window-geometry.js';

/** Apply identically on server and client. Tiny test worlds or future map
 * versions pass through unchanged; original material IDs survive clipping. */
export function patchMapCollision(positions,materials){
 if(positions.length!==patch.sourceLength||!patch.checks.every(c=>c.positions.every((v,i)=>Math.abs(positions[c.triangle*9+i]-v)<.00001)))return {positions,materials};
 const removed=new Set(patch.removed),keptLength=positions.length-removed.size*9,extra=patch.outside.reduce((n,p)=>n+p.positions.length,0)+patch.indices.length*3;
 const result=new Float32Array(keptLength+extra),types=materials?new Uint8Array(result.length/9):null;let at=0;
 for(let t=0;t<positions.length/9;t++)if(!removed.has(t)){for(let j=0;j<9;j++)result[at+j]=positions[t*9+j];if(types)types[at/9]=materials[t];at+=9;}
 for(const part of patch.outside){result.set(part.positions,at);if(types)types.fill(materials[part.source],at/9,(at+part.positions.length)/9);at+=part.positions.length;}
 // Replacement uses the existing concrete/brick ballistics (material 0).
 for(const index of patch.indices){for(let j=0;j<3;j++)result[at++]=patch.vertices[index*3+j];}
 return {positions:result,materials:types};
}
