import * as THREE from 'three';
import { raycastWorld, floorHeight } from '../shared/physics.js';
import {
  getCalloutDocument,
  listCallouts,
  listSessionCallouts,
  listAllCallouts,
  upsertSessionCallout,
  removeSessionCallout,
  clearSessionCallouts,
  findCallout,
  commitSessionCallouts,
  regionIdFromName,
  replaceSessionCallouts,
} from '../shared/map-callouts.js';

const CELL = 0.75;
const SESSION_DRAFT_KEY = 'dust2.region-session.v1';

/** Prefer window.document — never shadow with callout JSON named `document`. */
const dom = () => globalThis.document;

/** 7 debug paint colors — index 0 white, then cycle (1→white … 8→white). */
export const REGION_PALETTE = Object.freeze([
  { hex: 0xffffff, css: '#ffffff', name: '白' },
  { hex: 0xff4d4d, css: '#ff4d4d', name: '红' },
  { hex: 0xffb84d, css: '#ffb84d', name: '橙' },
  { hex: 0xfff04d, css: '#fff04d', name: '黄' },
  { hex: 0x4dff88, css: '#4dff88', name: '绿' },
  { hex: 0x4db8ff, css: '#4db8ff', name: '蓝' },
  { hex: 0xd24dff, css: '#d24dff', name: '紫' },
]);

const LOCAL_WHITE = 0xffffff;

function cellKey(x, z, size = CELL) {
  return `${Math.floor(x / size)},${Math.floor(z / size)}`;
}

function cellCenter(key, size = CELL) {
  const [ix, iz] = key.split(',').map(Number);
  return { x: (ix + 0.5) * size, z: (iz + 0.5) * size };
}

function parseListArgs(args) {
  const tokens = String(args || '').trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return { action: 'list' };
  const lower = tokens.map((t) => t.toLowerCase());
  const renameIdx = lower.indexOf('rename');
  if (renameIdx >= 0) {
    return {
      action: 'rename',
      target: tokens.slice(0, renameIdx).join(' '),
      newName: tokens.slice(renameIdx + 1).join(' '),
    };
  }
  const last = lower[lower.length - 1];
  if (['delete', 'remake'].includes(last)) {
    return { action: last, target: tokens.slice(0, -1).join(' ') };
  }
  return { action: 'list', filter: tokens.join(' ') };
}

function makeMat(hex, opacity) {
  return new THREE.MeshBasicMaterial({
    color: hex,
    transparent: true,
    opacity,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

function makeLabelSprite(text, cssColor) {
  const canvas = dom().createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 128, 128);
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.beginPath();
  ctx.arc(64, 64, 52, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = cssColor || '#fff';
  ctx.font = 'bold 64px Segoe UI, Microsoft YaHei, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(text).slice(0, 3), 64, 68);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(1.6, 1.6, 1);
  sprite.userData.dispose = () => {
    tex.dispose();
    mat.dispose();
  };
  return sprite;
}

/** Crosshair brush painter: 7-color numbered session temps until export. */
export class RegionPainter {
  constructor({ scene, camera, toast = () => {}, system = () => {}, systemHtml = null } = {}) {
    this.scene = scene;
    this.camera = camera;
    this.toast = toast;
    this.system = system;
    this.systemHtml = systemHtml || ((html, plain) => system(plain || html.replace(/<[^>]+>/g, '')));
    this.active = false;
    this.nameZh = '';
    this.sessionSeq = 1;
    this.brushIndex = 1;
    this.brushColorIndex = 0;
    this.showMode = 'temp'; // temp | all | local | off
    this.cells = new Set();
    this.group = new THREE.Group();
    this.committed = new THREE.Group();
    this.localGroup = new THREE.Group();
    this.labels = new THREE.Group();
    this.group.visible = false;
    this.committed.visible = true;
    this.localGroup.visible = false;
    this.labels.visible = true;
    this.meshes = new Map();
    /** @type {Map<string, {mesh: THREE.Mesh, regionId: string}>} */
    this.committedMeshes = new Map();
    this.localMeshes = new Map();
    this.labelSprites = new Map();
    this.paletteMats = REGION_PALETTE.map((c) => makeMat(c.hex, 0.5));
    this.paletteCommitMats = REGION_PALETTE.map((c) => makeMat(c.hex, 0.38));
    this.localMat = makeMat(LOCAL_WHITE, 0.28);
    this._geo = new THREE.PlaneGeometry(CELL * 0.92, CELL * 0.92);
    this.scene?.add(this.group, this.committed, this.localGroup, this.labels);
    this.lastPaintAt = 0;
    this._restoreDraft();
    this._applyShowMode();
  }

  _persistDraft() {
    try {
      const points = listSessionCallouts();
      if (!points.length) {
        localStorage.removeItem(SESSION_DRAFT_KEY);
        return;
      }
      localStorage.setItem(SESSION_DRAFT_KEY, JSON.stringify({
        savedAt: new Date().toISOString(),
        sessionSeq: this.sessionSeq,
        points,
      }));
    } catch { /* quota */ }
  }

  _clearDraft() {
    try { localStorage.removeItem(SESSION_DRAFT_KEY); } catch { /* ignore */ }
  }

  _restoreDraft() {
    try {
      const raw = localStorage.getItem(SESSION_DRAFT_KEY);
      if (!raw) return;
      const draft = JSON.parse(raw);
      const points = Array.isArray(draft?.points) ? draft.points : [];
      if (!points.length) return;
      replaceSessionCallouts(points);
      this.sessionSeq = Math.max(1, Number(draft.sessionSeq) || (points.length + 1));
      for (const p of listSessionCallouts()) {
        if (!p.cells?.length) continue;
        const colorIndex = p.colorIndex ?? ((p.sessionIndex || 1) - 1) % 7;
        const mat = this.paletteCommitMats[((colorIndex % 7) + 7) % 7];
        for (const key of p.cells) {
          const k = String(key);
          if (this.committedMeshes.has(k)) continue;
          const c = cellCenter(k, p.cellSize || CELL);
          const floor = floorHeight(c.x, c.z, 40, 80);
          const mesh = new THREE.Mesh(this._geo, mat);
          mesh.rotation.x = -Math.PI / 2;
          mesh.position.set(c.x, (floor ?? p.y ?? 0) + 0.04, c.z);
          this.committed.add(mesh);
          this.committedMeshes.set(k, { mesh, regionId: p.id, colorIndex });
        }
        this._placeLabel(p);
      }
      this.showMode = 'temp';
      this.system(`已从浏览器草稿恢复 ${points.length} 个临时区域（上次 ${draft.savedAt || ''}）`);
      this.toast(`恢复 ${points.length} 临时区`);
    } catch {
      this._clearDraft();
    }
  }

  isActive() {
    return this.active;
  }

  _palette(i) {
    return REGION_PALETTE[((i % 7) + 7) % 7];
  }

  start() {
    this.active = true;
    this.brushIndex = this.sessionSeq;
    this.brushColorIndex = (this.brushIndex - 1) % 7;
    this.nameZh = String(this.brushIndex);
    this.cells.clear();
    this._clearBrush();
    this.group.visible = true;
    this.showMode = this.showMode === 'off' ? 'temp' : this.showMode;
    this._applyShowMode();
    const pal = this._palette(this.brushColorIndex);
    this.system(`区域 #${this.brushIndex} · ${pal.name}色 · 准星涂色 · 右键擦除 · /name 名 结束`);
    this.toast(`#${this.brushIndex} ${pal.name}`);
  }

  cancel() {
    if (!this.active) return;
    this.active = false;
    this.nameZh = '';
    this.cells.clear();
    this._clearBrush();
    this.group.visible = false;
    this.system('已取消当前笔刷（临时区仍在 · /clear all 可清空）');
  }

  /** Name the active brush and immediately finish it (no separate /end). */
  setName(nameZh) {
    this.nameZh = String(nameZh || '').trim().slice(0, 48);
    if (!this.active) {
      this.system('请先 /region 开始绘制');
      return false;
    }
    if (!this.nameZh) {
      this.system('名称不能为空 · 用法：/name 中门');
      return false;
    }
    try {
      return this.end();
    } catch (err) {
      this.system(String(err.message || err));
      return false;
    }
  }

  update(now = performance.now(), { erase = false } = {}) {
    if (!this.active || !this.camera) return;
    if (now - this.lastPaintAt < 40) return;
    this.lastPaintAt = now;
    const origin = this.camera.position;
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion).normalize();
    const hit = raycastWorld(
      { x: origin.x, y: origin.y, z: origin.z },
      { x: dir.x, y: dir.y, z: dir.z },
      80,
    );
    if (hit == null) return;
    const px = origin.x + dir.x * hit;
    const py = origin.y + dir.y * hit;
    const pz = origin.z + dir.z * hit;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const x = px + dx * CELL * 0.55;
        const z = pz + dz * CELL * 0.55;
        if (erase) this._erase(x, z);
        else this._paint(x, py, z);
      }
    }
  }

  _brushMat() {
    return this.paletteMats[this.brushColorIndex];
  }

  _paint(x, y, z) {
    const key = cellKey(x, z);
    if (this.cells.has(key) || this.committedMeshes.has(key)) return;
    this.cells.add(key);
    const c = cellCenter(key);
    const floor = floorHeight(c.x, c.z, Math.max(y + 4, 8), 40);
    const mesh = new THREE.Mesh(this._geo, this._brushMat());
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(c.x, (floor ?? y) + 0.04, c.z);
    this.group.add(mesh);
    this.meshes.set(key, mesh);
  }

  _erase(x, z) {
    const key = cellKey(x, z);
    if (!this.cells.has(key)) return;
    this.cells.delete(key);
    const mesh = this.meshes.get(key);
    if (!mesh) return;
    this.group.remove(mesh);
    this.meshes.delete(key);
  }

  _clearBrush() {
    for (const mesh of this.meshes.values()) this.group.remove(mesh);
    this.meshes.clear();
  }

  _commitMeshes(regionId, colorIndex) {
    const mat = this.paletteCommitMats[((colorIndex % 7) + 7) % 7];
    for (const [key, mesh] of this.meshes) {
      this.group.remove(mesh);
      mesh.material = mat;
      this.committed.add(mesh);
      this.committedMeshes.set(key, { mesh, regionId, colorIndex });
    }
    this.meshes.clear();
  }

  _removeCommittedByRegion(regionId) {
    for (const [key, entry] of [...this.committedMeshes]) {
      if (entry.regionId !== regionId) continue;
      this.committed.remove(entry.mesh);
      this.committedMeshes.delete(key);
    }
    this._removeLabel(regionId);
  }

  _clearCommittedVisuals() {
    for (const entry of this.committedMeshes.values()) this.committed.remove(entry.mesh);
    this.committedMeshes.clear();
    this._clearLabels();
  }

  _clearLocalVisuals() {
    for (const mesh of this.localMeshes.values()) this.localGroup.remove(mesh);
    this.localMeshes.clear();
  }

  _removeLabel(regionId) {
    const s = this.labelSprites.get(regionId);
    if (!s) return;
    this.labels.remove(s);
    s.userData.dispose?.();
    this.labelSprites.delete(regionId);
  }

  _clearLabels() {
    for (const id of [...this.labelSprites.keys()]) this._removeLabel(id);
  }

  _placeLabel(point) {
    this._removeLabel(point.id);
    const idx = Number(point.sessionIndex) || Number(point.nameZh) || 1;
    const colorIndex = Number.isFinite(point.colorIndex) ? point.colorIndex : (idx - 1) % 7;
    const pal = this._palette(colorIndex);
    const sprite = makeLabelSprite(point.nameZh || String(idx), pal.css);
    sprite.position.set(point.x, (point.y || 0) + 1.2, point.z);
    this.labels.add(sprite);
    this.labelSprites.set(point.id, sprite);
  }

  _rebuildLocalOverlays() {
    this._clearLocalVisuals();
    const locals = listCallouts().filter((p) => Array.isArray(p.cells) && p.cells.length && !p.session);
    for (const p of locals) {
      for (const key of p.cells) {
        const k = String(key);
        if (this.localMeshes.has(k) || this.committedMeshes.has(k)) continue;
        const c = cellCenter(k, p.cellSize || CELL);
        const floor = floorHeight(c.x, c.z, 40, 80);
        const mesh = new THREE.Mesh(this._geo, this.localMat);
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.set(c.x, (floor ?? p.y ?? 0) + 0.03, c.z);
        this.localGroup.add(mesh);
        this.localMeshes.set(k, mesh);
      }
    }
  }

  _applyShowMode() {
    const mode = this.showMode;
    const showTemp = mode === 'temp' || mode === 'all';
    const showLocal = mode === 'local' || mode === 'all';
    this.committed.visible = showTemp;
    this.labels.visible = showTemp;
    this.localGroup.visible = showLocal;
    if (showLocal) this._rebuildLocalOverlays();
    else this._clearLocalVisuals();
    // Point-only locals: white label when showing local/all
    if (showLocal) {
      for (const p of listCallouts()) {
        if (p.session || (p.cells && p.cells.length)) continue;
        if (this.labelSprites.has(`local:${p.id}`)) continue;
        const sprite = makeLabelSprite(p.nameZh || p.name || p.id, '#ffffff');
        sprite.position.set(p.x, (p.y || 0) + 1.2, p.z);
        sprite.userData.localPoint = true;
        this.labels.add(sprite);
        this.labelSprites.set(`local:${p.id}`, sprite);
      }
      this.labels.visible = true;
    } else {
      for (const id of [...this.labelSprites.keys()]) {
        if (String(id).startsWith('local:')) this._removeLabel(id);
      }
    }
  }

  setShowMode(mode) {
    const next = String(mode || '').trim().toLowerCase();
    if (!['temp', 'all', 'local', 'off'].includes(next)) {
      this.system('用法：/rshow temp | /rshow all | /rshow local');
      return false;
    }
    this.showMode = next;
    this._applyShowMode();
    if (next === 'temp') this.system('显示：当局临时区域（七色 + 编号）');
    else if (next === 'all') this.system('显示：全部 · 临时=彩色编号 · 本地=白色');
    else if (next === 'local') this.system('显示：仅本地区域（白色）');
    else this.system('已关闭区域叠加显示');
    this.toast(`/rshow ${next}`);
    return true;
  }

  end() {
    if (!this.active) {
      this.system('当前没有进行中的区域绘制 · 先 /region');
      return null;
    }
    if (!this.cells.size) {
      this.system('还没有涂到任何格子，继续用准星扫地面');
      return null;
    }
    if (!this.nameZh) this.nameZh = String(this.brushIndex);
    const keys = [...this.cells];
    let sx = 0;
    let sz = 0;
    let sy = 0;
    let n = 0;
    for (const key of keys) {
      const c = cellCenter(key);
      const floor = floorHeight(c.x, c.z, 40, 80);
      sx += c.x;
      sz += c.z;
      sy += floor ?? 0;
      n++;
    }
    const sessionIndex = this.brushIndex;
    const colorIndex = this.brushColorIndex;
    const id = regionIdFromName(this.nameZh, `n${sessionIndex}`);
    this._removeCommittedByRegion(id);
    removeSessionCallout(id);
    const point = upsertSessionCallout({
      id,
      name: id,
      nameZh: this.nameZh,
      x: sx / n,
      y: sy / n,
      z: sz / n,
      kind: 'painted',
      aliases: [String(sessionIndex)],
      tags: ['hud', 'bot', 'authored', 'painted', 'session'],
      cells: keys,
      cellSize: CELL,
      sessionIndex,
      colorIndex,
    });
    this._commitMeshes(id, colorIndex);
    this._placeLabel(point);
    this.cells.clear();
    this.nameZh = '';
    this.active = false;
    this.group.visible = false;
    this.sessionSeq = Math.max(this.sessionSeq, sessionIndex + 1);
    this.showMode = this.showMode === 'off' ? 'temp' : this.showMode;
    this._applyShowMode();
    const pal = this._palette(colorIndex);
    this.system(`已记下 #${sessionIndex}「${point.nameZh}」· ${pal.name}色 · ${keys.length} 格 · HUD 已同步 · 下一片 /region`);
    this.toast(`#${sessionIndex} ${point.nameZh}`);
    this._persistDraft();
    return point;
  }

  handleList(args = '') {
    const parsed = parseListArgs(args);
    if (parsed.action === 'list') return this.listRegions(parsed.filter);
    if (parsed.action === 'delete') return this.deleteRegion(parsed.target);
    if (parsed.action === 'remake') return this.remakeRegion(parsed.target);
    if (parsed.action === 'rename') return this.renameRegion(parsed.target, parsed.newName);
    return false;
  }

  listRegions(filter = '') {
    const all = listAllCallouts();
    const q = String(filter || '').trim();
    const rows = q
      ? all.filter((p) => (p.nameZh || '').includes(q) || (p.name || '').includes(q) || p.id.includes(q)
        || String(p.sessionIndex || '') === q)
      : all;
    if (!rows.length) {
      this.system(q ? `没有匹配「${q}」的区域` : '地图尚无区域命名');
      return false;
    }
    const parts = rows.map((p) => {
      const label = p.nameZh || p.name || p.id;
      const cells = p.cells?.length ? `${p.cells.length}格` : '点';
      if (p.session) {
        const pal = this._palette(p.colorIndex ?? ((p.sessionIndex || 1) - 1));
        return `<span class="region-temp">#${p.sessionIndex || '?'} ${label}[${cells}·${pal.name}]</span>`;
      }
      return `<span class="region-local">${label}[${cells}·本地]</span>`;
    });
    this.systemHtml(`区域 ${rows.length}：${parts.join(' · ')}`, `区域 ${rows.length}`);
    this.system('操作：/rlist 名 delete|remake|rename · /rshow temp|all|local · /clear all');
    return true;
  }

  deleteRegion(label) {
    const name = String(label || '').trim();
    if (!name) {
      this.system('用法：/rlist 区域名 delete');
      return false;
    }
    const hit = findCallout(name) || findCallout(name, { sessionOnly: true });
    if (!hit) {
      this.system(`未找到区域「${name}」`);
      return false;
    }
    if (!hit.session) {
      this.system(`「${hit.nameZh}」是本地/地图区域，不能 delete · 仅临时可用`);
      return false;
    }
    removeSessionCallout(hit.id);
    this._removeCommittedByRegion(hit.id);
    this._persistDraft();
    this.system(`已删除临时 #${hit.sessionIndex || ''}「${hit.nameZh}」`);
    this.toast(`已删 ${hit.nameZh}`);
    return true;
  }

  remakeRegion(label) {
    const name = String(label || '').trim();
    if (!name) {
      this.system('用法：/rlist 区域名 remake');
      return false;
    }
    const hit = findCallout(name);
    if (!hit) {
      this.system(`未找到区域「${name}」`);
      return false;
    }
    if (!hit.cells?.length) {
      this.system(`「${hit.nameZh}」没有格子，无法 remake`);
      return false;
    }
    if (hit.session) {
      this.brushIndex = hit.sessionIndex || this.sessionSeq;
      this.brushColorIndex = hit.colorIndex ?? ((this.brushIndex - 1) % 7);
      removeSessionCallout(hit.id);
      this._removeCommittedByRegion(hit.id);
    } else {
      this.brushIndex = this.sessionSeq;
      this.brushColorIndex = (this.brushIndex - 1) % 7;
    }
    this.active = true;
    this.nameZh = hit.nameZh || hit.name;
    this.cells.clear();
    this._clearBrush();
    this.group.visible = true;
    for (const key of hit.cells) {
      const c = cellCenter(String(key), hit.cellSize || CELL);
      const floor = floorHeight(c.x, c.z, 40, 80);
      this.cells.add(String(key));
      const mesh = new THREE.Mesh(this._geo, this._brushMat());
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(c.x, (floor ?? 0) + 0.04, c.z);
      this.group.add(mesh);
      this.meshes.set(String(key), mesh);
    }
    this.showMode = 'temp';
    this._applyShowMode();
    this.system(`重绘「${this.nameZh}」· #${this.brushIndex} ${this._palette(this.brushColorIndex).name}色`);
    this.toast(`重绘 ${this.nameZh}`);
    return true;
  }

  renameRegion(label, newName) {
    const name = String(label || '').trim();
    const next = String(newName || '').trim().slice(0, 48);
    if (!name || !next) {
      this.system('用法：/rlist 区域名 rename 新名');
      return false;
    }
    const hit = findCallout(name);
    if (!hit?.session) {
      this.system(hit ? `「${hit.nameZh}」不是临时区域` : `未找到「${name}」`);
      return false;
    }
    const oldId = hit.id;
    removeSessionCallout(oldId);
    const renamed = upsertSessionCallout({
      ...hit,
      id: regionIdFromName(next, `n${hit.sessionIndex || 1}`),
      name: regionIdFromName(next, `n${hit.sessionIndex || 1}`),
      nameZh: next,
      session: true,
      sessionIndex: hit.sessionIndex,
      colorIndex: hit.colorIndex,
    });
    for (const [key, entry] of this.committedMeshes) {
      if (entry.regionId === oldId) this.committedMeshes.set(key, { ...entry, regionId: renamed.id });
    }
    this._removeLabel(oldId);
    this._placeLabel(renamed);
    this._persistDraft();
    this.system(`已重命名：${hit.nameZh} → ${renamed.nameZh}（#${renamed.sessionIndex}）`);
    this.toast(renamed.nameZh);
    return true;
  }

  clearAll({ discardDraft = true } = {}) {
    const n = clearSessionCallouts();
    this._clearCommittedVisuals();
    this._clearBrush();
    this.cells.clear();
    this.nameZh = '';
    this.active = false;
    this.group.visible = false;
    this.sessionSeq = 1;
    if (discardDraft) this._clearDraft();
    this._applyShowMode();
    this.system(n ? `已清除当局 ${n} 个临时区域（地图/本地保留）` : '当局没有临时区域');
    this.toast('临时区域已清空');
    return n;
  }

  listPainted() {
    return listAllCallouts().filter((p) => p.kind === 'painted' || (p.cells && p.cells.length));
  }

  listSession() {
    return listSessionCallouts();
  }

  hasPendingExport() {
    return listSessionCallouts().length > 0;
  }

  _buildExportDocument() {
    const session = listSessionCallouts();
    const base = getCalloutDocument();
    const byId = new Map(base.points.map((p) => [p.id, p]));
    for (const p of session) {
      const { session: _s, ...rest } = p;
      byId.set(p.id, { ...rest, tags: [...new Set([...(rest.tags || []), 'painted', 'authored'])] });
    }
    return {
      ...base,
      updatedAt: new Date().toISOString(),
      points: [...byId.values()].sort((a, b) => a.id.localeCompare(b.id)),
    };
  }

  _downloadJson(text, filename = 'map-callouts.json') {
    try {
      const blob = new Blob([text], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = dom().createElement('a');
      a.href = url;
      a.download = filename;
      a.rel = 'noopener';
      dom().body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      return true;
    } catch {
      return false;
    }
  }

  async _saveRuntime(calloutDoc, { keepalive = false } = {}) {
    const body = JSON.stringify({ document: calloutDoc, promoteShared: false });
    const res = await fetch('/api/dev/callouts', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: !!keepalive,
    });
    if (!res.ok) {
      let detail = '';
      try {
        const payload = await res.json();
        detail = payload?.error ? `: ${payload.error}` : '';
      } catch { /* ignore */ }
      throw new Error(`保存到 .runtime 失败 (${res.status})${detail}`);
    }
    return res;
  }

  /**
   * Merge session temps into local map + optional .runtime / JSON download.
   * Never clears temps until runtime save (or saveRuntime:false) succeeds.
   * Download failure alone does not fail the export.
   */
  async exportRegions({ saveRuntime = true, download = true, keepalive = false } = {}) {
    const session = listSessionCallouts();
    const hasLocalPainted = listCallouts().some((p) => p.kind === 'painted' || p.cells?.length);
    if (!session.length && !hasLocalPainted) {
      this.system('还没有可导出的区域 · 先 /region · /name 名');
      this.toast('没有区域可导出');
      return { ok: false, count: 0, reason: 'empty' };
    }
    if (!session.length && hasLocalPainted && !download) {
      this.system('没有新的临时区域；本地区域已在 .runtime / 地图里');
      this.toast('没有新的临时区');
      return { ok: true, count: 0, saved: false, names: [] };
    }

    this._persistDraft();
    const count = session.length;
    const calloutDoc = this._buildExportDocument();
    const names = calloutDoc.points
      .filter((p) => p.kind === 'painted' || p.cells?.length)
      .map((p) => p.nameZh || p.name || p.id);
    const text = `${JSON.stringify(calloutDoc, null, 2)}\n`;

    try {
      // Prefer disk write first — that is what updates local map naming.
      if (saveRuntime && count > 0) {
        await this._saveRuntime(calloutDoc, { keepalive });
      }

      let downloaded = false;
      if (download) {
        downloaded = this._downloadJson(text);
        if (!downloaded) this.system('浏览器拦截了 JSON 下载（本地 .runtime 已照常写入）');
      }

      if (count > 0) {
        commitSessionCallouts();
        this._clearCommittedVisuals();
        this.sessionSeq = 1;
        this._clearDraft();
        this._applyShowMode();
      }

      const bits = [];
      if (count) bits.push(`合并 ${count} 临时 → 绘制 ${names.length}`);
      if (saveRuntime && count) bits.push('已写入 .runtime');
      if (downloaded) bits.push('已下载 JSON');
      this.system(`已导出：${bits.join(' · ') || '完成'}`);
      this.toast(count ? '已导出区域命名' : '已下载区域 JSON');
      return {
        ok: true,
        count: names.length,
        merged: count,
        saved: !!(saveRuntime && count),
        downloaded,
        names,
      };
    } catch (err) {
      this._persistDraft();
      const msg = String(err.message || err);
      this.system(`导出失败，临时区域已保留（可重试「导出」或「导出并退出」）：${msg}`);
      this.toast('导出失败 · 临时区仍在');
      return { ok: false, count: 0, error: msg };
    }
  }

  dispose() {
    this._clearBrush();
    this._clearCommittedVisuals();
    this._clearLocalVisuals();
    clearSessionCallouts();
    this.group.removeFromParent();
    this.committed.removeFromParent();
    this.localGroup.removeFromParent();
    this.labels.removeFromParent();
    this._geo.dispose();
    for (const m of [...this.paletteMats, ...this.paletteCommitMats, this.localMat]) m.dispose();
  }
}

export { CELL as REGION_CELL_SIZE, cellKey, cellCenter, parseListArgs };
