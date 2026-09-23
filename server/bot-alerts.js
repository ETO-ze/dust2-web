import {MAP} from '../shared/map-data.js';
const range=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
const home=p=>(p.botAI?.defenseRole||p.botAI?.role||'').endsWith('-b')?'B':'A';

// Called only by witnessed contact, a heard shot, or a teammate casualty.
// Store a site-level radio report, never an unseen enemy's live coordinates.
export function reportSiteThreat(room,team,point,kind='sound'){
 if(team!=='CT'||room.mode!=='defuse'||room.round.phase!=='live')return;
 const site=range(point,MAP.sites.A)<range(point,MAP.sites.B)?'A':'B';
 if(range(point,MAP.sites[site])>29)return;
 const now=room.clock(),alerts=room.botAlerts||={};
 let alert=alerts[site];
 if(!alert||now-alert.lastAt>16000)alert=alerts[site]={site,firstAt:now,lastAt:now,contactAt:null,deathAt:null};
 alert.lastAt=now;
 if(kind==='contact')alert.contactAt??=now;
 if(kind==='death')alert.deathAt??=now;
}

export function rotationSite(room,p){
 const now=room.clock(),ai=p.botAI;
 if(p.team!=='CT'||room.mode!=='defuse'||room.round.phase!=='live'||room.bomb?.state==='planted')return null;
 if(ai.engaging||ai.utility||p.objectiveLocked||now-(ai.lastSeenAt??-Infinity)<2500)return null;
 const alerts=Object.values(room.botAlerts||{}).filter(a=>now-a.lastAt<=16000&&
   (now-a.firstAt>=10000||a.contactAt!==null&&now-a.contactAt>=3000||a.deathAt!==null&&now-a.deathAt>=5000));
 // Repeated shots refresh knowledge without restarting the first alarm timer.
 alerts.sort((a,b)=>Number(b.contactAt!==null)-Number(a.contactAt!==null)||b.lastAt-a.lastAt);
 const alert=alerts[0];if(!alert)return null;
 const alive=[...room.players.values()].filter(q=>q.alive&&q.team==='CT');
 const rosterKey=alive.map(q=>q.id).sort().join(',');
 let plan=room.botRotation;
 if(!plan||plan.alert!==alert||plan.rosterKey!==rosterKey||now>=plan.recheckAt){
  const other=alert.site==='A'?'B':'A';
  const elsewhere=alive.filter(q=>home(q)===other);
  // Keep one defender at the other site. Prefer its dedicated anchor.
  const keeper=[...elsewhere].sort((a,b)=>Number(!(a.botAI?.defenseRole||'').startsWith('anchor'))-Number(!(b.botAI?.defenseRole||'').startsWith('anchor'))||range(a,MAP.sites[other])-range(b,MAP.sites[other]))[0];
  const candidates=elsewhere.filter(q=>q!==keeper&&q.bot&&!q.controllerId&&!q.botAI.engaging&&!q.botAI.utility&&!q.objectiveLocked&&now-(q.botAI.lastSeenAt??-Infinity)>=2500);
  const priority=q=>['rotator','mid','short','long'].indexOf(q.botAI.defenseRole);
  candidates.sort((a,b)=>(priority(a)<0?9:priority(a))-(priority(b)<0?9:priority(b))||range(a,MAP.sites[alert.site])-range(b,MAP.sites[alert.site])||a.seat-b.seat);
  plan=room.botRotation={alert,rosterKey,recheckAt:now+1500,ids:new Set(candidates.slice(0,2).map(q=>q.id))};
 }
 if(!plan.ids.has(p.id))return null;
 if(ai.rotationAlert!==alert){ai.rotationAlert=alert;ai.rotations=(ai.rotations||0)+1;}
 return alert.site;
}
