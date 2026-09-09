import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {readVpkIndex} from '../../tools/vpk-index.mjs';

const root=path.resolve(import.meta.dirname,'../..');
const game=process.env.CS2_GAME_DIR||'E:/steam/steamapps/common/Counter-Strike Global Offensive/game/csgo';
const specs=JSON.parse(fs.readFileSync(path.join(import.meta.dirname,'default-skins.json'),'utf8'));
const vpk=path.join(game,'pak01_dir.vpk');
const entries=new Set(readVpkIndex(vpk).entries.map(e=>e.path));
const source=path.join(root,'artifacts/weapon-expansion/source');
const filters=[...new Set(specs.flatMap(s=>[s.material,s.preview,s.input+'_c']))];
for(const file of filters)if(!entries.has(file))throw Error('Missing source '+file);
fs.mkdirSync(source,{recursive:true});
const temp=path.join(root,'artifacts/export-temp');fs.mkdirSync(temp,{recursive:true});
const lockPath=path.join(root,'artifacts/s2v-export.lock');
const lock=fs.openSync(lockPath,'wx');fs.writeFileSync(lock,JSON.stringify({pid:process.pid,task:'weapon-finishes',startedAt:new Date().toISOString()}));
try{
 const log=fs.openSync(path.join(root,'artifacts/weapon-expansion/extract-finishes.log'),'w');
 const result=spawnSync(path.join(root,'tools/source2viewer/Source2Viewer-CLI.exe'),['-i',vpk,'-f',filters.join(','),'-o',source,'-d'],{stdio:['ignore',log,log],windowsHide:true,env:{...process.env,TEMP:temp,TMP:temp},timeout:600000});
 fs.closeSync(log);
 if(result.error)throw result.error;
 if(result.status)throw Error('Source2Viewer exit '+result.status);
 console.log('Extracted '+specs.length+' original finishes and previews.');
}finally{fs.closeSync(lock);fs.unlinkSync(lockPath);}
