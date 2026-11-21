import monstercat from '../shared/monstercat-music.json' with {type:'json'};
import legacyOptional from '../shared/legacy-optional-music.json' with {type:'json'};
import actionCues from '../shared/music-action-cues.json' with {type:'json'};
import {MUSIC_KITS as kits,isMusicKit} from '../shared/music-kits.js';
import {MusicVoices} from './music-voices.js';
import {preferences} from './persistence.js';
import {fetchCachedAsset,isAssetSaved} from './loading.js';

const cueNames={
  mvp:'MVP 乐曲',menu:'主菜单',roundStart:'回合准备',startAction:'行动开始',roundWon:'回合胜利',roundLost:'回合失败',
  matchEnd:'比赛结束',bombPlanted:'C4 已安装',bombWarning:'C4 最后十秒',roundWarning:'回合最后十秒',death:'死亡镜头',
};
const kitOption=id=>`<option value="${id}">${kits[id]}</option>`;
function fetchClip(clip,signal){
  return fetchCachedAsset(new URL('assets/audio/music/optional/'+clip.file,document.baseURI),{sha256:clip.sha256,bytes:clip.bytes,signal});
}
export class MatchAudio {
  constructor(audio){
    this.audio=audio;this.kit=preferences.getItem('dust2.music-kit')||'neckdeep_01';
    if(!isMusicKit(this.kit))this.kit='neckdeep_01';
    this.volume=Math.max(0,Math.min(1,Number(preferences.getItem('dust2.music-volume')??.22)));
    this.voices=new MusicVoices(audio);this.generation=0;this.cache=new Map();this.nextBeep=0;this.played=[];
  }
  async manifest(){return this.metadata||=fetchCachedAsset(new URL('assets/audio/music/manifest.json',document.baseURI)).then(r=>{if(!r.ok)throw Error('音乐盒清单加载失败');return r.json();}).catch(e=>{this.metadata=null;throw e;});}
  async kitInfo(id){
    if(id==='none')return {id,cues:{},downloadRequired:false};
    if(!isMusicKit(id))throw Error('无效的音乐盒');
    const kit=monstercat[id]||legacyOptional[id]||(await this.manifest()).kits[id];
    if(!kit)throw Error('找不到这款音乐盒的资源清单');
    return {...kit,cues:{...kit.cues,startAction:actionCues[id]}};
  }
  async prepareRoom(ids=[],bots=false,signal){
    if(this.kit==='none'||!this.volume)return;
    const kitsInRoom=new Set([this.kit,...ids]);if(bots)kitsInRoom.add('valve_cs2_01');
    const files=[[this.kit,'startAction'],...[...kitsInRoom].filter(id=>isMusicKit(id)&&id!=='none').map(id=>[id,'mvp'])];
    // Cosmetics may fail independently of joining the game; cancellation still exits immediately.
    await Promise.allSettled(files.map(async([id,cue])=>{
      const clip=(await this.kitInfo(id)).cues[cue];
      if(clip&&!await isAssetSaved(clip.sha256,clip.bytes))await fetchClip(clip,signal);
    }));
    if(signal?.aborted)throw signal.reason||new DOMException('已取消','AbortError');
  }
  setKit(kit){
    if(!isMusicKit(kit)||kit===this.kit)return;
    this.stop();this.kit=kit;preferences.setItem('dust2.music-kit',kit);this.onKitChange?.(kit);
  }
  setVolume(value){this.volume=Math.max(0,Math.min(1,Number(value)||0));this.voices.setVolume(this.volume);preferences.setItem('dust2.music-volume',this.volume);}
  invalidateResult(){if(this.result)clearTimeout(this.result.timer);this.result=null;this.deferred=null;}
  stop(){
    this.invalidateResult();this.generation++;this.abort?.abort();this.abort=null;
    this.voices.stop();this.cue=null;this.phase=null;this.announcedRound=null;this.warningRound=null;this.warningBomb=null;
  }
  async play(cue,kit=this.kit,ended=null){
    this.abort?.abort();const generation=++this.generation;
    if(kit==='none'||!this.volume||!this.audio.ctx||!isMusicKit(kit))return false;
    this.abort=new AbortController();const signal=this.abort.signal,valid=()=>generation===this.generation;
    try{
      const info=await this.kitInfo(kit),clip=info.cues[cue];if(!clip||!valid())return false;
      if(info.downloadRequired&&cue!=='mvp'&&cue!=='startAction'&&!await isAssetSaved(clip.sha256,clip.bytes))return false;
      const key=kit+'/'+cue;let blob=this.cache.get(key);
      if(!blob){const response=await fetchClip(clip,signal);if(!response.ok)throw Error('音乐片段加载失败');blob=await response.blob();}
      if(!valid())return false;
      this.cache.delete(key);this.cache.set(key,blob);while(this.cache.size>3)this.cache.delete(this.cache.keys().next().value);
      const playing=await this.voices.start(blob,this.volume,valid,()=>{if(valid()){this.cue=null;ended?.();}});
      if(!valid()||!playing)return false;
      this.cue=cue;this.played.push({kit,cue,at:performance.now()});if(this.played.length>24)this.played.shift();return true;
    }catch(e){if(e.name!=='AbortError')console.warn('音乐盒：',e.message);return false;}
  }
  playPhase(cue){
    if(this.result){this.deferred=cue;return;}
    this.play(cue).then(ok=>{if(!ok&&cue==='startAction'&&this.cue==='roundStart'&&this.phase==='live')this.voices.fadeOut();});
  }
  resolveResult(result){
    if(this.result!==result)return;
    const next=this.deferred;this.invalidateResult();
    if(next)this.playPhase(next);
  }
  showResult(e,self){
    this.invalidateResult();
    const result={};this.result=result;
    const finish=()=>this.resolveResult(result),ownResult=e.winner===self?.team?'roundWon':'roundLost';
    const winnerKit=e.mvp?.musicKit??(e.mvpId&&e.mvpId===self?.id?this.kit:null);
    const anthem=this.kit!=='none'&&isMusicKit(winnerKit)&&winnerKit!=='none';
    const playAnthem=()=>{
      if(this.result!==result||result.anthem)return;
      result.anthem=true;clearTimeout(result.timer);
      this.play('mvp',winnerKit,finish).then(ok=>{if(!ok)finish();});
    };
    this.play(ownResult,this.kit,anthem?playAnthem:finish).then(ok=>{
      if(this.result!==result)return;
      if(!ok){if(anthem)playAnthem();else finish();}
      else if(anthem&&!result.anthem)result.timer=setTimeout(playAnthem,950);
    });
  }
  event(e,self,snapshot){
    const a=this.audio;
    if(e.type==='round_start'){
      this.warningRound=null;this.warningBomb=null;this.nextBeep=0;
      this.phase='freeze';this.playPhase('roundStart');
    }
    if(e.type==='round_end'){
      this.phase='ended';this.announcedRound=e.round??snapshot?.round?.number;
      a.play(e.winner==='CT'?'announceCT':'announceT',{level:.7});this.showResult(e,self);
    }
    if(e.type==='match_end'){
      this.phase='matchEnded';
      if(this.announcedRound==null||this.announcedRound!==snapshot?.round?.number)a.play(e.winner==='CT'?'announceCT':'announceT',{level:.65});
      this.playPhase('matchEnd');
    }
    if(e.type==='kill'&&e.victimId===self?.id&&!this.result&&!['ended','matchEnded'].includes(snapshot?.round?.phase))this.play('death');
    if(e.type==='bomb_action')a.play(e.action==='plant'?'bombPlant':'bombDefuseStart',{level:.5});
    if(e.type==='bomb_planted'){a.play('announcePlant',{level:.65});this.invalidateResult();this.play('bombPlanted');this.nextBeep=0;}
    if(e.type==='bomb_defused'){a.play('bombDefuseFinish',{level:.6});a.play('announceDefuse',{level:.7,delay:.25});}
    if(e.type==='bomb_exploded'){a.play('bombExplosion',{level:.85});a.play('bombDebris',{level:.55,delay:.12});}
    if((e.type==='join'||e.type==='music_equipped')&&isMusicKit(e.musicKit)&&e.musicKit!=='none'&&this.kit!=='none'&&this.volume){
      this.kitInfo(e.musicKit).then(async info=>{const clip=info.cues.mvp;if(!await isAssetSaved(clip.sha256,clip.bytes))await fetchClip(clip);}).catch(()=>{});
    }
  }
  update(snapshot,listener,now){
    if(!snapshot?.round)return;
    const phase=snapshot.round.phase,previous=this.phase;this.phase=phase;
    if(phase==='live'&&previous==='freeze')this.playPhase('startAction');
    const b=snapshot.bomb;if(!b||phase!=='live')return;
    const key=b.actorId+':'+b.action;if(key!==this.actionKey){this.actionKey=key;this.keyStep=-1;}
    if(b.action==='plant'){const step=Math.min(6,Math.floor(b.progress*7));if(step>this.keyStep){this.keyStep=step;this.audio.play('bombKey',{level:.38});}}
    if(b.state==='planted'){
      if(now>=this.nextBeep){const distance=listener?Math.hypot(listener.x-b.x,listener.y-b.y,listener.z-b.z):0;this.audio.play(b.remaining<=10?'bombBeepFast':'bombBeep',{level:.65/(1+distance*.08),distance});this.nextBeep=now+Math.max(130,Math.min(1050,b.remaining*25));}
      if(b.remaining>0&&b.remaining<=10&&this.warningBomb!==b.plantedAt){this.warningBomb=b.plantedAt;this.invalidateResult();this.play('bombWarning');}
    }else if(snapshot.mode==='defuse'&&snapshot.round.timeLeft>0&&snapshot.round.timeLeft<=10&&this.warningRound!==snapshot.round.number){this.warningRound=snapshot.round.number;this.invalidateResult();this.play('roundWarning');}
  }
  status(){return {kit:this.kit,volume:this.volume,cue:this.cue,playing:this.voices.playing,cachedClips:this.cache.size,cachedBytes:[...this.cache.values()].reduce((sum,b)=>sum+b.size,0),played:this.played};}
}

export function mountMusicSettings(settings,music,audio){
  const tab=document.createElement('button');tab.textContent='声音 / 音乐盒';tab.dataset.tab='audio';settings.element.querySelector('.config-tabs').append(tab);
  const panel=document.createElement('section');panel.dataset.panel='audio';panel.hidden=true;
  panel.innerHTML=`<h3>音乐盒素材库</h3><label class="config-row"><span>选择音乐盒</span><select id="music-kit">${kitOption('none')}<optgroup label="音乐盒">${Object.keys(kits).filter(id=>id!=='none'&&!monstercat[id]).map(kitOption).join('')}</optgroup><optgroup label="Monstercat 音乐盒">${Object.keys(monstercat).map(kitOption).join('')}</optgroup></select></label><p id="music-equipped"></p><label class="config-row">音乐音量 <output id="music-volume-label"></output><input id="music-volume" type="range" min="0" max="1" step=".01"></label><p>额外音乐盒需要先下载。包含开局、胜负、MVP、死亡和 C4 倒计时片段，保存在本机。</p><button id="music-download">检查下载状态…</button> <label class="config-row"><span>试听片段</span><select id="music-preview-cue"></select></label><button id="music-preview">试听所选片段</button> <button id="music-stop">停止试听</button><p id="music-status" role="status"></p>`;
  settings.element.querySelector('.config-scroll').append(panel);
  const select=panel.querySelector('#music-kit'),volume=panel.querySelector('#music-volume'),label=panel.querySelector('#music-volume-label'),status=panel.querySelector('#music-status'),download=panel.querySelector('#music-download');let busy=false;
  const preview=panel.querySelector('#music-preview'),cueSelect=panel.querySelector('#music-preview-cue');
  async function saved(kit){
    if(!kit.downloadRequired)return true;
    // Existing installations add the new action cue on their next room load.
    const checks=await Promise.all(Object.entries(kit.cues).filter(([cue])=>cue!=='startAction').map(([,clip])=>isAssetSaved(clip.sha256,clip.bytes)));
    return checks.length>0&&checks.every(Boolean);
  }
  let revision=0;
  async function refresh(){
    const id=select.value,request=++revision;
    download.disabled=true;preview.disabled=true;cueSelect.disabled=true;
    panel.querySelector('#music-equipped').textContent='已装备：'+kits[music.kit];
    try{
      const kit=await music.kitInfo(id),ready=await saved(kit);
      if(request!==revision)return;
      const previousCue=cueSelect.value;
      cueSelect.replaceChildren(...Object.keys(cueNames).filter(cue=>kit.cues[cue]).map(cue=>new Option(cueNames[cue],cue)));
      if(kit.cues[previousCue])cueSelect.value=previousCue;
      const size=Object.values(kit.cues).reduce((sum,cue)=>sum+cue.bytes,0)/1048576;
      download.textContent=ready?(music.kit===id?'已装备':'装备音乐盒'):`下载 · ${size.toFixed(1)} MB`;
      download.disabled=busy||(ready&&music.kit===id);
      preview.disabled=busy||!ready||id==='none';cueSelect.disabled=preview.disabled;
    }catch(error){
      if(request!==revision)return;
      status.textContent=error.message;download.textContent='重试检查';download.disabled=false;
    }
  }
  tab.onclick=()=>{settings.element.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('selected',b===tab));settings.element.querySelectorAll('[data-panel]').forEach(p=>p.hidden=p!==panel);refresh();};
  select.value=music.kit;volume.value=music.volume;label.textContent=Math.round(music.volume*100)+'%';
  select.onchange=()=>{music.stop();status.textContent='';refresh();};volume.oninput=()=>{music.setVolume(volume.value);label.textContent=Math.round(music.volume*100)+'%';};
  download.onclick=async()=>{if(busy)return;busy=true;download.disabled=true;select.disabled=true;const id=select.value;try{const kit=await music.kitInfo(id);if(kit.downloadRequired&&!await saved(kit)){const clips=Object.values(kit.cues);for(let i=0;i<clips.length;i++){const clip=clips[i];status.textContent=`下载 ${kits[id]} · ${i+1}/${clips.length}`;const response=await fetchCachedAsset(new URL('assets/audio/music/optional/'+clip.file,document.baseURI),{sha256:clip.sha256,bytes:clip.bytes});if(!response.ok)throw Error('音乐片段下载失败');}if(!await saved(kit))throw Error('存储空间不足，音乐盒未完整保存');status.textContent='下载完成，点击装备后生效。';}else{music.setKit(id);status.textContent='音乐盒已装备并保存';}}catch(e){status.textContent=e.message;}finally{busy=false;select.disabled=false;refresh();}};
  cueSelect.onchange=()=>{music.stop();status.textContent='';};
  preview.onclick=async()=>{
    const id=select.value,cue=cueSelect.value;
    status.textContent='加载试听…';await audio.start();
    if(id!==select.value||cue!==cueSelect.value)return;
    const playing=await music.play(cue,id);
    if(select.value===id&&cueSelect.value===cue)status.textContent=playing?'正在试听：'+kits[id]+' · '+cueNames[cue]:'请检查音乐音量和本机缓存';
  };
  panel.querySelector('#music-stop').onclick=()=>{music.stop();status.textContent='已停止';};
}
