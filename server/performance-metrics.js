/** A bounded 60-second window; health reads do not reset other observers. */
export class ServerPerformance{
 constructor(size=1800){this.samples=new Float32Array(size);this.index=0;this.count=0;this.maxDelay=0;this.lateTicks=0;this.ticks=0;}
 record(milliseconds,delay=0){this.samples[this.index]=milliseconds;this.index=(this.index+1)%this.samples.length;this.count=Math.min(this.count+1,this.samples.length);this.maxDelay=Math.max(this.maxDelay,delay);this.ticks++;if(milliseconds>1000/30||delay>1000/30)this.lateTicks++;}
 snapshot(){const sorted=Array.from(this.samples.subarray(0,this.count)).sort((a,b)=>a-b),round=n=>Math.round((n||0)*100)/100;return {windowSamples:this.count,tickBudgetMs:33.33,tickP50Ms:round(sorted[Math.floor(this.count*.5)]),tickP95Ms:round(sorted[Math.floor(this.count*.95)]),tickMaxMs:round(sorted.at(-1)),maxSchedulingDelayMs:round(this.maxDelay),lateTicks:this.lateTicks,totalTicks:this.ticks};}
}
