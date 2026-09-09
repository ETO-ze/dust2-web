import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {WEAPON_ORDER} from '../shared/weapons.js';
const source=fs.readFileSync(new URL('../output/cs2-settings/weapons.vdata',import.meta.url),'utf8');
const aliases={pistol:'glock',usp:'usp_silencer',m4a1:'m4a1_silencer',m4a4:'m4a1',sg553:'sg556'},values={};
for(const id of WEAPON_ORDER){
 if(id==='knife')continue;
 const block=source.match(new RegExp('^\\tweapon_'+(aliases[id]||id)+'_prefab =\\s*\\{([\\s\\S]*?)^\\t\\}','m'))?.[1];
 if(!block)throw Error('Missing weapon '+id);
 const array=name=>{const result=block.match(new RegExp('\\b'+name+' = \\[ ([0-9., ]+) \\]'))?.[1]?.split(',').map(Number);if(!result||result.length!==2||!result.every(Number.isFinite))throw Error('Missing '+name);return result;};
 values[id]={spread:array('m_flSpread'),stand:array('m_flInaccuracyStand'),crouch:array('m_flInaccuracyCrouch'),move:array('m_flInaccuracyMove'),jump:array('m_flInaccuracyJump')};
}
fs.writeFileSync(new URL('../shared/weapon-accuracy-data.js',import.meta.url),'// Read-only extraction from user-installed Valve scripts/weapons.vdata_c.\nexport const ACCURACY_SOURCE = '+JSON.stringify({path:'scripts/weapons.vdata_c',sha256:createHash('sha256').update(source).digest('hex')})+';\nexport const WEAPON_ACCURACY = '+JSON.stringify(values,null,2)+';\n');
console.log('Extracted accuracy arrays for '+Object.keys(values).length+' weapons.');
