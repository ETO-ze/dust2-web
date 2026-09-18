import seed from './map-callouts.json' with { type: 'json' };

const num = (v, d = 0) => Number.isFinite(Number(v)) ? Number(v) : d;

/** @typedef {{id:string,name:string,nameZh?:string,x:number,y:number,z:number,kind?:string,aliases?:string[],tags?:string[],note?:string,session?:boolean}} CalloutPoint */

/** @type {{version:number,mapId:string,updatedAt:string,points:CalloutPoint[]}} */
let documentState = normalizeDocument(seed);

/** Debug-session temporary regions (not written until export). */
let sessionPoints = [];

export function slugId(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\u4e00-\u9fff]+/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

/** Stable id for Chinese-only names (slugId would otherwise be empty). */
export function regionIdFromName(nameZh, fallbackId = '') {
  const fromFallback = slugId(fallbackId);
  if (fromFallback) return fromFallback;
  const fromName = slugId(nameZh);
  if (fromName) return fromName;
  const text = String(nameZh || '').trim();
  if (!text) return '';
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `r${(h >>> 0).toString(36)}`;
}

export function normalizeDocument(raw) {
  const points = Array.isArray(raw?.points) ? raw.points.map(normalizePoint).filter(Boolean) : [];
  return {
    version: Math.max(1, Number(raw?.version) || 1),
    mapId: String(raw?.mapId || 'de_dust2'),
    updatedAt: String(raw?.updatedAt || new Date().toISOString()),
    points,
  };
}

export function normalizePoint(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const nameZh = String(raw.nameZh || raw.name || raw.id || '').trim().slice(0, 48);
  const id = regionIdFromName(nameZh, raw.id || raw.name);
  if (!id) return null;
  const name = String(raw.name || nameZh || id).trim().slice(0, 48) || id;
  const aliases = [...new Set((Array.isArray(raw.aliases) ? raw.aliases : [])
    .map(a => String(a || '').trim()).filter(Boolean))].slice(0, 12);
  const tags = [...new Set((Array.isArray(raw.tags) ? raw.tags : [])
    .map(t => String(t || '').trim().toLowerCase()).filter(Boolean))].slice(0, 12);
  return {
    id,
    name,
    nameZh: nameZh || name,
    x: +num(raw.x).toFixed(3),
    y: +num(raw.y).toFixed(3),
    z: +num(raw.z).toFixed(3),
    kind: ['area', 'anchor', 'site', 'spot', 'painted'].includes(raw.kind) ? raw.kind : 'area',
    aliases,
    tags,
    ...(raw.session ? { session: true } : {}),
    ...(Number.isFinite(Number(raw.sessionIndex)) ? { sessionIndex: Math.max(1, Math.floor(Number(raw.sessionIndex))) } : {}),
    ...(Number.isFinite(Number(raw.colorIndex)) ? { colorIndex: ((Math.floor(Number(raw.colorIndex)) % 7) + 7) % 7 } : {}),
    ...(Array.isArray(raw.cells) && raw.cells.length
      ? {
        cells: raw.cells.map((c) => (Array.isArray(c) ? `${c[0]},${c[1]}` : String(c))).slice(0, 20000),
        cellSize: Math.max(0.25, Math.min(4, num(raw.cellSize, 0.75) || 0.75)),
      }
      : {}),
    ...(raw.note ? { note: String(raw.note).slice(0, 120) } : {}),
  };
}

export function getCalloutDocument() {
  return documentState;
}

export function listCallouts() {
  return documentState.points;
}

export function listSessionCallouts() {
  return sessionPoints;
}

/** Map built-ins + session temps (session overrides same id). */
export function listAllCallouts() {
  const byId = new Map(documentState.points.map((p) => [p.id, p]));
  for (const p of sessionPoints) byId.set(p.id, p);
  return [...byId.values()].sort((a, b) => (a.nameZh || a.id).localeCompare(b.nameZh || b.id, 'zh'));
}

export function replaceCallouts(raw) {
  documentState = normalizeDocument({
    ...raw,
    updatedAt: new Date().toISOString(),
  });
  return documentState;
}

export function upsertCallout(raw) {
  const point = normalizePoint(raw);
  if (!point) return null;
  const points = documentState.points.filter(p => p.id !== point.id);
  points.push(point);
  points.sort((a, b) => a.id.localeCompare(b.id));
  documentState = { ...documentState, updatedAt: new Date().toISOString(), points };
  return point;
}

export function upsertSessionCallout(raw) {
  const point = normalizePoint({ ...raw, session: true, kind: raw.kind || 'painted' });
  if (!point) return null;
  sessionPoints = sessionPoints.filter((p) => p.id !== point.id);
  sessionPoints.push({ ...point, session: true });
  return point;
}

export function removeCallout(id) {
  const key = regionIdFromName('', id) || slugId(id) || String(id || '');
  const before = documentState.points.length;
  const points = documentState.points.filter(p => p.id !== key);
  documentState = { ...documentState, updatedAt: new Date().toISOString(), points };
  return before !== points.length;
}

export function removeSessionCallout(idOrName) {
  const target = findCallout(idOrName, { sessionOnly: true });
  if (!target) return false;
  const before = sessionPoints.length;
  sessionPoints = sessionPoints.filter((p) => p.id !== target.id);
  return sessionPoints.length !== before;
}

export function clearSessionCallouts() {
  const n = sessionPoints.length;
  sessionPoints = [];
  return n;
}

/** Replace the whole session list (draft restore). */
export function replaceSessionCallouts(rawPoints) {
  sessionPoints = (Array.isArray(rawPoints) ? rawPoints : [])
    .map((p) => normalizePoint({ ...p, session: true }))
    .filter(Boolean)
    .map((p) => ({ ...p, session: true }));
  return sessionPoints;
}

/** Match by nameZh / name / id (session first when scanning all). */
export function findCallout(label, { sessionOnly = false, mapOnly = false } = {}) {
  const q = String(label || '').trim();
  if (!q) return null;
  const pools = sessionOnly ? sessionPoints : mapOnly ? documentState.points : [...sessionPoints, ...documentState.points];
  const qId = regionIdFromName(q, q);
  return pools.find((p) =>
    p.nameZh === q || p.name === q || p.id === q || p.id === qId
      || (p.aliases || []).includes(q)) || null;
}

/** Merge session temps into the persisted document (for export). */
export function commitSessionCallouts() {
  if (!sessionPoints.length) return { count: 0, document: documentState };
  for (const p of sessionPoints) {
    const { session, ...rest } = p;
    upsertCallout({ ...rest, tags: [...new Set([...(rest.tags || []), 'painted', 'authored'])] });
  }
  const count = sessionPoints.length;
  sessionPoints = [];
  return { count, document: documentState };
}

export function calloutIndex(points = listAllCallouts()) {
  const byId = new Map();
  for (const p of points) {
    byId.set(p.id, p);
    for (const alias of p.aliases || []) byId.set(String(alias), p);
  }
  return byId;
}

export function getCalloutPoint(id, points = listAllCallouts()) {
  if (id == null) return null;
  return calloutIndex(points).get(String(id)) || calloutIndex(points).get(slugId(id)) || null;
}

export function nearestCallout(position, { maxDistance = Infinity, points = listAllCallouts() } = {}) {
  let best = null;
  for (const p of points) {
    const gap = Math.hypot(num(position?.x) - p.x, num(position?.z) - p.z);
    if (gap > maxDistance) continue;
    if (!best || gap < best.gap) best = { point: p, gap };
  }
  return best;
}

/** Prefer painted cell regions (session first), then nearest named point. */
export function calloutAt(position, { maxDistance = 18, points = listAllCallouts() } = {}) {
  const painted = points.filter((p) => Array.isArray(p.cells) && p.cells.length);
  painted.sort((a, b) => Number(!!b.session) - Number(!!a.session));
  for (const p of painted) {
    const size = num(p.cellSize, 0.75) || 0.75;
    const key = `${Math.floor(num(position?.x) / size)},${Math.floor(num(position?.z) / size)}`;
    if (p.cells.includes(key) || p.cells.some((c) => (Array.isArray(c) ? `${c[0]},${c[1]}` : String(c)) === key)) {
      return { point: p, gap: 0, painted: true };
    }
  }
  return nearestCallout(position, { maxDistance, points });
}

export function calloutLabel(point) {
  if (!point) return '';
  return point.nameZh || point.name || point.id;
}
