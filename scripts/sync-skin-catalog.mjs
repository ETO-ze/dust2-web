import { readFile,writeFile,stat } from 'node:fs/promises';
import { SKINS } from '../shared/skins.js';
const root='assets/weapons/cs2-loadout/';
const manifest=JSON.parse(await readFile('public/'+root+'manifest.json','utf8'));
const defaults=manifest.models.map(m=>({id:m.file.replace(/\.glb$/,''),weapon:m.id,name:m.chineseName,englishName:m.name,model:root+m.file,preview:root+m.preview.file,bytes:m.bytes,sha256:m.sha256,isDefault:true,condition:'Factory New',wear:m.parameters.wear,wearMin:m.wearMin,paintkit:m.paintkit,previewBytes:m.preview.bytes,previewSha256:m.preview.sha256}));
for(const skin of defaults){const file=`assets/viewmodel/optional/${skin.weapon}.glb`;if(await stat('public/'+file).catch(()=>null)){const a=JSON.parse(await readFile('public/'+file.replace('.glb','-manifest.json'),'utf8'));skin.animation={model:file,bytes:a.bytes,sha256:a.sha256};}}
const laterRoot='assets/weapons/cs2-skins/';
const legacy=JSON.parse(await readFile('public/'+laterRoot+'legacy-manifest.json','utf8'));
const optionalFinish=(m,base)=>({
 id:m.file.split('/').pop().replace(/\.glb$/,''),weapon:m.id,name:m.chineseName,englishName:m.name,
 model:base+m.file,preview:base+m.preview.file,bytes:m.bytes,sha256:m.sha256,isDefault:false,
 paintkit:m.paintkit,previewBytes:m.preview.bytes,previewSha256:m.preview.sha256,condition:m.condition,
 wear:m.parameters.wear,wearMin:m.wearMin,
});
const options=legacy.models.map(m=>optionalFinish(m,laterRoot));
const existingKnives=SKINS.filter(s=>['m9-vanilla','butterfly-vanilla'].includes(s.id));
const catalog=[...defaults,...options,...existingKnives];
for(const directory of ['expansion','stock-guns','popular','knives']){
 const base=laterRoot+directory+'/';
 const manifest=JSON.parse(await readFile('public/'+base+'manifest.json','utf8'));
 const additions=manifest.skins??manifest.models.map(model=>optionalFinish(model,base));
 for(const skin of additions){
  if(directory==='popular')skin.collection='popular';
  const original=defaults.find(item=>item.weapon===skin.weapon);
  if(!original)throw Error('Unknown weapon: '+skin.weapon);
  if(skin.weapon!=='knife'&&original.animation)skin.animation=original.animation;
  catalog.push(skin);
 }
}
if(new Set(catalog.map(s=>s.id)).size!==catalog.length)throw Error('Duplicate Valve cosmetic ID');
const current=await readFile('shared/skins.js','utf8');
await writeFile('shared/skins.js',current.slice(0,current.indexOf('const baseSkins ='))+'const baseSkins = '+JSON.stringify(catalog,null,2)+'.map(skin => Object.freeze(skin));\n'+current.slice(current.indexOf('export const SKINS')));
console.log(`Synced ${defaults.length} pristine defaults; ${catalog.length} total finishes.`);
