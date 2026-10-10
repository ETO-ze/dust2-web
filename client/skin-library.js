import {SKINS} from '../shared/skins.js';
import {getWeapon} from '../shared/weapons.js';
export function filterSkins({weapon='all',category='all',query='',availability='all',downloaded=new Set(),loadout={}}={}){
 const search=String(query).trim().toLocaleLowerCase();
 return SKINS.filter(s=>(weapon==='all'||s.weapon===weapon)&&(category==='all'||getWeapon(s.weapon).category===category)
  && (!search||`${s.name} ${s.englishName||''} ${getWeapon(s.weapon).name}`.toLocaleLowerCase().includes(search))
  && (availability==='all'||availability==='equipped'&&loadout[s.weapon]===s.id||availability==='saved'&&downloaded.has(s.id)));
}
