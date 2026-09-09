import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { readVpkIndex } from '../../tools/vpk-index.mjs';

const root=path.resolve(import.meta.dirname,'../..');
const stage=path.join(root,'artifacts/weapon-expansion');
const game=process.env.CS2_GAME_DIR||'E:/steam/steamapps/common/Counter-Strike Global Offensive/game/csgo';
const vpk=path.join(game,'pak01_dir.vpk');
const cli=path.join(root,'tools/source2viewer/Source2Viewer-CLI.exe');
const args=process.argv.slice(2),ids=args.find(a=>a.startsWith('--ids='))?.slice(6).split(',');
const doModels=args.includes('--models')||!args.includes('--animations');
const doAnimations=args.includes('--animations')||!args.includes('--models');
const rows=[
  ['elite','pist','pistol'],['p250','pist','pistol'],['fiveseven','pist','pistol'],['deagle','pist','pistol'],
  ['nova','shot','rifle'],['mag7','shot','rifle'],['mp9','smg','rifle'],['mp7','smg','rifle'],
  ['bizon','smg','rifle'],['scar20','snip','rifle'],['m4a4','rif','rifle'],['ssg08','snip','rifle'],
  ['tec9','pist','pistol'],['xm1014','shot','rifle'],['sawedoff','shot','rifle'],['mac10','smg','rifle'],
  ['galilar','rif','rifle'],['sg553','rif','rifle','sg556'],
];
const entries=new Map(readVpkIndex(vpk).entries.map(entry=>[entry.path,entry]));
const manifest=rows.map(([id,type,animationType,sourceId=id])=>{
  const model=`weapons/models/${sourceId}/weapon_${type}_${sourceId}.vmdl_c`;
  const directory=`animation/anims/viewmodel/${animationType}/${animationType}_${sourceId}`;
  const clips={draw:`draw_${sourceId}`,idle:`idle_${sourceId}`,reload:`reload_${sourceId}`,shoot:`shoot1_${sourceId}`,inspect:`lookat01_${sourceId}`};
  if(id==='elite'){clips.shoot=`shoot_right1_${sourceId}`;clips.shoot2=`shoot_left1_${sourceId}`;}
  if(entries.has(`${directory}/reload_empty_${sourceId}.vnmclip_c`))clips.reloadEmpty=`reload_empty_${sourceId}`;
  if(id==='ssg08')for(const [action,stem]of Object.entries({...clips}))if(entries.has(`${directory}/${stem}_lgcy.vnmclip_c`))clips[action+'Legacy']=stem+'_lgcy';
  if(!entries.has(model))throw Error('Missing model '+model);
  for(const stem of Object.values(clips))if(!entries.has(`${directory}/${stem}.vnmclip_c`))throw Error('Missing original animation '+directory+'/'+stem);
  return{id,sourceId,model,modelBytes:entries.get(model).length,animationDirectory:directory,clips};
});
if(ids?.some(id=>!manifest.some(spec=>spec.id===id)))throw Error('Unknown --ids value');
fs.mkdirSync(stage,{recursive:true});
fs.writeFileSync(path.join(stage,'source-index.json'),JSON.stringify({sourceVpk:vpk,weapons:manifest},null,2)+'\n');
if(args.includes('--index-only')){console.log(JSON.stringify({weapons:manifest.length,clips:manifest.reduce((sum,s)=>sum+Object.keys(s.clips).length,0)}));process.exit(0);}
const temp=path.join(root,'artifacts/export-temp');fs.mkdirSync(temp,{recursive:true});
const lockPath=path.join(root,'artifacts/s2v-export.lock');
const lock=fs.openSync(lockPath,'wx');fs.writeFileSync(lock,JSON.stringify({pid:process.pid,task:'weapon-expansion',startedAt:new Date().toISOString()}));
function exportedGLB(file){if(!fs.existsSync(file))return false;const header=Buffer.alloc(12),fd=fs.openSync(file,'r');fs.readSync(fd,header);fs.closeSync(fd);return header.toString('ascii',0,4)==='glTF'&&header.readUInt32LE(8)===fs.statSync(file).size;}
function run(resource,output,model){
  if(exportedGLB(output)){console.log('verified existing '+path.relative(stage,output));return;}
  fs.mkdirSync(path.dirname(output),{recursive:true});
  const log=fs.openSync(output+'.log','w');
  const command=['-i',vpk,'-f',resource,'-o',output,'-d','--gltf_export_format','glb','--gltf_export_animations','--game',path.join(game,'gameinfo.gi')];
  if(model)command.push('--gltf_export_materials','--gltf_textures_adapt','--gltf_export_extras');
  const result=spawnSync(cli,command,{cwd:root,stdio:['ignore',log,log],windowsHide:true,env:{...process.env,TEMP:temp,TMP:temp},timeout:300000});
  fs.closeSync(log);
  if(result.error||result.status||!exportedGLB(output))throw Error('Export failed '+resource+': '+(result.error?.message||result.status)+'; see '+output+'.log');
  console.log(path.relative(stage,output)+' '+fs.statSync(output).size+' bytes');
}
try{
  for(const spec of manifest.filter(spec=>!ids||ids.includes(spec.id))){
    if(doModels)run(spec.model,path.join(stage,'raw',spec.id,spec.id+'.glb'),true);
    if(doAnimations)for(const [action,stem]of Object.entries(spec.clips))run(`${spec.animationDirectory}/${stem}.vnmclip_c`,path.join(stage,'animations',spec.id+'-'+action+'.glb'),false);
  }
}finally{fs.closeSync(lock);fs.unlinkSync(lockPath);}
