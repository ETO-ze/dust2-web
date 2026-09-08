#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, open, readFile, realpath, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_ROOT = path.join(PROJECT_ROOT, 'public', 'assets');
const DEFAULT_LOCK = path.join(PROJECT_ROOT, 'config', 'assets-lock.json');

export function validateAssetPath(value) {
  if (typeof value !== 'string' || !value.startsWith('assets/')) throw new Error(`Asset path must start with assets/: ${value}`);
  const parts = value.slice(7).split('/');
  if (!parts.length || parts.some(part => !/^[A-Za-z0-9_.-]+$/.test(part) || part === '.' || part === '..' || part.endsWith('.') || /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(part))) {
    throw new Error(`Unsafe asset path: ${value}`);
  }
  return parts;
}

export function validateLock(lock) {
  if (!lock || lock.schemaVersion !== 1 || !Array.isArray(lock.files)) throw new Error('Unsupported assets lock file');
  const names = new Set();
  for (const entry of lock.files) {
    validateAssetPath(entry.path);
    if (!Number.isSafeInteger(entry.bytes) || entry.bytes < 0 || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error(`Invalid size/hash: ${entry.path}`);
    if (names.has(entry.path.toLowerCase())) throw new Error(`Duplicate asset path: ${entry.path}`);
    names.add(entry.path.toLowerCase());
  }
  return lock;
}

async function optionalStat(target) {
  try { return await lstat(target); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

// Reject symlinks/junctions before reading, creating, or replacing a target.
// Checking every ancestor also prevents public/ or assets/ from redirecting writes.
export async function assetDestination(root, assetPath, { create = false } = {}) {
  const parts = validateAssetPath(assetPath);
  const absoluteRoot = path.resolve(root);
  const target = path.resolve(absoluteRoot, ...parts);
  if (!target.startsWith(absoluteRoot + path.sep)) throw new Error(`Asset escapes root: ${assetPath}`);
  const parsed = path.parse(target);
  let current = parsed.root;
  const segments = target.slice(parsed.root.length).split(path.sep);
  for (let index = 0; index < segments.length; index++) {
    current = path.join(current, segments[index]);
    const final = index === segments.length - 1;
    let status = await optionalStat(current);
    if (!status && !final && create) {
      try { await mkdir(current); } catch (error) { if (error.code !== 'EEXIST') throw error; }
      status = await lstat(current);
    }
    if (status?.isSymbolicLink()) throw new Error(`Symlink/junction is not allowed in asset path: ${current}`);
    if (status && !(final ? status.isFile() : status.isDirectory())) throw new Error(`Unexpected file type in asset path: ${current}`);
  }
  const rootStatus = await optionalStat(absoluteRoot);
  if (rootStatus) {
    const resolvedRoot = await realpath(absoluteRoot);
    const parentStatus = await optionalStat(path.dirname(target));
    if (parentStatus) {
      const relative = path.relative(resolvedRoot, await realpath(path.dirname(target)));
      if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new Error(`Asset escapes real root: ${assetPath}`);
    }
  }
  return target;
}

async function matchesFile(target, entry) {
  const status = await optionalStat(target);
  if (!status || status.size !== entry.bytes) return false;
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(target)) hash.update(chunk);
  return hash.digest('hex') === entry.sha256;
}

function downloadURL(baseURL, entry) {
  const base = new URL(baseURL);
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw new Error('Asset mirror must be an HTTP(S) URL without credentials, query, or fragment');
  if (!base.pathname.endsWith('/')) base.pathname += '/';
  const url = new URL(entry.path, base);
  url.searchParams.set('v', entry.sha256);
  return url;
}

export async function syncAsset(entry, { root = DEFAULT_ROOT, baseURL, check = false, fetchImpl = fetch, timeoutMs = 120_000 } = {}) {
  validateLock({ schemaVersion: 1, files: [entry] });
  let target = await assetDestination(root, entry.path);
  if (await matchesFile(target, entry)) return { path: entry.path, status: 'skipped', bytes: entry.bytes };
  if (check) throw new Error(`Missing or modified asset: ${entry.path}`);
  const url = downloadURL(baseURL, entry);
  target = await assetDestination(root, entry.path, { create: true });
  const temporary = `${target}.${randomUUID()}.part`;
  let handle;
  try {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok || !response.body) throw new Error(`HTTP ${response.status} downloading ${entry.path}`);
    handle = await open(temporary, 'wx');
    const hash = createHash('sha256');
    let bytes = 0;
    for await (const chunk of response.body) {
      bytes += chunk.length;
      if (bytes > entry.bytes) throw new Error(`Size mismatch for ${entry.path}: expected ${entry.bytes}, received more`);
      hash.update(chunk);
      let offset = 0;
      while (offset < chunk.length) {
        const written = await handle.write(chunk, offset, chunk.length - offset);
        if (!written.bytesWritten) throw new Error(`Could not write ${entry.path}`);
        offset += written.bytesWritten;
      }
    }
    if (bytes !== entry.bytes || hash.digest('hex') !== entry.sha256) throw new Error(`Size/SHA-256 mismatch for ${entry.path}`);
    await handle.sync();
    await handle.close();
    handle = null;
    await assetDestination(root, entry.path);
    await rename(temporary, target);
    return { path: entry.path, status: 'downloaded', bytes };
  } finally {
    await handle?.close().catch(() => {});
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

export async function syncAssets(lock, { concurrency = 4, onProgress = () => {}, ...options } = {}) {
  validateLock(lock); // Validate the whole manifest before making any changes.
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16) throw new Error('Concurrency must be between 1 and 16');
  const result = { total: lock.files.length, totalBytes: lock.files.reduce((sum, entry) => sum + entry.bytes, 0), downloaded: 0, skipped: 0, errors: [] };
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, lock.files.length) }, async () => {
    while (next < lock.files.length) {
      const entry = lock.files[next++];
      try {
        const status = await syncAsset(entry, { baseURL: lock.baseURL, ...options });
        result[status.status]++;
        onProgress(status, result);
      } catch (error) {
        const failure = { path: entry.path, message: error.message };
        result.errors.push(failure);
        onProgress({ ...failure, status: 'error' }, result);
      }
    }
  }));
  return result;
}

async function main() {
  const args = process.argv.slice(2);
  const options = {};
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--check') options.check = true;
    else if (args[index] === '--base-url' && args[index + 1]) options.baseURL = args[++index];
    else if (args[index] === '--help' || args[index] === '-h') {
      console.log('Usage: node scripts/fetch-assets.mjs [--check] [--base-url https://mirror.example/dust2/]\nRestores locked assets to public/assets with four parallel transfers.\n--check verifies local files without downloading or changing anything.');
      return;
    } else throw new Error(`Unknown or incomplete option: ${args[index]}`);
  }
  const lock = JSON.parse(await readFile(DEFAULT_LOCK, 'utf8'));
  console.log(`${options.check ? 'Checking' : 'Restoring'} ${lock.files.length} locked assets (${(lock.totalBytes / 1048576).toFixed(1)} MiB).`);
  let reported = 0;
  const result = await syncAssets(lock, { ...options, onProgress(status, progress) {
    if (status.status === 'error') console.error(`${status.path}: ${status.message}`);
    const completed = progress.downloaded + progress.skipped + progress.errors.length;
    if (completed - reported >= 25 || completed === progress.total) {
      console.log(`${completed}/${progress.total} — downloaded ${progress.downloaded}, verified ${progress.skipped}, failed ${progress.errors.length}`);
      reported = completed;
    }
  } });
  if (result.errors.length) process.exitCode = 1;
  else console.log('Assets verified. Ready for npm run build and npm start.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
