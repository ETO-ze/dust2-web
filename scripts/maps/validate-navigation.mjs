import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {initPhysics,createPlayerState,stepPlayer} from '../../shared/physics.js';
import {MapTacticalGraph} from '../../server/map-tactical-graph.js';
import {settleNavPoint,probeNavEdge} from './navigation-movement.mjs';
import {loadPrivatePhysics} from './load-private-physics.mjs';

const root=process.env.DUSTII_MAP_LIBRARY;
if(!root)throw Error('Set DUSTII_MAP_LIBRARY to the directory containing exports.json');
const reports=JSON.parse(fs.readFileSync(path.join(root,'exports.json')));
const allEdges=process.argv.includes('--all-edges');
const airMovement=process.argv.includes('--source-air')?'source':'legacy';
const outputArg=process.argv.find(value=>value.startsWith('--output='));
const outputDirectory=outputArg?path.resolve(outputArg.slice(9)):null;
const selected=process.argv.slice(2).filter(value=>!value.startsWith('--'));
const compact=({endState,...plan})=>plan;
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
for(const report of reports.filter(r=>!selected.length||selected.includes(r.id))){
 const started=performance.now();
 const dir=path.join(report.directory,'compiled'),map=JSON.parse(fs.readFileSync(path.join(dir,'map.json'))),areas=JSON.parse(fs.readFileSync(path.join(dir,'nav.json')));
 const physics=loadPrivatePhysics(report.directory,1);
 initPhysics(physics.positions,null,{mapPatches:false,airMovement});
 const stands=new Map();
 for(const area of areas){const standing=settleNavPoint(area);if(standing)stands.set(area.id,standing);}
 const rejected=new Map(),plans=new Map(),routes=[];
 const graph=new MapTacticalGraph(map,areas.map(a=>stands.get(a.id)||a),{standAllowed:a=>stands.has(a.id),edgeAllowed:(a,b)=>!rejected.has(`${a.id}>${b.id}`)});
 console.log(JSON.stringify({map:map.id,stage:'standing',standable:stands.size,areas:areas.length}));
 for(const team of ['T','CT'])for(const site of ['A','B']){
  const spawn=map.spawns[team][0],spawnState=createPlayerState(spawn);
  for(let i=0;i<60;i++)stepPlayer(spawnState,{},1/30);
  let answer=null;
  // Failed shortest-path edges are removed and an alternative is searched.
  // Physics is never weakened to make the original shortest route pass.
  for(let attempt=0;attempt<160;attempt++){
   const candidate=graph.route(spawnState,map.sites[site]);
   if(!candidate){answer={team,site,passed:false,reason:'no-validated-alternative',attempts:attempt,nodes:[]};break;}
   let state={...spawnState},blocked=null,ticks=0;
   const routePlans=[];
   const initial=probeNavEdge({...spawnState,id:`spawn-${team}`,corners:[]},candidate[0],{initialState:state});
   if(!initial.passed){answer={team,site,passed:false,reason:'spawn-connector-blocked',attempts:attempt+1,nodes:candidate.map(a=>a.id),failure:compact(initial)};break;}
   state=initial.endState;ticks+=initial.ticks;
   for(let i=1;i<candidate.length;i++){
    const a=candidate[i-1],b=candidate[i],key=`${a.id}>${b.id}`;
    // Carry the real state through every edge, including momentum and crouch.
    // Independent centre-to-centre successes alone are not a playable route.
    const result=probeNavEdge(a,b,{initialState:state});
    if(!result.passed){blocked={key,...compact(result)};rejected.set(key,blocked);break;}
    state=result.endState;ticks+=result.ticks;
    const record={key,from:a.id,to:b.id,...compact(result)};
    plans.set(key,record);routePlans.push(record);
   }
   if(blocked)continue;
   answer={team,site,passed:true,attempts:attempt+1,nodes:candidate.map(a=>a.id),walkedEdges:candidate.length-1,ticks,seconds:ticks/30,
    initial:compact(initial),spawnState,edgePlans:routePlans,final:{x:state.x,y:state.y,z:state.z,crouch:state.crouch}};
   break;
  }
  answer||={team,site,passed:false,reason:'search-budget',attempts:160,nodes:[]};
  routes.push(answer);
  console.log(JSON.stringify({map:map.id,team,site,passed:answer.passed,attempts:answer.attempts,nodes:answer.nodes.length,reason:answer.reason,seconds:answer.seconds,rejected:rejected.size}));
 }
 let standaloneEdgesTested=0;
 if(allEdges){
  for(const a of stands.values())for(const id of a.neighbors){
   const b=stands.get(id),key=`${a.id}>${id}`;
   if(!b||plans.has(key)||rejected.has(key))continue;
   const probe=compact(probeNavEdge(a,b));standaloneEdgesTested++;
   if(probe.passed)plans.set(key,{key,from:a.id,to:b.id,scope:'standalone-adjacency',...probe});
   else rejected.set(key,{key,...probe});
   if(standaloneEdgesTested%500===0)console.log(JSON.stringify({map:map.id,stage:'all-edges',tested:standaloneEdgesTested,accepted:plans.size,rejected:rejected.size}));
  }
 }
 const result={schemaVersion:2,map:map.id,airMovement,sourceSha256:report.sourceSha256,physicsSha256:physics.physicsSha256,maskSha256:physics.maskSha256,policySha256:physics.policySha256,navigationSha256:sha(fs.readFileSync(path.join(dir,'nav.json'))),areas:areas.length,standable:stands.size,standaloneEdgesTested,
  complete:false,spawnSiteRoutesPassed:routes.every(r=>r.passed),scope:'Continuous 30 Hz real-player physics from first T/CT source spawn to both sites, with crouch/jump and blocked-edge replanning; not a full-map playtest or dynamic entity simulation',
  standIds:[...stands.keys()],standPoints:[...stands.values()].map(({id,x,y,z,crouch})=>({id,x,y,z,crouch})),
  acceptedEdges:[...plans.keys()].filter(key=>!rejected.has(key)),rejectedEdges:[...rejected.keys()],edgePlans:[...plans.values()].filter(p=>!rejected.has(p.key)),failures:[...rejected.values()],routes,
  elapsedSeconds:(performance.now()-started)/1000};
 const targetDirectory=outputDirectory?path.join(outputDirectory,map.id):report.directory;fs.mkdirSync(targetDirectory,{recursive:true});
 fs.writeFileSync(path.join(targetDirectory,'navigation-audit.json.part'),JSON.stringify(result));
 fs.renameSync(path.join(targetDirectory,'navigation-audit.json.part'),path.join(targetDirectory,'navigation-audit.json'));
 console.log(JSON.stringify({map:map.id,stage:'done',passed:routes.filter(r=>r.passed).length,acceptedEdges:result.acceptedEdges.length,rejectedEdges:result.rejectedEdges.length,elapsedSeconds:result.elapsedSeconds}));
}
