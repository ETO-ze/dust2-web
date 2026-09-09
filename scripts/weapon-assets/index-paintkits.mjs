import fs from 'node:fs';
import path from 'node:path';
import { readVpkIndex } from '../../tools/vpk-index.mjs';

const root=path.resolve(import.meta.dirname,'../..');
const source=path.join(root,'output/cs2-skins/source');
const text=fs.readFileSync(path.join(source,'scripts/items/items_game.txt'),'utf8');
const translation=file=>Object.fromEntries([...fs.readFileSync(path.join(source,'resource',file),'utf8').matchAll(/"([^"\r\n]+)"\s+"([^"\r\n]*)"/g)].map(match=>[match[1].toLowerCase(),match[2]]));
const english=translation('csgo_english.txt'),chinese=translation('csgo_schinese.txt');
const tokens=[...text.matchAll(/"((?:\\.|[^"\\])*)"|([{}])|\/\/[^\r\n]*/g)].filter(m=>m[1]!==undefined||m[2]).map(m=>m[1]??m[2]);
let cursor=0;
function object(){const result={};while(cursor<tokens.length){const key=tokens[cursor++];if(key==='}')return result;const value=tokens[cursor++];result[key]=value==='{'?object():value;}throw Error('Unterminated KeyValues block');}
// items_game repeats paint_kits for subsequent collections and partial patches.
const kits={};
for(let index=0;index<tokens.length-1;index++)if(tokens[index]==='paint_kits'&&tokens[index+1]==='{'){
 cursor=index+2;const section=object();for(const [id,kit]of Object.entries(section))kits[id]={...kits[id],...kit};index=cursor-1;
}
const game=process.env.CS2_GAME_DIR||'E:/steam/steamapps/common/Counter-Strike Global Offensive/game/csgo';
const entries=new Set(readVpkIndex(path.join(game,'pak01_dir.vpk')).entries.map(entry=>entry.path));
const weapons={elite:'elite',p250:'p250',fiveseven:'fiveseven',deagle:'deagle',nova:'nova',mag7:'mag7',mp9:'mp9',mp7:'mp7',bizon:'bizon',scar20:'scar20',m4a4:'m4a1',ssg08:'ssg08',tec9:'tec9',xm1014:'xm1014',sawedoff:'sawedoff',mac10:'mac10',galilar:'galilar',sg553:'sg556',ak47:'ak47',m4a1:'m4a1_silencer',awp:'awp',pistol:'glock',usp:'usp_silencer',knife:'knife_karambit'};
const result={source:'Installed CS2 items_game and localization, read only',weapons:{}};
for(const [id,inventoryWeapon]of Object.entries(weapons)){
 const list=[];
 for(const [paintkit,kit]of Object.entries(kits)){
  const preview=`panorama/images/econ/default_generated/weapon_${inventoryWeapon}_${kit.name}_light_png.vtex_c`;
  const material=`materials/models/weapons/customization/paints/vmats/${kit.name}.vmat_c`;
  if(!entries.has(preview)||!entries.has(material))continue;
  const token=(kit.description_tag||'').replace(/^#/,'').toLowerCase();
  list.push({paintkit:Number(paintkit),paint:kit.name,name:english[token]||kit.description_tag||kit.name,chineseName:chinese[token]||null,body:kit.use_legacy_model==='1'?'legacy':'hd',wearMin:Number(kit.wear_remap_min||0),wearMax:Number(kit.wear_remap_max||1),officialFactoryNewPossible:Number(kit.wear_remap_min||0)<.07,material,inventory:`weapon_${inventoryWeapon}_${kit.name}`,preview});
 }
 result.weapons[id]=list;
}
const dest=path.join(root,'artifacts/weapon-expansion');fs.mkdirSync(dest,{recursive:true});fs.writeFileSync(path.join(dest,'paintkit-candidates.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(Object.fromEntries(Object.entries(result.weapons).map(([id,list])=>[id,list.length]))));
