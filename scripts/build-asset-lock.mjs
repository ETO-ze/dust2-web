import { readFile, writeFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { SKINS } from '../shared/skins.js';
import { UTILITY_ASSETS } from '../shared/utility-assets.js';
import { AGENT_ASSETS } from '../shared/agent-assets.js';
import { AGENT_ARM_ASSETS } from '../shared/agent-arm-assets.js';
const base=JSON.parse(await readFile('public/assets/asset-manifest.json','utf8'));
const names=new Map(base.files.map(f=>[f.path,f.group]));
for(const skin of SKINS){names.set(skin.model,'skin');names.set(skin.preview,'preview');}
for(const item of Object.values(UTILITY_ASSETS))names.set(item.model,'utility');
for(const agent of Object.values(AGENT_ASSETS)){names.set(agent.model,'agent');if(agent.preview)names.set(typeof agent.preview==='string'?agent.preview:agent.preview.file,'preview');}
for(const arms of Object.values(AGENT_ARM_ASSETS))names.set(arms.model,'agent');
names.set('assets/viewmodel/arms.glb','legacy');
names.set('assets/valve-dust2/de_dust2.png','interface');
for(const path of ['assets/map/penetration-materials.u8','assets/map/penetration-materials.json','assets/ui-cs2/manifest.json','assets/weapons/cs2-skins/legacy-manifest.json'])names.set(path,'metadata');
for(const path of ['assets/asset-manifest.json','assets/map/collision.json','assets/valve-dust2/de_dust2_1_png.png','assets/valve-dust2/de_dust2_radar_psd.png','assets/viewmodel/manifest.json','assets/viewmodel/gloves-manifest.json','assets/viewmodel/animations-manifest.json','assets/characters-cs2/manifest.json','assets/weapons/cs2-loadout/manifest.json','assets/weapons/cs2-utility/manifest.json'])names.set(path,'metadata');
const music=JSON.parse(await readFile('public/assets/audio/music/manifest.json','utf8'));
for(const kit of Object.values(music.kits))for(const cue of Object.values(kit.cues))names.set('assets/audio/music/optional/'+cue.file,'music');
names.set('assets/weapons/cs2-utility/c4-manifest.json','metadata');
const files=[];
names.set('assets/characters-cs2/optional-manifest.json','metadata');
for(const [path,group] of [...names].sort(([a],[b])=>a.localeCompare(b))){const content=await readFile('public/'+path);files.push({path,bytes:content.length,sha256:createHash('sha256').update(content).digest('hex'),group});}
const lock={schemaVersion:1,version:createHash('sha256').update(JSON.stringify(files)).digest('hex').slice(0,16),baseURL:'https://cs2.duskrain.cn/',baseManifestVersion:base.version,totalBytes:files.reduce((s,f)=>s+f.bytes,0),files};
await writeFile('config/assets-lock.json',JSON.stringify(lock,null,2)+'\n');
console.log(`Asset lock: ${files.length} files, ${(lock.totalBytes/1048576).toFixed(1)} MiB`);
