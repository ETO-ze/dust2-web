const asBytes=value=>value instanceof ArrayBuffer?new Uint8Array(value):ArrayBuffer.isView(value)?new Uint8Array(value.buffer,value.byteOffset,value.byteLength):null;
const digest=async value=>Array.from(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',value)),v=>v.toString(16).padStart(2,'0')).join('');
const encode=value=>new TextEncoder().encode(value);

export function applyPrivateCollisionExclusions(mask,groups,policy){
 if(!Array.isArray(policy.excludedGroups)||!Array.isArray(groups))throw Error('Invalid private collision policy');
 for(const entry of policy.excludedGroups){
  const {firstTriangle,triangles,reason,sourceEntities}=entry;
  if(!Number.isSafeInteger(firstTriangle)||!Number.isSafeInteger(triangles)||firstTriangle<0||triangles<=0||firstTriangle+triangles>mask.length||entry.solid!==false||entry.resolved!==true)throw Error('Invalid private collision exclusion');
  const group=groups.find(g=>g.firstTriangle===firstTriangle&&g.triangles===triangles);
  if(!group)throw Error('Private collision excludes an unmatched group');
  if(reason==='nonphysical-interaction'){
   const tags=group.extras?.InteractAs;
   if(group.source!=='world_physics.gltf'||group.extras?.CollisionGroup?.toLowerCase()!=='conditionallysolid'||!Array.isArray(tags)||!tags.length||
      !tags.every(tag=>['blocksound','npcclip','navclip'].includes(tag.toLowerCase())))throw Error('Private collision lacks nonphysical source layers');
  }else{
   if(group.source!=='map_physics.gltf')throw Error('Private collision excludes an unmatched brush or prop');
   if(!Array.isArray(sourceEntities)||!sourceEntities.length)throw Error('Private collision lacks source entity state');
   if(reason==='non-solid-prop'){
    if(group.name.split(' ')[0]!=='prop_dynamic'||!sourceEntities.every(e=>e.id&&e.solid===0))throw Error('Private collision lacks nonsolid prop state');
   }else if(reason==='inactive-layout-prop'){
    const layout=/^\[pr#\](?:props\.2v2(?:\.[ab])?|brush\.blocker(?:\.[ab])?)$/i;
    if(group.name.split(' ')[0]!=='prop_dynamic'||!sourceEntities.every(e=>e.id&&e.startdisabled===true&&layout.test(e.targetname)&&/^models\/.+\.vmdl$/.test(e.model)))
     throw Error('Private collision lacks disabled layout prop evidence');
   }else if(group.name!=='func_brush'||!['never-solid','initially-disabled'].includes(reason)||
     !sourceEntities.every(e=>reason==='never-solid'?e.solidity===1:e.solidity===0&&[true,1,'true','1'].includes(e.startdisabled)))throw Error('Private collision is not supported by source brush state');
  }
  mask.fill(0,firstTriangle,firstTriangle+triangles);
 }
 const proof=policy.nativePlayerExclusions;
 if(!proof)return;
 if(proof.schemaVersion!==1||proof.map!==policy.map||proof.sourceSha256!==policy.sourceSha256||
    proof.physicsSha256!==policy.physicsSha256||proof.groupsSha256!==policy.groupsSha256||
    proof.worldModel!=='maps/'+policy.map+'/world_physics.vmdl_c'||!/^[a-f0-9]{64}$/.test(proof.worldPhysicsSha256)||
    !Array.isArray(proof.groups))throw Error('Native PHYS evidence does not match this map');
 for(const row of proof.groups){
  const match=groups.find(g=>g.firstTriangle===row.firstTriangle&&g.triangles===row.triangles);
  if(!match||match.source!=='world_physics.gltf'||!Number.isSafeInteger(row.firstTriangle)||!Number.isSafeInteger(row.triangles)||
     row.firstTriangle<0||row.triangles<=0||row.firstTriangle+row.triangles>mask.length||!Number.isSafeInteger(row.nativeAttribute)||row.nativeAttribute<0||
     !(row.nativeShapes>0)||!Array.isArray(row.interactExclude)||!row.interactExclude.includes('player')||
     match.mask!==row.oldMask||!(match.mask&1)||match.extras?.SurfaceProperty!==row.surfaceProperty||
     match.extras?.CollisionGroup!==row.group||JSON.stringify(match.extras?.InteractAs)!==JSON.stringify(row.interactAs))
   throw Error('Native PHYS player exclusion does not match the exported group');
  // Preserve all bullet and grenade bits authored in the original mask.
  for(let i=row.firstTriangle,end=i+row.triangles;i<end;i++)mask[i]&=~1;
 }
}

/** Shared private-map decoding. Source geometry is immutable; only explicitly
 * source-declared nonphysical ranges can be removed. */
export async function decodePrivateMapCollision({bytes,maskBytes,groupsText,policyText,map,expected={}},{channels=[1]}={}) {
 const original=asBytes(bytes),originalMask=asBytes(maskBytes);
 if(!original||!originalMask||original.byteLength%36||!channels.length||channels.some(c=>![1,2,4].includes(c)))throw Error('Invalid private collision buffers or channels');
 const [physicsSha256,maskSha256,groupsSha256,policySha256]=await Promise.all([digest(original),digest(originalMask),digest(encode(groupsText)),digest(encode(policyText))]);
 const policy=JSON.parse(policyText),groups=JSON.parse(groupsText);
 if(policy.map!==map.id||policy.sourceSha256!==map.sourceSha256||policy.physicsSha256!==physicsSha256||policy.maskSha256!==maskSha256||policy.groupsSha256!==groupsSha256)throw Error('Private collision source hashes do not match');
 for(const [key,value]of Object.entries({physicsSha256,maskSha256,policySha256}))if(expected[key]&&expected[key]!==value)throw Error('Private collision differs from server '+key);
 const mask=Uint8Array.from(originalMask);
 applyPrivateCollisionExclusions(mask,groups,policy);
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
