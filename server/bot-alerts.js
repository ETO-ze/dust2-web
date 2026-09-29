import {MAP} from '../shared/map-data.js';
const range=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
const automated=p=>p.bot&&!p.controllerId;
const home=p=>{if(!automated(p))return null;const role=p.botAI?.defenseRole;return ['anchor-b','sniper-b'].includes(role)?'B':['anchor-a','sniper-a','mid','short','long','rotator'].includes(role)?'A':null;};

// Called only by witnessed contact, a heard shot, or a teammate casualty.
// Store a site-level radio report, never an unseen enemy's live coordinates.
export function reportSiteThreat(room,team,point,kind='sound',observation={}){
 if(team!=='CT'||room.mode!=='defuse'||room.round.phase!=='live')return;
 const site=range(point,MAP.sites.A)<range(point,MAP.sites.B)?'A':'B';
 if(range(point,MAP.sites[site])>29)return;
 const now=room.clock(),alerts=room.botAlerts||={};
 let alert=alerts[site];
 if(!alert||now-alert.lastAt>16000)alert=alerts[site]={site,firstAt:now,lastAt:now,contactAt:null,deathAt:null};
 alert.lastAt=now;
 if(kind==='contact'){
  if(alert.contactAt===null||now-(alert.contactLastAt??alert.contactAt)>6000)alert.contactAt=now;
  alert.contactLastAt=now;
  if(observation.enemyId){
   // An enemy seen at the other site is no longer evidence for this site.
   for(const other of Object.values(alerts))other.contacts?.delete(observation.enemyId);
   (alert.contacts||=new Map()).set(observation.enemyId,{at:now,hasBomb:!!observation.hasBomb});
   for(const [id,seen] of alert.contacts)if(now-seen.at>6000)alert.contacts.delete(id);
  }
 }
 if(kind==='death'){if(alert.deathAt===null||now-(alert.deathLastAt??alert.deathAt)>10000)alert.deathAt=now;alert.deathLastAt=now;}
 if(kind==='sound')alert.soundAt=now;
}

function evidence(alert,now){
 const contacts=[...(alert.contacts?.values()||[])].filter(v=>now-v.at<=6000);
 const contact=alert.contactAt!==null&&now-(alert.contactLastAt??alert.contactAt)<=6000;
 const death=alert.deathAt!==null&&now-(alert.deathLastAt??alert.deathAt)<=10000;
 const bomb=contacts.some(v=>v.hasBomb),strong=bomb||contacts.length>=2||contact&&death;
 return {alert,contact,death,bomb,strong,count:contacts.length,score:(bomb?8:0)+(strong?4:0)+(contact?2:0)+(death?1:0)};
}

export function rotationSite(room,p){
 const now=room.clock(),ai=p.botAI;
 if(!automated(p)||p.team!=='CT'||room.mode!=='defuse'||room.round.phase!=='live'||room.bomb?.state==='planted')return null;
 if(ai.engaging||ai.utility||p.objectiveLocked||now-(ai.lastSeenAt??-Infinity)<2500)return null;
 const alerts=Object.values(room.botAlerts||{}).filter(a=>now-a.lastAt<=16000).map(a=>evidence(a,now)).filter(e=>
   e.contact&&now-e.alert.contactAt>=3000||e.death&&now-e.alert.deathAt>=5000||
   e.alert.soundAt!==undefined&&now-e.alert.firstAt>=10000);
 // Repeated shots refresh knowledge without restarting the first alarm timer.
 alerts.sort((a,b)=>b.score-a.score||b.alert.lastAt-a.alert.lastAt);
 const previous=room.botRotation;
 let threat=alerts[0];
 // Finish the short reinforcement route after contact breaks. Fresh conflicting
 // visual evidence can override it; repeated sounds cannot cause oscillation.
 if(previous?.commitUntil>now&&(!threat||threat.score<previous.score))threat=previous.threat;
 if(!threat)return null;
 const {alert}=threat;
 const alive=[...room.players.values()].filter(q=>q.alive&&q.team==='CT');
 const rosterKey=alive.map(q=>[q.id,q.controllerId||'',home(q),!!q.botAI?.engaging,!!q.botAI?.utility,!!q.objectiveLocked,automated(q)?'bot':range(q,MAP.sites[alert.site])<24].join(':')).sort().join(',');
 let plan=room.botRotation;
 if(!plan||plan.alert!==alert||plan.rosterKey!==rosterKey||now>=plan.recheckAt){
  const other=alert.site==='A'?'B':'A';
  const elsewhere=alive.filter(q=>home(q)===other);
  const opposing=room.botAlerts?.[other],contested=opposing&&now-opposing.lastAt<6000&&
    (evidence(opposing,now).contact||evidence(opposing,now).death);
  // Keep an anchor for weak/noisy probes, but release the last remote defender
  // for a witnessed execute, spotted carrier or a contact plus lost defender.
  const releaseAnchor=threat.strong&&!contested;
  const keeper=releaseAnchor?null:[...elsewhere].sort((a,b)=>Number(!(a.botAI?.defenseRole||'').startsWith('anchor'))-Number(!(b.botAI?.defenseRole||'').startsWith('anchor'))||range(a,MAP.sites[other])-range(b,MAP.sites[other]))[0];
  const eligible=alive.filter(q=>home(q)===other||home(q)===alert.site&&['mid','rotator','short','long'].includes(q.botAI?.defenseRole)&&range(q,MAP.sites[alert.site])>=24);
  const candidates=eligible.filter(q=>q!==keeper&&automated(q)&&!q.botAI.engaging&&!q.botAI.utility&&!q.objectiveLocked&&now-(q.botAI.lastSeenAt??-Infinity)>=2500);
  const priority=q=>['rotator','mid','short','long'].indexOf(q.botAI.defenseRole);
  candidates.sort((a,b)=>Number(!previous?.ids.has(a.id))-Number(!previous?.ids.has(b.id))||(priority(a)<0?9:priority(a))-(priority(b)<0?9:priority(b))||range(a,MAP.sites[alert.site])-range(b,MAP.sites[alert.site])||a.seat-b.seat);
  // Nearby humans count as support at their actual site, never as an A anchor.
  const present=alive.filter(q=>!eligible.includes(q)&&range(q,MAP.sites[alert.site])<24).length;
  const desired=threat.strong?Math.min(alive.length,threat.bomb||threat.count>=3?5:4):3;
  plan=room.botRotation={alert,threat,score:threat.score,rosterKey,recheckAt:now+1500,
    commitUntil:previous?.alert===alert?previous.commitUntil:now+12000,
    ids:new Set(candidates.slice(0,Math.max(0,Math.min(threat.strong?4:2,desired-present))).map(q=>q.id))};
 }
 if(!plan.ids.has(p.id))return null;
 if(ai.rotationAlert!==alert){ai.rotationAlert=alert;ai.rotations=(ai.rotations||0)+1;}
 return alert.site;
}
