import { fetchCachedAsset } from './loading.js';
// Valve's original CS2 samples. Source paths and conversion hashes live in the asset manifest.
const clamp = (value, low, high) => Math.max(low, Math.min(high, Number(value) || 0));
import {reloadProfile} from '../shared/reload-profiles.js';
import {getWeapon} from '../shared/weapons.js';

export class GameAudio {
  constructor() {
    this.ctx = null; this.volume = 0.6; this.ready = false; this.buffers = [];
    this.banks = new Map(); this.voices = new Set(); this.loading = null;
    this.lastWeapon = 'ak47'; this.lastTeam = 'T'; this.lastHitAt = -Infinity; this.lastKillAt = -Infinity;
  }

  async start() {
    if (!this.ctx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) throw new Error('浏览器不支持游戏音频');
      const c = this.ctx = new AudioContext({ latencyHint: 'interactive' });
      this.mix = c.createDynamicsCompressor();
      this.mix.threshold.value = -12; this.mix.knee.value = 12; this.mix.ratio.value = 8;
      this.mix.attack.value = 0.003; this.mix.release.value = 0.13;
      this.master = c.createGain(); this.master.gain.value = this.volume;
      // A bounded output curve protects the destination even when many shots overlap.
      const limiter = c.createWaveShaper(), curve = new Float32Array(4097);
      for (let i = 0; i < curve.length; i++) { const x = i * 2 / (curve.length - 1) - 1; curve[i] = x / (1 + 0.18 * Math.abs(x)); }
      limiter.curve = curve; limiter.oversample = '2x';
      this.mix.connect(this.master); this.master.connect(limiter); limiter.connect(c.destination);
    }
    await this.ctx.resume();
    if (!this.loading) this.loading = this.loadSamples().catch(error => { this.loading = null; throw error; });
    await this.loading;
    this.ready = true;
  }

  async loadSamples() {
    const base = new URL('assets/audio/cs2/', document.baseURI);
    const response = await fetchCachedAsset(new URL('manifest.json', base));
    if (!response.ok) throw new Error(`CS2 音效清单加载失败 (${response.status})`);
    const manifest = await response.json();
    const names = [...new Set(Object.values(manifest.banks).flat())], decoded = new Map();
    let cursor=0;
    await Promise.all(Array.from({length:4},async()=>{while(cursor<names.length){const name=names[cursor++];
      const result = await fetchCachedAsset(new URL(name, base));
      if (!result.ok) throw new Error(`CS2 音效加载失败：${name}`);
      decoded.set(name, await this.ctx.decodeAudioData(await result.arrayBuffer()));
    }}));
    for (const [bank, files] of Object.entries(manifest.banks)) this.banks.set(bank, files.map(file => decoded.get(file)));
    // Preserve the existing CC0 footstep samples; firing never falls back to synthesis.
    this.buffers = (await Promise.all(Array.from({ length: 5 }, async (_, i) => {
      try {
        const response = await fetchCachedAsset(new URL(`assets/audio/footstep_concrete_00${i}.ogg`, document.baseURI));
        return response.ok ? await this.ctx.decodeAudioData(await response.arrayBuffer()) : null;
      } catch { return null; }
    }))).filter(Boolean);
    this.sampleCount = decoded.size;
  }

  setVolume(value) {
    this.volume = clamp(value, 0, 1);
    if (this.master) this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.02);
  }

  weaponId(id, options = {}) {
    const value = String(id || this.lastWeapon).toLowerCase();
    if (value === 'pistol') return 'glock';
    return ({ ak: 'ak47', 'ak-47': 'ak47', m4: 'm4a1', 'm4a1-s': 'm4a1', m4a1s: 'm4a1', glock18: 'glock', 'usp-s': 'usp' })[value] || value;
  }

  play(bank, { level = 0.5, pan = 0, distance = 0, delay = 0, rate = 1, channel = 'effect', loop=false } = {}) {
    if (!this.ready) return null;
    const samples = this.banks.get(bank);
    if (!samples?.length) return null;
    if (channel === 'remote' && [...this.voices].filter(voice => voice.channel === channel).length >= 20) return null;
    if (this.voices.size >= 64) this.stopVoice(this.voices.values().next().value);
    const c = this.ctx, source = c.createBufferSource(), gain = c.createGain(), panner = c.createStereoPanner();
    source.loop=loop;source.buffer = samples[Math.floor(Math.random() * samples.length)]; source.playbackRate.value = clamp(rate, 0.75, 1.25);
    gain.gain.value = clamp(level, 0, 1.2); panner.pan.value = clamp(pan, -1, 1);
    const nodes = [source, gain, panner];
    if (distance > 3) {
      const filter = c.createBiquadFilter(); filter.type = 'lowpass';
      filter.frequency.value = Math.max(1100, 14500 / (1 + distance * 0.025)); filter.Q.value = 0.5;
      source.connect(filter); filter.connect(gain); nodes.push(filter);
    } else source.connect(gain);
    gain.connect(panner); panner.connect(this.mix);
    const voice = { source, nodes, channel }; this.voices.add(voice);
    source.onended = () => this.releaseVoice(voice);
    source.start(c.currentTime + Math.max(0, delay));
    return voice;
  }

  shot(id = 'ak47', distance = 0, pan = 0, options = {}) {
    if (!this.ready) return;
    const weapon = this.weaponId(id, options), remote = options.remote ?? distance > 0;
    if (weapon === 'knife') { this.knife(options.heavy?'heavySwing':'swing', distance, pan); return; }
    if (!remote) { this.lastWeapon = weapon; if (options.team) this.lastTeam = options.team; }
    const gap = Math.max(0, Number(distance) || 0), farBank = `${weapon}Far`;
    const bank = remote && gap >= 26 && this.banks.has(farBank) ? farBank : weapon;
    const base = { ak47: 0.66, m4a1: 0.65, awp: 0.72, glock: 0.65, usp: 0.70 }[weapon] || 0.6;
    const level = remote ? base * 0.80 / (1 + gap * 0.045) : base;
    this.play(bank, { level, distance: remote ? gap : 0, pan: remote ? pan : 0, rate: 0.99 + Math.random() * 0.02, channel: remote ? 'remote' : 'shot' });
    if (weapon === 'awp' && !remote) {
      this.play('awpBack', { level: 0.36, delay: 0.43, channel: 'bolt' });
      this.play('awpForward', { level: 0.36, delay: 0.81, channel: 'bolt' });
    }
  }

  knife(kind = 'swing', distance = 0, pan = 0) {
    const gap = Math.max(0, Number(distance) || 0);
    const bank={wall:'knifeWall',hit:'knifeHit',heavyHit:'knifeHeavyHit',heavySwing:'knifeHeavySwing'}[kind]||'knifeSwing';
    const voice=this.play(bank, {
      level: (kind === 'swing' ? 0.62 : 0.76) / (1 + gap * 0.13), pan, distance: gap, channel: gap > 0 ? 'remote' : 'effect',
    });
    if(voice&&gap===0){this.lastKnife={kind,bank,at:this.ctx.currentTime};if(kind==='heavySwing')this.heavySwingCount=(this.heavySwingCount||0)+1;}
  }

  hit({ headshot = false, armor = false, weapon = '', heavy=false } = {}) {
    if (!this.ready || this.ctx.currentTime - this.lastHitAt < 0.035) return;
    this.lastHitAt = this.ctx.currentTime;
    if (weapon === 'knife') this.knife(heavy?'heavyHit':'hit');
    else if (headshot) this.headshot({ armor });
    else this.play(armor ? 'armorHit' : 'bodyHit', { level: 0.90, channel: 'feedback' });
  }

  headshot({ armor = false } = {}) { this.play(armor ? 'headArmor' : 'headHit', { level: 1.0, channel: 'feedback' }); }

  kill({ headshot = false } = {}) {
    if (!this.ready || this.ctx.currentTime - this.lastKillAt < 0.06) return;
    this.lastKillAt = this.ctx.currentTime;
    // The hit event already supplies the head impact; avoid playing it twice on a lethal shot.
    this.play('kill', { level: headshot ? 1.05 : 0.96, channel: 'feedback' });
  }

  weaponReload(id = this.lastWeapon, options = {}) {
    if (!this.ready) return;
    const weapon=this.weaponId(id,options),w=getWeapon(id==='glock'?'pistol':id),profile=reloadProfile(w.id,options.empty);
    this.cancelReload();this.lastWeapon=weapon;if(options.team)this.lastTeam=options.team;
    const duration=clamp(options.duration||w.reloadTime,.1,8),elapsed=Math.max(0,options.elapsed||0);
    const sequence=w.reloadStyle==='shell'?[{fraction:.7,bank:`${weapon}Shell`}]:profile?.sounds||[];
    for(const {fraction,bank} of sequence){const delay=fraction*duration-elapsed;if(delay>=-.035)this.play(bank,{level:.66,delay:Math.max(0,delay),channel:'reload'});}
  }

  reload(id = this.lastWeapon, options = {}) { this.weaponReload(id, options); }
  draw(id){
    this.cancelDraw();const weapon=this.weaponId(id),bank=id==='c4'?'bombDraw':weapon+'Draw';
    const voice=this.play(bank,{level:.68,channel:'draw'});
    if(voice){this.drawCount=(this.drawCount||0)+1;this.lastDraw={weapon:id,bank,at:this.ctx.currentTime};}
    return voice;
  }
  utilityAmbient(snapshot,position){
    this.fireVoices||=new Map();
    const near=(snapshot.fires||[]).map(f=>({id:f.id,d:Math.hypot(f.x-position.x,f.y-position.y,f.z-position.z)})).filter(f=>f.d<24).sort((a,b)=>a.d-b.d).slice(0,2);
    for(const [id,voice]of this.fireVoices)if(!near.some(f=>f.id===id)||voice.released){this.stopVoice(voice);this.fireVoices.delete(id);}
    for(const f of near){let voice=this.fireVoices.get(f.id);if(!voice){voice=this.play('fireLoop',{level:.15/(1+f.d*.12),distance:f.d,loop:true,channel:'fire'});if(voice)this.fireVoices.set(f.id,voice);}if(voice)voice.nodes[1].gain.setTargetAtTime(.15/(1+f.d*.12),this.ctx.currentTime,.1);}
  }
  cancelDraw(){for(const voice of [...this.voices])if(voice.channel==='draw')this.stopVoice(voice);}
  releaseVoice(voice) {
    if (!voice || voice.released) return;
    voice.released = true;this.voices.delete(voice);voice.source.onended = null;
    for (const node of voice.nodes) node.disconnect();
  }
  stopVoice(voice) {
    if (!voice || voice.released) return;
    try { voice.source.stop(); } catch { /* Already ended. */ }
    // Suspended AudioContexts may defer onended until they resume. Disconnect
    // cancelled voices now, so leaving/reloading cannot retain their graphs.
    this.releaseVoice(voice);
  }
  cancelReload() { for (const voice of [...this.voices]) if (voice.channel === 'reload' || voice.channel === 'bolt') this.stopVoice(voice); }
  stopAll() { for (const voice of [...this.voices]) this.stopVoice(voice); this.lastHitAt = this.lastKillAt = -Infinity; }

  step() {
    if (!this.ready || !this.buffers.length) return;
    this.banks.set('footstep', this.buffers); this.play('footstep', { level: 0.20, channel: 'step' });
  }

  // Kept for legacy menu/round notifications only; guns, impacts, kills and reloads use samples.
  beep(hz = 900, duration = 0.06, volume = 0.1) {
    if (!this.ready) return;
    if (this.voices.size >= 64) this.stopVoice(this.voices.values().next().value);
    const c = this.ctx, t = c.currentTime, source = c.createOscillator(), gain = c.createGain();
    source.frequency.value = clamp(hz, 40, 12000); gain.gain.setValueAtTime(clamp(volume, 0.001, 0.3), t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + Math.max(0.01, duration)); source.connect(gain); gain.connect(this.mix);
    const voice = { source, nodes: [source, gain], channel: 'ui' }; this.voices.add(voice);
    source.onended = () => this.releaseVoice(voice);
    source.start(t); source.stop(t + Math.max(0.01, duration));
  }
}
