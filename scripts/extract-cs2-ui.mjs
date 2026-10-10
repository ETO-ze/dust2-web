import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readVpkIndex } from '../tools/vpk-index.mjs';
const root=path.resolve(import.meta.dirname,'..');
const vpk=process.env.CS2_VPK||'E:/steam/steamapps/common/Counter-Strike Global Offensive/game/csgo/pak01_dir.vpk';
const index=readVpkIndex(vpk),entries=new Map(index.entries.map(e=>[e.path,e]));
const weapons={hkp2000:'hkp2000',cz75a:'cz75a',revolver:'revolver',aug:'aug',famas:'famas',g3sg1:'g3sg1',mp5sd:'mp5sd',p90:'p90',ump45:'ump45',m249:'m249',negev:'negev',molotov:'molotov',incgrenade:'incgrenade',decoy:'decoy',ak47:'ak47',m4a4:'m4a1',m4a1:'m4a1_silencer',awp:'awp',pistol:'glock',usp:'usp_silencer',elite:'elite',p250:'p250',fiveseven:'fiveseven',deagle:'deagle',nova:'nova',mag7:'mag7',mp9:'mp9',mp7:'mp7',bizon:'bizon',scar20:'scar20',ssg08:'ssg08',tec9:'tec9',xm1014:'xm1014',sawedoff:'sawedoff',mac10:'mac10',galilar:'galilar',sg553:'sg556',knife:'knife_karambit',hegrenade:'hegrenade',flashbang:'flashbang',smokegrenade:'smokegrenade',armor:'kevlar',helmet:'assaultsuit',defusekit:'defuser',c4:'c4',world:'world'};
const sources=Object.fromEntries(Object.entries(weapons).map(([id,name])=>[id,`panorama/images/icons/equipment/${name}.vsvg_c`]));
Object.assign(sources,{
  headshot:'panorama/images/hud/deathnotice/icon_headshot.vsvg_c',wallbang:'panorama/images/hud/deathnotice/penetrate.vsvg_c',smoke:'panorama/images/hud/deathnotice/smoke_kill.vsvg_c',blind:'panorama/images/hud/deathnotice/blind_kill.vsvg_c',noscope:'panorama/images/hud/deathnotice/noscope.vsvg_c',airborne:'panorama/images/hud/deathnotice/inairkill.vsvg_c',assist:'panorama/images/icons/equipment/flashbang_assist.vsvg_c',death:'panorama/images/hud/teamcounter/killtype_default.vsvg_c',health:'panorama/images/hud/health_cross.vsvg_c',CT:'panorama/images/icons/ui/ct_logo_1c.vsvg_c',T:'panorama/images/icons/ui/t_logo_1c.vsvg_c',kill:'panorama/images/hud/kill_pip_default.vsvg_c',killHeadshot:'panorama/images/hud/kill_pip_headshot.vsvg_c',timer:'panorama/images/icons/ui/timer.vsvg_c',
});
for(const id of ['1','2','3','4','5','extra','mask'])sources[`killCard${id}`]=`panorama/images/hud/kill_${id}.vsvg_c`;
for(const id of ['blast','burn','slash','shock'])sources[`killPip${id}`]=`panorama/images/hud/kill_pip_${id}.vsvg_c`;
Object.assign(sources,{hudArmor:'panorama/images/hud/armor.vsvg_c',hudHelmet:'panorama/images/hud/armor_helmet.vsvg_c',botAvatar:'panorama/images/hud/teamcounter/teamcounter_botavatar.vsvg_c',knifeM9:'panorama/images/icons/equipment/knife_m9_bayonet.vsvg_c',knifeButterfly:'panorama/images/icons/equipment/knife_butterfly.vsvg_c'});
function read(resource){const e=entries.get(resource);if(!e)throw Error(`Missing ${resource}`);if(e.preloadBytes)throw Error(`Unexpected preload ${resource}`);const archive=e.archiveIndex===0x7fff?vpk:vpk.replace('_dir.vpk',`_${String(e.archiveIndex).padStart(3,'0')}.vpk`),fd=fs.openSync(archive,'r'),b=Buffer.alloc(e.length);try{fs.readSync(fd,b,0,b.length,e.offset+(e.archiveIndex===0x7fff?index.headerSize+index.treeSize:0));}finally{fs.closeSync(fd);}return b;}
function dataBlock(b){for(let i=0;i<b.readUInt32LE(12);i++){const o=16+12*i;if(b.toString('ascii',o,o+4)==='DATA'){const start=o+4+b.readUInt32LE(o+4);return b.subarray(start,start+b.readUInt32LE(o+8));}}throw Error('No DATA block');}
const out=path.join(root,'public/assets/ui-cs2'),bundled=path.join(root,'client/original-hud');fs.mkdirSync(out,{recursive:true});fs.mkdirSync(bundled,{recursive:true});
const sha=b=>createHash('sha256').update(b).digest('hex');const assets={};
for(const[id,source]of Object.entries(sources)){const original=read(source),data=dataBlock(original),start=data.indexOf('<svg'),end=data.lastIndexOf('</svg>');if(start<0||end<start)throw Error(`No original SVG ${id}`);const svg=data.subarray(start,end+6);if(/<script\b|<foreignObject\b|(?:href|xlink:href)\s*=\s*["'](?:https?:|javascript:)/i.test(svg.toString()))throw Error(`Unexpected active SVG ${id}`);fs.writeFileSync(path.join(out,id+'.svg'),svg);assets[id]={file:`assets/ui-cs2/${id}.svg`,source,sourceSha256:sha(original),bytes:svg.length,sha256:sha(svg)};}
const references=path.join(root,'artifacts/ui-cs2/panorama');fs.mkdirSync(references,{recursive:true});
const styles=['mainmenu','mainmenu_play','buymenu','scoreboard','hud/huddeathnotice','hud/huddeathpanel','hud/hudteamcounter','hud/hudhealthammocenter','hud/hudweaponselection','endofmatch','endofmatch-win','teamselectmenu','hud/hudwinpanel'];
for(const name of styles){const source=`panorama/styles/${name}.vcss_c`;if(!entries.has(source))continue;const data=dataBlock(read(source));fs.writeFileSync(path.join(references,name.replaceAll('/','-')+'.css'),data.subarray(6).toString().replace(/^[\s\S]*?(?=@define)/,'').replace(/\0+$/,''));}
for(const name of ['hudhealthammocenter','hudteamcounter','hudweaponselection','huddeathnotice','hudwinpanel']){
 const source=`panorama/layout/hud/${name}.vxml_c`;if(!entries.has(source))continue;
 const data=dataBlock(read(source));fs.writeFileSync(path.join(references,`${name}.xml.data`),data);
}
fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify({source:'User-installed Counter-Strike 2, Valve',sourceVpk:'game/csgo/pak01_dir.vpk',extractedAt:new Date().toISOString(),method:'Read-only VPK extraction; original SVG subtree from Source 2 DATA block. No redraw, rasterization or shape changes.',assets},null,2)+'\n');
// Imported by Vite so new HUD glyphs are available in the same deployment;
// they never depend on an older CDN asset manifest containing the new names.
for(const [id,asset] of Object.entries(assets))fs.copyFileSync(path.join(out,id+'.svg'),path.join(bundled,id+'.svg'));
fs.writeFileSync(path.join(bundled,'icons.js'),'// Original Valve SVGs, emitted by scripts/extract-cs2-ui.mjs.\nexport const originalIcons=Object.freeze({\n'+Object.keys(assets).map(id=>` ${JSON.stringify(id)}:new URL('./${id}.svg',import.meta.url).href,`).join('\n')+'\n});\n');
fs.writeFileSync(path.join(bundled,'sources.json'),JSON.stringify({source:'User-installed CS2 / Valve',method:'Unmodified SVG subtree from original VPK; font package decoded with Source2Viewer',assets},null,2)+'\n');
console.log(JSON.stringify({icons:Object.keys(assets).length,bytes:Object.values(assets).reduce((n,a)=>n+a.bytes,0),styles:fs.readdirSync(references)}));
