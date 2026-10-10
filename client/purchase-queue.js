/** Preserve click order without freezing unrelated buy buttons. Only one
 * request is in flight; spacing respects the authoritative server rate limit. */
export class PurchaseQueue{
 constructor({send,onChange=()=>{},onTimeout=()=>{},clock=()=>performance.now(),schedule=(fn,ms)=>globalThis.setTimeout(fn,ms),cancel=id=>globalThis.clearTimeout(id)}={}){Object.assign(this,{send,onChange,onTimeout,clock,schedule,cancel});this.items=[];this.current=null;this.lastSent=-Infinity;this.timer=null;}
 enqueue(item){if(this.items.length+(this.current?1:0)>=16)return false;this.items.push({...item});this.pump();this.onChange();return true;}
 get pending(){return [...(this.current?[this.current]:[]),...this.items];}
 pump(){
  if(this.current||!this.items.length||this.timer)return;
  const wait=Math.max(0,270-(this.clock()-this.lastSent));
  if(wait){this.timer=this.schedule(()=>{this.timer=null;this.pump();},wait);return;}
  this.current=this.items.shift();this.lastSent=this.clock();
  this.timer=this.schedule(()=>{this.timer=null;this.clear();this.onTimeout();},5000);
  this.send(this.current);this.onChange();
 }
 settle(){if(!this.current)return;this.cancel(this.timer);this.timer=null;this.current=null;this.pump();this.onChange();}
 clear(){if(this.timer)this.cancel(this.timer);this.timer=null;this.current=null;this.items=[];this.onChange();}
}
