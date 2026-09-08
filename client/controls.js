const VERSION = 1;
const STORAGE_KEY = 'dust2.controls.v1';
const MAX_BINDINGS = 3;
export const CONTROL_ACTIONS = Object.freeze([
  ['forward', '向前移动', '移动'], ['back', '向后移动', '移动'], ['left', '向左移动', '移动'], ['right', '向右移动', '移动'],
  ['jump', '跳跃', '移动'], ['walk', '静步', '移动'], ['crouch', '蹲下', '移动'],
  ['fire', '开火', '战斗'], ['altFire', '副攻击 / 开镜', '战斗'], ['reload', '换弹', '战斗'],
  ['primary', '主武器', '武器'], ['secondary', '手枪', '武器'], ['knife', '近战武器', '武器'],
  ['lastWeapon', '上一把使用的武器', '武器'], ['previousWeapon', '切换上一件武器', '武器'], ['nextWeapon', '切换下一件武器', '武器'],
  ['buy', '购买菜单', '界面'], ['inspect', '检视武器', '界面'], ['interact', '使用 / 安装 / 拆除', '界面'],
  ['scoreboard', '计分板（按住）', '界面'], ['menu', '游戏菜单', '界面'],
].map(([id, label, group]) => Object.freeze({ id, label, group })));
const ACTIONS = new Map(CONTROL_ACTIONS.map(action => [action.id, action]));
export const DEFAULT_BINDINGS = Object.freeze(Object.fromEntries(Object.entries({
  forward: ['KeyW'], back: ['KeyS'], left: ['KeyA'], right: ['KeyD'], jump: ['Space'],
  walk: ['ShiftLeft', 'ShiftRight'], crouch: ['ControlLeft', 'ControlRight'],
  fire: ['Mouse0'], altFire: ['Mouse2'], reload: ['KeyR'], primary: ['Digit1'], secondary: ['Digit2'], knife: ['Digit3'],
  lastWeapon: ['KeyQ'], previousWeapon: ['WheelUp'], nextWeapon: ['WheelDown'], buy: ['KeyB'], inspect: ['KeyF'], interact: ['KeyE'], scoreboard: ['Tab'], menu: ['Escape'],
}).map(([action, tokens]) => [action, Object.freeze(tokens)])));
const copy = bindings => Object.fromEntries(CONTROL_ACTIONS.map(({ id }) => [id, [...bindings[id]]]));
const TOKEN_PATTERN = /^(?:Key[A-Z]|Digit[0-9]|Numpad(?:[0-9]|Add|Subtract|Multiply|Divide|Decimal|Enter|Equal)|F(?:[1-9]|1[0-9]|2[0-4])|Arrow(?:Up|Down|Left|Right)|(?:Shift|Control|Alt|Meta)(?:Left|Right)|Space|Tab|Escape|Enter|Backspace|Delete|Insert|Home|End|PageUp|PageDown|CapsLock|NumLock|ScrollLock|Pause|Backquote|Minus|Equal|BracketLeft|BracketRight|Backslash|Semicolon|Quote|Comma|Period|Slash|IntlBackslash|IntlRo|IntlYen|Mouse[0-4]|WheelUp|WheelDown)$/;
const validToken = token => typeof token === 'string' && TOKEN_PATTERN.test(token);
const browserStorage = () => { try { return globalThis.localStorage || null; } catch { return null; } };
const targetElement = event => event.composedPath?.().find(node => node?.nodeType === 1) || event.target;
const editable = event => {
  const node = targetElement(event);
  return !!(node?.isContentEditable || node?.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="textbox"], [data-game-input="ignore"]'));
};
export function formatBinding(token) {
  if (!token) return '未绑定';
  return ({ Space: '空格', ShiftLeft: '左 Shift', ShiftRight: '右 Shift', ControlLeft: '左 Ctrl', ControlRight: '右 Ctrl', AltLeft: '左 Alt', AltRight: '右 Alt', MetaLeft: '左 Win', MetaRight: '右 Win', Mouse0: '鼠标左键', Mouse1: '鼠标中键', Mouse2: '鼠标右键', Mouse3: '鼠标侧键 1', Mouse4: '鼠标侧键 2', WheelUp: '滚轮向上', WheelDown: '滚轮向下', Escape: 'Esc', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/' })[token] || token.replace(/^Key|^Digit/, '').replace(/^Numpad/, '小键盘 ');
}

/** Input only. The game owns pointer locking, movement, weapons and all actions. */
export class GameControls {
  constructor({ target = globalThis.window, storage = browserStorage(), enabled = () => true, onAction = () => {}, mouse = true } = {}) {
    this.target = target; this.storage = storage; this.enabled = enabled; this.onAction = onAction; this.mouse = mouse;
    this.bindings = copy(DEFAULT_BINDINGS); this.held = new Set(); this.sources = new Map(); this.edges = new Map(); this.listeners = new Set(); this.capture = null; this.persistenceError = null;
    this._load(); this._index();
    this.handlers = {
      keydown: event => this._keyDown(event), keyup: event => this._release(event.code, event),
      mousedown: event => this._mouseDown(event), mouseup: event => this._release(`Mouse${event.button}`, event),
      wheel: event => this._wheel(event), blur: () => this.clear(),
      focusin: event => { if (editable(event)) this.clear(); },
      contextmenu: event => { if (this.capture || (this.mouse && this.held.has('altFire'))) event.preventDefault(); },
    };
    for (const [type, handler] of Object.entries(this.handlers)) target?.addEventListener(type, handler, { capture: true, ...(type === 'wheel' ? { passive: false } : {}) });
    this.visibilityTarget = target?.document || (target?.nodeType === 9 ? target : null);
    this.visibilityHandler = () => { if (this.visibilityTarget.hidden) this.clear(); };
    this.visibilityTarget?.addEventListener('visibilitychange', this.visibilityHandler);
  }

  _load() {
    try {
      const source = this.storage?.getItem(STORAGE_KEY); if (!source) return;
      const data = JSON.parse(source); if (data.version !== VERSION || !data.bindings || typeof data.bindings !== 'object') return;
      const next = {}, used = new Set();
      // Reject corrupted/conflicting settings as a whole; never silently lose a movement key.
      for (const { id } of CONTROL_ACTIONS) {
        const tokens = data.bindings[id] ?? DEFAULT_BINDINGS[id];
        if (!Array.isArray(tokens) || tokens.length > MAX_BINDINGS) return;
        next[id] = [];
        for (const token of tokens) { if (!validToken(token) || used.has(token)) return; used.add(token); next[id].push(token); }
      }
      this.bindings = next;
    } catch { /* Missing/blocked storage or old malformed settings use CS defaults. */ }
  }
  _save() {
    this.persistenceError = null;
    try { this.storage?.setItem(STORAGE_KEY, JSON.stringify({ version: VERSION, bindings: this.bindings })); }
    catch { this.persistenceError = '浏览器未允许保存，当前设置仍然生效。'; }
  }
  _index() { this.byToken = new Map(); for (const [action, tokens] of Object.entries(this.bindings)) for (const token of tokens) this.byToken.set(token, action); }
  _notify() { for (const listener of this.listeners) listener(); }
  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  getBindings() { return copy(this.bindings); }
  down(action) { return this.held.has(action); }
  consume(action) { const count = this.edges.get(action) || 0; if (!count) return false; if (count === 1) this.edges.delete(action); else this.edges.set(action, count - 1); return true; }
  _edge(action) { this.edges.set(action, Math.min(8, (this.edges.get(action) || 0) + 1)); }
  _allowed(action, event) { return !!action && !editable(event) && !this.capture && (typeof this.enabled === 'function' ? this.enabled(action, event) : this.enabled); }
  _press(token, event) {
    const action = this.byToken.get(token); if (this.sources.has(token) || !this._allowed(action, event)) return;
    event.preventDefault?.(); this.sources.set(token, action);
    if (this.held.has(action)) return;
    this.held.add(action); this._edge(action); this.onAction(action, { pressed: true, source: token, event });
  }
  _release(token, event) {
    const action = this.sources.get(token); if (!action) return;
    this.sources.delete(token);
    if ([...this.sources.values()].includes(action)) return;
    this.held.delete(action); this.onAction(action, { pressed: false, source: token, event });
  }
  _keyDown(event) {
    if (this._captureEvent(event.code, event)) return;
    if (event.repeat || event.isComposing || (event.metaKey && !['MetaLeft', 'MetaRight'].includes(event.code))) return;
    this._press(event.code, event);
  }
  _mouseDown(event) { if (this._captureEvent(`Mouse${event.button}`, event)) return; if (this.mouse) this._press(`Mouse${event.button}`, event); }
  _wheel(event) {
    if (!event.deltaY) return;
    const token = event.deltaY < 0 ? 'WheelUp' : 'WheelDown';
    if (this._captureEvent(token, event)) return;
    const action = this.byToken.get(token); if (!this._allowed(action, event)) return;
    event.preventDefault?.(); this._edge(action); this.onAction(action, { pressed: true, source: token, event });
    if (!this.held.has(action)) this.onAction(action, { pressed: false, source: token, event });
  }
  clear() {
    const active = [...this.held]; this.held.clear(); this.sources.clear(); this.edges.clear();
    for (const action of active) this.onAction(action, { pressed: false, source: 'clear', event: null });
  }
  setBinding(action, token, { slot = 0, conflict = 'reject' } = {}) {
    if (!ACTIONS.has(action) || !Number.isInteger(slot) || slot < 0 || slot >= MAX_BINDINGS || slot > this.bindings[action].length || (token != null && !validToken(token))) return { ok: false, reason: 'invalid', message: '无效的动作或按键。' };
    const oldToken = this.bindings[action][slot];
    if (token === oldToken) return { ok: true, changed: false };
    const otherAction = token == null ? null : this.byToken.get(token);
    if (otherAction === action) return { ok: false, reason: 'duplicate', message: '该动作已经绑定这个按键。' };
    if (otherAction && conflict !== 'swap') return { ok: false, reason: 'conflict', action: otherAction, token, message: `${formatBinding(token)} 已用于「${ACTIONS.get(otherAction).label}」。` };
    this.clear();
    if (otherAction) {
      const otherSlot = this.bindings[otherAction].indexOf(token);
      if (oldToken) this.bindings[otherAction][otherSlot] = oldToken; else this.bindings[otherAction].splice(otherSlot, 1);
    }
    if (token == null) this.bindings[action].splice(slot, 1); else this.bindings[action][slot] = token;
    this._index(); this._save(); this._notify();
    return { ok: true, changed: true, swapped: otherAction || null };
  }
  resetDefaults() { this.cancelCapture(); this.clear(); this.bindings = copy(DEFAULT_BINDINGS); this._index(); this._save(); this._notify(); }
  beginCapture(action, slot = 0) {
    if (!ACTIONS.has(action) || slot < 0 || slot > this.bindings[action].length || slot >= MAX_BINDINGS) return false;
    this.clear(); this.capture = { action, slot, conflict: null, message: '' }; this._notify(); return true;
  }
  cancelCapture() { this.capture = null; this._notify(); }
  confirmSwap() {
    const capture = this.capture; if (!capture?.conflict) return { ok: false };
    this.capture = null;
    return this.setBinding(capture.action, capture.conflict.token, { slot: capture.slot, conflict: 'swap' });
  }
  _captureEvent(token, event) {
    if (!this.capture) return false;
    if (token === 'Escape') { event.preventDefault?.(); event.stopImmediatePropagation?.(); this.cancelCapture(); return true; }
    if (token.startsWith('Mouse') && targetElement(event)?.closest?.('[data-controls-ui]')) return true;
    event.preventDefault?.(); event.stopImmediatePropagation?.();
    if (event.repeat || event.isComposing || this.capture.conflict || !validToken(token)) return true;
    const capture = this.capture;
    // Clear capture before notifying a successful binding change.
    this.capture = null;
    const result = this.setBinding(capture.action, token, { slot: capture.slot });
    if (!result.ok) { this.capture = capture; capture.message = result.message; if (result.reason === 'conflict') capture.conflict = result; }
    this._notify(); return true;
  }

  mountSettings(container) {
    const document = container.ownerDocument, panel = document.createElement('section'); panel.className = 'controls-panel'; panel.dataset.controlsPanel = '';
    const node = (tag, className, text) => { const element = document.createElement(tag); if (className) element.className = className; if (text) element.textContent = text; return element; };
    const button = (text, handler, label) => { const element = node('button', 'controls-button', text); element.type = 'button'; element.dataset.controlsUi = ''; if (label) element.setAttribute('aria-label', label); element.addEventListener('click', handler); return element; };
    const render = () => {
      const fragment = document.createDocumentFragment();
      const header = node('div', 'controls-heading'); header.append(node('div', '', '按键绑定'), button('恢复 CS 默认', () => { this.resetDefaults(); })); fragment.append(header);
      fragment.append(node('p', 'controls-help', '点击按键后重新绑定。每个动作最多 3 个按键；可保留空格并添加滚轮跳。Esc 取消录入。'));
      if (this.persistenceError) fragment.append(node('p', 'controls-warning', this.persistenceError));
      if (this.capture) {
        const capture = this.capture, card = node('div', 'controls-capture'); card.setAttribute('role', 'status');
        card.append(node('b', '', `正在设置：${ACTIONS.get(capture.action).label}`));
        card.append(node('p', '', capture.message || '按下新按键，或在此区域点击鼠标 / 滚动滚轮。'));
        const actions = node('div', 'controls-capture-actions');
        if (capture.conflict) {
          const old = this.bindings[capture.action][capture.slot];
          card.append(node('small', '', old ? `交换后，「${ACTIONS.get(capture.conflict.action).label}」改为 ${formatBinding(old)}。` : `确认后，将解除「${ACTIONS.get(capture.conflict.action).label}」上的这个按键。`));
          actions.append(button(old ? '交换绑定' : '移用这个按键', () => this.confirmSwap()));
        }
        actions.append(button('取消', () => this.cancelCapture())); card.append(actions); fragment.append(card);
      }
      const list = node('div', 'controls-list');
      let group = '';
      for (const action of CONTROL_ACTIONS) {
        if (group !== action.group) { group = action.group; list.append(node('h4', 'controls-group', group)); }
        const row = node('div', 'controls-row'), keys = node('div', 'controls-bindings'); row.append(node('span', 'controls-action', action.label));
        this.bindings[action.id].forEach((token, slot) => {
          const item = node('span', 'controls-binding');
          item.append(button(formatBinding(token), () => this.beginCapture(action.id, slot), `${action.label}：${formatBinding(token)}，点击修改`));
          item.append(button('×', () => this.setBinding(action.id, null, { slot }), `解除${action.label}的${formatBinding(token)}`)); keys.append(item);
        });
        if (this.bindings[action.id].length < MAX_BINDINGS) keys.append(button(this.bindings[action.id].length ? '+ 添加' : '未绑定 · 添加', () => this.beginCapture(action.id, this.bindings[action.id].length), `添加${action.label}按键`));
        row.append(keys); list.append(row);
      }
      fragment.append(list); panel.replaceChildren(fragment);
    };
    container.append(panel); const unsubscribe = this.subscribe(render); render();
    return () => { unsubscribe(); this.cancelCapture(); panel.remove(); };
  }
  destroy() {
    this.clear(); this.cancelCapture();
    for (const [type, handler] of Object.entries(this.handlers)) this.target?.removeEventListener(type, handler, { capture: true });
    this.visibilityTarget?.removeEventListener('visibilitychange', this.visibilityHandler); this.listeners.clear();
  }
}
