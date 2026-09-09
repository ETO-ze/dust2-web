import { WEAPONS, normalizeWeapon } from '../shared/weapons.js';
import { getEquipment } from '../shared/equipment.js';
import { uiIconUrl } from './ui-icons.js';

// References: Valve's Spectator UI (2012-08-30) describes staying in the match
// with player identity, weapon and team status visible while observing.
// https://blog.counter-strike.net/2012/08/4839/
// https://help.steampowered.com/en/faqs/view/0E82-09BC-324C-CB12
// This is our presentation of that flow, not a pixel copy of a CS2 death panel.
const numeric = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const remaining = (value, elapsed) => Math.max(0, numeric(value) - Math.max(0, numeric(elapsed)));
const label = (value, fallback) => typeof value === 'string' && value.trim() ? value.trim().slice(0, 80) : fallback;

export function describeDeath(snapshot, self, { event = null, elapsed = 0, spectating = null } = {}) {
  if (!snapshot || !self || self.alive !== false) return { visible: false };
  const players = Array.isArray(snapshot.players) ? snapshot.players : [];
  const kill = event?.type === 'kill' && event.victimId === self.id ? event : null;
  const killer = kill ? players.find(player => player.id === kill.killerId) : null;
  const teammates = players.filter(player => player.id !== self.id && player.team === self.team && player.alive);
  const watched = spectating?.alive && spectating.team === self.team && spectating.id !== self.id ? spectating : null;
  const mode = snapshot.mode === 'defuse' ? 'defuse' : 'deathmatch';
  const round = snapshot.round || {};
  const seconds = mode === 'deathmatch' ? remaining(self.respawnIn, elapsed) : remaining(round.timeLeft, elapsed);
  const weapon = kill ? normalizeWeapon(kill.weapon) : '';
  const weaponName = WEAPONS[weapon]?.name || getEquipment(weapon)?.name || ({ bomb: 'C4 爆炸', c4: 'C4 爆炸', world: '环境伤害' })[weapon] || (kill ? '其他伤害' : '');
  let statusTitle, statusDetail, clock = '', clockLabel = '';
  if (round.phase==='matchEnded'||snapshot.match?.status==='ended') {
    statusTitle='比赛结束';statusDetail='返回大厅，创建或加入下一场比赛';
  } else if (mode === 'deathmatch') {
    statusTitle = seconds > 0 ? '自动重生' : '正在重生';
    statusDetail = '重生后自动回到战斗';
    clock = seconds > 0 ? String(Math.ceil(seconds)) : '…';
    clockLabel = seconds > 0 ? '秒后' : '请稍候';
  } else if (round.phase === 'ended') {
    statusTitle = '下一回合即将开始';
    statusDetail = round.winner === 'CT' ? '防守方 CT 获胜' : round.winner === 'T' ? '进攻方 T 获胜' : '本回合结束';
    clock = String(Math.ceil(seconds)); clockLabel = '秒后';
  } else if (round.phase === 'waiting') {
    statusTitle = '等待双方玩家';
    statusDetail = '双方就绪后开始新回合';
  } else {
    statusTitle = watched ? `正在观战 ${label(watched.name, '队友')}` : '等待下一回合';
    statusDetail = teammates.length ? `己方 ${teammates.length} 人存活 · 对局仍在继续` : '己方无人存活 · 等待回合结算';
    if (watched) {
      const heldWeapon = WEAPONS[normalizeWeapon(watched.weapon)]?.name;
      statusDetail = `己方 ${teammates.length} 人存活 · 生命 ${Math.max(0, Math.ceil(numeric(watched.health)))}${heldWeapon ? ` · ${heldWeapon}` : ''}`;
    }
  }
  return {
    visible: true, mode, hasKill: !!kill,
    killerName: kill ? label(killer?.name || kill.killerName, kill.killerId ? '对手' : '环境') : '你已阵亡',
    killerTeam: killer?.team === 'CT' || killer?.team === 'T' ? killer.team : '',
    weaponName, weaponId:weapon, headshot: !!kill?.headshot,
    statusTitle, statusDetail, seconds, clock, clockLabel,
    teamAlive: teammates.length, observedName: watched ? label(watched.name, '队友') : '',
  };
}

export class DeathScreen {
  constructor(container) {
    this.container = container;
    this.eventRecord = null;
    this.room = null;
    this.deaths = null;
    this.visible = false;
    if (!container?.ownerDocument) return;
    const element = container.ownerDocument.createElement('div');
    element.id = 'death-screen'; element.hidden = true;
    element.innerHTML = `<div class="death-screen-shade" aria-hidden="true"></div>
      <section class="death-screen-card" aria-label="阵亡信息">
        <div class="death-screen-mark" aria-hidden="true"><img src="${uiIconUrl('death')}" alt=""></div>
        <div class="death-screen-kill"><small class="death-screen-eyebrow">你已阵亡</small><b class="death-screen-killer"></b><div class="death-screen-weapon"><img class="death-weapon-icon" alt=""><span></span><em hidden><img src="${uiIconUrl('headshot')}" alt="爆头"></em></div></div>
        <div class="death-screen-status"><b></b><span></span><small class="death-screen-keys"></small></div>
        <div class="death-screen-clock" aria-live="off"><strong></strong><span></span></div>
      </section><span class="death-screen-announcement" role="status" aria-live="polite"></span>`;
    this.element = element;
    this.parts = Object.fromEntries(['eyebrow', 'killer', 'weapon', 'status', 'keys', 'clock', 'announcement'].map(name => [name, element.querySelector(`.death-screen-${name}`)]));
    container.appendChild(element);
  }

  event(event, snapshot, myId) {
    if (event?.type !== 'kill' || event.victimId !== myId) return;
    const victim = snapshot?.players?.find(player => player.id === myId);
    this.eventRecord = { type: 'kill', victimId: event.victimId, killerId: event.killerId,
      killerName: event.killerName, weapon: event.weapon, headshot: !!event.headshot };
    this.room = snapshot?.room || null;
    this.deaths = victim?.deaths ?? null;
  }

  update(snapshot, self, { elapsed = 0, spectating = null, scoreboardKey = 'Tab', menuKey = 'Esc', nextSpectatorKey = '左键', previousSpectatorKey = '右键' } = {}) {
    if (!this.element) return;
    if (!self || self.alive || (this.room && this.room !== snapshot?.room) ||
      (this.deaths != null && self.deaths != null && this.deaths !== self.deaths)) this.eventRecord = null;
    this.room = snapshot?.room || null;
    this.deaths = self?.deaths ?? null;
    const state = describeDeath(snapshot, self, { event: this.eventRecord, elapsed, spectating });
    this.state = state;
    this.element.hidden = !state.visible;
    this.container.classList.toggle('is-dead', state.visible);
    if (!state.visible) { this.visible = false; this.setText(this.parts.announcement, ''); return; }
    const write = (node, value) => this.setText(node, value);
    write(this.parts.eyebrow, state.hasKill ? '击杀你的玩家' : '已离开本回合战斗');
    write(this.parts.killer, state.killerName);
    this.parts.killer.dataset.team = state.killerTeam;
    write(this.parts.weapon.querySelector('span'), state.weaponName);
    const weaponIcon=this.parts.weapon.querySelector('.death-weapon-icon');if(weaponIcon.dataset.weapon!==state.weaponId){weaponIcon.dataset.weapon=state.weaponId;weaponIcon.src=uiIconUrl(state.weaponId);weaponIcon.alt=state.weaponName;}
    this.parts.weapon.querySelector('em').hidden = !state.headshot;
    this.parts.weapon.hidden = !state.weaponName;
    write(this.parts.status.querySelector('b'), state.statusTitle);
    write(this.parts.status.querySelector('span'), state.statusDetail);
    write(this.parts.keys, state.observedName
      ? `${nextSpectatorKey || '左键'} 下一位 · ${previousSpectatorKey || '右键'} 上一位 · ${scoreboardKey || 'Tab'} 战况`
      : `${scoreboardKey || 'Tab'} 查看战况 · ${menuKey || 'Esc'} 菜单`);
    write(this.parts.clock.querySelector('strong'), state.clock);
    write(this.parts.clock.querySelector('span'), state.clockLabel);
    this.parts.clock.hidden = !state.clock;
    if (!this.visible) write(this.parts.announcement, `你已阵亡。${state.hasKill ? `${state.killerName}使用${state.weaponName}${state.headshot ? '爆头' : ''}击杀了你。` : ''}${state.statusTitle}。`);
    this.visible = true;
  }

  setText(node, value) { if (node && node.textContent !== String(value ?? '')) node.textContent = String(value ?? ''); }
  reset() {
    this.eventRecord = null; this.room = null; this.deaths = null; this.visible = false; this.state = { visible: false };
    if (this.element) this.element.hidden = true;
    this.container?.classList.remove('is-dead');
    this.setText(this.parts?.announcement, '');
  }
  dispose() { this.reset(); this.element?.remove(); this.element = null; }
}
