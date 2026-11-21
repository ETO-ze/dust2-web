// Two streaming decoders let an existing cue continue while its successor starts.
export class MusicVoices {
  constructor(audio){this.audio=audio;this.voices=[];this.current=null;}
  create(){
    const ctx=this.audio.ctx,media=new Audio(),gain=ctx.createGain();
    media.preload='none';
    ctx.createMediaElementSource(media).connect(gain);
    if(!this.master){this.master=ctx.createGain();this.master.connect(this.audio.mix);}
    gain.connect(this.master);
    const voice={media,gain,lease:0,url:null,timer:null};
    this.voices.push(voice);return voice;
  }
  clear(voice){
    clearTimeout(voice.timer);voice.lease++;voice.media.onended=null;voice.media.onerror=null;
    if(voice.url){
      voice.media.pause();voice.media.removeAttribute('src');voice.media.load();
      URL.revokeObjectURL(voice.url);voice.url=null;
    }
    if(this.current===voice)this.current=null;
  }
  envelope(voice,value,seconds){
    const gain=voice.gain.gain,t=this.audio.ctx.currentTime;
    if(gain.cancelAndHoldAtTime)gain.cancelAndHoldAtTime(t);
    else{const start=gain.value;gain.cancelScheduledValues(t);gain.setValueAtTime(start,t);}
    gain.linearRampToValueAtTime(value,t+seconds);
  }
  async start(blob,volume,valid,done){
    const next=this.voices.find(v=>v!==this.current)||this.create();
    this.clear(next);
    const lease=next.lease,ctx=this.audio.ctx;
    next.gain.gain.cancelScheduledValues(ctx.currentTime);next.gain.gain.setValueAtTime(0,ctx.currentTime);
    next.url=URL.createObjectURL(blob);next.media.src=next.url;this.setVolume(volume);
    try{await next.media.play();}catch(error){if(lease===next.lease)this.clear(next);throw error;}
    if(lease!==next.lease)return false;
    if(!valid()){this.clear(next);return false;}
    const previous=this.current;this.current=next;
    const finish=()=>{if(this.current===next&&next.lease===lease){this.clear(next);done();}};
    next.media.onended=finish;next.media.onerror=finish;
    this.envelope(next,1,previous?0.32:0.08);
    if(previous){clearTimeout(previous.timer);this.envelope(previous,0,0.32);previous.timer=setTimeout(()=>this.clear(previous),365);}
    if(next.media.ended)finish();
    return true;
  }
  fadeOut(){
    const voice=this.current;if(!voice)return;
    voice.media.onended=null;voice.media.onerror=null;this.envelope(voice,0,0.4);
    clearTimeout(voice.timer);voice.timer=setTimeout(()=>this.clear(voice),465);
  }
  setVolume(volume){if(this.master)this.master.gain.setTargetAtTime(volume,this.audio.ctx.currentTime,.02);}
  stop(){for(const voice of this.voices)this.clear(voice);}
  get playing(){return !!this.current&&!this.current.media.paused;}
}
