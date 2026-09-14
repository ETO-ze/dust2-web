import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readVpkIndex} from '../../tools/vpk-index.mjs';
const root=path.resolve(import.meta.dirname,'../..'),stage=path.join(root,'artifacts/utility-audio'),raw=path.join(stage,'raw');
const pak=path.join(process.env.CS2_GAME_DIR||'E:/steam/steamapps/common/Counter-Strike Global Offensive/game/csgo','pak01_dir.vpk');
const index=new Map(readVpkIndex(pak).entries.map(e=>[e.path,e]));
const text=fs.readFileSync(path.join(root,'artifacts/cs2-audio/raw/soundevents/game_sounds_weapons.vsndevts'),'utf8'),events={};
for(const m of text.matchAll(/\n\t([^\n=]+) =\s*\n\t\{/g)){const end=text.indexOf('\n\t}',m.index+m[0].length);events[m[1].trim()]=[...text.slice(m.index,end).matchAll(/"(sounds\/[^"\n]+)\.vsnd"/g)].map(m=>m[1]+'.vsnd_c');}
// Select the event's own samples. Referenced distant layers/gear are not its
// primary sound (the old exporter sometimes chose the shared gear first).
const bankEvents={hegrenadePin:'HEGrenade.PullPin_Grenade',flashbangPin:'Flashbang.PullPin_Grenade',smokegrenadePin:'SmokeGrenade.PullPin_Grenade',incgrenadePin:'IncGrenade.PullPin_Grenade',decoyPin:'Decoy.PullPin_Grenade',
  flashbangThrow:'Flashbang.Throw',decoyThrow:'Decoy.Throw',incgrenadeThrow:'IncGrenade.Throw',
  flashbangBounce:'Flashbang.Bounce',smokegrenadeBounce:'SmokeGrenade.Bounce',molotovBounce:'Molotov.Bounce',incgrenadeBounce:'IncGrenade.Bounce',decoyBounce:'Flashbang.Bounce',
  smokegrenadeDetonate:'BaseSmokeEffect.Sound',smokegrenadeFar:'BaseSmokeEffect.SoundDistant',flashbangFar:'Flashbang.ExplodeDistant',
  molotovIgnite:'Molotov.Start',incgrenadeIgnite:'IncGrenade.Start',incgrenadePop:'IncGrenade.Pop',molotovFailed:'Molotov.StartFailed',incgrenadeFailed:'IncGrenade.StartFailed'};
const banks=Object.fromEntries(Object.entries(bankEvents).map(([bank,event])=>{const files=(events[event]||[]).slice(0,2);if(!files.length||files.some(f=>!index.has(f)))throw Error('Missing CS2 utility event '+event);return [bank,files];}));
const sources=[...new Set(Object.values(banks).flat())];fs.mkdirSync(raw,{recursive:true});
const manifestPath=path.join(root,'public/assets/audio/cs2/manifest.json');fs.copyFileSync(manifestPath,path.join(stage,'manifest-before.json'));
const temp=path.join(root,'artifacts/export-temp');fs.mkdirSync(temp,{recursive:true});const lockPath=path.join(root,'artifacts/s2v-export.lock'),lock=fs.openSync(lockPath,'wx');
try{fs.writeFileSync(lock,JSON.stringify({pid:process.pid,task:'utility-audio'}));const log=fs.openSync(path.join(stage,'export.log'),'w');const r=spawnSync(path.join(root,'tools/source2viewer/Source2Viewer-CLI.exe'),['-i',pak,'-f',sources.join(','),'-o',raw+path.sep,'-d'],{stdio:['ignore',log,log],windowsHide:true,timeout:180000,env:{...process.env,TEMP:temp,TMP:temp}});fs.closeSync(log);if(r.status)throw Error('Utility audio export failed');}finally{fs.closeSync(lock);fs.unlinkSync(lockPath);}
const files=[],destinations=new Map();
for(const source of sources){const stem=source.replace(/\.vsnd_c$/,''),input=['.wav','.mp3','.ogg'].map(ext=>path.join(raw,stem+ext)).find(p=>fs.existsSync(p));if(!input)throw Error('Missing exported '+source);
 const file=stem.replace(/^sounds\//,'').replaceAll('/','_')+'.mp3',destination=path.join(root,'public/assets/audio/cs2',file);
 const r=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-i',input,'-map_metadata','-1','-af','volume=0.707945784','-ar','44100','-c:a','libmp3lame','-q:a','3',destination],{encoding:'utf8',windowsHide:true});if(r.status)throw Error(r.stderr);
 const bytes=fs.readFileSync(destination);files.push({file,source,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),sourceCrc32:index.get(source).crc.toString(16)});destinations.set(source,file);
}
const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
manifest.utilityEvents=bankEvents;Object.assign(manifest.banks,Object.fromEntries(Object.entries(banks).map(([bank,src])=>[bank,src.map(s=>destinations.get(s))])));
manifest.files=[...manifest.files.filter(f=>!files.some(n=>n.file===f.file)),...files];
fs.writeFileSync(manifestPath,JSON.stringify(manifest,null,2));fs.writeFileSync(path.join(stage,'proof.json'),JSON.stringify({bankEvents,files},null,2));
console.log(JSON.stringify({banks:Object.keys(banks).length,files:files.length,bytes:files.reduce((n,f)=>n+f.bytes,0)}));
