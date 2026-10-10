import {WEAPONS,WEAPON_ORDER,TEAM_LOADOUTS} from './weapons.js';
export const LOADOUT_GROUPS=Object.freeze(['pistols','mid','rifles']);
export const LOADOUT_LABELS=Object.freeze({pistols:'手枪',mid:'中级',rifles:'步枪'});
export const STARTING_PISTOLS=Object.freeze({CT:Object.freeze(['usp','hkp2000']),T:Object.freeze(['pistol'])});
export function startingPistolForTeam(value,team){const side=team==='CT'?'CT':'T',id=value?.[side]?.pistols?.[0];return STARTING_PISTOLS[side].includes(id)?id:STARTING_PISTOLS[side][0];}
export function loadoutCandidates(team,group){return WEAPON_ORDER.filter(id=>WEAPONS[id].category===group&&WEAPONS[id].teams.includes(team));}
export function normalizeWeaponLoadout(value){
 const result={};
 for(const team of ['CT','T']){result[team]={};for(const group of LOADOUT_GROUPS){
  const allowed=loadoutCandidates(team,group),raw=value?.[team]?.[group],chosen=Array.isArray(raw)?raw.filter(id=>typeof id==='string'&&allowed.includes(id)):[];
  const ids=[...new Set([...chosen,...TEAM_LOADOUTS[team][group],...allowed])].slice(0,5);
  if(group==='pistols'){const starter=startingPistolForTeam(value,team);result[team][group]=[starter,...[...new Set([...chosen,...TEAM_LOADOUTS[team][group],...allowed])].filter(id=>!STARTING_PISTOLS[team].includes(id))].slice(0,5);}else result[team][group]=ids;
 }}return result;
}
export function teamWeaponLoadout(value,team){return normalizeWeaponLoadout(value)[team==='CT'?'CT':'T'];}
export function canReplaceLoadoutSlot(team,group,index,weapon){
 if(!STARTING_PISTOLS[team]||!LOADOUT_GROUPS.includes(group)||!Number.isInteger(index)||index<0||index>4||!loadoutCandidates(team,group).includes(weapon))return false;
 return group!=='pistols'||(index===0?STARTING_PISTOLS[team].includes(weapon):!STARTING_PISTOLS[team].includes(weapon));
}
export function replaceLoadoutSlot(value,team,group,index,weapon){
 const next=normalizeWeaponLoadout(value);if(!canReplaceLoadoutSlot(team,group,index,weapon))return next;
 const row=next[team][group],prior=row.indexOf(weapon);if(group==='pistols'&&prior===0)return next;
 if(prior>=0)row[prior]=row[index];row[index]=weapon;return next;
}
