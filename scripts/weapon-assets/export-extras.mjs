import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {readVpkIndex} from '../../tools/vpk-index.mjs';
const root=path.resolve(import.meta.dirname,'../..'),stage=path.join(root,'artifacts/optional-extras');
const game=process.env.CS2_GAME_DIR||'E:/steam/steamapps/common/Counter-Strike Global Offensive/game/csgo',pak=path.join(game,'pak01_dir.vpk');
const index=new Set(readVpkIndex(pak).entries.map(e=>e.path));fs.mkdirSync(stage,{recursive:true});
const cli=path.join(root,'tools/source2viewer/Source2Viewer-CLI.exe'),temp=path.join(root,'artifacts/export-temp');
const lockPath=path.join(root,'artifacts/s2v-export.lock'),lock=fs.openSync(lockPath,'wx');
function run(source,out,model=false){
 if(!source.includes(',')&&!index.has(source))throw Error('Missing original asset '+source);
 if(fs.existsSync(out)&&out.endsWith('.glb')&&fs.readFileSync(out).toString('ascii',0,4)==='glTF')return;
 fs.mkdirSync(out.endsWith(path.sep)?out:path.dirname(out),{recursive:true});const log=fs.openSync(out+'.log','w');
 const args=['-i',pak,'-f',source,'-o',out,'-d'];
 if(out.endsWith('.glb'))args.push('--gltf_export_format','glb','--gltf_export_animations','--game',path.join(game,'gameinfo.gi'));
 if(model)args.push('--gltf_export_materials','--gltf_textures_adapt','--gltf_export_extras');
 const result=spawnSync(cli,args,{stdio:['ignore',log,log],windowsHide:true,timeout:300000,env:{...process.env,TEMP:temp,TMP:temp}});fs.closeSync(log);
 if(result.error||result.status)throw Error('Export failed '+source);console.log('Exported '+source);
}
try{
 for(const id of ['m9','butterfly']){
  run(`weapons/models/knife/knife_${id}/weapon_knife_${id}.vmdl_c`,path.join(stage,id,id+'.glb'),true);
  for(const [action,stem] of Object.entries({draw:'draw',idle:'idle1',shoot:'light_miss1',shoot2:'light_miss2',heavy:'heavy_miss1',inspect:'lookat01'}))run(`animation/anims/viewmodel/knife/knife_${id}/${stem}_${id}.vnmclip_c`,path.join(stage,'animations',id+'-'+action+'.glb'));
 }
 const cues=['startround_01','wonround','lostround','roundmvpanthem_01','endofmatch','bombplanted','bombtenseccount','roundtenseccount','deathcam'];
 const sounds=['blitzkids_01','neckdeep_02','isoxo_01'].flatMap(kit=>cues.map(cue=>`sounds/music/${kit}/${cue}.vsnd_c`));
 for(const source of sounds)if(!source.includes(',')&&!index.has(source))throw Error('Missing '+source);
 run(sounds.join(','),path.join(stage,'audio')+path.sep);
}finally{fs.closeSync(lock);fs.unlinkSync(lockPath);}
