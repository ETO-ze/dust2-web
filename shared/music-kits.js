// These stable loadout IDs are also the only accepted network values.
export const MUSIC_KITS=Object.freeze({
  neckdeep_01:'Neck Deep · 人生何处不青山',valve_cs2_01:'Valve · Counter-Strike 2',
  blitzkids_01:'Blitz Kids · 有为青年',neckdeep_02:'Neck Deep · 躺平青年',isoxo_01:'ISOxo · 非人类',
  alleycvt_01:'ALLEYCVT & LEVEL UP · 相信',arcando_01:'Arcando & Pirapus · 超声波',
  djdiesel_01:'DJ DIESEL & Hairitage · 甩起头来',fool_01:'F.O.O.L · 狂徒',
  noisestorm_01:'Noisestorm · 横行无忌',pegboardnerds_01:'Pegboard Nerds · 断开连接',
  tristam_braken_01:'Tristam & Braken · 翱翔',vicetone_01:'Vicetone & Cozi Zuehlsdorff · 内华达',none:'关闭音乐',
});
export function isMusicKit(id){return typeof id==='string'&&Object.hasOwn(MUSIC_KITS,id);}
// A map response advertises complete local kits by ID, keeping cue manifests
// and their artist metadata out of the download router's initial bundle.
export function packagedMusicKitForPath(path){
  const cue=/^assets\/audio\/music\/optional\/([a-z0-9_]+)\/([a-z0-9_-]+)\.mp3$/.exec(path);
  if(!cue||cue[1]==='none'||!isMusicKit(cue[1]))return null;
  if((cue[1]==='neckdeep_01'||cue[1]==='valve_cs2_01')&&!/^startaction_01-[a-f0-9]{12}$/.test(cue[2]))return null;
  return cue[1];
}
export function musicKitLabel(id){return isMusicKit(id)?MUSIC_KITS[id]:'';}
export function roomMusicKits(room){
  return [...new Set([...room.players.values()].map(player=>player.musicKit).filter(id=>isMusicKit(id)&&id!=='none'))].sort();
}
