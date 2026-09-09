import fs from 'node:fs';import path from 'node:path';import{spawnSync}from'node:child_process';
const root=path.resolve(import.meta.dirname,'../..'),stage=path.join(root,'artifacts/characters-cs2');
const game=process.env.CS2_GAME_DIR||'E:/steam/steamapps/common/Counter-Strike Global Offensive/game/csgo';
const temp=path.join(root,'artifacts/export-temp'),lockPath=path.join(root,'artifacts/s2v-export.lock');
fs.mkdirSync(temp,{recursive:true});const lock=fs.openSync(lockPath,'wx');fs.writeFileSync(lock,JSON.stringify({pid:process.pid,task:'optional-agents',startedAt:new Date().toISOString()}));
const specs=[{id:'ct-ava',team:'CT',source:'ctm_fbi/ctm_fbi_variantb',name:'Special Agent Ava | FBI',itemId:5308},{id:'t-miami',team:'T',source:'tm_professional/tm_professional_varf',name:'Sir Bloody Miami Darryl | The Professionals',itemId:4726}];
function run(resource,file,model=false){
 if(fs.existsSync(file)&&!(model&&process.argv.includes('--force'))){const h=Buffer.alloc(12),fd=fs.openSync(file,'r');fs.readSync(fd,h);fs.closeSync(fd);if(!model||(h.toString('ascii',0,4)==='glTF'&&h.readUInt32LE(8)===fs.statSync(file).size)){console.log('existing '+path.relative(stage,file));return;}}
 fs.mkdirSync(path.dirname(file),{recursive:true});const log=fs.openSync(file+'.log','w');const args=['-i',path.join(game,'pak01_dir.vpk'),'-f',resource,'-o',file,'-d','--game',path.join(game,'gameinfo.gi')];if(model)args.push('--gltf_export_format','glb','--gltf_export_animations','--gltf_export_materials','--gltf_textures_adapt','--gltf_export_extras');
 const result=spawnSync(path.join(root,'tools/source2viewer/Source2Viewer-CLI.exe'),args,{windowsHide:true,stdio:['ignore',log,log],env:{...process.env,TEMP:temp,TMP:temp},timeout:360000});fs.closeSync(log);if(result.status||result.error)throw Error('Export '+resource+' '+result.status);console.log(path.relative(stage,file));
}
try{
 for(const s of specs){run('agents/models/'+s.source+'.vmdl_c',path.join(stage,'raw',s.id,s.id+'.glb'),true);run('panorama/images/econ/characters/customplayer_'+s.source.split('/')[1]+'_png.vtex_c',path.join(stage,'previews',s.id+'.png'));}
 for(const [id,source]of [['ct-sas','ctm_sas'],['t-phoenix','tm_phoenix']])run('panorama/images/econ/characters/customplayer_'+source+'_png.vtex_c',path.join(stage,'previews',id+'.png'));
 fs.writeFileSync(path.join(stage,'optional-source-index.json'),JSON.stringify({agents:specs},null,2)+'\n');
}finally{fs.closeSync(lock);fs.unlinkSync(lockPath);}
