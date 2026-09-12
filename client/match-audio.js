import {preferences} from './persistence.js';
import {fetchCachedAsset,isAssetSaved} from './loading.js';

const kits={neckdeep_01:'Neck Deep · 人生何处不青山',valve_cs2_01:'Valve · Counter-Strike 2',blitzkids_01:'Blitz Kids · 有为青年',neckdeep_02:'Neck Deep · 躺平青年',isoxo_01:'ISOxo · 非人类',none:'关闭音乐'};
// One HTML media decoder at a time. Optional music is downloaded by cue, never
// decoded into a several-minute Web Audio buffer or added to the initial pack.
export class MatchAudio {
  constructor(audio){
    this.audio=audio;this.kit=preferences.getItem('dust2.music-kit')||'neckdeep_01';
    if(!Object.hasOwn(kits,this.kit))this.kit='neckdeep_01';
    this.volume=Math.max(0,Math.min(1,Number(preferences.getItem('dust2.music-volume')??.22)));
    this.media=new Audio();this.media.preload='none';this.generation=0;this.cache=new Map();this.nextBeep=0;this.played=[];
  }
  async manifest(){return this.metadata||=fetchCachedAsset(new URL('assets/audio/music/manifest.json',document.baseURI)).then(r=>{if(!r.ok)throw Error('音乐盒清单加载失败');return r.json();}).catch(e=>{this.metadata=null;throw e;});}
  setKit(kit){if(!Object.hasOwn(kits,kit))return;this.stop();this.kit=kit;preferences.setItem('dust2.music-kit',kit);}
  setVolume(value){this.volume=Math.max(0,Math.min(1,Number(value)||0));if(this.gain)this.gain.gain.value=this.volume;preferences.setItem('dust2.music-volume',this.volume);}
  stop(){this.generation++;this.abort?.abort();this.abort=null;this.media.pause();this.media.removeAttribute('src');this.media.load();if(this.url)URL.revokeObjectURL(this.url);this.url=null;this.cue=null;}
  async play(cue){
    this.stop();if(this.kit==='none'||this.volume===0||!this.audio.ctx)return false;
    const generation=this.generation,kit=this.kit;this.abort=new AbortController();const signal=this.abort.signal;
    try{
      const manifest=await this.manifest(),clip=manifest.kits[kit]?.cues[cue];if(!clip||generation!==this.generation)return false;
      if(manifest.kits[kit].downloadRequired&&!await isAssetSaved(clip.sha256,clip.bytes))return false;
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
  panel.innerHTML=`<h3>音乐盒素材库</h3><label class="config-row"><span>选择音乐盒</span><select id="music-kit">${Object.entries(kits).map(([id,name])=>`<option value="${id}">${name}</option>`).join('')}</select></label><p id="music-equipped"></p><label class="config-row">音乐音量 <output id="music-volume-label"></output><input id="music-volume" type="range" min="0" max="1" step=".01"></label><p>额外音乐盒需要先下载。包含开局、胜负、MVP、死亡和 C4 倒计时片段，保存在本机。</p><button id="music-download">检查下载状态…</button> <button id="music-preview">试听当前装备的 MVP 乐曲</button> <button id="music-stop">停止试听</button><p id="music-status" role="status"></p>`;
  settings.element.querySelector('.config-scroll').append(panel);
  const select=panel.querySelector('#music-kit'),volume=panel.querySelector('#music-volume'),label=panel.querySelector('#music-volume-label'),status=panel.querySelector('#music-status'),download=panel.querySelector('#music-download');let busy=false;
  async function saved(kit){for(const clip of Object.values(kit?.cues||{}))if(!await isAssetSaved(clip.sha256,clip.bytes))return false;return true;}
  async function refresh(){const id=select.value;download.disabled=true;panel.querySelector('#music-equipped').textContent='已装备：'+kits[music.kit];try{const kit=(await music.manifest()).kits[id],ready=!kit?.downloadRequired||await saved(kit);if(id!==select.value)return;download.textContent=ready?(music.kit===id?'已装备':'装备音乐盒'):`下载 · ${(Object.values(kit.cues).reduce((n,c)=>n+c.bytes,0)/1048576).toFixed(1)} MB`;download.disabled=busy||music.kit===id&&ready;}catch(e){status.textContent=e.message;download.textContent='重试检查';download.disabled=false;}}
  tab.onclick=()=>{settings.element.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('selected',b===tab));settings.element.querySelectorAll('[data-panel]').forEach(p=>p.hidden=p!==panel);refresh();};
  select.value=music.kit;volume.value=music.volume;label.textContent=Math.round(music.volume*100)+'%';
  select.onchange=refresh;volume.oninput=()=>{music.setVolume(volume.value);label.textContent=Math.round(music.volume*100)+'%';};
  download.onclick=async()=>{if(busy)return;busy=true;download.disabled=true;select.disabled=true;const id=select.value;try{const kit=(await music.manifest()).kits[id];if(kit?.downloadRequired&&!await saved(kit)){const clips=Object.values(kit.cues);for(let i=0;i<clips.length;i++){const clip=clips[i];status.textContent=`下载 ${kits[id]} · ${i+1}/${clips.length}`;await fetchCachedAsset(new URL('assets/audio/music/optional/'+clip.file,document.baseURI),{sha256:clip.sha256,bytes:clip.bytes});}if(!await saved(kit))throw Error('存储空间不足，音乐盒未完整保存');status.textContent='下载完成，点击装备后生效。';}else{music.setKit(id);status.textContent='音乐盒已装备并保存';}}catch(e){status.textContent=e.message;}finally{busy=false;select.disabled=false;refresh();}};
  panel.querySelector('#music-preview').onclick=async()=>{status.textContent='加载试听…';await audio.start();status.textContent=await music.play('mvp')?'正在试听':'音乐已关闭，或需要重新下载音乐盒';};
  panel.querySelector('#music-stop').onclick=()=>{music.stop();status.textContent='已停止';};
}
