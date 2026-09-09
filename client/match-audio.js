import {fetchCachedAsset} from './loading.js';

// One HTML media decoder at a time. Optional music is downloaded by cue, never
// decoded into a several-minute Web Audio buffer or added to the initial pack.
export class MatchAudio {
  constructor(audio){
    this.audio=audio;this.kit=localStorage.getItem('dust2.music-kit')||'neckdeep_01';
    if(!['none','neckdeep_01','valve_cs2_01'].includes(this.kit))this.kit='neckdeep_01';
    this.volume=Math.max(0,Math.min(1,Number(localStorage.getItem('dust2.music-volume')??.22)));
    this.media=new Audio();this.media.preload='none';this.generation=0;this.cache=new Map();this.nextBeep=0;this.played=[];
  }
  async manifest(){return this.metadata||=fetchCachedAsset(new URL('assets/audio/music/manifest.json',document.baseURI)).then(r=>{if(!r.ok)throw Error('音乐盒清单加载失败');return r.json();}).catch(e=>{this.metadata=null;throw e;});}
  setKit(kit){if(!['none','neckdeep_01','valve_cs2_01'].includes(kit))return;this.stop();this.kit=kit;localStorage.setItem('dust2.music-kit',kit);}
  setVolume(value){this.volume=Math.max(0,Math.min(1,Number(value)||0));if(this.gain)this.gain.gain.value=this.volume;localStorage.setItem('dust2.music-volume',this.volume);}
  stop(){this.generation++;this.abort?.abort();this.abort=null;this.media.pause();this.media.removeAttribute('src');this.media.load();if(this.url)URL.revokeObjectURL(this.url);this.url=null;this.cue=null;}
  async play(cue){
    this.stop();if(this.kit==='none'||this.volume===0||!this.audio.ctx)return false;
    const generation=this.generation,kit=this.kit;this.abort=new AbortController();const signal=this.abort.signal;
    try{
      const manifest=await this.manifest(),clip=manifest.kits[kit]?.cues[cue];if(!clip||generation!==this.generation)return false;
      const key=kit+'/'+cue;let blob=this.cache.get(key);
      if(!blob){const r=await fetchCachedAsset(new URL('assets/audio/music/optional/'+clip.file,document.baseURI),{sha256:clip.sha256,bytes:clip.bytes,signal});if(!r.ok)throw Error('音乐片段加载失败');blob=await r.blob();}
      if(generation!==this.generation)return false;
      this.cache.delete(key);this.cache.set(key,blob);while(this.cache.size>3)this.cache.delete(this.cache.keys().next().value);
      if(!this.source){this.source=this.audio.ctx.createMediaElementSource(this.media);this.gain=this.audio.ctx.createGain();this.source.connect(this.gain);this.gain.connect(this.audio.mix);}
      this.gain.gain.value=this.volume;this.url=URL.createObjectURL(blob);this.media.src=this.url;this.media.loop=false;
      await this.media.play();if(generation!==this.generation)return false;
      this.cue=cue;this.played.push({kit,cue,at:performance.now()});if(this.played.length>24)this.played.shift();return true;
    }catch(e){if(e.name!=='AbortError')console.warn('音乐盒：',e.message);return false;}
  }
  event(e,self){
    const a=this.audio;
    if(e.type==='round_start'){this.warningRound=null;this.warningBomb=null;this.nextBeep=0;this.play('roundStart');}
    if(e.type==='round_end'){a.play(e.winner==='CT'?'announceCT':'announceT',{level:.7});this.play(e.mvpId===self?.id?'mvp':e.winner===self?.team?'roundWon':'roundLost');}
    if(e.type==='match_end'){a.play(e.winner==='CT'?'announceCT':'announceT',{level:.65});this.play(e.winnerTeamId===self?.teamId?'matchEnd':'roundLost');}
    if(e.type==='kill'&&e.victimId===self?.id)this.play('death');
    if(e.type==='bomb_action')a.play(e.action==='plant'?'bombPlant':'bombDefuseStart',{level:.5});
    if(e.type==='bomb_planted'){a.play('announcePlant',{level:.65});this.play('bombPlanted');this.nextBeep=0;}
    if(e.type==='bomb_defused'){a.play('bombDefuseFinish',{level:.6});a.play('announceDefuse',{level:.7,delay:.25});}
    if(e.type==='bomb_exploded'){a.play('bombExplosion',{level:.85});a.play('bombDebris',{level:.55,delay:.12});}
  }
  update(snapshot,listener,now){
    const b=snapshot?.bomb;if(!b)return;
    const key=b.actorId+':'+b.action;if(key!==this.actionKey){this.actionKey=key;this.keyStep=-1;}
    if(b.action==='plant'){const step=Math.min(6,Math.floor(b.progress*7));if(step>this.keyStep){this.keyStep=step;this.audio.play('bombKey',{level:.38});}}
    if(b.state==='planted'){
      if(now>=this.nextBeep){const distance=listener?Math.hypot(listener.x-b.x,listener.y-b.y,listener.z-b.z):0;this.audio.play(b.remaining<=10?'bombBeepFast':'bombBeep',{level:.65/(1+distance*.08),distance});this.nextBeep=now+Math.max(130,Math.min(1050,b.remaining*25));}
      if(b.remaining<=10&&this.warningBomb!==b.plantedAt){this.warningBomb=b.plantedAt;this.play('bombWarning');}
    }else if(snapshot.mode==='defuse'&&snapshot.round.phase==='live'&&snapshot.round.timeLeft<=10&&this.warningRound!==snapshot.round.number){this.warningRound=snapshot.round.number;this.play('roundWarning');}
    if(this.cue==='roundStart'&&snapshot.round.phase==='live')this.stop();
  }
  status(){return {kit:this.kit,volume:this.volume,cue:this.cue,playing:!this.media.paused,cachedClips:this.cache.size,cachedBytes:[...this.cache.values()].reduce((sum,b)=>sum+b.size,0),played:this.played};}
}

export function mountMusicSettings(settings,music,audio){
  const tab=document.createElement('button');tab.textContent='声音 / 音乐盒';tab.dataset.tab='audio';settings.element.querySelector('.config-tabs').append(tab);
  const panel=document.createElement('section');panel.dataset.panel='audio';panel.hidden=true;
  panel.innerHTML='<h3>音乐盒</h3><label class="config-row music-selection"><span>已装备</span><select id="music-kit"><option value="neckdeep_01">Neck Deep · 人生何处不青山</option><option value="valve_cs2_01">Valve · Counter-Strike 2</option><option value="none">关闭音乐</option></select></label><label class="config-row">音乐音量 <output id="music-volume-label"></output><input id="music-volume" type="range" min="0" max="1" step=".01"></label><p>音乐按需下载并缓存在本机。比赛、C4 倒计时和胜负会播放相应片段；音量独立设置。</p><button id="music-preview">试听 MVP 乐曲</button> <button id="music-stop">停止试听</button><p id="music-status" role="status"></p><small>Neck Deep — Life’s Not Out To Get You · Valve 原版事件音频</small>';
  settings.element.querySelector('.config-scroll').append(panel);
  tab.onclick=()=>{settings.element.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('selected',b===tab));settings.element.querySelectorAll('[data-panel]').forEach(p=>p.hidden=p!==panel);};
  const select=panel.querySelector('#music-kit'),volume=panel.querySelector('#music-volume'),label=panel.querySelector('#music-volume-label'),status=panel.querySelector('#music-status');
  select.value=music.kit;volume.value=music.volume;label.textContent=Math.round(music.volume*100)+'%';
  select.onchange=()=>{music.setKit(select.value);status.textContent='音乐盒已保存';};volume.oninput=()=>{music.setVolume(volume.value);label.textContent=Math.round(music.volume*100)+'%';};
  panel.querySelector('#music-preview').onclick=async()=>{status.textContent='加载试听…';await audio.start();status.textContent=await music.play('mvp')?'正在试听':'音乐已关闭或加载失败';};
  panel.querySelector('#music-stop').onclick=()=>{music.stop();status.textContent='已停止';};
}
