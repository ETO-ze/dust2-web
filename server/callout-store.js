import { writeFile, readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getCalloutDocument,
  replaceCallouts,
  normalizeDocument,
} from '../shared/map-callouts.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUNTIME_FILE = path.join(ROOT, '.runtime', 'map-callouts.json');
const SHARED_FILE = path.join(ROOT, 'shared', 'map-callouts.json');

function readJsonBody(req, limit = 8_000_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error('body too large'), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export async function loadCalloutsFromDisk() {
  for (const file of [RUNTIME_FILE, SHARED_FILE]) {
    try {
      const raw = JSON.parse(await readFile(file, 'utf8'));
      replaceCallouts(raw);
      return { ok: true, path: file, count: getCalloutDocument().points.length };
    } catch { /* try next */ }
  }
  return { ok: true, path: null, count: getCalloutDocument().points.length };
}

export async function saveCalloutsDocument(raw, { promoteShared = false } = {}) {
  const doc = normalizeDocument({
    ...raw,
    updatedAt: new Date().toISOString(),
  });
  replaceCallouts(doc);
  await mkdir(path.dirname(RUNTIME_FILE), { recursive: true });
  const text = `${JSON.stringify(doc, null, 2)}\n`;
  await writeFile(RUNTIME_FILE, text, 'utf8');
  let sharedPath = null;
  if (promoteShared) {
    await writeFile(SHARED_FILE, text, 'utf8');
    sharedPath = SHARED_FILE;
  }
  return {
    ok: true,
    document: getCalloutDocument(),
    path: RUNTIME_FILE,
    sharedPath,
    count: doc.points.length,
  };
}

/** Handle /api/dev/callouts — returns true if handled. */
export async function handleCalloutApi(req, res, requestPath) {
  if (requestPath !== '/api/dev/callouts') return false;
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Methods': 'GET,PUT,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return true;
  }
  if (req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(getCalloutDocument()));
    return true;
  }
  if (req.method === 'PUT' || req.method === 'POST') {
    try {
      const text = await readJsonBody(req);
      const raw = JSON.parse(text || '{}');
      const promoteShared = raw.promoteShared === true || requestPath.includes('promote');
      const payload = raw.document || raw;
      const saved = await saveCalloutsDocument(payload, { promoteShared });
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(saved));
    } catch (error) {
      const status = error.statusCode || 400;
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: String(error.message || error) }));
    }
    return true;
  }
  res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Method Not Allowed');
  return true;
}
