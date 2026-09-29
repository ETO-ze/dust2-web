import {standingAimPoint} from './bot-perception.js';
import {raycastWorld} from '../shared/physics.js';
import {MAP} from '../shared/map-data.js';
const range=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
const point=n=>({x:n.x,y:n.y,z:n.z});
export const HOLD_POSTS=Object.freeze({
 A:[[27,2.5,-67],[36,2.8,-66],[23,2.5,-62],[31,3,-72],[19,0,-58],[33,0,-55],[41,2.6,-60],[15,4,-52]],
 B:[[-46,.8,-69],[-38,.3,-68],[-34,.4,-70],[-43,.3,-65],[-30,3,-66],[-28,1,-56],[-48,.5,-60],[-36,.4,-58]],
});
export function validHoldPosts(room,p,site){
 const key=p.team+':'+site,cache=room.holdPostCache||=new Map();
 if(cache.has(key))return cache.get(key);
 const angles=(p.botAI.watchPoints||[]).map(n=>standingAimPoint(room,n)).filter(Boolean),posts=[];
 for(const [x,y,z]of HOLD_POSTS[site]){
  const eye=standingAimPoint(room,{x,y:y+1.62,z});if(!eye)continue;
  const stand={x:eye.x,y:eye.y-1.62,z:eye.z};
  if(posts.some(n=>range(n,stand)<1))continue;
  if(!angles.some(to=>range(stand,to)>3&&Math.abs(Math.atan2(to.y-eye.y,range(stand,to)))<.48&&room.visibleToBot(eye,to)))continue;
  let cover=0;
  for(let i=0;i<8;i++){const yaw=i*Math.PI/4,dir={x:Math.sin(yaw),y:0,z:Math.cos(yaw)};if(raycastWorld({...stand,y:stand.y+1},dir,2.8))cover++;}
  posts.push({...stand,cover});
 }
 cache.set(key,posts);return posts;
}
export function chooseHoldPost(room,p,site,offset=0){
 const ai=p.botAI,key=`${room.round.number}:${ai.role}:${site}`;
 if(ai.holdPost?.key===key)return ai.holdPost.goal;
 // Small test rooms without navigation keep their authored fallback.
 const fallback=()=>point(room.nearestNav(MAP.sites[site])||MAP.sites[site]);
 if(!room.nav?.length)return fallback();
 const posts=validHoldPosts(room,p,site),start=(room.round.number+(p.seat||0)*3+offset)%Math.max(1,posts.length);
 const peers=[...room.players.values()].filter(q=>q!==p&&q.alive&&q.team===p.team);
 const sorted=posts.map((n,i)=>({n,score:(i-start+posts.length)%posts.length-Math.min(2,n.cover)*.6+
  peers.reduce((sum,q)=>sum+(range(q.botAI?.holdPost?.goal||q,n)<2?20:0),0)})).sort((a,b)=>a.score-b.score);
 for(const {n}of sorted){
  if(range(p,n)>1.3){const path=room.planPath(p,n);if(!path.length||range(path.at(-1),n)>.6)continue;}
  ai.holdPost={key,goal:point(n)};return ai.holdPost.goal;
 }
 const goal=fallback();ai.holdPost={key,goal};return goal;
}
