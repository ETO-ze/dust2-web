import fs from 'node:fs';
import {MAP} from '../shared/map-data.js';
import {initPhysics,createPlayerState,stepPlayer,raycastWorld} from '../shared/physics.js';

const bytes=fs.readFileSync(new URL('../public/assets/map/positions.f32',import.meta.url));
initPhysics(new Float32Array(bytes.buffer,bytes.byteOffset,bytes.byteLength/4));
const nodes=new Map(MAP.nav.map(n=>[n.id,n]));
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
const nearest=p=>MAP.nav.reduce((a,b)=>distance(a,p)<distance(b,p)?a:b);
function pathBetween(from,to,preferWalking=false){
  const start=nearest(from),end=nearest(to),open=new Set([start.id]),cost=new Map([[start.id,0]]),prev=new Map();
  while(open.size){
    let id=null,score=Infinity;for(const candidate of open){const s=cost.get(candidate)+distance(nodes.get(candidate),end);if(s<score){id=candidate;score=s;}}
    if(id===end.id){const result=[end];while(result[0].id!==start.id)result.unshift(nodes.get(prev.get(result[0].id)));return result;}
    open.delete(id);const n=nodes.get(id);
    for(const key of n.neighbors){const next=nodes.get(key);if(!next)continue;const penalty=preferWalking?Math.max(0,next.y-n.y-.35)*30:0;const g=cost.get(id)+distance(n,next)+penalty;if(g<(cost.get(key)??Infinity)){prev.set(key,id);cost.set(key,g);open.add(key);}}
  }
  return [];
}
const routes={
  a_long:[{x:8,y:0,z:5},{x:16,y:0,z:-8},{x:20,y:0,z:-18},{x:38,y:0,z:-28},{x:37,y:1,z:-54},MAP.sites.A],
  mid:[{x:-7,y:-1,z:-10},{x:-10,y:-2,z:-27},{x:-10,y:-3,z:-45},MAP.spawns.CT[0]],
  b_tunnels:[{x:-42,y:1,z:7},{x:-44,y:1,z:-19},{x:-43,y:1,z:-29},{x:-40,y:0,z:-47},MAP.sites.B],
  lower_tunnel:[{x:-42,y:1,z:7},{x:-44,y:1,z:-19},{x:-35,y:0,z:-29},{x:-26,y:-2,z:-32},{x:-14,y:-3,z:-35}],
  catwalk:[{x:-7,y:-1,z:-10},{x:-3,y:0,z:-27},{x:4,y:0,z:-41},{x:9,y:2.4,z:-51},MAP.sites.A],
};
function test(name,autoJump,preferWalking){
  const p=createPlayerState(MAP.spawns.T[0]);for(let i=0;i<90;i++)stepPlayer(p,{},1/60);
  const path=[];let from=p;for(const goal of routes[name]){const segment=pathBetween(from,goal,preferWalking);path.push(...segment.slice(path.length?1:0));from=goal;}
  let index=0,anchor={x:p.x,z:p.z},lastMovement=0,maxStall=0,jumps=0,steps=0;
  const trace=[];
  for(steps=0;steps<180*60;steps++){
    while(index<path.length&&Math.hypot(p.x-path[index].x,p.z-path[index].z)<.26&&Math.abs(p.y-path[index].y)<1.1)index++;
    if(index===path.length)break;
    const target=path[index],dx=target.x-p.x,dz=target.z-p.z;
    const yaw=Math.atan2(-dx,-dz),blockedFor=(steps-lastMovement)/60;
    const jump=autoJump&&(target.y-p.y>.4||blockedFor>1.2)&&(steps%42)<3;
    if(jump&&!p.lastJump)jumps++;
    stepPlayer(p,{forward:1,yaw,jump,speedScale:.7},1/60);
    if(Math.hypot(p.x-anchor.x,p.z-anchor.z)>.2){anchor={x:p.x,z:p.z};lastMovement=steps;}
    maxStall=Math.max(maxStall,blockedFor);
    if(steps%30===0)trace.push({t:steps/60,index,x:+p.x.toFixed(3),y:+p.y.toFixed(3),z:+p.z.toFixed(3),grounded:p.grounded});
    if(blockedFor>8||p.outOfWorld)break;
  }
  const target=path[index],capsuleBlock=target?raycastWorld({x:p.x,y:p.y+.5,z:p.z},{x:target.x-p.x,y:0,z:target.z-p.z},1):null;
  return {name,autoJump,preferWalking,success:index===path.length,seconds:+(steps/60).toFixed(2),index,waypoints:path.length,maxStall:+maxStall.toFixed(2),jumps,position:{x:p.x,y:p.y,z:p.z,grounded:p.grounded},next:target,waistObstacleDistance:capsuleBlock,path:path.map(n=>n.id),trace};
}
const report=[];for(const route of Object.keys(routes))for(const autoJump of[false,true])for(const preferWalking of[false,true]){
  const result=test(route,autoJump,preferWalking);report.push(result);console.log(JSON.stringify({...result,trace:undefined,path:undefined}));
}
fs.writeFileSync(new URL('../public/assets/map/walk-validation.json',import.meta.url),JSON.stringify(report,null,2));
