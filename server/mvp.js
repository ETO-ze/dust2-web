// Awards are captured at the result, before after-round kills or a side swap.

function award(p, reason, kills) {
  return {id:p.id,name:p.name,agentId:p.agentId,team:p.team,reason,kills,
    stars:p.mvpStars||0,musicKit:p.musicKit||(p.bot?'valve_cs2_01':'neckdeep_01')};
}

export function objectiveMvp(room, body, reason) {
  const player=room.players.get(body.controllerId)||body;
  return award(player,reason,player.roundKills||0);
}

export function roundMvp(room,winner,objective) {
  let result=objective;
  if(!result) {
    const candidates=[...room.players.values()].filter(p=>p.team===winner&&p.roundKills>0);
    const best=candidates.sort((a,b)=>b.roundKills-a.roundKills||(a.seat??10)-(b.seat??10))[0];
    if(!best)return null;
    result=award(best,'eliminations',best.roundKills);
  }
  if(result.team!==winner)return null;
  const player=room.players.get(result.id);
  const stars=(player?.mvpStars??result.stars)+1;
  if(player)player.mvpStars=stars;
  return {...result,kills:player?.roundKills??result.kills,stars};
}

export function matchMvp(room,winnerTeamId) {
  const candidates=[...room.players.values()].filter(p=>p.teamId===winnerTeamId);
  candidates.sort((a,b)=>(b.mvpStars||0)-(a.mvpStars||0)||b.kills-a.kills||
    b.assists-a.assists||a.deaths-b.deaths||(a.seat??10)-(b.seat??10));
  const best=candidates[0];
  if(!best?.mvpStars&&!best?.kills)return room.round.mvp||null;
  return award(best,best.mvpStars?'roundAwards':'matchKills',best.kills);
}
