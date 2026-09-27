import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cloneThrowRecord, parsePracticeImport, sanitizePracticeName, sanitizePackId } from './practice-throws.js';

const PACK_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'practice-packs');

/** Distinct chat colors for packs (cycled). */
export const PRACTICE_PACK_COLORS = Object.freeze([
  '#7ec8e3', '#e8b86d', '#9ddea3', '#d4a5ff', '#f09595', '#a8c5ff', '#f0d878', '#8fd4c8',
]);

let cachedPacks = null;

export function practicePackColor(index) {
  return PRACTICE_PACK_COLORS[((Number(index) || 0) % PRACTICE_PACK_COLORS.length + PRACTICE_PACK_COLORS.length) % PRACTICE_PACK_COLORS.length];
}

/** Load built-in packs from shared/practice-packs/*.json (cached). */
export function loadBuiltInPracticePacks({ force = false } = {}) {
  if (cachedPacks && !force) return cachedPacks;
  const packs = [];
  let dirEntries = [];
  try {
    dirEntries = fs.readdirSync(PACK_DIR, { withFileTypes: true });
  } catch {
    cachedPacks = packs;
    return packs;
  }
  const files = dirEntries
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.json'))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b, 'en'));
  let colorIndex = 0;
  for (const file of files) {
    const stem = file.replace(/\.json$/i, '');
    const id = sanitizePackId(stem) || sanitizePackId(path.parse(file).name);
    if (!id) continue;
    let raw;
    try {
      raw = fs.readFileSync(path.join(PACK_DIR, file), 'utf8');
    } catch {
      continue;
    }
    const parsed = parsePracticeImport(raw);
    if (!parsed.ok) continue;
    let meta = {};
    try { meta = JSON.parse(raw); } catch { /* ignore */ }
    const label = sanitizePackId(meta.id || meta.label || stem) || id;
    packs.push({
      id: label,
      label,
      file,
      builtIn: true,
      color: practicePackColor(colorIndex++),
      throws: parsed.throws.map((t) => {
        const cloned = cloneThrowRecord(t);
        cloned.packId = label;
        return cloned;
      }),
    });
  }
  cachedPacks = packs;
  return packs;
}
