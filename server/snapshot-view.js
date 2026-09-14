// Private team purchase calls never cross the opponent's WebSocket connection.
// Prepare at most two views per broadcast, rather than serializing per player.
export function snapshotForSide(snapshot,side){
  return {...snapshot,players:snapshot.players.map(player=>{
    if(player.team===side)return player;
    const {botBuy,lossIncome,...publicPlayer}=player;return publicPlayer;
  })};
}
