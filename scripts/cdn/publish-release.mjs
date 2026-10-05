import { createReadStream } from 'node:fs';
import { readFile, realpath, stat, mkdir, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { createR2Client, S3Error } from './s3-client.mjs';
import { toPublicManifest, validateReleaseId, validateResourceKey } from './release-manifest.mjs';

export const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable, no-transform';
const SENSITIVE_SEGMENT = /^(?:\.git|\.env(?:\..*)?|\.ssh|id_(?:rsa|ed25519|ecdsa)(?:\..*)?|node_modules|signing|credentials(?:\..*)?|secrets?(?:\..*)?)$/i;
const digestBuffer = data => createHash('sha256').update(data).digest('hex');

export class PublishError extends Error {
  constructor(message, { retryable = false } = {}) { super(message); this.name = 'PublishError'; this.retryable = retryable; }
}

function assertInteger(value, min, max, label) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new PublishError(`Invalid ${label}`);
}

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

/** Reject anything outside the exact runtime namespaces, including encoded traversal. */
export function validateReleasePlan(plan) {
  try { validateReleaseId(plan?.releaseId); } catch { throw new PublishError('Invalid releaseId'); }
  if (plan?.schemaVersion !== 1) throw new PublishError('Invalid release manifest schema');
  const prefix = `releases/${plan.releaseId}/`;
  if (plan.manifestKey !== `${prefix}release-manifest.json`) throw new PublishError('Unexpected public manifest key');
  if (!Array.isArray(plan.sourceRoots) || !plan.sourceRoots.length || plan.sourceRoots.some(root => typeof root !== 'string' || !path.isAbsolute(root))) throw new PublishError('Explicit absolute sourceRoots are required');
  if (!Array.isArray(plan.assets) || !plan.assets.length || plan.assets.length > 20_000) throw new PublishError('Invalid asset allowlist');
  const keys = new Set();
  let bytes = 0;
  for (const asset of plan.assets) {
    const key = asset?.key;
    if (typeof key !== 'string' || !key.startsWith(prefix) || /[\\%?#\x00-\x20\x7f]/.test(key)) throw new PublishError('Invalid asset object key');
    const segments = key.split('/');
    if (segments.some(part => !part || part === '.' || part === '..' || part.startsWith('.') || SENSITIVE_SEGMENT.test(part))) throw new PublishError('Unsafe asset object key');
    try { validateResourceKey(key, plan.releaseId); }
    catch { throw new PublishError('Object key is outside runtime asset allowlist'); }
    if (keys.has(key)) throw new PublishError('Duplicate asset object key');
    keys.add(key);
    assertInteger(asset.bytes, 0, 5 * 1024 ** 3, 'asset byte size');
    if (!/^[a-f0-9]{64}$/.test(asset.sha256 ?? '')) throw new PublishError('Invalid asset SHA-256');
    if (typeof asset.sourcePath !== 'string' || !path.isAbsolute(asset.sourcePath)) throw new PublishError('Absolute sourcePath is required');
    if (typeof asset.contentType !== 'string' || /[\r\n]/.test(asset.contentType)) throw new PublishError('Invalid asset Content-Type');
    if (asset.contentEncoding !== undefined || (key.endsWith('.gz') && asset.contentType !== 'application/octet-stream')) throw new PublishError('Compressed transport must have octet-stream Content-Type and no Content-Encoding');
    if (asset.cacheControl !== IMMUTABLE_CACHE_CONTROL) throw new PublishError('Immutable no-transform cache policy is required');
    bytes += asset.bytes;
    if (!Number.isSafeInteger(bytes)) throw new PublishError('Release byte total is too large');
  }
  try { toPublicManifest(plan); } catch { throw new PublishError('Invalid static delivery metadata'); }
  return { prefix, assets: plan.assets.length, bytes };
}

async function hashStream(stream) {
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of stream) { hash.update(chunk); bytes += chunk.length; }
  return { bytes, sha256: hash.digest('hex') };
}

async function localPreflight(plan, concurrency) {
  let roots;
  try { roots = await Promise.all(plan.sourceRoots.map(root => realpath(root))); }
  catch { throw new PublishError('A source root is unavailable'); }
  for (const root of roots) {
    if (root === path.parse(root).root || root.split(/[\\/]/).some(part => SENSITIVE_SEGMENT.test(part))) throw new PublishError('Unsafe source root');
  }
  await mapLimit(plan.assets, concurrency, async asset => {
    let file, info;
    try { file = await realpath(asset.sourcePath); info = await stat(file); }
    catch { throw new PublishError(`Missing source for ${asset.key}`); }
    if (!roots.some(root => isWithin(root, file)) || file.split(/[\\/]/).some(part => SENSITIVE_SEGMENT.test(part)) || !info.isFile()) throw new PublishError(`Source is outside approved roots for ${asset.key}`);
    if (info.size !== asset.bytes) throw new PublishError(`Source size mismatch for ${asset.key}`);
    let actual;
    try { actual = await hashStream(createReadStream(file)); }
    catch { throw new PublishError(`Cannot read source for ${asset.key}`); }
    if (actual.bytes !== asset.bytes || actual.sha256 !== asset.sha256) throw new PublishError(`Source SHA-256 mismatch for ${asset.key}`);
  });
}

async function mapLimit(values, limit, callback) {
  let next = 0;
  let firstError;
  const workers = Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (!firstError && next < values.length) {
      const index = next++;
      try { await callback(values[index], index); }
      catch (error) { firstError ??= error; }
    }
  });
  await Promise.all(workers);
  if (firstError) throw firstError;
}

function header(headers, name) {
  const found = Object.entries(headers ?? {}).find(([key]) => key.toLowerCase() === name);
  return found ? String(found[1]) : undefined;
}

function checkRemoteHeaders(asset, response) {
  const h = response.headers;
  if (header(h, 'content-length') !== String(asset.bytes)) throw new PublishError(`Immutable object size conflict for ${asset.key}`);
  if (header(h, 'content-encoding')) throw new PublishError(`Unexpected Content-Encoding for ${asset.key}`);
  if (header(h, 'content-type') !== asset.contentType || header(h, 'cache-control') !== asset.cacheControl) throw new PublishError(`Immutable object header conflict for ${asset.key}`);
  const metadataHash = header(h, 'x-amz-meta-sha256');
  if (metadataHash && metadataHash !== asset.sha256) throw new PublishError(`Immutable object SHA-256 metadata conflict for ${asset.key}`);
  // ETag is never accepted as proof of file integrity.
}

async function verifyRemote(client, asset, retry) {
  return retry(async () => {
    const response = await client.getObject(asset.key);
    try { checkRemoteHeaders(asset, response); }
    catch (error) { response.body?.destroy?.(); throw error; }
    let actual;
    try { actual = await hashStream(response.body); }
    catch { throw new PublishError(`Interrupted remote verification for ${asset.key}`, { retryable: true }); }
    if (actual.bytes !== asset.bytes || actual.sha256 !== asset.sha256) throw new PublishError(`Immutable object SHA-256 conflict for ${asset.key}; use a new releaseId`);
  });
}

async function publishObject(client, asset, retry) {
  const existing = await retry(() => client.headObject(asset.key));
  if (existing) {
    checkRemoteHeaders(asset, existing);
    await verifyRemote(client, asset, retry);
    return 'reused';
  }
  try {
    await retry(() => client.putObject(asset.key, { filePath: asset.sourcePath, body: asset.body,
      bytes: asset.bytes, sha256: asset.sha256, contentType: asset.contentType,
      cacheControl: asset.cacheControl, ifNoneMatch: '*' }));
  } catch (error) {
    // A prior successful PUT with a lost response, or another uploader, can win.
    // Verify the winner; never overwrite it.
    if (error.status !== 412 && error.status !== 409) throw error;
    const winner = await retry(() => client.headObject(asset.key));
    if (!winner) throw new PublishError(`Conditional upload failed for ${asset.key}`);
    checkRemoteHeaders(asset, winner);
    await verifyRemote(client, asset, retry);
    return 'reused';
  }
  await verifyRemote(client, asset, retry);
  return 'uploaded';
}

async function writeAtomic(filename, value) {
  await mkdir(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
  await rename(temporary, filename);
}

/** Upload only this manifest's exact keys. No DNS, public bucket access or live activation. */
export async function publishRelease(plan, { client, dryRun = true, concurrency = 3, retries = 3,
  readyPath, onProgress = () => {}, delay = sleep } = {}) {
  assertInteger(concurrency, 1, 8, 'concurrency');
  assertInteger(retries, 0, 6, 'retry count');
  const summary = validateReleasePlan(plan);
  if (!dryRun && (!client || typeof client.headObject !== 'function' || typeof client.getObject !== 'function' || typeof client.putObject !== 'function')) throw new PublishError('An explicit R2 client is required');
  if (!dryRun && (!readyPath || !path.isAbsolute(readyPath))) throw new PublishError('An absolute local READY evidence path is required');
  if (!dryRun && (path.basename(readyPath) !== 'READY.json' || plan.sourceRoots.some(root => path.resolve(root) === path.dirname(path.resolve(readyPath)) || isWithin(path.resolve(root), path.resolve(readyPath))))) throw new PublishError('READY.json must be outside all asset source roots');
  if (!dryRun) {
    // Preserve earlier proof, but prevent an interrupted recheck looking ready.
    try { await rename(readyPath, `${readyPath}.previous-${Date.now()}-${randomUUID()}.json`); }
    catch (error) { if (error.code !== 'ENOENT') throw new PublishError('Cannot archive earlier READY evidence'); }
  }
  onProgress({ phase: 'source-verification', assets: summary.assets, bytes: summary.bytes });
  await localPreflight(plan, concurrency);
  const manifestBody = Buffer.from(`${JSON.stringify(toPublicManifest(plan), null, 2)}\n`);
  const manifestHash = digestBuffer(manifestBody);
  if (dryRun) return { schemaVersion: 1, releaseId: plan.releaseId, dryRun: true, assets: summary.assets,
    bytes: summary.bytes, manifestKey: plan.manifestKey, manifestSha256: manifestHash, uploaded: 0,
    activated: false, reason: 'Validated sources; no remote requests or writes' };

  const retry = async operation => {
    for (let attempt = 0; ; attempt++) {
      try { return await operation(); }
      catch (error) {
        if (!(error instanceof S3Error || error instanceof PublishError) || !error.retryable || attempt >= retries) throw error;
        onProgress({ phase: 'retry', attempt: attempt + 1 });
        await delay(Math.min(4000, 250 * 2 ** attempt));
      }
    }
  };
  let uploaded = 0;
  let reused = 0;
  let verified = 0;
  await mapLimit(plan.assets, concurrency, async asset => {
    const result = await publishObject(client, asset, retry);
    if (result === 'uploaded') uploaded++; else reused++;
    verified++;
    onProgress({ phase: 'object-verified', verified, assets: summary.assets, uploaded, reused });
  });
  const publicAsset = { key: plan.manifestKey, body: manifestBody, bytes: manifestBody.length,
    sha256: manifestHash, contentType: 'application/json; charset=utf-8', cacheControl: IMMUTABLE_CACHE_CONTROL };
  // This completion marker is published only after every asset's streamed GET passes.
  const manifestResult = await publishObject(client, publicAsset, retry);
  const evidence = { schemaVersion: 1, releaseId: plan.releaseId, status: 'READY', verifiedAt: new Date().toISOString(),
    verificationScope: 'Authenticated R2 origin, full streamed SHA-256', assets: summary.assets,
    bytes: summary.bytes, uploaded, reused, verified, manifestKey: plan.manifestKey,
    manifestBytes: manifestBody.length, manifestSha256: manifestHash, manifestResult,
    activated: false, remainingChecks: ['Public domain, CORS, Range and byte integrity', 'Browser loading and WSS', 'Operator activation'] };
  await writeAtomic(readyPath, evidence);
  return evidence;
}

function parseCLI(argv) {
  const options = { dryRun: true, concurrency: 3, retries: 3 };
  let action;
  for (let i = 0; i < argv.length; i++) {
    const name = argv[i];
    if (name === '--help') { options.help = true; continue; }
    if (name === '--dry-run' || name === '--upload') {
      if (action && action !== name) throw new PublishError('--dry-run and --upload are mutually exclusive');
      action = name;
      options.dryRun = name === '--dry-run';
      continue;
    }
    if (!['--manifest', '--endpoint', '--bucket', '--ready', '--concurrency', '--retries'].includes(name) || !argv[i + 1] || argv[i + 1].startsWith('--')) throw new PublishError('Unknown or incomplete CLI option');
    const value = argv[++i];
    options[name.slice(2)] = ['--concurrency', '--retries'].includes(name) ? Number(value) : value;
  }
  return options;
}

async function main() {
  const options = parseCLI(process.argv.slice(2));
  if (options.help) {
    console.log('node scripts/cdn/publish-release.mjs --manifest <release-local-manifest.json> [--dry-run | --upload --bucket <bucket> --endpoint <R2 HTTPS URL>] [--ready <READY.json>] [--concurrency 1..8] [--retries 0..6]\nUpload credentials: R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY; optional R2_SESSION_TOKEN. No credential files are read. Default is dry-run.');
    return;
  }
  if (!options.manifest) throw new PublishError('--manifest is required');
  let plan;
  try { plan = JSON.parse(await readFile(path.resolve(options.manifest), 'utf8')); }
  catch { throw new PublishError('Cannot read release-local-manifest.json'); }
  let client;
  if (!options.dryRun) client = createR2Client({ endpoint: options.endpoint ?? process.env.R2_ENDPOINT,
    bucket: options.bucket, credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY, sessionToken: process.env.R2_SESSION_TOKEN } });
  const readyPath = path.resolve(options.ready ?? path.join(path.dirname(path.resolve(options.manifest)), 'READY.json'));
  const result = await publishRelease(plan, { ...options, client, readyPath,
    onProgress: event => { if (event.phase !== 'object-verified' || event.verified % 50 === 0 || event.verified === event.assets) console.log(JSON.stringify(event)); } });
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error instanceof PublishError || error instanceof S3Error ? error.message : 'CDN publication failed; no live activation was performed'); process.exitCode = 1; });
}
