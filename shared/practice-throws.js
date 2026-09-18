/** Utility-practice throw records — shape aligned for later bot lineup training. */

/** Hotkeys in practice mode: 1 HE · 2 flash · 3 smoke · 4 fire. */
export const PRACTICE_KIT = Object.freeze(['hegrenade', 'flashbang', 'smokegrenade', 'molotov']);
export const PRACTICE_AMMO = 99;
export const PRACTICE_KEY_LABELS = Object.freeze(['雷', '闪', '烟', '火']);

export function practiceUtilityAt(index) {
  return PRACTICE_KIT[Math.max(0, Math.min(PRACTICE_KIT.length - 1, Number(index) || 0))] || 'hegrenade';
}

export function sanitizePracticeName(raw) {
  return String(raw || '')
    .trim()
    .replace(/[\u0000-\u001f\u007f<>"/\\|*?]/g, '')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

/** Short pack / export id: letters, digits, dash; max 24. */
export function sanitizePackId(raw) {
  return String(raw || '')
    .trim()
    .replace(/\.json$/i, '')
    .replace(/[\u0000-\u001f\u007f<>"/\\|*?.\s]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
    .toLowerCase() || '';
}

export function practiceExportFilename(count, { packId = '' } = {}) {
  const n = Math.max(0, Math.floor(Number(count) || 0));
  const id = sanitizePackId(packId);
  return id ? `${id}-${n}.json` : `practice-${n}.json`;
}

export function cloneThrowRecord(entry) {
  if (!entry) return null;
  return {
    name: entry.name,
    weapon: entry.weapon,
    team: entry.team || 'T',
    stand: { x: entry.stand.x, y: entry.stand.y, z: entry.stand.z },
    yaw: entry.yaw,
    pitch: entry.pitch,
    throwMode: entry.throwMode === 'drop' ? 'drop' : entry.throwMode === 'lob' ? 'lob' : 'full',
    throwStrength: Number.isFinite(entry.throwStrength) ? entry.throwStrength : 1,
    jumpThrow: !!entry.jumpThrow,
    crouch: !!entry.crouch,
    velocity: entry.velocity
      ? { x: entry.velocity.x, y: entry.velocity.y, z: entry.velocity.z }
      : { x: 0, y: 0, z: 0 },
    impacts: Array.isArray(entry.impacts) ? entry.impacts.map((i) => ({ ...i })) : [],
    recordedAt: entry.recordedAt || 0,
    ...(entry.packId ? { packId: entry.packId } : {}),
    ...(entry.tape ? { tape: cloneThrowTape(entry.tape) } : {}),
  };
}

/** Clone press→release motion tape (optional on legacy records). */
export function cloneThrowTape(tape) {
  if (!tape || !Array.isArray(tape.frames) || !tape.frames.length) return null;
  return {
    version: 1,
    durationMs: Math.max(0, Math.round(Number(tape.durationMs) || tape.frames[tape.frames.length - 1]?.t || 0)),
    frames: tape.frames.map((f) => ({
      t: Math.round(Number(f.t) || 0),
      x: Number(f.x) || 0,
      y: Number(f.y) || 0,
      z: Number(f.z) || 0,
      yaw: Number(f.yaw) || 0,
      pitch: Number(f.pitch) || 0,
      vx: Number(f.vx) || 0,
      vy: Number(f.vy) || 0,
      vz: Number(f.vz) || 0,
      fwd: Number(f.fwd) || 0,
      right: Number(f.right) || 0,
      walk: !!f.walk,
      jump: !!f.jump,
      crouch: !!f.crouch,
      fire: !!f.fire,
      fire2: !!f.fire2,
      grounded: !!f.grounded,
      jumpId: Number.isFinite(f.jumpId) ? f.jumpId : 0,
    })),
  };
}

export function serializePracticeExport(entries, { room = '', mode = 'utility' } = {}) {
  const list = (Array.isArray(entries) ? entries : []).map(cloneThrowRecord).filter(Boolean);
  return {
    type: 'dust2-practice-throws',
    version: 1,
    exportedAt: new Date().toISOString(),
    room,
    mode,
    count: list.length,
    throws: list,
  };
}

/** Accept exported JSON, a bare throws array, or a single throw object. */
export function parsePracticeImport(raw) {
  let data = raw;
  if (typeof raw === 'string') {
    try { data = JSON.parse(raw); }
    catch { return { ok: false, error: 'JSON 解析失败' }; }
  }
  if (!data || typeof data !== 'object') return { ok: false, error: '无效的道具练习文件' };
  let list;
  if (data.type === 'dust2-practice-throws' && Array.isArray(data.throws)) list = data.throws;
  else if (Array.isArray(data)) list = data;
  else if (Array.isArray(data.throws)) list = data.throws;
  else if (data.weapon && data.stand) list = [data];
  else return { ok: false, error: '需要 dust2-practice-throws 格式或 throws 数组' };

  const throws = [];
  const seen = new Set();
  for (const entry of list) {
    const cloned = cloneThrowRecord(entry);
    if (!cloned?.weapon || !cloned.stand || !Number.isFinite(cloned.stand.x)) continue;
    const name = sanitizePracticeName(cloned.name);
    if (!name) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    cloned.name = name;
    throws.push(cloned);
  }
  if (!throws.length) return { ok: false, error: '文件里没有可用的道具点' };
  return { ok: true, throws, count: throws.length };
}
