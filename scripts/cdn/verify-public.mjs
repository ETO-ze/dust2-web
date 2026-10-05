import {createHash, randomUUID} from 'node:crypto';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {toPublicManifest} from './release-manifest.mjs';

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);
const REQUIRED_EXPOSE = ['etag', 'content-length', 'content-range', 'accept-ranges'];
const sha = data => createHash('sha256').update(data).digest('hex');
const commaTokens = value => (value || '').split(',').map(token => token.trim().toLowerCase()).filter(Boolean);
const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);

/** Only an operator-selected HTTPS origin may receive requests. HTTP is explicitly
 * limited to loopback for tests; the CLI never enables that exception. */
export function validatePublicBase(value, {allowLocalhost = false} = {}) {
  if (typeof value !== 'string' || value.trim() !== value || /[\\\s\u0000-\u001f\u007f]/.test(value))
    throw Error('CDN base must be an absolute HTTPS URL without whitespace');
  let url;
  try { url = new URL(value); } catch { throw Error('CDN base must be an absolute HTTPS URL'); }
  if (url.protocol !== 'https:' && !(allowLocalhost && url.protocol === 'http:' && LOOPBACK.has(url.hostname)))
    throw Error('CDN base requires HTTPS');
  if (!url.hostname || url.username || url.password || /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*@/i.test(value)
      || /[?#]/.test(value) || /%(?:2e|2f|5c)/i.test(value)
      || value.split('/').includes('..') || value.split('/').includes('.'))
    throw Error('CDN base cannot contain credentials, query, fragment or escaping path segments');
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return url.href;
}

function validateOrigin(value, options) {
  const url = new URL(validatePublicBase(value, options));
  if (url.pathname !== '/') throw Error('Game origin must not contain a path');
  return url.origin;
}

function validateRelease(manifest) {
  if (!manifest || manifest.schemaVersion !== 1 || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,95}$/.test(manifest.releaseId || '')
      || ['.', '..'].includes(manifest.releaseId) || !Array.isArray(manifest.assets) || !manifest.assets.length)
    throw Error('Invalid publisher manifest schema or release ID');
  const prefix = `releases/${manifest.releaseId}/`, keys = new Set();
  for (const asset of manifest.assets) {
    if (!asset || typeof asset.key !== 'string' || !asset.key.startsWith(prefix)
        || !/^releases\/[a-zA-Z0-9._-]+\/(?:assets|maps)\/[a-zA-Z0-9._/-]+$/.test(asset.key)
        || asset.key.split('/').some(part => !part || part === '.' || part === '..' || part.startsWith('.'))
        || /(?:^|\/)(?:credentials?|secrets?|tokens?|passwords?|id_rsa|id_ed25519)(?:[./_-]|$)/i.test(asset.key)
        || /\.(?:pem|key|p12|pfx|apk|exe|zip|7z|tar|sqlite|db|toml|yaml|yml)$/i.test(asset.key)
        || keys.has(asset.key)) throw Error('Invalid, duplicate or non-asset object key');
    if (!Number.isSafeInteger(asset.bytes) || asset.bytes < 0 || !/^[a-f0-9]{64}$/.test(asset.sha256 || '')
        || typeof asset.contentType !== 'string' || !/^[a-z0-9.+-]+\/[a-z0-9.+-]+(?:;[\x20-\x7e]*)?$/i.test(asset.contentType)
        || typeof asset.cacheControl !== 'string' || /[\r\n]/.test(asset.cacheControl))
      throw Error('Invalid object integrity or response metadata');
    if (asset.key.endsWith('.gz') && asset.contentType !== 'application/octet-stream')
      throw Error('Compressed transport objects must be application/octet-stream');
    keys.add(asset.key);
  }
  if (manifest.manifestKey !== `${prefix}release-manifest.json`) throw Error('Invalid public manifest key');
  return {prefix, publicManifest: toPublicManifest(manifest)};
}

class CheckFailure extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
function check(condition, code, message) { if (!condition) throw new CheckFailure(code, message); }
function typeOf(response) { return (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase(); }

function cors(response, origin) {
  check(response.headers.get('access-control-allow-origin') === origin, 'cors-origin', 'CORS must allow the exact game origin');
  check(!['true'].includes((response.headers.get('access-control-allow-credentials') || '').toLowerCase()),
    'cors-credentials', 'Static delivery must not enable credentialed requests');
  const exposed = commaTokens(response.headers.get('access-control-expose-headers'));
  check(REQUIRED_EXPOSE.every(name => exposed.includes(name)), 'cors-expose', 'CORS must expose ETag and Range metadata');
}

function metadata(response, asset) {
  check(response.status === 200, 'http-status', `Expected HTTP 200; received ${response.status}`);
  check(response.headers.get('content-length') === String(asset.bytes), 'content-length', 'Content-Length does not match the manifest');
  check(typeOf(response) === asset.contentType.split(';')[0].toLowerCase(), 'content-type', 'Content-Type does not match the manifest');
  const encoding = response.headers.get('content-encoding');
  check(asset.key.endsWith('.gz') ? encoding === null : encoding === null || encoding.toLowerCase() === 'identity',
    'content-encoding', 'Object response must preserve the manifest bytes; .gz cannot have Content-Encoding');
  check(Boolean(response.headers.get('etag')?.trim()), 'etag', 'ETag is missing');
  check(response.headers.get('cache-control') === asset.cacheControl, 'cache-control', 'Cache-Control does not match the manifest');
  check((response.headers.get('accept-ranges') || '').toLowerCase() === 'bytes', 'accept-ranges', 'Byte ranges are not advertised');
}

async function consume(response, {limit = Infinity, hash = false, prefixBytes = 0} = {}) {
  const digest = hash ? createHash('sha256') : null;
  const prefix = [], chunks = [];
  let bytes = 0, prefixLength = 0;
  if (response.body) for await (const part of response.body) {
    const chunk = Buffer.from(part); bytes += chunk.length;
    if (bytes > limit) { await response.body.cancel?.().catch(() => {}); throw new CheckFailure('body-size', 'Response body exceeds its expected size'); }
    digest?.update(chunk);
    if (!hash) chunks.push(chunk);
    if (prefixLength < prefixBytes) {
      const first = chunk.subarray(0, prefixBytes - prefixLength); prefix.push(first); prefixLength += first.length;
    }
  }
  return {bytes, sha256: digest?.digest('hex'), prefix: Buffer.concat(prefix), data: hash ? null : Buffer.concat(chunks)};
}

async function cancel(response) {
  if (response?.body && !response.body.locked) await response.body.cancel().catch(() => {});
}

function sampleAssets(assets, count) {
  const selected = [], groups = new Set();
  const add = asset => { if (asset && asset.bytes > 0 && !selected.includes(asset) && selected.length < count) selected.push(asset); };
  add(assets.find(asset => asset.key.endsWith('.gz')));
  for (const asset of assets) {
    const tail = asset.key.split('/').slice(2), group = tail[0] === 'maps' ? `${tail[0]}/${tail[1]}` : tail[0];
    if (!groups.has(group)) { groups.add(group); add(asset); }
  }
  for (const asset of assets) add(asset);
  return selected;
}

// A resume file is trusted local operator evidence, not an authenticated remote
// statement. Bind every historical byte proof to the exact current inventory;
// fresh HEAD requests below still check both origins and the recorded ETag.
function validateResumeReport(prior, {manifest, base, origins, allowLocalhost}) {
  const invalid = () => { throw Error('Resume report does not match a complete, untampered local verification record'); };
  const timestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value;
  if (!prior || prior.schemaVersion !== 1 || prior.kind !== 'cdn-public-verification'
      || prior.releaseId !== manifest.releaseId || prior.baseURL !== base
      || !Array.isArray(prior.origins) || canonical(prior.origins) !== canonical(origins)
      || typeof prior.ok !== 'boolean' || !timestamp(prior.startedAt) || !timestamp(prior.completedAt)
      || Date.parse(prior.completedAt) < Date.parse(prior.startedAt)
      || !Array.isArray(prior.assets) || !Array.isArray(prior.failures) || !Array.isArray(prior.rangeSamples)) invalid();
  // Do not let normalization hide a credentials-bearing or differently scoped URL.
  if (validatePublicBase(prior.baseURL, {allowLocalhost}) !== base) invalid();
  const expected = new Map(manifest.assets.map(asset => [asset.key, asset])), verified = new Map();
  let bytes = 0;
  for (const asset of prior.assets) {
    const current = expected.get(asset?.key);
    if (!current || verified.has(asset.key) || Object.keys(asset).some(key => !['key', 'bytes', 'sha256', 'etag'].includes(key))
        || asset.bytes !== current.bytes || asset.sha256 !== current.sha256
        || typeof asset.etag !== 'string' || !/^"[\x21\x23-\x7e]+"$/.test(asset.etag)) invalid();
    verified.set(asset.key, {...asset}); bytes += asset.bytes;
  }
  const totalBytes = manifest.assets.reduce((total, asset) => total + asset.bytes, 0);
  if (prior.fileCount !== manifest.assets.length || prior.totalBytes !== totalBytes
      || prior.verifiedFiles !== verified.size || prior.verifiedBytes !== bytes
      || !Number.isSafeInteger(bytes) || !Number.isSafeInteger(totalBytes)) invalid();
  const scopes = new Set(), globalScopes = new Set(['missing-object', 'directory-listing', 'public-manifest',
    ...origins.map(origin => `preflight:${origin}`)]);
  for (const failure of prior.failures) {
    if (!failure || typeof failure.scope !== 'string' || scopes.has(failure.scope)
        || !(expected.has(failure.scope) || globalScopes.has(failure.scope)
          || (failure.scope.startsWith('range:') && expected.has(failure.scope.slice(6))))
        || typeof failure.code !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(failure.code)
        || typeof failure.message !== 'string' || failure.message.length > 1024
        || /[\u0000-\u001f\u007f]/.test(failure.message)
        || (expected.has(failure.scope) && verified.has(failure.scope))) invalid();
    scopes.add(failure.scope);
  }
  // A finished report must account for every object, including each failed one.
  if (verified.size + prior.failures.filter(failure => expected.has(failure.scope)).length !== expected.size) invalid();
  const rangeKeys = new Set();
  for (const range of prior.rangeSamples) {
    const asset = verified.get(range?.key), end = Math.min(63, (asset?.bytes || 0) - 1);
    if (!asset || asset.bytes === 0 || rangeKeys.has(range.key) || range.ok !== true
        || range.start !== 0 || range.end !== end || range.bytes !== end + 1
        || scopes.has(`range:${range.key}`)) invalid();
    rangeKeys.add(range.key);
  }
  if (prior.ok && (prior.failures.length || verified.size !== expected.size || !rangeKeys.size)) invalid();
  const proof = prior.publicManifest;
  if (!proof || proof.ok !== true || proof.key !== manifest.manifestKey || !Number.isSafeInteger(proof.bytes)
      || proof.bytes < 1 || proof.bytes > 16 * 1024 * 1024 || !/^[a-f0-9]{64}$/.test(proof.sha256 || '')
      || scopes.has('public-manifest')) invalid();
  return {verified, sourceReportSha256: sha(canonical(prior))};
}

/** Reads every object. This checks actual HTTP headers and bytes, but Node's
 * fetch does not enforce browser CORS: a real browser acceptance test is still
 * required. It never writes a bucket, DNS record or game configuration. */
export async function verifyPublicRelease(manifest, {
  baseURL, origins, fetcher = globalThis.fetch, concurrency = 3, timeoutMs = 30000,
  rangeSamples = 5, allowLocalhost = false, signal, onProgress, resumeReport, networkRetries = 2,
} = {}) {
  const base = validatePublicBase(baseURL, {allowLocalhost});
  if (!Array.isArray(origins) || !origins.length) throw Error('At least one game --origin is required');
  const gameOrigins = [...new Set(origins.map(origin => validateOrigin(origin, {allowLocalhost})))];
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) throw Error('Concurrency must be between 1 and 8');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120000) throw Error('Invalid request timeout');
  if (!Number.isInteger(rangeSamples) || rangeSamples < 1 || rangeSamples > 20) throw Error('Range sample count must be between 1 and 20');
  if (!Number.isInteger(networkRetries) || networkRetries < 0 || networkRetries > 2) throw Error('Network retries must be between 0 and 2');
  const {prefix, publicManifest} = validateRelease(manifest);
  const resume = resumeReport === undefined ? null : validateResumeReport(resumeReport,
    {manifest, base, origins: gameOrigins, allowLocalhost});
  const selected = sampleAssets(manifest.assets, rangeSamples), prefixes = new Map();
  const report = {schemaVersion: 1, kind: 'cdn-public-verification', releaseId: manifest.releaseId,
    baseURL: base, origins: gameOrigins, startedAt: new Date().toISOString(), ok: false,
    fileCount: manifest.assets.length, totalBytes: manifest.assets.reduce((total, asset) => total + asset.bytes, 0),
    verifiedFiles: 0, verifiedBytes: 0, rangeSamples: [], failures: [], assets: [],
    requestRetryPolicy: {networkRetries, retryEvents: []},
    browserAcceptance: {status: 'not-run', required: true,
      note: 'HTTP bytes and CORS headers were checked. Node fetch does not prove browser CORS enforcement or game runtime compatibility.'},
    operatorDownloadConfig: null};
  if (resume) report.resume = {sourceReportSha256: resume.sourceReportSha256,
    sourceStartedAt: resumeReport.startedAt, sourceCompletedAt: resumeReport.completedAt,
    sourceVerifiedFiles: resumeReport.verifiedFiles, sourceVerifiedBytes: resumeReport.verifiedBytes,
    historicalFailures: resumeReport.failures.map(failure => ({...failure})), reusedFiles: 0, reusedBytes: 0,
    freshlyHashedFiles: 0, freshlyHashedBytes: 0,
    policy: 'Trusted local historical full-body SHA-256 plus fresh HEAD metadata and exact ETag at every origin; failed objects and Range samples are fully re-read.'};
  const fail = (scope, error) => report.failures.push({scope, code: error.code || (error.name === 'TimeoutError' ? 'timeout' : 'network'),
    message: error instanceof CheckFailure ? error.message : 'Request failed; retry or inspect connectivity without publishing credentials'});
  const request = async (key, {method = 'GET', origin = gameOrigins[0], headers = {}} = {}) => {
    const url = new URL(key, base);
    check(url.href.startsWith(base) && url.origin === new URL(base).origin, 'request-origin', 'Object URL escaped the selected CDN base');
    const attempts = ['GET', 'HEAD'].includes(method) ? networkRetries + 1 : 1;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      const timeout = AbortSignal.timeout(timeoutMs), combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
      try {
        return await fetcher(url.href, {method, headers: {Origin: origin, ...headers}, credentials: 'omit',
          redirect: 'error', cache: 'no-store', signal: combined});
      } catch (error) {
        if (error instanceof CheckFailure || signal?.aborted) throw error;
        const retryScheduled = attempt < attempts;
        report.requestRetryPolicy.retryEvents.push({scope: key, origin, method, attempt,
          code: error.name === 'TimeoutError' ? 'timeout' : 'network', retryScheduled});
        if (!retryScheduled) throw error;
        await new Promise(resolve => setTimeout(resolve, attempt * 100));
      }
    }
  };
  const readPublicManifest = async () => {
    let response;
    try {
      response = await request(manifest.manifestKey);
      check(response.status === 200, 'manifest-unpublished', `Public release manifest is not available (${response.status})`);
      check(typeOf(response) === 'application/json', 'content-type', 'Public manifest must be JSON');
      check(response.headers.get('content-encoding') === null, 'content-encoding', 'Public manifest must not be transformed');
      cors(response, gameOrigins[0]);
      check(Boolean(response.headers.get('etag')), 'etag', 'Public manifest ETag is missing');
      check(response.headers.get('cache-control') === manifest.assets[0].cacheControl, 'cache-control', 'Public manifest must use immutable, untransformed delivery');
      const read = await consume(response, {limit: 16 * 1024 * 1024});
      check(response.headers.get('content-length') === String(read.bytes), 'content-length', 'Public manifest Content-Length is incorrect');
      let remote;
      try { remote = JSON.parse(read.data.toString('utf8')); } catch { throw new CheckFailure('manifest-json', 'Public manifest is not valid JSON'); }
      check(canonical(remote) === canonical(publicManifest), 'manifest-mismatch', 'Public release manifest differs from the local sanitized manifest');
      const proof = {key: manifest.manifestKey, bytes: read.bytes, sha256: sha(read.data), ok: true};
      if (resume) check(proof.bytes === resumeReport.publicManifest.bytes && proof.sha256 === resumeReport.publicManifest.sha256,
        'resume-manifest-mismatch', 'Fresh public manifest bytes differ from the historical verification proof');
      return proof;
    } finally { await cancel(response); }
  };
  // Verify the remote commit marker before accepting any historical body proof.
  // It is checked again last so the normal final activation guard remains intact.
  if (resume) {
    try { report.resume.initialManifest = await readPublicManifest(); }
    catch (error) { fail('public-manifest', error); report.completedAt = new Date().toISOString(); return report; }
  }
  let cursor = 0;
  await Promise.all(Array.from({length: Math.min(concurrency, manifest.assets.length)}, async () => {
    while (cursor < manifest.assets.length) {
      const asset = manifest.assets[cursor++];
      let head, response;
      try {
        let etag;
        for (const origin of gameOrigins) {
          head = await request(asset.key, {method: 'HEAD', origin});
          metadata(head, asset); cors(head, origin);
          check((await consume(head, {limit: 0})).bytes === 0, 'head-body', 'HEAD must have no response body');
          etag ||= head.headers.get('etag');
          check(head.headers.get('etag') === etag, 'etag-stability', 'Object ETag differs between game origins');
        }
        const historical = resume?.verified.get(asset.key);
        if (historical) check(etag === historical.etag, 'resume-etag-mismatch', 'Fresh ETag differs from the historical full-body verification');
        if (historical && !selected.includes(asset)) {
          report.verifiedFiles++; report.verifiedBytes += historical.bytes;
          report.assets.push({...historical});
          report.resume.reusedFiles++; report.resume.reusedBytes += historical.bytes;
          continue;
        }
        response = await request(asset.key);
        metadata(response, asset); cors(response, gameOrigins[0]);
        check(response.headers.get('etag') === etag, 'etag-stability', 'HEAD and GET returned different object versions');
        const read = await consume(response, {limit: asset.bytes, hash: true, prefixBytes: selected.includes(asset) ? 64 : 0});
        check(read.bytes === asset.bytes, 'body-size', 'Object body size differs from the manifest');
        check(read.sha256 === asset.sha256, 'sha256', 'Object SHA-256 differs from the manifest');
        if (selected.includes(asset)) prefixes.set(asset.key, read.prefix);
        report.verifiedFiles++; report.verifiedBytes += read.bytes;
        report.assets.push({key: asset.key, bytes: read.bytes, sha256: read.sha256, etag});
        if (resume) { report.resume.freshlyHashedFiles++; report.resume.freshlyHashedBytes += read.bytes; }
      } catch (error) { fail(asset.key, error); }
      finally {
        await cancel(head); await cancel(response);
        if (typeof onProgress === 'function') await onProgress({
          fileCount: report.fileCount, totalBytes: report.totalBytes,
          checkedFiles: report.verifiedFiles + report.failures.length,
          verifiedFiles: report.verifiedFiles, verifiedBytes: report.verifiedBytes,
          failures: report.failures.length,
        });
      }
    }
  }));
  for (const origin of gameOrigins) {
    let preflight;
    try {
      preflight = await request(manifest.assets[0].key, {method: 'OPTIONS', origin,
        headers: {'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'Range'}});
      check([200, 204].includes(preflight.status), 'cors-preflight', `Preflight returned ${preflight.status}`);
      check(preflight.headers.get('access-control-allow-origin') === origin, 'cors-origin', 'Preflight did not allow the exact game origin');
      const methods = commaTokens(preflight.headers.get('access-control-allow-methods'));
      check(methods.includes('get') && methods.includes('head') && methods.every(method => ['get', 'head', 'options'].includes(method)),
        'cors-methods', 'Public CORS must allow GET/HEAD and exclude write methods');
      const headers = commaTokens(preflight.headers.get('access-control-allow-headers'));
      check(headers.includes('range') || headers.includes('*'), 'cors-range', 'Preflight does not allow the Range header');
      check((preflight.headers.get('access-control-allow-credentials') || '').toLowerCase() !== 'true',
        'cors-credentials', 'Preflight enables credentialed requests');
      await consume(preflight, {limit: 1024});
    } catch (error) { fail(`preflight:${origin}`, error); }
    finally { await cancel(preflight); }
  }
  for (const asset of selected) {
    if (!prefixes.has(asset.key)) continue;
    let response;
    try {
      const end = Math.min(63, asset.bytes - 1);
      response = await request(asset.key, {headers: {Range: `bytes=0-${end}`}});
      check(response.status === 206, 'range-status', `Range request must return 206; received ${response.status}`);
      cors(response, gameOrigins[0]);
      check(response.headers.get('content-range') === `bytes 0-${end}/${asset.bytes}`, 'content-range', 'Invalid Content-Range');
      check(response.headers.get('content-length') === String(end + 1), 'range-length', 'Range Content-Length is incorrect');
      check(typeOf(response) === asset.contentType.split(';')[0].toLowerCase(), 'content-type', 'Range Content-Type is incorrect');
      check(response.headers.get('content-encoding') === null, 'content-encoding', 'Range bytes must not be transformed');
      check(Boolean(response.headers.get('etag')), 'etag', 'Range ETag is missing');
      check(response.headers.get('etag') === report.assets.find(verified => verified.key === asset.key)?.etag,
        'etag-stability', 'Range and full GET returned different object versions');
      const read = await consume(response, {limit: end + 1});
      check(read.data.equals(prefixes.get(asset.key)), 'range-bytes', 'Range response bytes differ from the verified full object');
      report.rangeSamples.push({key: asset.key, start: 0, end, bytes: read.bytes, ok: true});
    } catch (error) { fail(`range:${asset.key}`, error); }
    finally { await cancel(response); }
  }
  for (const [key, statuses, scope] of [
    [`${prefix}assets/cdn-verifier-${randomUUID()}.missing`, [404], 'missing-object'],
    [`${prefix}assets/`, [403, 404], 'directory-listing'],
  ]) {
    let response;
    try {
      response = await request(key);
      check(statuses.includes(response.status), 'negative-status', `${scope} returned ${response.status}`);
    } catch (error) { fail(scope, error); }
    finally { await cancel(response); }
  }
  // The commit marker is deliberately read last: an incomplete upload must not
  // become eligible for an operator to switch the download configuration.
  try {
    report.publicManifest = await readPublicManifest();
  } catch (error) { fail('public-manifest', error); }
  report.assets.sort((a, b) => a.key.localeCompare(b.key));
  report.ok = report.failures.length === 0 && report.verifiedFiles === report.fileCount
    && report.rangeSamples.length === selected.length;
  report.completedAt = new Date().toISOString();
  if (report.ok) report.operatorDownloadConfig = {schemaVersion: 1,
    assetBaseURL: new URL(`${prefix}assets/`, base).href,
    mapBaseURL: new URL(`${prefix}maps/`, base).href, fallbackToGameServer: false};
  return report;
}

export function parseVerifyArgs(args) {
  const options = {origins: []}, known = new Set(['--manifest', '--base', '--origin', '--report', '--resume-report', '--concurrency', '--timeout-ms', '--range-samples', '--network-retries']);
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === '--help') return {help: true};
    if (!known.has(flag) || !args[i + 1] || args[i + 1].startsWith('--')) throw Error(`Invalid or missing argument: ${flag}`);
    const value = args[++i];
    if (flag === '--origin') options.origins.push(value);
    else {
      const name = {'--manifest': 'manifestPath', '--base': 'baseURL', '--report': 'reportPath',
        '--resume-report': 'resumeReportPath', '--concurrency': 'concurrency', '--timeout-ms': 'timeoutMs',
        '--range-samples': 'rangeSamples', '--network-retries': 'networkRetries'}[flag];
      if (options[name] !== undefined) throw Error(`Repeated argument: ${flag}`);
      options[name] = ['concurrency', 'timeoutMs', 'rangeSamples', 'networkRetries'].includes(name) ? Number(value) : value;
    }
  }
  if (!options.manifestPath || !options.baseURL || !options.reportPath || !options.origins.length)
    throw Error('Required: --manifest <local.json> --base <https://cdn/> --origin <https://game> --report <local.json>');
  const samePath = (left, right) => process.platform === 'win32'
    ? resolve(left).toLowerCase() === resolve(right).toLowerCase() : resolve(left) === resolve(right);
  if (samePath(options.manifestPath, options.reportPath)) throw Error('Report cannot overwrite the input manifest');
  if (options.resumeReportPath && (samePath(options.resumeReportPath, options.reportPath)
      || samePath(options.resumeReportPath, options.manifestPath))) throw Error('Resume report must be separate from the manifest and output report');
  return options;
}

async function main() {
  const options = parseVerifyArgs(process.argv.slice(2));
  if (options.help) {
    console.log('Read-only CDN verification: --manifest <publisher.json> --base <https://cdn/> --origin <https://game> [--origin <https://game:8443>] --report <report.json> [--resume-report <trusted-local-report.json>] [--concurrency 3] [--timeout-ms 30000] [--range-samples 5] [--network-retries 2]');
    return;
  }
  const manifest = JSON.parse(await readFile(resolve(options.manifestPath), 'utf8'));
  const reportPath = resolve(options.reportPath);
  if (options.resumeReportPath) options.resumeReport = JSON.parse(await readFile(resolve(options.resumeReportPath), 'utf8'));
  const normalized = value => process.platform === 'win32' ? resolve(value).toLowerCase() : resolve(value);
  if (manifest.assets?.some(asset => typeof asset.sourcePath === 'string' && normalized(asset.sourcePath) === normalized(reportPath)))
    throw Error('Report cannot overwrite a local resource');
  const report = await verifyPublicRelease(manifest, options);
  await mkdir(dirname(reportPath), {recursive: true});
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, {encoding: 'utf8', mode: 0o600});
  console.log(JSON.stringify({ok: report.ok, releaseId: report.releaseId, verifiedFiles: report.verifiedFiles,
    verifiedBytes: report.verifiedBytes, failures: report.failures.length, report: reportPath,
    browserAcceptance: 'still required', configurationApplied: false}));
  if (!report.ok) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error => { console.error(`CDN verification failed: ${error instanceof SyntaxError ? 'Local manifest is invalid JSON' : error.message}`); process.exitCode = 1; });
