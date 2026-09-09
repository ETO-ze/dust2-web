import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const root=path.resolve(import.meta.dirname,'../..'),stage=path.join(root,'artifacts/characters-cs2/gloves');
const game=process.env.CS2_GAME_DIR||'E:/steam/steamapps/common/Counter-Strike Global Offensive/game/csgo';
const temp=path.join(root,'artifacts/export-temp');
fs.mkdirSync(stage,{recursive:true});fs.mkdirSync(temp,{recursive:true});
const lockPath=path.join(root,'artifacts/s2v-export.lock'),lock=fs.openSync(lockPath,'wx');
fs.writeFileSync(lock,JSON.stringify({pid:process.pid,task:'hedge-maze-gloves',startedAt:new Date().toISOString()}));
function run(resource,name,model=false){
 const output=path.join(stage,name),log=fs.openSync(output+'.log','w');
 const args=['-i',path.join(game,'pak01_dir.vpk'),'-f',resource,'-o',output,'-d','--game',path.join(game,'gameinfo.gi')];
 if(model)args.push('--gltf_export_format','glb','--gltf_export_animations','--gltf_export_materials','--gltf_textures_adapt','--gltf_export_extras');
 const result=spawnSync(path.join(root,'tools/source2viewer/Source2Viewer-CLI.exe'),args,{windowsHide:true,stdio:['ignore',log,log],env:{...process.env,TEMP:temp,TMP:temp},timeout:300000});
 fs.closeSync(log);if(result.status||result.error)throw Error('Export '+resource+': '+result.status);console.log(name);
}
try{
 if(!fs.existsSync(path.join(stage,'sport.glb')))run('agents/models/shared/arms/glove_sporty/glove_sporty.vmdl_c','sport.glb',true);
 run('gloves/paints/sporty_green.vmat_c','sporty_green.vmat');
 run('gloves/paints/sporty_green.vcompmat_c','sporty_green.vcompmat');
}finally{fs.closeSync(lock);fs.unlinkSync(lockPath);}
