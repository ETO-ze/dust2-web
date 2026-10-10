// Extend the existing catalog without regenerating user defaults or melee rules.
// All numbers and finish eligibility come from the read-only installed CS2 exports.
import fs from 'node:fs';
const rows=[
 ['hkp2000','P2000','pistols',['CT'],389,'fire-elemental','pist_hkp2000'],
 ['cz75a','CZ75-Auto','pistols',['CT','T'],643,'xiangliu','pist_cz_75'],
 ['revolver','R8 左轮手枪','pistols',['CT','T'],595,'reboot','pist_revolver'],
 ['aug','AUG','rifles',['CT'],455,'akihabara-accept','rif_aug'],
 ['famas','FAMAS','rifles',['CT'],604,'roll-cage','rif_famas'],
 ['g3sg1','G3SG1','rifles',['T'],493,'flux','snip_g3sg1'],
 ['mp5sd','MP5-SD','mid',['CT','T'],810,'phosphor','smg_mp5sd'],
 ['p90','P90','mid',['CT','T'],359,'asiimov','smg_p90'],
 ['ump45','UMP-45','mid',['CT','T'],556,'primal-saber','smg_ump45'],
 ['m249','M249','mid',['CT','T'],496,'nebula-crusader','mach_m249para'],
 ['negev','Negev','mid',['CT','T'],514,'power-loader','mach_negev'],
];
const source=fs.readFileSync('output/weapon-data-audit','utf8');
const candidates=JSON.parse(fs.readFileSync('artifacts/weapon-expansion/paintkit-candidates.json','utf8')).weapons;
const specs=JSON.parse(fs.readFileSync('scripts/weapon-assets/default-skins.json','utf8'));
const definitions=[];
for(const[id,name,category,teams,paintkit,slug,composite]of rows){
 const finish=candidates[id].find(s=>s.paintkit===paintkit);
 if(!finish?.officialFactoryNewPossible||finish.wearMin!==0)throw Error('Invalid pristine finish '+id);
 const englishName=id==='revolver'?'Reboot':id==='mp5sd'?'Phosphor':finish.name;
 const input=`materials/models/weapons/customization/${composite}/${composite}_composite_inputs.vmat`;
 const spec={...finish,id,weapon:id,file:`${id}-${slug}`,name:`${name} | ${englishName}`,englishName,previewOutput:`previews/${id}-${slug}.webp`,input,rawGLB:`artifacts/weapon-expansion/raw/${id}/${id}.glb`};
 const index=specs.findIndex(s=>s.id===id);if(index<0)specs.push(spec);else specs[index]=spec;
 const block=source.match(new RegExp('\\tweapon_'+id+' =\\s*\\{([\\s\\S]*?)\\n\\t\\}'))?.[1];
 if(!block)throw Error('Missing installed definition '+id);
 const read=(field,fallback)=>{const value=block.match(new RegExp('^\\t\\t'+field+' = ([^\\n\\r]+)','m'))?.[1];if(value===undefined)return fallback;try{return JSON.parse(value);}catch{return value;}};
 const first=(v,i=0)=>Array.isArray(v)?v[i]??v[0]:v;
 const magazine=read('m_iMaxClip1'),reserveAmmoAsClips=read('m_bReserveAmmoAsClips',false),spread=read('m_flSpread'),stand=read('m_flInaccuracyStand');
 const levels=read('m_nZoomLevels',0);
 definitions.push({id,name,skin:finish.chineseName,category,teams,slot:category==='pistols'?2:1,price:read('m_nPrice'),damage:read('m_nDamage'),headMultiplier:read('m_flHeadshotMultiplier',4),armorRatio:read('m_flArmorRatio',1),fireInterval:first(read('m_flCycleTime')),magazine,reserve:read('m_nPrimaryReserveAmmoMax')*(reserveAmmoAsClips?magazine:1),reserveAmmoAsClips,reloadTime:read('m_flDisallowAttackAfterReloadStartDuration'),reloadStyle:'magazine',range:read('m_flRange')*.0254,rangeModifier:read('m_flRangeModifier'),pellets:read('m_nNumBullets',1),spread:first(spread)+first(stand),scopedSpread:first(spread,1)+first(stand,1),crouchingSpread:first(spread)+first(read('m_flInaccuracyCrouch')),movingSpread:first(read('m_flInaccuracyMove')),recoil:Math.min(.07,first(read('m_flRecoilMagnitude'))*.0007),automatic:read('m_bIsFullAuto',false),zoomFovs:[90,...Array.from({length:levels},(_,i)=>read('m_nZoomFOV'+(i+1)))],zoomStyle:levels?(id==='aug'?'optic':'scope'):null,unzoomsAfterShot:read('m_bUnzoomsAfterShot',false),maxSpeed:first(read('m_flMaxSpeed'))*.0254,scopedMaxSpeed:first(read('m_flMaxSpeed'),1)*.0254,color:'#a9b3ad'});
}
fs.writeFileSync('scripts/weapon-assets/default-skins.json',JSON.stringify(specs,null,2)+'\n');
let weapons=fs.readFileSync('shared/weapons.js','utf8');
for(const row of definitions){const pattern=new RegExp('^  \\{"id":"'+row.id+'"[^\\n]*\\n','m');weapons=weapons.replace(pattern,'');}
weapons=weapons.replace('  {"id":"knife"',definitions.map(row=>'  '+JSON.stringify(row)+',').join('\n')+'\n  {"id":"knife"');
const order=JSON.parse(weapons.match(/WEAPON_ORDER = Object.freeze\((\[[^\n]+\])/)[1]);
weapons=weapons.replace(/WEAPON_ORDER = Object.freeze\(\[[^\n]+\]/,'WEAPON_ORDER = Object.freeze('+JSON.stringify([...new Set([...order.filter(id=>id!=='knife'),...rows.map(row=>row[0]),'knife'])]));
if(!weapons.includes("p2000:'hkp2000'"))weapons=weapons.replace("WEAPON_ALIASES = Object.freeze({","WEAPON_ALIASES = Object.freeze({p2000:'hkp2000','cz75-auto':'cz75a',cz75:'cz75a',r8:'revolver','r8-revolver':'revolver','mp5-sd':'mp5sd','ump-45':'ump45',");
fs.writeFileSync('shared/weapons.js',weapons);
console.log(JSON.stringify(definitions.map(({id,price,magazine,reserve})=>({id,price,magazine,reserve}))));
