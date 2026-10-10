import {raycastWorld} from '../shared/physics.js';
import {eyePosition} from '../shared/aim.js';
import {reportSiteThreat} from './bot-alerts.js';

const sounds=Object.freeze({gunshot:{range:50,ttl:3000,priority:3},suppressed:{range:24,ttl:2400,priority:2},footstep:{range:22,ttl:1800,priority:1},landing:{range:28,ttl:2200,priority:2},reload:{range:13,ttl:1600,priority:1},utility:{range:20,ttl:2000,priority:1},decoy:{range:40,ttl:2200,priority:2}});
const automated=p=>p.bot&&!p.controllerId&&!p.controlledBy;
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
function unobstructed(room,a,b){
 if(room.privateBots?.world)return room.privateBots.world.clearSight(a,b);
 const d=distance(a,b);if(d<.01)return true;
 const hit=raycastWorld(a,{x:(b.x-a.x)/d,y:(b.y-a.y)/d,z:(b.z-a.z)/d},d);
 return hit===null||hit>d-.05;
}
/** Frozen, uncertain sound evidence. Never stores the emitter's target ID. */
export function hearNoise(room,source,kind='gunshot',{origin=eyePosition(source)}={}){
 const spec=sounds[kind];if(!spec||!source||!origin)return [];
 const now=room.clock(),heard=[];
 for(const p of room.players.values()){
  if(!p.alive||p.id===source.id||kind!=='decoy'&&p.team===source.team)continue;
  const from=eyePosition(p),d=distance(from,origin);if(d>spec.range)continue;
  const blocked=!unobstructed(room,from,origin),range=spec.range*(blocked?.62:1),strength=1-d/range;if(strength<.12)continue;
  const cell=blocked?4:2,point={x:Math.round(origin.x/cell)*cell,y:Math.round(origin.y),z:Math.round(origin.z/cell)*cell},confidence=Math.min(.8,.3+strength*.5);
  if(automated(p)&&p.botAI){
   const ai=p.botAI,stale=now>=(ai.heardUntil||0),same=ai.heardPoint&&distance(ai.heardPoint,point)<5;
   if(stale||same||spec.priority>=(ai.heardPriority||0)){
    if(stale||!same)ai.heardReadyAt=now+(room.botDifficulty==='easy'?420:room.botDifficulty==='normal'?230:160);
    Object.assign(ai,{heardPoint:point,heardAt:now,heardUntil:now+spec.ttl,heardKind:kind,heardPriority:spec.priority,heardConfidence:confidence,heardUncertainty:cell});
    ai.heardCount=(ai.heardCount||0)+1;
   }
  }
  room.privateBots?.perception.publish(p.team,{kind:'sound',sound:kind,point,confidence,uncertainty:cell,listenerId:p.id,ttl:spec.ttl,enemyId:null});
  reportSiteThreat(room,p.team,point,'sound');heard.push(p.id);
 }
 return heard;
}
export function hearingPoint(room,p){
 const ai=p.botAI,now=room.clock();
 return ai?.heardPoint&&now>=(ai.heardReadyAt||0)&&now<(ai.heardUntil||0)&&now>=(p.flashBlindUntil||0)?ai.heardPoint:null;
}
export function hearEvent(room,type,fields){
 const source=room.players.get(fields.shooterId||fields.playerId||fields.ownerId);
 if(type==='shot'&&source&&fields.weapon!=='knife')hearNoise(room,source,['usp','m4a1','mp5sd'].includes(fields.weapon)?'suppressed':'gunshot');
 if(type==='grenade_thrown'&&source)hearNoise(room,source,'utility');
 if(type==='decoy_pulse'&&fields.origin)hearNoise(room,{id:null,team:null},'decoy',{origin:fields.origin});
}
/** Consume real server movement, including prediction-stream movement. Shift
 * and crouch are silent; spawning, teleports and stale inputs cannot make steps. */
export function movementNoise(room,p,input){
 const now=room.clock(),previous=p.acousticState;
 p.acousticState={life:p.lifeId,x:p.x,y:p.y,z:p.z,grounded:p.grounded,distance:previous?.distance||0,nextAt:previous?.nextAt||0};
 if(!previous||previous.life!==p.lifeId||!p.alive||!['live','ended'].includes(room.round.phase))return;
 const moved=Math.hypot(p.x-previous.x,p.z-previous.z);if(moved>1.5){p.acousticState.distance=0;return;}
 if(p.grounded&&!previous.grounded&&now>=previous.nextAt){hearNoise(room,p,'landing');p.acousticState.nextAt=now+260;p.acousticState.distance=0;return;}
 if(!p.grounded||input.walk||p.crouch||Math.hypot(p.vx||0,p.vz||0)<3.1){p.acousticState.distance=0;return;}
 p.acousticState.distance+=moved;
 if(p.acousticState.distance>=1.65&&now>=previous.nextAt){hearNoise(room,p,'footstep');p.acousticState.distance%=1.65;p.acousticState.nextAt=now+220;}
}
