import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';

const source=JSON.parse(readFileSync(new URL('./nuke-vent-poses.json',import.meta.url)));

// The map export strips the source model's skin binding. Apply the sampled Valve
// joint palette to its original indexed vertices before baking either endpoint.
export function nukeVentPoses(doc,sourceFile) {
  const node=doc.nodes[source.nodeIndex];
  const digest=createHash('sha256').update(readFileSync(sourceFile)).digest('hex');
  if(digest!==source.renderSourceSha256||node?.name!==source.nodeName)throw Error('Nuke vent visual model changed. Re-export its endpoint poses.');
  return {
    nodeIndex:source.nodeIndex,
    vertices(primitive,accessor) {
      const positions=accessor(primitive.attributes.POSITION),joints=accessor(primitive.attributes.JOINTS_0),weights=accessor(primitive.attributes.WEIGHTS_0);
      if(createHash('sha256').update(Buffer.from(positions.buffer,positions.byteOffset,positions.byteLength)).digest('hex')!==source.positionSha256){
        throw Error('Nuke vent does not match the animated source vertices.');
      }
      return Object.entries(source.skinPose).map(([pose,bones])=>{
        const out=new Float32Array(positions.length);
        for(let i=0;i<positions.length/3;i++){
          const [x,y,z]=positions.subarray(i*3,i*3+3);
          for(let k=0;k<4;k++){
            const weight=weights[i*4+k];
            if(!weight)continue;
            const matrix=bones[joints[i*4+k]];
            for(let c=0;c<3;c++)out[i*3+c]+=weight*(matrix[c]*x+matrix[c+4]*y+matrix[c+8]*z+matrix[c+12]);
          }
        }
        return {name:pose==='open'?'nuke-vent-slats-open':'nuke-vent-slats',positions:out};
      });
    },
  };
}
