import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {WEAPON_ORDER} from '../shared/weapons.js';
const source=fs.readFileSync(new URL('../output/cs2-settings/weapons.vdata',import.meta.url),'utf8');
const names={pistol:'glock',usp:'usp_silencer',m4a1:'m4a1_silencer',m4a4:'m4a1',sg553:'sg556'};
const result={};
for(const id of WEAPON_ORDER){
 if(id==='knife')continue;
 const block=source.match(new RegExp('^\\tweapon_'+(names[id]||id)+'_prefab =\\s*\\{([\\s\\S]*?)^\\t\\}','m'))?.[1];
 if(!block)throw Error('Missing weapon '+id);
 const value=name=>{const array=block.match(new RegExp('\\b'+name+' = \\[ ([0-9., ]+) \\]'))?.[1];return array?Number(array.split(',')[['m4a1','usp'].includes(id)?1:0]):Number(block.match(new RegExp('\\b'+name+' = ([0-9.]+)'))?.[1]);};
 result[id]={penetration:value('m_flPenetration'),tracerFrequency:value('m_nTracerFrequency')};
 if(!Object.values(result[id]).every(Number.isFinite))throw Error('Missing ballistics '+id);
}
fs.writeFileSync(new URL('../shared/weapon-ballistics.js',import.meta.url),'// Extracted from user-installed Valve scripts/weapons.vdata_c. Surface loss is a separate web approximation.\nexport const BALLISTICS_SOURCE = '+JSON.stringify({path:'scripts/weapons.vdata_c',sha256:createHash('sha256').update(source).digest('hex')})+';\nexport const WEAPON_BALLISTICS = Object.freeze('+JSON.stringify(result,null,2)+');\n');
console.log(JSON.stringify(result));
