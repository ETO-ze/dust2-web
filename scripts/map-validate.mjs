import fs from 'node:fs';
import {MAP} from '../shared/map-data.js';
import {initPhysics,createPlayerState,stepPlayer,floorHeight} from '../shared/physics.js';

const bytes=fs.readFileSync(new URL('../public/assets/map/positions.f32',import.meta.url));
const positions=new Float32Array(bytes.buffer,bytes.byteOffset,bytes.byteLength/4);
const started=performance.now();initPhysics(positions);
const nav=new Map(MAP.nav.map(p=>[p.id,p]));
const nearest=p=>MAP.nav.reduce((a,b)=>Math.hypot(a.x-p.x,a.y-p.y,a.z-p.z)<Math.hypot(b.x-p.x,b.y-p.y,b.z-p.z)?a:b);
const visited=new Set([MAP.spawns.T[0].navId]),queue=[MAP.spawns.T[0].navId];
for(let i=0;i<queue.length;i++)for(const id of nav.get(queue[i])?.neighbors??[])if(nav.has(id)&&!visited.has(id)){visited.add(id);queue.push(id);}
const results=[];
for(const[team,spawns]of Object.entries(MAP.spawns))for(let i=0;i<spawns.length;i++){
  const initial=spawns[i],p=createPlayerState(initial);
  for(let k=0;k<120;k++)stepPlayer(p,{},1/60);
  const drift=Math.hypot(p.x-initial.x,p.z-initial.z);
  results.push({team,index:i,grounded:p.grounded,y:+p.y.toFixed(3),fall:+(initial.y-p.y).toFixed(3),drift:+drift.toFixed(3),okay:p.grounded&&!p.outOfWorld&&drift<1});
}
const destinations=Object.fromEntries(Object.entries({...MAP.sites,CT:MAP.spawns.CT[0]}).map(([k,p])=>[k,visited.has(nearest(p).id)]));
const report={triangles:positions.length/9,initAndCheckMs:Math.round(performance.now()-started),navNodes:MAP.nav.length,reachableFromT:visited.size,destinations,spawns:results};
fs.writeFileSync(new URL('../public/assets/map/validation.json',import.meta.url),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
if(results.some(x=>!x.okay)||Object.values(destinations).some(x=>!x))process.exitCode=1;
