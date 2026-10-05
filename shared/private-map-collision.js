const asBytes=value=>value instanceof ArrayBuffer?new Uint8Array(value):ArrayBuffer.isView(value)?new Uint8Array(value.buffer,value.byteOffset,value.byteLength):null;
const digest=async value=>Array.from(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',value)),v=>v.toString(16).padStart(2,'0')).join('');
const encode=value=>new TextEncoder().encode(value);

/** Shared private-map decoding. Source geometry is immutable; only explicitly
 * source-disabled brush ranges can be removed. No collision tolerance changes. */
export async function decodePrivateMapCollision({bytes,maskBytes,groupsText,policyText,map,expected={}},{channels=[1]}={}) {
 const original=asBytes(bytes),originalMask=asBytes(maskBytes);
 if(!original||!originalMask||original.byteLength%36||!channels.length||channels.some(c=>![1,2,4].includes(c)))throw Error('Invalid private collision buffers or channels');
 const [physicsSha256,maskSha256,groupsSha256,policySha256]=await Promise.all([digest(original),digest(originalMask),digest(encode(groupsText)),digest(encode(policyText))]);
 const policy=JSON.parse(policyText),groups=JSON.parse(groupsText);
 if(policy.map!==map.id||policy.sourceSha256!==map.sourceSha256||policy.physicsSha256!==physicsSha256||policy.maskSha256!==maskSha256||policy.groupsSha256!==groupsSha256)throw Error('Private collision source hashes do not match');
 for(const [key,value]of Object.entries({physicsSha256,maskSha256,policySha256}))if(expected[key]&&expected[key]!==value)throw Error('Private collision differs from server '+key);
 const mask=originalMask.slice();
 if(!Array.isArray(policy.excludedGroups)||!Array.isArray(groups))throw Error('Invalid private collision policy');
 for(const group of policy.excludedGroups){
  if(!Number.isSafeInteger(group.firstTriangle)||!Number.isSafeInteger(group.triangles)||group.firstTriangle<0||group.triangles<=0||group.firstTriangle+group.triangles>mask.length||group.solid!==false||group.resolved!==true||!['never-solid','initially-disabled'].includes(group.reason))throw Error('Invalid private collision exclusion');
  if(!groups.some(g=>g.name==='func_brush'&&g.source==='map_physics.gltf'&&g.firstTriangle===group.firstTriangle&&g.triangles===group.triangles))throw Error('Private collision excludes an unmatched brush');
  if(!group.sourceEntities?.length||!group.sourceEntities.every(e=>group.reason==='never-solid'?e.solidity===1:e.solidity===0&&[true,1,'true','1'].includes(e.startdisabled)))throw Error('Private collision lacks source entity state');
  mask.fill(0,group.firstTriangle,group.firstTriangle+group.triangles);
 }
 if(original.byteLength!==mask.length*36||mask.length!==map.physics.triangles)throw Error('Private collision geometry length differs from map');
 const aligned=original.byteOffset%4===0?original:original.slice();
 const all=new Float32Array(aligned.buffer,aligned.byteOffset,aligned.byteLength/4),positionsByChannel={},sourceTrianglesByChannel={};
 for(const channel of new Set(channels)){
  let count=0;for(const bits of mask)if(bits&channel)count++;
  const positions=new Float32Array(count*9);
  const sourceTriangles=new Uint32Array(count);
  for(let i=0,j=0;i<mask.length;i++)if(mask[i]&channel){positions.set(all.subarray(i*9,i*9+9),j);sourceTriangles[j/9]=i;j+=9;}
  positionsByChannel[channel]=positions;
  sourceTrianglesByChannel[channel]=sourceTriangles;
 }
 return {positionsByChannel,sourceTrianglesByChannel,physicsSha256,maskSha256,policySha256};
}
