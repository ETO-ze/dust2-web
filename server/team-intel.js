import {updateBombSpotting} from './bomb-radar.js';
import {eyePosition} from '../shared/aim.js';
import {getWeapon} from '../shared/weapons.js';
import {cs2FovToVertical} from '../shared/cs2-settings.js';
import {angleDifference} from './bot-aim.js';
import {lookAt} from './bot-perception.js';
import {reportSiteThreat} from './bot-alerts.js';

// Radio knowledge is a copy of an observation, never a live enemy reference.
export function shareSighting(room,observer,enemy){
 const now=room.clock();
 reportSiteThreat(room,observer.team,enemy,'contact',{enemyId:enemy.id,hasBomb:!!enemy.hasBomb});
 const report={x:enemy.x,y:enemy.y,z:enemy.z,at:now,observer:observer.id,lifeId:enemy.lifeId};
 (room.teamIntel||={})[observer.team]=report;
 const sightings=(room.teamSightings||={})[observer.team]||=new Map();
 sightings.set(enemy.id,report);
 for(const [id,r] of sightings)if(now-r.at>12000)sightings.delete(id);
}

// Return only observed coordinates. Snapshot serialization selects one team's list.
export function radarBySide(room) {
 const result={T:[],CT:[]}, now=room.clock();
 for (const team of ['T','CT']) {
  const reports=new Map(room.teamSightings?.[team]||[]);
  for(const visual of room.privateBots?.perception?.reports?.[team]||[]) {
   if(visual.kind==='visual' && visual.at>(reports.get(visual.enemyId)?.at??-Infinity))
    reports.set(visual.enemyId,{...visual.point,at:visual.at,lifeId:visual.lifeId});
  }
  for (const [id,r] of reports) {
   const actor=room.players.get(id);
   if (!actor?.alive || actor.team===team || actor.lifeId!==r.lifeId || now-r.at>=1400) continue;
   result[team].push({id,x:Math.round(r.x*4)/4,z:Math.round(r.z*4)/4,y:Math.round(r.y),at:r.at});
  }
 }
 return result;
}

// Humans and possessed bodies also supply radio information. Use authoritative
// view angles and the same wall/smoke test as bots; don't trust client spotting.
// At most 5 observers x 5 opponents, at 5 Hz, and only in rooms that need it.
export function updateTeamVision(room){
 const now=room.clock();
 if(room.round.phase!=='live'||(!room.gridVision && room.mode!=='defuse')||now<(room.nextTeamVisionAt||0))return;
 room.nextTeamVisionAt=now+200;
 if(room.mode==='defuse')updateBombSpotting(room,now);
 const players=[...room.players.values()];
 if(!room.gridVision && !players.some(p=>p.alive&&p.team==='CT'&&p.bot&&!p.controllerId))return;
 const enemies=players.filter(p=>p.alive&&now>=(p.protectionUntil||0));
 for(const p of players){
  if(!p.alive||(!room.gridVision && p.team!=='CT')||p.bot&&!p.controllerId||now<(p.flashBlindUntil||0))continue;
  const from=eyePosition(p),fov=getWeapon(p.weapon).zoomFovs[p.zoomLevel||0]||90;
  // Conservative 4:3 reference viewport also works with narrower mobile views.
  const horizontal=fov*Math.PI/360,vertical=cs2FovToVertical(fov)*Math.PI/360;
  for(const enemy of enemies){
   if(enemy.team===p.team)continue;
   if(Math.hypot(enemy.x-p.x,enemy.y-p.y,enemy.z-p.z)>110)continue;
   const height=enemy.crouch?1.1:1.8;
   for(const offset of [height*.67,height-.18,height*.43]){
    const to={x:enemy.x,y:enemy.y+offset,z:enemy.z},angle=lookAt(from,to);
    if(Math.abs(angleDifference(angle.yaw,p.yaw||0))>horizontal||Math.abs(angle.pitch-(p.pitch||0))>vertical)continue;
    if(room.visibleToBot(from,to)){shareSighting(room,p,enemy);break;}
   }
  }
 }
}
