const range=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
export function selectSpawn(room,team,self=null){
 const pool=room.spawnPoints?.[team];
 if(!pool?.length)throw new Error(`Map has no ${team} spawn points`);
 const round=room.round.number;
 if(room.spawnReservations?.round!==round)room.spawnReservations={round,CT:new Set(),T:new Set()};
 const used=room.spawnReservations[team];if(used.size>=pool.length)used.clear();
 const order=room.spawnCounter[team]++,all=[...room.players.values()].filter(q=>q!==self&&q.alive);
 const scored=pool.map((point,index)=>{
  const mates=all.filter(q=>q.team===team),nearest=Math.min(Infinity,...mates.map(q=>range(q,point)));
  const crowd=mates.reduce((sum,q)=>sum+Math.max(0,8-range(q,point)),0);
  const threat=all.filter(q=>q.team!==team).reduce((sum,q)=>sum+Math.max(0,30-range(q,point)),0);
  return {point,index,score:(nearest<1.25?2000:0)+(used.has(index)?800:0)+crowd*6+threat,tie:(index-order%pool.length+pool.length)%pool.length};
 });
 scored.sort((a,b)=>a.score-b.score||a.tie-b.tie);used.add(scored[0].index);return scored[0].point;
}
