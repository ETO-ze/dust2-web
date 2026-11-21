import {AGENT_ASSETS} from './agent-assets.js';
import {AGENT_ARM_ASSETS} from './agent-arm-assets.js';

// Only hash-named optional agent releases get a same-origin delivery override.
export function isPackagedAgentPath(path) {
  return /^assets\/characters-cs2\/popular\/[a-z0-9-]+\/(?:(?:body|arms)-[0-9a-f]{12}\.glb|portrait-[0-9a-f]{12}\.webp)$/.test(path);
}

export function packagedAgentAssets() {
  const assets = [];
  for (const [id, agent] of Object.entries(AGENT_ASSETS)) {
    if (!isPackagedAgentPath(agent.model)) continue;
    const arm = AGENT_ARM_ASSETS[id];
    const entries = [[agent.model, agent], [arm?.model, arm], [agent.preview?.file, agent.preview]];
    for (const [path, file] of entries) {
      if (!isPackagedAgentPath(path) || !file?.sha256 || !path.includes(file.sha256.slice(0, 12))) {
        throw new Error('Incomplete packaged agent: ' + id);
      }
      assets.push({path, bytes:file.bytes, sha256:file.sha256});
    }
  }
  return assets;
}
