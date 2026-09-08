import { MAP } from '../shared/map-data.js';
import { getWeapon } from '../shared/weapons.js';

const TEAM_COLORS = { CT: '#79bde2', T: '#dfbd76' };
const LOCATION_NAMES = {
  'T SPAWN': 'T 出生点', 'CT SPAWN': 'CT 出生点', A: 'A 包点', B: 'B 包点',
  MID: '中路', 'LONG A': 'A 大道', TUNNELS: 'B 洞', CATWALK: 'A 小道',
};
const now = () => performance.now();
const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min, max) => Math.max(min, Math.min(max, number(value)));
const distanceXZ = (a, b) => Math.hypot(number(a?.x) - number(b?.x), number(a?.z) - number(b?.z));
const distance = (a, b) => Math.hypot(number(a?.x) - number(b?.x), number(a?.y) - number(b?.y), number(a?.z) - number(b?.z));
const clockText = seconds => {
  const value = Math.max(0, Math.ceil(number(seconds)));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
};

export class HUD {
  constructor() {
    this.elements = Object.fromEntries([
      'score-ct', 'score-t', 'mode-label', 'round-time', 'round-state', 'location',
      'network-status', 'room-label', 'kill-feed', 'toast', 'hitmarker', 'damage-vignette',
      'center-message', 'interact-prompt', 'interact-text', 'health', 'armor', 'money',
      'slot1', 'slot2', 'slot3', 'weapon-name', 'ammo', 'reserve', 'reload-label',
      'board-room', 'score-body', 'buy-note', 'weapon-skin', 'hit-damage',
      'kill-confirm', 'kill-title', 'kill-victim', 'kill-weapon', 'kill-combo',
    ].map(id => [id, document.getElementById(id)]));
    this.radar = document.getElementById('radar');
    this.context = this.radar?.getContext('2d');
    this.interactFill = this.elements['interact-prompt']?.querySelector('.interact-track i');
    this.interactTrack = this.elements['interact-prompt']?.querySelector('.interact-track');
    this.messageTitle = this.elements['center-message']?.querySelector('b');
    this.messageBody = this.elements['center-message']?.querySelector('span');
    this.revealed = new Map();
    this.seenEvents = new Set();
    this.feed = [];
    this.myId = null;
    this.snapshotTime = null;
    this.receivedAt = now();
    this.lastRadar = -Infinity;
    this.lastBoard = -Infinity;
    this.boardKey = '';
    this.radarImage = new Image();
    this.radarImage.onload = () => {
      this.radarReady = true;
      if (this.lastSnapshot && this.lastSelf) this.drawRadar(this.lastSnapshot, this.lastSelf, now());
    };
    // Keep nested deployments such as /dust2/ on their own asset path.
    const radarPath = String(MAP.overview?.image || 'assets/valve-dust2/de_dust2_radar_psd.png').replace(/^\/+/, '');
    this.radarImage.src = new URL(radarPath, document.baseURI).href;
  }

  text(id, value) {
    const element = this.elements[id];
    const content = String(value ?? '');
    if (element && element.textContent !== content) element.textContent = content;
  }

  update(snapshot, self, { ping = 0, fps = 0 } = {}) {
    if (!snapshot || !self) return;
    const time = now();
    if (this.snapshotTime !== snapshot.time || this.lastSnapshot?.room !== snapshot.room) {
      if (this.lastSnapshot && this.lastSnapshot.room !== snapshot.room) {
        this.revealed.clear();
        this.seenEvents.clear();
        for (const entry of this.feed) { clearTimeout(entry.timer); entry.node.remove(); }
        this.feed = [];
      }
      this.snapshotTime = snapshot.time;
      this.receivedAt = time;
    }
    this.lastSnapshot = snapshot;
    this.lastSelf = self;
    this.myId = self.id;
    const elapsed = Math.max(0, (time - this.receivedAt) / 1000);
    const round = snapshot.round || {};
    const bomb = snapshot.bomb || {};
    const mode = snapshot.mode === 'defuse' ? 'defuse' : 'deathmatch';
    const weapon = getWeapon(self.weapon || 'pistol');

    this.text('score-ct', number(snapshot.scores?.CT));
    this.text('score-t', number(snapshot.scores?.T));
    this.text('mode-label', mode === 'defuse' ? '经典爆破' : '团队死斗');
    this.text('room-label', snapshot.room || '------');
    this.text('board-room', `${snapshot.room || ''} · ${mode === 'defuse' ? '经典爆破' : '团队死斗'}`);
    this.text('network-status', `${Math.round(clamp(ping, 0, 9999))} ms · ${Math.round(clamp(fps, 0, 999))} FPS`);
    const network = this.elements['network-status'];
    if (network) network.style.color = time - this.receivedAt > 2500 ? '#f09b83' : '';
    this.text('health', Math.ceil(clamp(self.health, 0, 999)));
    this.text('armor', `护甲 ${Math.round(clamp(self.armor, 0, 999))}`);
    this.text('money', `$ ${Math.max(0, Math.round(number(self.money))).toLocaleString('en-US')}`);
    this.text('weapon-name', weapon.name);
    this.text('weapon-skin', weapon.skin || '');
    this.text('ammo', weapon.slot === 3 ? '—' : Math.max(0, Math.floor(number(self.ammo))));
    this.text('reserve', weapon.slot === 3 ? '—' : Math.max(0, Math.floor(number(self.reserve))));
    for (let slot = 1; slot <= 3; slot++) {
      this.elements[`slot${slot}`]?.classList.toggle('selected', number(self.slot, weapon.slot) === slot);
    }
    const reload = Math.max(0, number(self.reloadRemaining) - elapsed);
    const protection = Math.max(0, number(self.spawnProtectionRemaining) - elapsed);
    this.text('reload-label', reload > 0 ? `正在换弹 ${reload.toFixed(1)} s` :
      protection > 0 && self.alive ? `重生保护 ${protection.toFixed(1)} s` :
        self.hasBomb ? '携带 C4 · 前往 A / B 包点' : weapon.slot === 3 ? '鼠标左键 近战 · B 购买' : 'R 换弹 · B 购买');

    const closest = (MAP.labels || []).reduce((best, label) => {
      const gap = distanceXZ(self, label);
      return !best || gap < best.gap ? { label, gap } : best;
    }, null)?.label;
    this.text('location', closest ? LOCATION_NAMES[closest.text] || closest.text : MAP.name || 'Dust II');

    const roundLeft = Math.max(0, number(round.timeLeft) - elapsed);
    const bombLeft = Math.max(0, number(bomb.remaining) - elapsed);
    this.text('round-time', bomb.state === 'planted' ? clockText(bombLeft) : mode === 'deathmatch' ? '∞' : round.phase === 'waiting' ? '—' : clockText(roundLeft));
    if (this.elements['round-time']) this.elements['round-time'].style.color = bomb.state === 'planted' ? '#ffb28c' : '';
    this.text('round-state', bomb.state === 'planted' ? `${bomb.site || ''} 区 · 炸弹已安装` :
      mode === 'deathmatch' ? '团队击杀 · 自动重生' : round.phase === 'waiting' ? '等待双方玩家' :
        round.phase === 'freeze' ? `回合 ${number(round.number, 1)} · 准备` :
          round.phase === 'ended' ? '下一回合即将开始' : `回合 ${number(round.number, 1)}`);

    let title = '', subtitle = '';
    if (round.phase === 'ended') {
      title = round.winner === 'CT' ? '防守方 CT 获胜' : round.winner === 'T' ? '进攻方 T 获胜' : '回合结束';
      subtitle = `${round.reason || ''}${round.reason ? ' · ' : ''}${Math.ceil(roundLeft)} 秒后下一回合`;
    } else if (mode === 'defuse' && round.phase === 'waiting') {
      title = '等待交战双方'; subtitle = '邀请朋友加入，或添加机器人开始对局';
    } else if (!self.alive) {
      title = '你已阵亡';
      subtitle = mode === 'deathmatch' ? `${Math.ceil(Math.max(0, number(self.respawnIn) - elapsed))} 秒后重生 · Tab 查看战况` : '等待下一回合 · Tab 查看战况';
    } else if (round.phase === 'freeze') {
      title = `回合 ${number(round.number, 1)}`;
      subtitle = `${Math.ceil(roundLeft)} 秒后出发 · B 购买装备${self.hasBomb ? ' · 你携带炸弹' : ''}`;
    }
    if (this.messageTitle) this.messageTitle.textContent = title;
    if (this.messageBody) this.messageBody.textContent = subtitle;
    if (this.elements['center-message']) this.elements['center-message'].hidden = !title;

    this.updateInteraction(snapshot, self);
    const buyLeft = Math.max(0, (number(round.buyEndsAt) - number(snapshot.time)) / 1000 - elapsed);
    const inBuyZone = (MAP.spawns?.[self.team] || []).some(spawn => distanceXZ(self, spawn) < 9 && Math.abs(number(self.y) - number(spawn.y)) < 3);
    this.text('buy-note', mode === 'deathmatch' ? '死斗模式可免费更换武器与补充护甲。' :
      !self.alive ? '阵亡后无法购买，等待下一回合。' : buyLeft <= 0 ? '本回合购买时间已结束。' :
        !inBuyZone ? `请返回己方出生区购买 · 剩余 ${Math.ceil(buyLeft)} 秒` : `购买时间剩余 ${Math.ceil(buyLeft)} 秒 · 当前 $${number(self.money)}`);
    if (time - this.lastBoard >= 250) { this.updateScoreboard(snapshot, self); this.lastBoard = time; }
    if (time - this.lastRadar >= 50) { this.drawRadar(snapshot, self, time); this.lastRadar = time; }
    this.pruneFeed(time);
  }

  updateInteraction(snapshot, self) {
    const prompt = this.elements['interact-prompt'];
    if (!prompt) return;
    const bomb = snapshot.bomb || {};
    let text = '', progress = 0, showTrack = false;
    if (self.alive && snapshot.mode === 'defuse' && snapshot.round?.phase === 'live') {
      const site = Object.entries(MAP.sites || {}).find(([, point]) => distanceXZ(self, point) <= number(point.radius, 6) && Math.abs(number(self.y) - number(point.y)) < 3)?.[0];
      if (bomb.actorId === self.id && bomb.action) {
        text = bomb.action === 'plant' ? `正在安装 · ${site || bomb.site || ''} 区 · 保持按住 E` : '正在拆除炸弹 · 保持按住 E';
        progress = clamp(bomb.progress, 0, 1); showTrack = true;
      } else if (bomb.state === 'planted' && self.team === 'CT' && distance(self, bomb) < 2.8) {
        text = '按住 E 拆除炸弹 · 保持静止'; showTrack = true;
        if (bomb.action === 'defuse' && bomb.actorId) { text = '队友正在拆除炸弹'; progress = clamp(bomb.progress, 0, 1); }
      } else if (bomb.state === 'carried' && (bomb.carrierId === self.id || self.hasBomb) && site) {
        text = `按住 E 安装炸弹 · ${site} 区 · 保持静止`; showTrack = true;
      } else if (bomb.state === 'dropped' && self.team === 'T' && distance(self, bomb) < 4) {
        text = '靠近地上的炸弹即可拾取';
      }
    }
    prompt.hidden = !text;
    this.text('interact-text', text);
    if (this.interactFill) this.interactFill.style.width = `${progress * 100}%`;
    if (this.interactTrack) this.interactTrack.hidden = !showTrack;
  }

  updateScoreboard(snapshot, self) {
    const body = this.elements['score-body'];
    if (!body) return;
    const players = [...(snapshot.players || [])].sort((a, b) =>
      Number(b.team === self.team) - Number(a.team === self.team) || String(a.team).localeCompare(String(b.team)) || number(b.kills) - number(a.kills) || number(a.deaths) - number(b.deaths));
    const key = JSON.stringify([self.id, ...players.map(p => [p.id, p.name, p.team, p.bot, p.alive, p.kills, p.deaths, p.assists, p.score])]);
    if (key === this.boardKey) return;
    this.boardKey = key;
    const fragment = document.createDocumentFragment();
    for (const player of players) {
      const row = document.createElement('tr');
      if (player.id === self.id) row.classList.add('own');
      row.style.color = TEAM_COLORS[player.team] || '#ddd';
      if (player.id === self.id) row.style.background = '#ead89a13';
      const values = [
        `${player.alive ? '' : '† '}${player.bot ? '[BOT] ' : ''}${player.name || '玩家'}${player.id === self.id ? ' (你)' : ''}`,
        number(player.kills), number(player.deaths), number(player.assists),
        number(player.score, number(player.kills) * 2 + number(player.assists)),
      ];
      for (const value of values) { const cell = document.createElement('td'); cell.textContent = String(value); row.appendChild(cell); }
      fragment.appendChild(row);
    }
    body.replaceChildren(fragment);
  }

  radarPoint(position) {
    const overview = MAP.overview || {};
    const units = number(MAP.metersPerSourceUnit, 0.0254) || 0.0254;
    const scale = number(overview.scale, 4.4) || 4.4;
    const size = number(overview.size, 1024) || 1024;
    return {
      x: ((number(position.x) / units - number(overview.pos_x, -2476)) / scale) * (this.radar.width / size),
      y: ((number(overview.pos_y, 3239) + number(position.z) / units) / scale) * (this.radar.height / size),
    };
  }

  drawRadar(snapshot, self, time) {
    const ctx = this.context;
    if (!ctx || !this.radar) return;
    const { width, height } = this.radar;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#101815'; ctx.fillRect(0, 0, width, height);
    if (this.radarReady) { ctx.globalAlpha = 0.87; ctx.drawImage(this.radarImage, 0, 0, width, height); ctx.globalAlpha = 1; }
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, width, height); ctx.clip();
    for (const player of snapshot.players || []) {
      if (player.id === self.id || player.team !== self.team || !player.alive) continue;
      const point = this.radarPoint(player);
      ctx.beginPath(); ctx.arc(point.x, point.y, 3.9, 0, Math.PI * 2);
      ctx.fillStyle = TEAM_COLORS[player.team] || '#8bcebb'; ctx.fill();
      ctx.strokeStyle = '#101815'; ctx.lineWidth = 1.3; ctx.stroke();
    }
    // Enemy shots reveal only their last firing position, briefly, never live tracking.
    for (const [id, reveal] of this.revealed) {
      if (reveal.until <= time) { this.revealed.delete(id); continue; }
      const point = this.radarPoint(reveal);
      ctx.globalAlpha = Math.min(1, (reveal.until - time) / 450);
      ctx.fillStyle = '#ee8169'; ctx.beginPath(); ctx.arc(point.x, point.y, 3.5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    const bomb = snapshot.bomb || {};
    if (bomb.state === 'planted' || (self.team === 'T' && bomb.state === 'dropped')) {
      const point = this.radarPoint(bomb);
      ctx.save(); ctx.translate(point.x, point.y); ctx.rotate(Math.PI / 4);
      ctx.fillStyle = bomb.state === 'planted' ? '#ff916d' : '#f7d785'; ctx.fillRect(-3.5, -3.5, 7, 7); ctx.restore();
    }
    const point = this.radarPoint(self);
    ctx.save(); ctx.translate(point.x, point.y); ctx.rotate(-number(self.yaw));
    ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(4.8, 5); ctx.lineTo(0, 2.5); ctx.lineTo(-4.8, 5); ctx.closePath();
    ctx.fillStyle = self.alive ? '#efffbd' : '#999'; ctx.fill();
    ctx.strokeStyle = '#142015'; ctx.lineWidth = 1.5; ctx.stroke(); ctx.restore();
    ctx.restore();
  }

  event(event, snapshot = this.lastSnapshot, myId = this.myId) {
    if (!event || (event.id != null && this.seenEvents.has(event.id))) return;
    if (event.id != null) {
      this.seenEvents.add(event.id);
      if (this.seenEvents.size > 512) this.seenEvents.delete(this.seenEvents.values().next().value);
    }
    const players = snapshot?.players || [];
    const me = players.find(player => player.id === myId) || this.lastSelf;
    const find = id => players.find(player => player.id === id);
    if (event.type === 'shot') {
      const shooter = find(event.shooterId);
      const origin = event.origin || shooter;
      if (me && shooter && origin && shooter.team !== me.team) this.revealed.set(shooter.id, { x: number(origin.x), z: number(origin.z), until: now() + 1400 });
    } else if (event.type === 'hit') {
      if (event.shooterId === myId) this.hit(event.headshot, event.damage);
      if (event.targetId === myId) this.damage();
    } else if (event.type === 'kill') {
      const killer = find(event.killerId), victim = find(event.victimId);
      if (event.killerId === myId && event.victimId !== myId) this.confirmKill(event, victim);
      if (event.victimId === myId) this.combo = 0;
      const node = document.createElement('div');
      node.className = `kill-entry${event.killerId === myId || event.victimId === myId ? ' own' : ''}`;
      const killerLabel = document.createElement('span');
      killerLabel.textContent = killer?.name || event.killerName || (event.killerId ? '玩家' : '环境');
      killerLabel.style.color = TEAM_COLORS[killer?.team] || '#d2d8cc';
      const weaponLabel = document.createElement('small');
      weaponLabel.textContent = `${event.weapon ? getWeapon(event.weapon).name : '淘汰'}${event.headshot ? ' · 爆头' : ''} →`;
      const victimLabel = document.createElement('span');
      victimLabel.textContent = victim?.name || event.victimName || '玩家'; victimLabel.style.color = TEAM_COLORS[victim?.team] || '#d2d8cc';
      node.append(killerLabel, weaponLabel, victimLabel);
      const entry = { node, expiresAt: now() + 6000 };
      entry.timer = setTimeout(() => { node.remove(); this.feed = this.feed.filter(item => item !== entry); }, 6000);
      this.feed.push(entry); this.elements['kill-feed']?.appendChild(node);
      while (this.feed.length > 5) { const old = this.feed.shift(); clearTimeout(old.timer); old.node.remove(); }
      this.revealed.delete(event.victimId);
    } else if (event.type === 'round_start') {
      this.combo = 0;
      this.revealed.clear(); this.toast('新回合开始 · B 购买装备');
    } else if (event.type === 'round_end') {
      this.toast(event.reason || `${event.winner === 'CT' ? '防守方 CT' : '进攻方 T'} 赢得回合`);
    } else if (event.type === 'bomb_planted') {
      this.toast(`${event.site || ''} 区炸弹已安装 · 40 秒倒计时`);
    } else if (event.type === 'bomb_defused') {
      this.toast('炸弹已拆除');
    } else if (event.type === 'bomb_exploded') {
      this.toast('炸弹爆炸');
    } else if (event.type === 'buy' && event.playerId === myId) {
      this.toast(event.weapon === 'armor' ? '护甲已补充' : `已装备 ${getWeapon(event.weapon).name}`);
    }
  }

  pruneFeed(time) {
    this.feed = this.feed.filter(entry => {
      if (entry.expiresAt > time) return true;
      clearTimeout(entry.timer); entry.node.remove(); return false;
    });
  }

  toast(text) {
    this.text('toast', text);
    const element = this.elements.toast;
    if (!element) return;
    clearTimeout(this.toastTimer); element.style.opacity = '1';
    this.toastTimer = setTimeout(() => { element.style.opacity = '0'; }, 2800);
  }

  reset() {
    this.seenEvents.clear(); this.revealed.clear(); this.combo = 0; this.lastKillAt = -Infinity;
    for (const entry of this.feed) { clearTimeout(entry.timer); entry.node.remove(); }
    this.feed = []; this.lastSnapshot = null; this.snapshotTime = null;
    clearTimeout(this.killTimer); this.elements['kill-confirm']?.classList.remove('visible', 'expire');
  }

  confirmKill(event, victim) {
    const time = now();
    this.combo = time - (this.lastKillAt ?? -Infinity) < 5000 ? (this.combo || 0) + 1 : 1;
    this.lastKillAt = time;
    const weapon = getWeapon(event.weapon);
    this.text('kill-title', event.headshot ? '爆头击杀' : this.combo > 1 ? `${this.combo} 连杀` : '击杀确认');
    this.text('kill-victim', victim?.name || event.victimName || '对手');
    this.text('kill-weapon', `${weapon.name}  /  ${weapon.skin || ''}`);
    this.text('kill-combo', this.combo > 1 ? `×${this.combo}` : '');
    const element = this.elements['kill-confirm'];
    if (!element) return;
    clearTimeout(this.killTimer); element.classList.remove('visible', 'expire');
    element.classList.toggle('headshot', !!event.headshot);
    void element.offsetWidth; element.classList.add('visible');
    this.killTimer = setTimeout(() => { element.classList.remove('visible'); element.classList.add('expire'); }, 2400);
  }

  hit(headshot = false, damage = 0) {
    const element = this.elements.hitmarker;
    if (!element) return;
    clearTimeout(this.hitTimer); element.style.color = headshot ? '#ffb46e' : '#ffefc1'; element.style.opacity = '1';
    const label = this.elements['hit-damage'];
    if (label) { label.textContent = `${headshot ? '爆头 ' : ''}${damage ? Math.round(damage) : ''}`; label.style.opacity = '1'; }
    this.hitTimer = setTimeout(() => { element.style.opacity = '0'; if (label) label.style.opacity = '0'; }, headshot ? 420 : 290);
  }

  damage() {
    const element = this.elements['damage-vignette'];
    if (!element) return;
    clearTimeout(this.damageTimer); element.style.transition = 'none'; element.style.opacity = '1';
    this.damageTimer = setTimeout(() => { element.style.transition = 'opacity .28s'; element.style.opacity = '0'; }, 70);
  }
}
