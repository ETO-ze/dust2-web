import {PlayerTimeline,INTERPOLATION_DELAY_MS} from '../shared/player-timeline.js';
export class RemotePlayers{
 constructor(){this.timeline=new PlayerTimeline(8);this.clear();}
 clear(){this.timeline.clear();this.time=0;this.receivedAt=0;this.viewTime=0;}
 push(snapshot,now){this.timeline.push(snapshot.time,snapshot.players);this.time=snapshot.time;this.receivedAt=now;}
 sample(now){this.viewTime=Math.min(this.time,this.time+Math.max(0,now-this.receivedAt)-INTERPOLATION_DELAY_MS);return this.timeline.sample(this.viewTime);}
}
