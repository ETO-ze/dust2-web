/** Reservations are resolved by command acknowledgement, not by guessing ammo deltas. */
export class ShotPrediction {
  constructor(){this.reset();}
  reset(){this.pending=[];this.triggered=false;this.lastRejected=null;}
  triggerReady(fire,automatic=false){if(!fire)this.triggered=false;return fire&&(automatic||!this.triggered);}
  reserve(id,at,weapon){this.pending.push({id,at,weapon});this.triggered=true;}
  reconcile(player){
    if(Number.isSafeInteger(player.shotAck))this.pending=this.pending.filter(shot=>shot.id>player.shotAck);
    if(player.shotRejected)this.lastRejected=player.shotRejected;
  }
  expire(now,ping=0){this.pending=this.pending.filter(shot=>now-shot.at<Math.max(1500,Math.min(4000,ping*4)));}
  status(){return {pending:this.pending.length,lastRejected:this.lastRejected};}
}
