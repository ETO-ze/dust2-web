export class FramePacer {
  constructor(){this.next=0;this.limit=0;}
  due(now,limit){
    if(limit!==this.limit){this.limit=limit;this.next=0;}
    if(!limit)return true;
    const step=1000/limit;
    if(now+.2<this.next)return false;
    this.next=this.next&&now-this.next<step*2?this.next+step:now+step;
    return true;
  }
}
