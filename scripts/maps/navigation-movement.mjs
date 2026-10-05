import {createPlayerState,stepPlayer,CROUCH_HEIGHT,STAND_HEIGHT,isHullClear,floorHeight} from '../../shared/physics.js';
import {navigationPortal} from '../../server/map-tactical-graph.js';

const distance=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
export function settleNavPoint(a) {
  const samples=[a,...(a.corners||[]).map(([x,y,z])=>({x:(x+a.x)/2,y:(y+a.y)/2,z:(z+a.z)/2}))];
  for(const crouch of [false,true])for(const q of samples){
    const y=floorHeight(q.x,q.z,q.y+.6,1.2);
    if(y===null||Math.abs(y-q.y)>.5)continue;
    const p={...createPlayerState({...q,y:y+.45}),crouch,height:crouch?CROUCH_HEIGHT:STAND_HEIGHT};
    for(let i=0;i<25;i++)stepPlayer(p,{crouch},1/30);
    if(p.grounded&&Math.abs(p.y-q.y)<.65&&distance(p,q)<.6&&isHullClear({...p,y:p.y+.004},p.height))return {...a,x:p.x,y:p.y,z:p.z,crouch};
  }
  return null;
}

export function edgeGoals(a,b,mode='walk') {
  const portal=navigationPortal(a,b);
  // A Source NAV connection can be a directed jump/drop, rather than a shared
  // polygon edge. Do not stop on the low edge during the flight to the landing.
  if(mode.startsWith('jump'))return [{x:b.x,y:b.y,z:b.z}];
  return [...(portal?[portal]:[]),{x:b.x,y:b.y,z:b.z}];
}

/** This controller is shared by the physical validator and private bot replay.
 * It only generates ordinary movement inputs. No position/velocity overrides. */
export function createEdgeController(a,b,{mode='walk',goals=edgeGoals(a,b,mode)}={}) {
  return {a,b,mode,goals:goals.map(p=>({...p})),index:0,ticks:0,stalled:0,last:null,jumps:0,lastJumpTick:-100};
}
export function edgeMovementInput(state,p) {
  state.ticks++;
  let goal=state.goals[state.index];
  if(!goal)return null;
  const final=state.index===state.goals.length-1;
  const d=distance(p,goal);
  if(d<.18&&Math.abs(p.y-goal.y)<.4&&(!final||p.grounded)){
    state.index++;
    goal=state.goals[state.index];
    if(!goal)return null;
  }
  const movement=state.last?distance(p,state.last):1;
  state.stalled=movement<.008?state.stalled+1:0;
  state.last={x:p.x,z:p.z};
  const remaining=distance(p,goal),yaw=Math.atan2(-(goal.x-p.x),-(goal.z-p.z));
  const jumpMode=state.mode.startsWith('jump');
  const threshold=state.mode==='jump-early'?2.1:state.mode==='jump-near'?.75:1.3;
  const jump=jumpMode&&p.grounded&&state.ticks-state.lastJumpTick>22&&state.jumps<3&&
    (remaining<threshold||state.stalled>=5);
  if(jump){state.jumps++;state.lastJumpTick=state.ticks;}
  const crouch=state.a.crouch||state.b.crouch||state.mode==='crouch'||(jumpMode&&!p.grounded);
  return {yaw,forward:jumpMode&&!p.grounded?Math.min(1,remaining/.3):Math.min(1,remaining/.45),crouch,jump};
}

export function probeNavEdge(a,b,{maxTicks=240,initialState=null}={}) {
  let lastFailure=null;
  const modes=['walk','crouch','jump','jump-early','jump-near'];
  for(const mode of modes){
    const p=initialState?{...initialState}:{...createPlayerState(a),crouch:!!a.crouch,height:a.crouch?CROUCH_HEIGHT:STAND_HEIGHT,grounded:true};
    const control=createEdgeController(a,b,{mode});
    for(let i=0;i<maxTicks;i++){
      const input=edgeMovementInput(control,p);
      if(!input){
        if(isHullClear({...p,y:p.y+.004},p.height))return {passed:true,mode,goals:control.goals,ticks:i,final:{x:p.x,y:p.y,z:p.z,crouch:p.crouch},endState:p,jumps:control.jumps};
        break;
      }
      stepPlayer(p,input,1/30);
      if(!Number.isFinite(p.x+p.y+p.z)||p.outOfWorld||p.y<Math.min(a.y,b.y)-1.5||control.stalled>40)break;
    }
    lastFailure={passed:false,mode,position:{x:p.x,y:p.y,z:p.z},remaining:distance(p,b),heightError:p.y-b.y,stalled:control.stalled};
  }
  return lastFailure;
}
