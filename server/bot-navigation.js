import {createPlayerState,stepPlayer} from '../shared/physics.js';
const distance=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
const point=p=>({x:p.x,y:p.y,z:p.z});
export const navigationEdge=(a,b)=>`${a}>${b}`;

/** Only measure attempted travel, not guarding, planting, fighting or lining up
 * a throw. Recovery follows the same hull physics as the player; no teleports. */
export function recoverNavigation(room,p,{force=false}={}){
 const ai=p.botAI,now=room.clock(),waypoint=ai.path?.[0];
 const active=!room.round||['live','ended'].includes(room.round.phase);
 const travelling=active&&waypoint&&ai.wantMove&&!ai.engaging&&!p.objectiveLocked&&(!ai.utility||ai.utility.phase==='approach');
 if(!travelling){ai.travelProbe=null;ai.stuckAt=now;return false;}
 const key=waypoint.navId??`${waypoint.x.toFixed(1)}:${waypoint.z.toFixed(1)}`;
 const gap=distance(p,waypoint),probe=ai.travelProbe;
 if(!force&&(!probe||probe.key!==key||gap<probe.gap-.2)){ai.travelProbe={key,gap,at:now};ai.stuckAt=now;return false;}
 if((!force&&now-probe.at<2200)||now<(ai.escapeUntil||0))return false;
 ai.recoveries=(ai.recoveries||0)+1;ai.routeFailures=(ai.routeFailures||0)+1;
 const blocked=ai.blockedEdges||=new Map();
 for(const [edge,until]of blocked)if(until<=now)blocked.delete(edge);
 if(waypoint.navId&&waypoint.fromNavId)blocked.set(navigationEdge(waypoint.fromNavId,waypoint.navId),now+20000);
 if(blocked.size>48)blocked.delete(blocked.keys().next().value);
 // Probe eight short motions only when genuinely stuck, capped to 128 physics
 // steps per recovery. Walking backwards/sideways is often enough at a jamb.
 const heading=Math.atan2(-(waypoint.x-p.x),-(waypoint.z-p.z));let best=null;
 for(const delta of [0,.8,-.8,1.57,-1.57,2.35,-2.35,Math.PI]){
  const q={...createPlayerState(p),vx:0,vy:p.vy||0,vz:0,grounded:p.grounded,crouch:p.crouch,height:p.height};
  for(let i=0;i<16;i++)stepPlayer(q,{forward:1,yaw:heading+delta,crouch:true,jump:i<2},1/30);
  const moved=distance(p,q);if(moved<.45||q.y<p.y-1.6||!Number.isFinite(q.x+q.y+q.z))continue;
  const score=moved-Math.abs(delta)*.12+(gap-distance(q,waypoint))*.3;
  if(!best||score>best.score)best={...point(q),score};
 }
 ai.travelProbe=null;ai.stuckAt=now;ai.goal=null;ai.path=[];ai.wanderAt=0;
 if(best){ai.escape={...point(best)};ai.escapeUntil=now+1600;ai.path=[point(best)];}
 else {ai.escape=null;ai.escapeUntil=0;}
 // A failed lineup yields to movement and is suppressed by botUtility. A
 // repeatedly blocked attack leg can select the other approach next replan.
 if(ai.utility)ai.utility.expiresAt=now-1;
 if(ai.routeFailures>=2&&p.team==='T'&&room.bomb.state!=='planted'){
  ai.routeVariant=(ai.routeVariant||0)+1;ai.routeFailures=0;ai.routeKey=null;
 }
 return true;
}
