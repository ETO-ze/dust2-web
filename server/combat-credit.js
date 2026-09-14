export const ASSIST_DAMAGE=40;
const owner=(room,actor)=>room.players.get(actor?.controllerId)||actor;
export function resetContributions(player){player.damageContributions=new Map();player.flashContributions=new Map();}
export function recordDamage(room,victim,attacker,damage){
  const scorer=owner(room,attacker),actual=Math.min(victim.health,Math.max(0,Number(damage)||0));
  if(!scorer||!victim.alive||attacker.id===victim.id||attacker.team===victim.team||!actual)return;
  victim.damageContributions||=new Map();for(const id of victim.damageContributions.keys())if(!room.players.has(id))victim.damageContributions.delete(id);const before=victim.damageContributions.get(scorer.id)?.damage||0;
  victim.damageContributions.set(scorer.id,{damage:before+actual,team:attacker.team,at:room.clock()});
}
export function recordFlash(room,victim,attacker,duration){
  const scorer=owner(room,attacker);if(!scorer||attacker.team===victim.team||duration<.5)return;
  victim.flashContributions||=new Map();for(const [id,f]of victim.flashContributions)if(f.until<room.clock()||!room.players.has(id))victim.flashContributions.delete(id);const before=victim.flashContributions.get(scorer.id);
  victim.flashContributions.set(scorer.id,{team:attacker.team,until:Math.max(before?.until||0,room.clock()+duration*1000+1000)});
}
export function awardAssist(room,victim,killer){
  const scorer=owner(room,killer);if(!scorer||killer.team===victim.team||killer.id===victim.id)return {};
  const eligible=([id,record])=>id!==scorer.id&&record.team===killer.team&&room.players.get(id)?.team===killer.team;
  const damage=[...(victim.damageContributions||[])].filter(e=>eligible(e)&&e[1].damage>=ASSIST_DAMAGE).sort((a,b)=>b[1].damage-a[1].damage||b[1].at-a[1].at);
  const flash=[...(victim.flashContributions||[])].filter(e=>eligible(e)&&e[1].until>=room.clock()).sort((a,b)=>b[1].until-a[1].until);
  const selected=damage[0]||flash[0];if(!selected)return {};
  const assister=room.players.get(selected[0]);assister.assists=(assister.assists||0)+1;
  return {assisterId:assister.id,assisterName:assister.name,flashAssist:!damage.length,assisterDamage:Math.round(victim.damageContributions?.get(assister.id)?.damage||0)};
}
