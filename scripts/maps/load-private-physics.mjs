import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const sha=buffer=>crypto.createHash('sha256').update(buffer).digest('hex');

/** Only the hash-bound source entity policy may remove collision groups.
 * A stale/missing policy is an error, so a replay cannot silently use different
 * geometry than the navigation audit. Original archives are never rewritten. */
export function loadPrivatePhysics(directory,channel=1) {
 if(![1,2,4].includes(channel))throw new Error('Private physics channel must be player, bullet, or grenade');
 const compiled=path.join(directory,'compiled'),bytes=fs.readFileSync(path.join(compiled,'physics.f32'));
 const originalMask=fs.readFileSync(path.join(compiled,'physics-mask.u8'));
 const policyBytes=fs.readFileSync(path.join(directory,'entity-collision-policy.json'));
 const policy=JSON.parse(policyBytes);
 const map=JSON.parse(fs.readFileSync(path.join(compiled,'map.json')));
 const groupsBytes=fs.readFileSync(path.join(compiled,'physics-groups.json')),groups=JSON.parse(groupsBytes);
 const physicsSha256=sha(bytes),maskSha256=sha(originalMask);
 if(policy.map!==map.id||policy.sourceSha256!==map.sourceSha256||policy.physicsSha256!==physicsSha256||policy.maskSha256!==maskSha256||policy.groupsSha256!==sha(groupsBytes))throw new Error('Private collision policy does not match immutable map geometry');
 const mask=Buffer.from(originalMask);
 for(const group of policy.excludedGroups){
  if(!Number.isSafeInteger(group.firstTriangle)||!Number.isSafeInteger(group.triangles)||group.firstTriangle<0||group.triangles<0||group.firstTriangle+group.triangles>mask.length||!['never-solid','initially-disabled'].includes(group.reason)||group.solid!==false||group.resolved!==true)throw new Error('Invalid private collision policy exclusion');
  if(!groups.some(g=>g.name==='func_brush'&&g.source==='map_physics.gltf'&&g.firstTriangle===group.firstTriangle&&g.triangles===group.triangles))throw new Error('Private collision policy excludes an unmatched brush group');
  if(!group.sourceEntities?.length||!group.sourceEntities.every(e=>group.reason==='never-solid'?e.solidity===1:e.solidity===0&&[true,1,'true','1'].includes(e.startdisabled)))throw new Error('Private collision policy is not supported by source entity state');
  mask.fill(0,group.firstTriangle,group.firstTriangle+group.triangles);
 }
 const all=new Float32Array(bytes.buffer,bytes.byteOffset,bytes.length/4);
 if(all.length!==mask.length*9)throw new Error('Collision mask length does not match geometry');
 const positions=new Float32Array(mask.filter(m=>m&channel).length*9);
 const sourceTriangles=new Uint32Array(positions.length/9);
 for(let i=0,j=0;i<mask.length;i++)if(mask[i]&channel){positions.set(all.subarray(i*9,i*9+9),j);sourceTriangles[j/9]=i;j+=9;}
 return {positions,sourceTriangles,physicsSha256,maskSha256,policySha256:sha(policyBytes),excludedTriangles:policy.excludedTriangles};
}
