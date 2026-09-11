import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'../..');
const game=process.env.CS2_GAME_DIR||'E:/steam/steamapps/common/Counter-Strike Global Offensive/game/csgo';
const temp=path.join(root,'artifacts/export-temp');fs.mkdirSync(temp,{recursive:true});
const lockPath=path.join(root,'artifacts/s2v-export.lock'),lock=fs.openSync(lockPath,'wx');
fs.writeFileSync(lock,JSON.stringify({pid:process.pid,task:'utility-assets',startedAt:new Date().toISOString()}));
const specs=[['hegrenade','hegrenade'],['flashbang','flashbang'],['smokegrenade','smoke'],['decoy','flashbang'],['molotov','molotov'],['incgrenade','incendiary'],['defusekit',null]];
const stage=path.join(root,'artifacts/weapon-expansion');
function run(resource,file,model=false){
 if(fs.existsSync(file)){console.log('Existing '+file);return;}
 fs.mkdirSync(path.dirname(file),{recursive:true});const log=fs.openSync(file+'.log','w');
 const args=['-i',path.join(game,'pak01_dir.vpk'),'-f',resource,'-o',file,'-d','--gltf_export_format','glb','--gltf_export_animations','--game',path.join(game,'gameinfo.gi')];
 if(model)args.push('--gltf_export_materials','--gltf_textures_adapt','--gltf_export_extras');
 const r=spawnSync(path.join(root,'tools/source2viewer/Source2Viewer-CLI.exe'),args,{stdio:['ignore',log,log],windowsHide:true,timeout:180000,env:{...process.env,TEMP:temp,TMP:temp}});fs.closeSync(log);
 if(r.error||r.status)throw r.error||Error('Export failed '+resource);
 console.log(path.relative(stage,file));
}
try{
 for(const [id,stem]of specs){
  const model=id==='defusekit'?'weapons/models/defuser/defuser.vmdl_c':id==='incgrenade'?'weapons/models/grenade/incendiary/weapon_incendiarygrenade.vmdl_c':`weapons/models/grenade/${id}/weapon_${id}.vmdl_c`;
  run(model,path.join(stage,'raw',id,id+'.glb'),true);
  if(!stem)continue;
  for(const [action,clip]of Object.entries({draw:'draw',idle:'idle',inspect:'lookat01',pullpin:'pullpin',throw:'throw_overhand',throwUnderhand:'throw_underhand',holdHigh:'throwcharge_high',holdMid:'throwcharge_mid',holdLow:'throwcharge_low'}))run(`animation/anims/viewmodel/grenade/grenade_${id==='decoy'?'flashbang':id==='incgrenade'?'incendiary':id}/${clip}_${stem}.vnmclip_c`,path.join(stage,'animations',id+'-'+action+'.glb'));
 }
}finally{fs.closeSync(lock);fs.unlinkSync(lockPath);}
