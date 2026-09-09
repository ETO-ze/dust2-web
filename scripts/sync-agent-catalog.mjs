import { readFile,writeFile } from 'node:fs/promises';
const {agents}=JSON.parse(await readFile('public/assets/characters-cs2/optional-manifest.json','utf8'));
await writeFile('shared/agent-assets.js','// Original CS2 agent models and inventory previews, verified before use.\nexport const AGENT_ASSETS=Object.freeze('+JSON.stringify(Object.fromEntries(agents.map(({id,...asset})=>[id,asset])),null,2)+');\n');
console.log(`Synced ${agents.length} agent assets.`);
