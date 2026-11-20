import {teammateRisk} from './bot-trajectory.js';
const automated=p=>p.bot&&!p.controllerId&&!p.controlledBy&&p.alive;
const turn=(p,target)=>({yaw:Math.atan2(target.x-p.x,target.z-p.z),pitch:0});

/** Team-only flash warning. It can request normal bot turn inputs, never
 * rotate a human/taken-over body or waive the actual release safety check. */
export class PrivateFlashCooperation {
 constructor(clock,world){this.clock=clock;this.world=world;this.warnings=new Map();}
 clear(){this.warnings.clear();}
 cancel(p){if(this.warnings.get(p.team)?.ownerId===p.id)this.warnings.delete(p.team);}
 prepare(p,result,players){
  const projected=players.map(q=>automated(q)?{...q,...turn(q,result.point)}:q);
  if(teammateRisk(this.world,p,result,projected,'flashbang'))return false;
  this.warnings.set(p.team,{ownerId:p.id,result,until:this.clock()+4000,released:false});return true;
 }
 warning(team){const w=this.warnings.get(team);if(w&&w.until<=this.clock()){this.warnings.delete(team);return null;}return w;}
 canRelease(p,players){const w=this.warning(p.team);return w?.ownerId===p.id&&!teammateRisk(this.world,p,w.result,players.filter(q=>q!==p),'flashbang');}
 released(p){const w=this.warning(p.team);if(w?.ownerId===p.id){w.released=true;w.until=this.clock()+w.result.seconds*1000+250;}}
 instruction(p){const w=this.warning(p.team);return automated(p)&&w&&(w.ownerId!==p.id||w.released)?turn(p,w.result.point):null;}
}
