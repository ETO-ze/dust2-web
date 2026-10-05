const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
export const routeLength=path=>path.slice(1).reduce((sum,p,i)=>sum+distance(path[i],p),0);
const signature=path=>path.map(n=>n.id).join(',');

/** Three bounded, collision-audited choices. The caller supplies only allied
 * positions and expiring perception reports, never unobserved enemy state. */
export function selectPrivateRoute(graph,start,goal,{preferred=null,teammates=[],reports=[],round=1,seat=0,role='',urgent=false}={}){
 const shortest=graph.route(start,goal);if(!shortest)return {path:null,variant:-1,reason:'no-verified-route'};
 if(preferred?.length&&['entry','trade','carrier','utility'].includes(role))return {path:preferred,variant:0,reason:'squad-lane'};
 const minimum=routeLength(shortest),limit=minimum*(urgent?1.15:1.4)+(urgent?2:6),candidates=graph.alternatives(start,goal,3).filter(p=>routeLength(p)<=limit);
 if(!candidates.length)candidates.push(shortest);
 const allies=teammates.filter(p=>p.alive!==false),evidence=reports.filter(r=>r.point&&r.confidence>.12);
 const targetVariant=(round+seat)%candidates.length;
 const choices=candidates.map((path,variant)=>{
  const length=routeLength(path),samples=path.slice(1,-1).filter((_,i)=>i%3===0);
  let exposure=0,traffic=0;
  for(const n of samples){
   for(const report of evidence){const radius=Math.max(3,report.uncertainty||0)+2,near=Math.max(0,1-distance(n,report.point)/radius);exposure+=near*report.confidence*(report.kind==='visual'?3:report.kind==='casualty'?2:.65);}
   for(const ally of allies)traffic+=Math.max(0,1-distance(n,ally)/3);
  }
  const score=length+exposure*(urgent?.5:2.5)+traffic*1.3-(variant===targetVariant&&!urgent?Math.min(8,minimum*.18):0);
  return {path,variant,length,score,signature:signature(path),reason:evidence.length?'known-contact-and-allied-spacing':'round-and-allied-spacing'};
 });
 choices.sort((a,b)=>a.score-b.score||a.variant-b.variant);return choices[0];
}
