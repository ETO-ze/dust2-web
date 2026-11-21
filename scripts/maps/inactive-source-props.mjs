import {Matrix4, Quaternion, Vector3} from 'three';

// The exporter emits disabled Wingman props alongside the standard map. Many
// models are also used by active props, so identify the instance in world space.
const layoutTarget = /^\[pr#\](?:props\.2v2(?:\.[ab])?|brush\.blocker(?:\.[ab])?)$/i;
const sourceUnit = 0.0254;
const matchDistance = 0.005;

function propInstances(entities) {
  const byModel = new Map();
  const enabled = [...entities.matchAll(/^@On\S+\s+(?:Delay=\S+\s+)?(?:Enable|Toggle)\s+(\S+)/gim)]
    .map(match => match[1].replace(/^"|"$/g, '').toLowerCase());
  for (const block of entities.split(/^====\d+====\s*$/m)) {
    const fields = Object.fromEntries([...block.matchAll(/^(classname|model|origin|targetname|startdisabled)[ \t]+([^\r\n]+)/gm)]
      .map(([,k,v]) => [k, v.trim().replace(/^"|"$/g, '')]));
    const model = fields.model?.match(/(?:^|\/)([^/"\\]+)\.vmdl$/i)?.[1].toLowerCase();
    if (!model || !fields.classname || !fields.origin) continue;
    let origin;
    try { origin = JSON.parse(fields.origin); } catch {continue;}
    if (!Array.isArray(origin) || origin.length!==3 || !origin.every(Number.isFinite)) continue;
    const [x,y,z] = origin, target = (fields.targetname || '').toLowerCase();
    const mayEnable = enabled.some(pattern => pattern.endsWith('*') ? target.startsWith(pattern.slice(0,-1)) : target===pattern);
    const hidden = fields.classname==='prop_dynamic' && /^(true|1)$/i.test(fields.startdisabled) &&
      layoutTarget.test(target) && !mayEnable;
    if (!byModel.has(model)) byModel.set(model, []);
    byModel.get(model).push({origin:new Vector3(y*sourceUnit,z*sourceUnit,x*sourceUnit), hidden});
  }
  for(const [model, instances] of byModel) if(!instances.some(e=>e.hidden)) byModel.delete(model);
  return byModel;
}

export function inactiveVisualPropNodes(doc, entitiesText) {
  const byModel = propInstances(entitiesText);
  const hidden = new Set();
  if (!byModel.size) return hidden;
  const position = new Vector3();
  function visit(index, parent) {
    const node=doc.nodes[index];
    const local=node.matrix ? new Matrix4().fromArray(node.matrix) : new Matrix4().compose(
      new Vector3().fromArray(node.translation || [0,0,0]), new Quaternion().fromArray(node.rotation || [0,0,0,1]),
      new Vector3().fromArray(node.scale || [1,1,1]));
    const world=local.premultiply(parent);
    if (node.mesh!==undefined) {
      const basename=(node.name || '').split('.')[0].split(/[/\\]/).pop().toLowerCase();
      const instances=byModel.get(basename);
      if (instances) {
        position.setFromMatrixPosition(world);
        const matches=instances.filter(e=>e.origin.distanceToSquared(position)<=matchDistance**2);
        if (matches.length && matches.every(e=>e.hidden)) hidden.add(index);
      }
    }
    for(const child of node.children || []) visit(child,world);
  }
  const identity=new Matrix4();
  for(const root of doc.scenes[doc.scene ?? 0].nodes) visit(root,identity);
  return hidden;
}
