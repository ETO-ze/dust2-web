// Each generated brush model belongs to this VPK. General prop models can be reused
// by enabled and disabled entities and cannot be hidden by filename.
export function disabledBrushModels(text, mapId) {
  const states = new Map();
  // The web room runs the standard layout. Keep switchable props (including
  // brush doors) and any explicitly targeted by Source enable/toggle outputs.
  const enableInputs = [...text.matchAll(/^@On\S+\s+(?:Delay=\S+\s+)?(?:Enable|Toggle)\s+(\S+)/gim)]
    .map(match => match[1].toLowerCase());
  const prefix = 'maps/' + mapId.toLowerCase() + '/entities/';
  for (const block of text.split(/^====\d+====\s*$/m)) {
    const field = key => block.match(new RegExp('^' + key + '[ \\t]+([^\\r\\n]+)', 'm'))?.[1].trim();
    const model = field('model')?.match(/^resource_name:"([^"]+)\.vmdl"$/i)?.[1].toLowerCase();
    if (!model?.startsWith(prefix) || model.slice(prefix.length).includes('/')) continue;
    const basename = model.slice(prefix.length);
    const target = (field('targetname') || '').replace(/^"|"$/g, '').toLowerCase();
    const layoutOnly = /^\[pr#\](?:brush\.blocker(?:\.[ab])?|retake\.[ab]site)$/.test(target);
    const enabledByOutput = enableInputs.some(pattern => pattern.endsWith('*') ? target.startsWith(pattern.slice(0,-1)) : pattern === target);
    const disabled = layoutOnly && !enabledByOutput && field('classname') === '"func_brush"' && /^(?:true|1|"1"|"true")$/i.test(field('startdisabled') || '');
    states.set(basename, (states.get(basename) ?? true) && disabled);
  }
  return new Set([...states].filter(([, disabled]) => disabled).map(([model]) => model));
}

export function sourceBrushHidden(name, disabled) {
  // Source 2 Viewer appends the mesh name and any primitive-instance suffix.
  return disabled.has((name || '').toLowerCase().split('.')[0]);
}
