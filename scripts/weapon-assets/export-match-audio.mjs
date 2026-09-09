import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readVpkIndex} from '../../tools/vpk-index.mjs';
import {RELOAD_PROFILES} from '../../shared/reload-profiles.js';
const root=path.resolve(import.meta.dirname,'../..'),stage=path.join(root,'artifacts/reload-c4'),raw=path.join(stage,'audio');
const game=process.env.CS2_GAME_DIR||'E:/steam/steamapps/common/Counter-Strike Global Offensive/game/csgo',pak=path.join(game,'pak01_dir.vpk');
const index=new Map(readVpkIndex(pak).entries.map(e=>[e.path,e]));
const eventText=fs.readFileSync(path.join(root,'artifacts/cs2-audio/raw/soundevents/game_sounds_weapons.vsndevts'),'utf8'),events={};
for(const m of eventText.matchAll(/\n\t([^\n=]+) =\s*\n\t\{/g)){const end=eventText.indexOf('\n\t}',m.index+m[0].length);events[m[1].trim().toLowerCase()]=[...eventText.slice(m.index,end).matchAll(/"(sounds\/[^"\n]+)\.vsnd"/g)].map(m=>m[1]+'.vsnd_c');}
const banks={},silent=[];
for(const modes of Object.values(RELOAD_PROFILES))for(const clip of Object.values(modes))for(const sound of clip.sounds){const files=events[sound.event.toLowerCase()];if(files?.length)banks[sound.bank]=files.slice(0,2);else silent.push(sound.event);}
Object.assign(banks,Object.fromEntries(Object.entries({bombBeep:['weapons/c4/c4_beep2','weapons/c4/c4_beep3'],bombBeepFast:['weapons/c4/c4_beep2_10sec'],bombKey:['weapons/c4/key_press1','weapons/c4/key_press2','weapons/c4/key_press3'],bombPlant:['weapons/c4/c4_plant'],bombDefuseStart:['weapons/c4/c4_disarmstart'],bombDefuseFinish:['weapons/c4/c4_disarmfinish'],bombExplosion:['weapons/c4/c4_explode_close_01'],bombDebris:['weapons/c4/c4_shockwave_debris_01'],bombDraw:['weapons/c4/c4_draw_01'],announcePlant:['vo/announcer/cs2_classic/bombpl'],announceDefuse:['vo/announcer/cs2_classic/bombdef'],announceCT:['vo/announcer/cs2_classic/ctwin'],announceT:['vo/announcer/cs2_classic/terwin']}).map(([key,values])=>[key,values.map(p=>'sounds/'+p+'.vsnd_c')])));
const cues={menu:'mainmenu',roundStart:'startround_01',roundWon:'wonround',roundLost:'lostround',mvp:'roundmvpanthem_01',matchEnd:'endofmatch',bombPlanted:'bombplanted',bombWarning:'bombtenseccount',roundWarning:'roundtenseccount',death:'deathcam'};
const kits=['valve_cs2_01','neckdeep_01'];
const music=kits.flatMap(kit=>Object.values(cues).map(cue=>`sounds/music/${kit}/${cue}.vsnd_c`));
const sources=[...new Set([...Object.values(banks).flat(),...music])];for(const p of sources)if(!index.has(p))throw Error('Missing audio '+p);
fs.mkdirSync(raw,{recursive:true});const temp=path.join(root,'artifacts/export-temp');fs.mkdirSync(temp,{recursive:true});
const lockPath=path.join(root,'artifacts/s2v-export.lock'),lock=fs.openSync(lockPath,'wx');
fs.writeFileSync(lock,JSON.stringify({pid:process.pid,task:'match-audio'}));
try{const log=fs.openSync(path.join(stage,'audio-export.log'),'w');const r=spawnSync(path.join(root,'tools/source2viewer/Source2Viewer-CLI.exe'),['-i',pak,'-f',sources.join(','),'-o',raw+path.sep,'-d'],{stdio:['ignore',log,log],windowsHide:true,timeout:180000,env:{...process.env,TEMP:temp,TMP:temp}});fs.closeSync(log);if(r.status)throw Error('Audio export failed');}finally{fs.closeSync(lock);fs.unlinkSync(lockPath);}
const hash=b=>createHash('sha256').update(b).digest('hex'),files=[],musicFiles=[];
const destinations=new Map();
for(const source of sources){
 const stem=source.replace(/\.vsnd_c$/,''),input=['.wav','.mp3','.ogg'].map(ext=>path.join(raw,stem+ext)).find(p=>fs.existsSync(p));if(!input)throw Error('No exported audio '+source);
 const isMusic=source.startsWith('sounds/music/'),file=isMusic?source.split('/').slice(-2).join('/').replace('.vsnd_c','.mp3'):stem.replace(/^sounds\//,'').replaceAll('/','_')+'.mp3';
 const folder=isMusic?'public/assets/audio/music/optional':'public/assets/audio/cs2',destination=path.join(root,folder,file);fs.mkdirSync(path.dirname(destination),{recursive:true});
 const convert=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-i',input,'-map_metadata','-1','-af','volume=0.707945784','-ar','44100','-c:a','libmp3lame','-q:a',isMusic?'4':'3',destination],{encoding:'utf8',windowsHide:true});if(convert.status)throw Error(convert.stderr);
 const probe=JSON.parse(spawnSync('ffprobe',['-v','error','-show_entries','format=duration','-of','json',destination],{encoding:'utf8',windowsHide:true}).stdout);
 const bytes=fs.readFileSync(destination),row={file,source,sha256:hash(bytes),bytes:bytes.length,duration:Number(probe.format.duration),sourceCrc32:index.get(source).crc.toString(16)};
 (isMusic?musicFiles:files).push(row);destinations.set(source,file);
}
const manifestFile=path.join(root,'public/assets/audio/cs2/manifest.json'),previous=JSON.parse(fs.readFileSync(manifestFile,'utf8'));
previous.banks={...previous.banks,...Object.fromEntries(Object.entries(banks).map(([bank,src])=>[bank,src.map(s=>destinations.get(s))]))};previous.files=[...previous.files.filter(p=>!files.some(n=>n.file===p.file)),...files];
previous.reloadEventSource='Original CNmSoundEvent metadata; event timing in shared/reload-profiles.js';previous.silentReloadEvents=[...new Set(silent)];fs.writeFileSync(manifestFile,JSON.stringify(previous,null,2));
const musicManifest={source:'Installed CS2 event clips. Valve and the credited music artists retain their rights.',kits:Object.fromEntries(kits.map(id=>[id,{id,name:id==='neckdeep_01'?'人生何处不青山':'Counter-Strike 2',artist:id==='neckdeep_01'?'Neck Deep':'Valve',cues:Object.fromEntries(Object.entries(cues).map(([event,cue])=>[event,musicFiles.find(f=>f.file===`${id}/${cue}.mp3`)]))}]))};
fs.writeFileSync(path.join(root,'public/assets/audio/music/manifest.json'),JSON.stringify(musicManifest,null,2));
fs.writeFileSync(path.join(stage,'audio-proof.json'),JSON.stringify({files,musicFiles,silent:[...new Set(silent)]},null,2));
console.log(JSON.stringify({effects:files.length,musicClips:musicFiles.length,silentEvents:[...new Set(silent)],bytes:[...files,...musicFiles].reduce((n,f)=>n+f.bytes,0)}));
