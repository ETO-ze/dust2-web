import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readVpkIndex} from '../../tools/vpk-index.mjs';
const root=path.resolve(import.meta.dirname,'../..'),stage=path.join(root,'artifacts/draw-melee'),raw=path.join(stage,'raw');
const game=process.env.CS2_GAME_DIR||'E:/steam/steamapps/common/Counter-Strike Global Offensive/game/csgo',pak=path.join(game,'pak01_dir.vpk');
const index=new Map(readVpkIndex(pak).entries.map(e=>[e.path,e]));
const text=fs.readFileSync(path.join(root,'artifacts/cs2-audio/raw/soundevents/game_sounds_weapons.vsndevts'),'utf8'),events={};
for(const m of text.matchAll(/\n\t([^\n=]+) =\s*\n\t\{/g)){const end=text.indexOf('\n\t}',m.index+m[0].length);events[m[1].trim().toLowerCase()]=[...text.slice(m.index,end).matchAll(/"([^"\n]+)"/g)].map(m=>m[1]);}
function resolve(name,seen=new Set()){
 if(seen.has(name.toLowerCase()))return [];seen.add(name.toLowerCase());
 return [...new Set((events[name.toLowerCase()]||[]).flatMap(v=>v.startsWith('sounds/')&&v.endsWith('.vsnd')?[v+'_c']:events[v.toLowerCase()]?resolve(v,seen):[]))];
}
const weapons={ak47:'AK47',m4a1:'M4A1',awp:'AWP',glock:'Glock',usp:'USP',elite:'ELITE',p250:'P250',fiveseven:'FiveSeven',deagle:'DEagle',nova:'Nova',mag7:'Mag7',mp9:'MP9',mp7:'MP7',bizon:'bizon',scar20:'SCAR20',m4a4:'M4A1',ssg08:'SSG08',tec9:'tec9',xm1014:'XM1014',sawedoff:'Sawedoff',mac10:'MAC10',galilar:'GalilAR',sg553:'SG556'};
const bankEvents=Object.fromEntries(Object.entries(weapons).map(([id,name])=>[id+'Draw','Weapon_'+name+'.Draw']));
Object.assign(bankEvents,{molotovDraw:'Molotov.Draw',incgrenadeDraw:'IncGrenade.Draw',decoyDraw:'Decoy.Draw',molotovThrow:'Molotov.Throw',incgrenadeThrow:'IncGrenade.Throw',decoyThrow:'Decoy.Throw',fireStart:'Molotov.Smash',fireLoop:'Molotov.Loop',fireExtinguish:'Molotov.Extinguish',knifeDraw:'Weapon_Knife.Draw.Small',knifeHeavySwing:'Weapon_Knife.Swish.Heavy',knifeHeavyHit:'Weapon_Knife.Hit.Heavy',hegrenadeDraw:'HEGrenade.Draw',flashbangDraw:'Flashbang.Draw',smokegrenadeDraw:'SmokeGrenade.Draw'});
const banks=Object.fromEntries(Object.entries(bankEvents).map(([bank,event])=>{const files=resolve(event).filter(f=>index.has(f)).slice(0,2);if(!files.length)throw Error('No samples for '+event);return[bank,files];}));
const sources=[...new Set(Object.values(banks).flat())];fs.mkdirSync(raw,{recursive:true});
const temp=path.join(root,'artifacts/export-temp');fs.mkdirSync(temp,{recursive:true});
const lockPath=path.join(root,'artifacts/s2v-export.lock'),lock=fs.openSync(lockPath,'wx');fs.writeFileSync(lock,JSON.stringify({pid:process.pid,task:'draw-melee-audio'}));
try {const log=fs.openSync(path.join(stage,'export.log'),'w');const r=spawnSync(path.join(root,'tools/source2viewer/Source2Viewer-CLI.exe'),['-i',pak,'-f',sources.join(','),'-o',raw+path.sep,'-d'],{stdio:['ignore',log,log],windowsHide:true,timeout:180000,env:{...process.env,TEMP:temp,TMP:temp}});fs.closeSync(log);if(r.status)throw Error('Audio export failed');}
finally{fs.closeSync(lock);fs.unlinkSync(lockPath);}
const files=[],destinations=new Map();
for(const source of sources){const stem=source.replace(/\.vsnd_c$/,''),input=['.wav','.mp3','.ogg'].map(ext=>path.join(raw,stem+ext)).find(p=>fs.existsSync(p));if(!input)throw Error('Missing converted sound '+source);
 const file=stem.replace(/^sounds\//,'').replaceAll('/','_')+'.mp3',destination=path.join(root,'public/assets/audio/cs2',file);
 const convert=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-i',input,'-map_metadata','-1','-af','volume=0.707945784','-ar','44100','-c:a','libmp3lame','-q:a','3',destination],{encoding:'utf8',windowsHide:true});if(convert.status)throw Error(convert.stderr);
 const bytes=fs.readFileSync(destination);files.push({file,source,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),sourceCrc32:index.get(source).crc.toString(16)});destinations.set(source,file);
}
const manifestFile=path.join(root,'public/assets/audio/cs2/manifest.json'),manifest=JSON.parse(fs.readFileSync(manifestFile,'utf8'));
manifest.banks={...manifest.banks,...Object.fromEntries(Object.entries(banks).map(([bank,list])=>[bank,list.map(s=>destinations.get(s))]))};
manifest.files=[...manifest.files.filter(f=>!files.some(n=>n.file===f.file)),...files];manifest.drawMeleeEvents=bankEvents;
fs.writeFileSync(manifestFile,JSON.stringify(manifest,null,2));fs.writeFileSync(path.join(stage,'proof.json'),JSON.stringify({bankEvents,banks,files},null,2));
console.log(JSON.stringify({banks:Object.keys(banks).length,files:files.length,bytes:files.reduce((n,f)=>n+f.bytes,0)}));
