// Private team purchase calls never cross the opponent's WebSocket connection.
// Prepare at most two views per broadcast, rather than serializing per player.
export function snapshotForSide(snapshot,side){
  const {radarBySide,ctSpottedBomb,...common}=snapshot;
  return {...common,bombSpotted:side==='CT'&&ctSpottedBomb===true,radarContacts:radarBySide?.[side]||[],events:(snapshot.events||[]).filter(e=>!e.audienceTeam||e.audienceTeam===side),weaponRequests:(snapshot.weaponRequests||[]).filter(r=>r.team===side),players:snapshot.players.map(player=>{
    if(player.team===side)return player;
    const {botBuy,lossIncome,weaponLoadout,plantSite,...publicPlayer}=player;return publicPlayer;
  })};
}
