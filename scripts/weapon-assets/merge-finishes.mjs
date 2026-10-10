import fs from 'node:fs';
import path from 'node:path';

const dir=path.resolve(import.meta.dirname,'../../public/assets/weapons/cs2-loadout');
const partial=process.argv[2];if(!partial)throw Error('Usage: node scripts/weapon-assets/merge-finishes.mjs manifest-<ids>.json');
const target=path.join(dir,'manifest.json'),base=JSON.parse(fs.readFileSync(target,'utf8'));
const additions=JSON.parse(fs.readFileSync(path.join(dir,path.basename(partial)),'utf8'));
const byId=new Map(base.models.map(m=>[m.id,m]));
for(const row of additions.models)byId.set(row.id,row);
base.models=[...byId.values()];base.updatedAt=new Date().toISOString();
base.tools.materialExporter='Source2Viewer-CLI 20.0.7409+d193e9602e5a63d2f1bf70ddf5ca3f81f46faaa0 (new finishes, VCS 72)';
fs.writeFileSync(target,JSON.stringify(base,null,2)+'\n');
fs.writeFileSync(path.join(dir,'SHA256SUMS.txt'),base.models.flatMap(m=>[m.sha256+'  '+m.file,m.preview.sha256+'  '+m.preview.file]).join('\n')+'\n');
console.log('Merged default finishes: '+base.models.length);
