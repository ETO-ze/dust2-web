// Read-only extraction from the user's installed CS2 VPK, then web audio conversion.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readVpkIndex } from '../../tools/vpk-index.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const pak = 'E:/steam/steamapps/common/Counter-Strike Global Offensive/game/csgo/pak01_dir.vpk';
const raw = path.join(root, 'artifacts/weapon-expansion/audio-raw');
const output = path.join(root, 'public/assets/audio/cs2');
const eventText=fs.readFileSync(path.join(root,'artifacts/cs2-audio/raw/soundevents/game_sounds_weapons.vsndevts'),'utf8');
const events={};
for(const match of eventText.matchAll(/\n\t([^\n=]+) =\s*\n\t\{/g)){
 const end=eventText.indexOf('\n\t}',match.index+match[0].length);
 events[match[1].toLowerCase()]=[...eventText.slice(match.index,end).matchAll(/"sounds\/([^"\n]+)\.vsnd"/g)].map(m=>m[1]);
}
const bankSources={},weapons=['elite','p250','fiveseven','deagle','nova','mag7','mp9','mp7','bizon','scar20','m4a4','ssg08','tec9','xm1014','sawedoff','mac10','galilar','sg553'];
for(const id of weapons){
 const eventId=id==='sg553'?'sg556':id;
 for(const [key,action]of [['','single'],['Far','singledistant'],['Out','clipout'],['In','clipin'],['Shell','insertshell']]){
  const files=events['weapon_'+eventId+'.'+action];if(files?.length)bankSources[id+key]=files.slice(0,2);
 }
 if(!bankSources[id])throw Error('Missing original gun shot event '+id);
}
for(const [bank,event]of Object.entries({heExplosion:'basegrenade.explode',heExplosionFar:'basegrenade.explodedistant',flashExplosion:'flashbang.explode',heThrow:'hegrenade.throw',smokeThrow:'smokegrenade.throw',grenadeBounce:'hegrenade.bounce'}))bankSources[bank]=events[event].slice(0,2);
const sourcePaths = [...new Set(Object.values(bankSources).flat())];
const index = readVpkIndex(pak), indexed = new Map(index.entries.map(e => [e.path, e]));
for (const name of sourcePaths) if (!indexed.has(`sounds/${name}.vsnd_c`)) throw new Error(`Missing source ${name}`);
fs.mkdirSync(output, { recursive: true }); fs.mkdirSync(raw, { recursive: true });
const command = [ '-i', pak, '-f', sourcePaths.map(p => `sounds/${p}.vsnd_c`).join(','), '-o', raw + path.sep, '-d' ];
const temp=path.join(root,'artifacts/export-temp');fs.mkdirSync(temp,{recursive:true});
const lockPath=path.join(root,'artifacts/s2v-export.lock'),lock=fs.openSync(lockPath,'wx');fs.writeFileSync(lock,JSON.stringify({pid:process.pid,task:'weapon-audio'}));
let result;try{result = spawnSync(path.join(root, 'tools/source2viewer/Source2Viewer-CLI.exe'), command, { encoding: 'utf8', maxBuffer: 8e6,windowsHide:true,env:{...process.env,TEMP:temp,TMP:temp} });}finally{fs.closeSync(lock);fs.unlinkSync(lockPath);}
fs.writeFileSync(path.join(root, 'artifacts/weapon-expansion/sounds-export.log'), result.stdout + result.stderr);
if (result.status !== 0) throw new Error(`S2V failed: ${result.status}`);
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const files = [];
for (const name of sourcePaths) {
  const wav = path.join(raw, 'sounds', name + '.wav'), mp3 = path.join(raw, 'sounds', name + '.mp3');
  const input = fs.existsSync(wav) ? wav : mp3;
  if (!fs.existsSync(input)) throw new Error(`S2V produced no audio for ${name}`);
  const filename = path.basename(name) + '.mp3', destination = path.join(output, filename);
  const convert = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', input, '-map_metadata', '-1', '-af', 'volume=0.707945784', '-ar', '44100', '-c:a', 'libmp3lame', '-q:a', '3', destination], { encoding: 'utf8' });
  if (convert.status !== 0) throw new Error(convert.stderr);
  const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_name,sample_rate,channels', '-of', 'json', destination], { encoding: 'utf8' });
  const metadata = JSON.parse(probe.stdout);
  files.push({ file: filename, source: `sounds/${name}.vsnd_c`, archive: indexed.get(`sounds/${name}.vsnd_c`).archiveIndex, sourceCrc32: indexed.get(`sounds/${name}.vsnd_c`).crc.toString(16).padStart(8, '0'), extractedSha256: hash(input), sha256: hash(destination), bytes: fs.statSync(destination).size, duration: Number(metadata.format.duration), ...metadata.streams[0] });
}
const previous=JSON.parse(fs.readFileSync(path.join(output,'manifest.json'),'utf8'));
const manifest = {
  source: 'User local installed Counter-Strike 2, Valve-owned game audio', pak,
  tool: 'Source 2 Viewer CLI 20.0.6980+a06886f7d06049052d32a7381ec05523064a2ca0',
  officialExportGuide: 'https://s2v.app/ValveResourceFormat/guides/exporting-sounds.html',
  eventSources: ['game_sounds_weapons.vsndevts', 'game_sounds_player.vsndevts', 'game_sounds_ui.vsndevts'],
  conversion: 'S2V compiled VSND to original WAV/MP3; FFmpeg libmp3lame quality 3, 44100 Hz, source channels retained, -3 dB gain, no invented gun synthesis.',
  banks: {...previous.banks,...Object.fromEntries(Object.entries(bankSources).map(([bank, names]) => [bank, names.map(n => path.basename(n) + '.mp3')]))},
  files: [...previous.files.filter(f=>!files.some(n=>n.file===f.file)),...files],
};
fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(JSON.stringify({ files: files.length, banks: Object.keys(bankSources).length, totalBytes: files.reduce((n, f) => n + f.bytes, 0), output }));
