import evidence from './data/vitality-demo-evidence.json' with {type:'json'};

// Role adaptation is explicit and auditable, not a claim to reproduce a player.
export const VITALITY_ROSTER=Object.freeze([
 Object.freeze({id:'flameZ',role:'entry'}),Object.freeze({id:'mezii',role:'trade'}),
 Object.freeze({id:'apEX',role:'utility'}),Object.freeze({id:'ropz',role:'flank'}),
 Object.freeze({id:'ZywOo',role:'sniper'}),
]);
export const challengeMember=(room,p)=>room.botDifficulty==='vitality'&&p?.bot&&!!room.challengeTeamId&&p.teamId===room.challengeTeamId;
export const botDifficultyFor=(room,p)=>room.botDifficulty==='vitality'?(challengeMember(room,p)?'vitality':'normal'):room.botDifficulty;
export function syncChallengeRoster(room){
 for(const teamId of ['A','B']){
  const bots=[...room.players.values()].filter(p=>p.bot&&p.teamId===teamId).sort((a,b)=>a.seat-b.seat);
  bots.forEach((p,i)=>{p.baseBotName||=p.name;p.challengeProfile=challengeMember(room,p)?VITALITY_ROSTER[i]||null:null;p.name=p.challengeProfile?.id||p.baseBotName;});
 }
}
export const challengeEvidence=(room,p)=>evidence.maps[room.privateMap?.mapId||'de_dust2']?.players[p.challengeProfile?.id]?.[p.team.toLowerCase()]||null;
export function challengeUtilityOrder(room,p){
 const sample=challengeEvidence(room,p),fallback=['smokegrenade','flashbang',p.team==='T'?'molotov':'incgrenade','hegrenade'];
 if(!sample)return fallback;
 const ids={smokegrenade:'smoke',flashbang:'flashbang',molotov:'molotov',incgrenade:'molotov',hegrenade:'hegrenade'};
 return [...fallback].sort((a,b)=>(sample.utility[ids[b]]||0)-(sample.utility[ids[a]]||0));
}
/** Sampled Source positions are preferences only. Accept a nearby stand and
 * a reachable route in the actual, collision-audited map; otherwise fall back. */
export function challengeOpeningPost(room,p,graph){
 if(!challengeMember(room,p))return null;
 const positions=(challengeEvidence(room,p)?.openingPositions||[]).filter(v=>!['CTSpawn','TSpawn'].includes(v.place)).slice(0,3);
 if(!positions.length)return null;
 const offset=room.round.number%3===0?1:0;
 for(let i=0;i<positions.length;i++){
  const sample=positions[(i+offset)%positions.length],source=sample.sourcePoint;
  const point={x:source.x*.0254,y:source.z*.0254,z:-source.y*.0254},node=graph.nearest(point);
  if(!node||Math.hypot(node.x-point.x,node.y-point.y,node.z-point.z)>3.5)continue;
  const route=graph.route(p,node);if(route?.length)return {node,route,place:sample.place};
 }
 return null;
}
