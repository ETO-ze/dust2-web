import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'..'),game=process.env.CS2_GAME_DIR||'E:/steam/steamapps/common/Counter-Strike Global Offensive/game/csgo';
const stage=path.join(root,'artifacts/weapon-expansion/animations'),temp=path.join(root,'artifacts/export-temp');
fs.mkdirSync(stage,{recursive:true});fs.mkdirSync(temp,{recursive:true});
const lockPath=path.join(root,'artifacts/s2v-export.lock'),lock=fs.openSync(lockPath,'wx');
fs.writeFileSync(lock,JSON.stringify({pid:process.pid,task:'original-sg553-aim-animations'}));
try{
 for(const [action,name] of [['aimIdle','ironsight_fidget'],['aimShoot','ironsight_shoot']]){
  const source=`animation/anims/viewmodel/rifle/rifle_sg556/${name}_sg556.vnmclip_c`,dest=path.join(stage,`sg553-${action}.glb`);
  if(fs.existsSync(dest))continue;
  const log=fs.openSync(dest+'.log','w');
  try{const result=spawnSync(path.join(root,'tools/source2viewer/Source2Viewer-CLI.exe'),['-i',path.join(game,'pak01_dir.vpk'),'-f',source,'-o',dest,'-d','--gltf_export_format','glb','--gltf_export_animations','--game',path.join(game,'gameinfo.gi')],{stdio:['ignore',log,log],windowsHide:true,timeout:120000,env:{...process.env,TEMP:temp,TMP:temp}});if(result.status||result.error)throw result.error||Error('Export failed: '+source);}
  finally{fs.closeSync(log);}
  console.log(source);
 }
}finally{fs.closeSync(lock);fs.unlinkSync(lockPath);}
