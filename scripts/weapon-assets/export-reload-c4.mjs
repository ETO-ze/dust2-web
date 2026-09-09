// Read-only installed game exports. Originals and intermediate files stay outside Git.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {readVpkIndex} from '../../tools/vpk-index.mjs';
const root=path.resolve(import.meta.dirname,'../..'),stage=path.join(root,'artifacts/reload-c4');
const game=process.env.CS2_GAME_DIR||'E:/steam/steamapps/common/Counter-Strike Global Offensive/game/csgo';
const pak=path.join(game,'pak01_dir.vpk'),cli=path.join(root,'tools/source2viewer/Source2Viewer-CLI.exe');
fs.mkdirSync(stage,{recursive:true});const temp=path.join(root,'artifacts/export-temp');fs.mkdirSync(temp,{recursive:true});
const entries=readVpkIndex(pak).entries,index=new Set(entries.map(e=>e.path));
const lockPath=path.join(root,'artifacts/s2v-export.lock'),lock=fs.openSync(lockPath,'wx');
fs.writeFileSync(lock,JSON.stringify({pid:process.pid,task:'reload-c4',at:new Date().toISOString()}));
const sources={ak47:'rifle/rifle_ak/reload_ak',m4a1:'rifle/_default_rifle/reload_rifle',awp:'rifle/rifle_awp/reload_awp',pistol:'pistol/pistol_glock18/reload_glock',usp:'pistol/_default_pistol/reload_pistol'};
for(const id of ['elite','p250','fiveseven','deagle','nova','mag7','mp9','mp7','bizon','scar20','m4a4','ssg08','tec9','xm1014','sawedoff','mac10','galilar','sg553']){
 const stem=id==='sg553'?'sg556':id,type=['elite','p250','fiveseven','deagle','tec9'].includes(id)?'pistol':'rifle';sources[id]=`${type}/${type}_${stem}/reload_${stem}${id==='ssg08'?'_lgcy':''}`;
}
function run(resource,output,args=[]){
 if(!index.has(resource))throw Error('Missing installed resource '+resource);
 fs.mkdirSync(path.dirname(output),{recursive:true});const log=fs.openSync(output+'.log','w');
 const result=spawnSync(cli,['-i',pak,'-f',resource,...args],{cwd:root,stdio:['ignore',log,log],windowsHide:true,timeout:180000,env:{...process.env,TEMP:temp,TMP:temp}});fs.closeSync(log);
 if(result.status!==0||result.error)throw result.error||Error('Export failed '+resource);
}
try{
 if(process.argv.includes('--metadata')){
  const rows={};
  for(const [id,base]of Object.entries(sources)){
   rows[id]={};for(const [mode,stem]of [['reload',base],['reloadEmpty',base.replace('/reload_','/reload_empty_')]]){
    const resource='animation/anims/viewmodel/'+stem+'.vnmclip_c';if(!index.has(resource))continue;
    const output=path.join(stage,'metadata',`${id}-${mode}`);run(resource,output,['-b','DATA']);const text=fs.readFileSync(output+'.log','utf8');
    const duration=Number(text.match(/m_flDuration = ([\d.]+)/)?.[1]);if(!duration)throw Error('Missing clip duration '+id);
    const tail=text.slice(text.lastIndexOf('\tm_events =')),events=[...tail.matchAll(/_class = "(CNmSoundEvent|CNmIDEvent)"([\s\S]*?)(?=\n\t\t\},)/g)].map(([,type,body])=>({type,time:Number(body.match(/m_flStartTime =\s*\{\s*m_flValue = ([\d.]+)/)?.[1]),name:body.match(type==='CNmSoundEvent'?/m_name = "([^"]+)"/:/m_ID = "([^"]+)"/)?.[1]})).filter(e=>e.name&&Number.isFinite(e.time));
    rows[id][mode]={source:resource,duration,events};
   }
  }
  fs.writeFileSync(path.join(stage,'reload-events.json'),JSON.stringify(rows,null,2));console.log('Metadata:',Object.keys(rows).length,'weapons');
 }
 if(process.argv.includes('--c4')){
  const output=path.join(stage,'raw/c4.glb');run('weapons/models/c4/weapon_c4.vmdl_c',output,['-o',output,'-d','--gltf_export_format','glb','--gltf_export_materials','--gltf_textures_adapt','--gltf_export_extras','--game',path.join(game,'gameinfo.gi')]);
  for(const [action,stem]of Object.entries({draw:'draw_c4',idle:'idle_c4',inspect:'lookat01_c4',plant:'plant_c4'})){
   const output=path.join(root,'artifacts/weapon-expansion/animations',`c4-${action}.glb`);run(`animation/anims/viewmodel/equipment/c4/${stem}.vnmclip_c`,output,['-o',output,'-d','--gltf_export_format','glb','--gltf_export_animations','--game',path.join(game,'gameinfo.gi')]);
  }
  console.log('C4 model and four animation clips exported');
 }
 if(process.argv.includes('--empty-clips'))for(const id of ['pistol','usp']){
  const output=path.join(root,'artifacts/weapon-expansion/animations',`${id}-reloadEmpty.glb`);
  run('animation/anims/viewmodel/'+sources[id].replace('/reload_','/reload_empty_')+'.vnmclip_c',output,['-o',output,'-d','--gltf_export_format','glb','--gltf_export_animations','--game',path.join(game,'gameinfo.gi')]);
 }
}finally{fs.closeSync(lock);fs.unlinkSync(lockPath);}
