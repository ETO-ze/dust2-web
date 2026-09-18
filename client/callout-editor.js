import * as THREE from 'three';
import {
  getCalloutDocument,
  listCallouts,
  normalizeDocument,
  normalizePoint,
  nearestCallout,
  calloutLabel,
  slugId,
  upsertCallout,
  removeCallout,
  replaceCallouts,
} from '../shared/map-callouts.js';

const STORAGE_KEY = 'dust2.map-callouts.draft.v1';

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'className') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v != null) node.setAttribute(k, v);
  }
  for (const child of [].concat(children)) {
    if (child == null || child === false) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

/**
 * In-match callout authoring: F8 toggle, M mark at feet, save to server JSON for bots/HUD.
 */
export class CalloutEditor {
  constructor({ scene, camera, getPose, toast = () => {}, onChange = () => {} } = {}) {
    this.scene = scene;
    this.camera = camera;
    this.getPose = getPose;
    this.toast = toast;
    this.onChange = onChange;
    this.enabled = false;
    this.selectedId = null;
    this.markers = new Map();
    this.group = new THREE.Group();
    this.group.visible = false;
    this.scene?.add(this.group);
    this._buildUi();
    this.loadLocalDraft();
    this.fetchServer().catch(() => {});
    this._onKey = (e) => this.onKey(e);
    window.addEventListener('keydown', this._onKey, true);
  }

  _buildUi() {
    this.root = el('div', { id: 'callout-editor', className: 'callout-editor', hidden: 'true' });
    this.root.innerHTML = '';
    this.title = el('div', { className: 'callout-editor-title', text: '点位调试 · F8 开关' });
    this.coords = el('div', { className: 'callout-editor-coords', text: '—' });
    this.list = el('div', { className: 'callout-editor-list' });
    this.hint = el('div', {
      className: 'callout-editor-hint',
      text: 'M 标记当前位置 · Del 删除选中 · 保存写入 shared/map-callouts.json',
    });
    this.nameInput = el('input', {
      type: 'text',
      placeholder: '中文名（如：中门）',
      maxlength: '48',
      className: 'callout-editor-input',
    });
    this.idInput = el('input', {
      type: 'text',
      placeholder: '英文 id（如：mid-doors）',
      maxlength: '40',
      className: 'callout-editor-input',
    });
    this.kindSelect = el('select', { className: 'callout-editor-input' }, [
      el('option', { value: 'area', text: '区域 area' }),
      el('option', { value: 'anchor', text: '锚点 anchor' }),
      el('option', { value: 'spot', text: '站位 spot' }),
      el('option', { value: 'site', text: '包点 site' }),
    ]);
    const actions = el('div', { className: 'callout-editor-actions' }, [
      el('button', { type: 'button', text: '标记此处', onClick: () => this.markHere() }),
      el('button', { type: 'button', text: '保存到服务器', onClick: () => this.saveServer() }),
      el('button', { type: 'button', text: '导出 JSON', onClick: () => this.download() }),
      el('button', { type: 'button', text: '删除选中', onClick: () => this.removeSelected() }),
    ]);
    this.status = el('div', { className: 'callout-editor-status', text: '未保存草稿可先本地编辑。' });
    this.root.append(this.title, this.coords, this.nameInput, this.idInput, this.kindSelect, actions, this.hint, this.list, this.status);
    document.body.append(this.root);
    this.nameInput.addEventListener('keydown', (e) => e.stopPropagation());
    this.idInput.addEventListener('keydown', (e) => e.stopPropagation());
    this.kindSelect.addEventListener('keydown', (e) => e.stopPropagation());
  }

  setEnabled(on) {
    this.enabled = !!on;
    this.root.hidden = !this.enabled;
    this.group.visible = this.enabled;
    document.body.classList.toggle('callout-editor-active', this.enabled);
    if (this.enabled) {
      this.refreshList();
      this.rebuildMarkers();
      this.toast('点位调试已开启 · M 标记 · F8 关闭');
      document.exitPointerLock?.();
    } else {
      this.toast('点位调试已关闭');
    }
  }

  toggle() {
    this.setEnabled(!this.enabled);
  }

  onKey(e) {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === 'F8') {
      e.preventDefault();
      e.stopPropagation();
      this.toggle();
      return;
    }
    if (!this.enabled) return;
    const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
    if (typing) return;
    if (e.code === 'KeyM') {
      e.preventDefault();
      e.stopPropagation();
      this.markHere();
    } else if (e.code === 'Delete' || e.code === 'Backspace') {
      e.preventDefault();
      e.stopPropagation();
      this.removeSelected();
    }
  }

  pose() {
    return this.getPose?.() || null;
  }

  update() {
    if (!this.enabled) return;
    const pose = this.pose();
    if (!pose) {
      this.coords.textContent = '等待玩家坐标…';
      return;
    }
    const near = nearestCallout(pose, { maxDistance: 8 });
    this.coords.textContent = `xyz ${pose.x.toFixed(2)}, ${pose.y.toFixed(2)}, ${pose.z.toFixed(2)} · yaw ${((pose.yaw || 0) * 180 / Math.PI).toFixed(0)}°`
      + (near ? ` · 附近 ${calloutLabel(near.point)} (${near.gap.toFixed(1)}m)` : '');
    this._projectMarkers(pose);
  }

  markHere() {
    const pose = this.pose();
    if (!pose) {
      this.toast('需要先进入对局');
      return;
    }
    let nameZh = this.nameInput.value.trim();
    let id = slugId(this.idInput.value.trim() || nameZh);
    if (!nameZh) {
      nameZh = window.prompt('区域/点位中文名（如：中门、A 猫道）', nearestCallout(pose, { maxDistance: 4 })?.point?.nameZh || '');
      if (nameZh == null) return;
      nameZh = String(nameZh).trim();
      if (!nameZh) {
        this.toast('名称不能为空');
        return;
      }
    }
    if (!id) id = slugId(nameZh) || `spot-${Date.now().toString(36)}`;
    const kind = this.kindSelect.value || 'area';
    const existing = listCallouts().find(p => p.id === id);
    const point = upsertCallout({
      id,
      name: existing?.name || id,
      nameZh,
      x: pose.x,
      y: pose.y,
      z: pose.z,
      kind,
      aliases: existing?.aliases || [],
      tags: [...new Set([...(existing?.tags || []), 'hud', 'bot', 'authored'])],
    });
    this.selectedId = point.id;
    this.nameInput.value = point.nameZh;
    this.idInput.value = point.id;
    this.persistLocal();
    this.refreshList();
    this.rebuildMarkers();
    this.onChange(getCalloutDocument());
    this.toast(`已标记 ${point.nameZh} (${point.id})`);
    this.status.textContent = `已更新 ${point.id} · 记得点「保存到服务器」`;
  }

  removeSelected() {
    const id = this.selectedId || nearestCallout(this.pose() || {}, { maxDistance: 3 })?.point?.id;
    if (!id) {
      this.toast('没有可删除的选中点');
      return;
    }
    if (!window.confirm(`删除点位 ${id}？`)) return;
    removeCallout(id);
    if (this.selectedId === id) this.selectedId = null;
    this.persistLocal();
    this.refreshList();
    this.rebuildMarkers();
    this.onChange(getCalloutDocument());
    this.toast(`已删除 ${id}`);
  }

  refreshList() {
    const points = listCallouts();
    this.list.replaceChildren(...points.map((p) => {
      const row = el('button', {
        type: 'button',
        className: `callout-editor-row${p.id === this.selectedId ? ' selected' : ''}`,
        onClick: () => {
          this.selectedId = p.id;
          this.nameInput.value = p.nameZh || p.name;
          this.idInput.value = p.id;
          this.kindSelect.value = p.kind || 'area';
          this.refreshList();
        },
      }, `${p.nameZh || p.name} · ${p.id}  (${p.x.toFixed(1)}, ${p.z.toFixed(1)})`);
      return row;
    }));
  }

  rebuildMarkers() {
    for (const mesh of this.markers.values()) this.group.remove(mesh);
    this.markers.clear();
    for (const p of listCallouts()) {
      const geo = new THREE.SphereGeometry(0.22, 10, 10);
      const mat = new THREE.MeshBasicMaterial({
        color: p.id === this.selectedId ? 0xffcc66 : p.kind === 'site' ? 0xff6666 : 0x66ccff,
        depthTest: true,
        transparent: true,
        opacity: 0.85,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(p.x, p.y + 0.35, p.z);
      mesh.userData.calloutId = p.id;
      this.group.add(mesh);
      this.markers.set(p.id, mesh);
    }
  }

  _projectMarkers() {
    // Selection highlight only; positions already world-space.
    for (const [id, mesh] of this.markers) {
      mesh.material.color.setHex(id === this.selectedId ? 0xffcc66 : 0x66ccff);
    }
  }

  persistLocal() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(getCalloutDocument()));
    } catch { /* ignore quota */ }
  }

  loadLocalDraft() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      replaceCallouts(JSON.parse(raw));
      this.status.textContent = '已载入本地草稿（优先于默认种子）。';
    } catch { /* ignore */ }
  }

  async fetchServer() {
    const res = await fetch('/api/dev/callouts', { cache: 'no-store' });
    if (!res.ok) return;
    const data = await res.json();
    replaceCallouts(data);
    this.persistLocal();
    if (this.enabled) {
      this.refreshList();
      this.rebuildMarkers();
    }
    this.onChange(getCalloutDocument());
    this.status.textContent = `已从服务器载入 ${listCallouts().length} 个点位。`;
  }

  async saveServer() {
    const promoteShared = window.confirm('是否同时写入 shared/map-callouts.json（方便提交仓库）？\n点「取消」则只保存到 .runtime/map-callouts.json（不触发热重启风险更低）。');
    const body = getCalloutDocument();
    const res = await fetch('/api/dev/callouts', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ document: body, promoteShared }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      this.toast('保存失败');
      this.status.textContent = `保存失败：${text || res.status}`;
      return;
    }
    const saved = await res.json();
    replaceCallouts(saved.document || body);
    this.persistLocal();
    this.onChange(getCalloutDocument());
    this.toast(promoteShared ? '已写入 shared + .runtime' : '已写入 .runtime/map-callouts.json');
    this.status.textContent = `已保存 ${listCallouts().length} 个点 · ${saved.path || ''}`;
  }

  download() {
    const blob = new Blob([JSON.stringify(getCalloutDocument(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: 'map-callouts.json' });
    document.body.append(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  dispose() {
    window.removeEventListener('keydown', this._onKey, true);
    this.root?.remove();
    this.group.removeFromParent();
    for (const mesh of this.markers.values()) {
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    this.markers.clear();
  }
}

export { normalizeDocument, normalizePoint, listCallouts, getCalloutDocument, nearestCallout, calloutLabel };
