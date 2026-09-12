import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const root=path.resolve(import.meta.dirname,'../..'),raw=path.join(root,'artifacts/optional-extras/audio/sounds/music');
const manifestFile=path.join(root,'public/assets/audio/music/manifest.json'),manifest=JSON.parse(fs.readFileSync(manifestFile,'utf8'));
const cues={roundStart:'startround_01',roundWon:'wonround',roundLost:'lostround',mvp:'roundmvpanthem_01',matchEnd:'endofmatch',bombPlanted:'bombplanted',bombWarning:'bombtenseccount',roundWarning:'roundtenseccount',death:'deathcam'};
for(const [id,name,artist] of [['blitzkids_01','有为青年','Blitz Kids'],['neckdeep_02','躺平青年','Neck Deep'],['isoxo_01','非人类','ISOxo']]){
 const kit={id,name,artist,downloadRequired:true,cues:{}};
 for(const [cue,stem] of Object.entries(cues)){
  const input=['.wav','.mp3','.ogg'].map(ext=>path.join(raw,id,stem+ext)).find(p=>fs.existsSync(p));if(!input)throw Error('Missing '+id+'/'+stem);
  const file=id+'/'+stem+'.mp3',dest=path.join(root,'public/assets/audio/music/optional',file);fs.mkdirSync(path.dirname(dest),{recursive:true});
  const result=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-i',input,'-map_metadata','-1','-af','volume=0.707945784','-ar','44100','-c:a','libmp3lame','-q:a','4',dest],{windowsHide:true,encoding:'utf8'});if(result.status)throw Error(result.stderr);
  const b=fs.readFileSync(dest),duration=Number(JSON.parse(spawnSync('ffprobe',['-v','error','-show_entries','format=duration','-of','json',dest],{windowsHide:true,encoding:'utf8'}).stdout).format.duration);
  kit.cues[cue]={file,source:`sounds/music/${id}/${stem}.vsnd_c`,bytes:b.length,sha256:createHash('sha256').update(b).digest('hex'),duration};
 }
 manifest.kits[id]=kit;console.log(id+' '+Object.values(kit.cues).reduce((n,c)=>n+c.bytes,0)+' bytes');
}
fs.writeFileSync(manifestFile,JSON.stringify(manifest,null,2));
