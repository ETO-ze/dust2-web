import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {gzipSync} from 'node:zlib';
import {IMMUTABLE_CACHE, toPublicManifest} from '../scripts/cdn/release-manifest.mjs';
import {parseVerifyArgs, validatePublicBase, verifyPublicRelease} from '../scripts/cdn/verify-public.mjs';

const sha = data => createHash('sha256').update(data).digest('hex');
const baseURL = 'https://downloads.test/', origins = ['https://game.test', 'https://game.test:8443'];
function fixture(mutate = () => {}) {
  const entries = [
    ['assets/textures/test.png', Buffer.from('texture '.repeat(20)), 'image/png'],
    ['assets/asset-manifest.json', Buffer.from('{"files":[]}'), 'application/json; charset=utf-8'],
    [`maps/de_mirage/transport/${'a'.repeat(64)}.gz`, gzipSync(Buffer.from('map mesh '.repeat(40))), 'application/octet-stream'],
  ];
  const assets = entries.map(([key, data, contentType]) => ({key: `releases/test-release/${key}`, sourcePath: `C:/private/${key}`,
    bytes: data.length, sha256: sha(data), contentType, cacheControl: IMMUTABLE_CACHE}));
  const manifest = {schemaVersion: 1, releaseId: 'test-release', manifestKey: 'releases/test-release/release-manifest.json',
    fileCount: assets.length, totalBytes: assets.reduce((n, asset) => n + asset.bytes, 0), sourceRoots: ['C:/private'], assets};
  const files = new Map(entries.map((entry, index) => [assets[index].key, entry[1]])), requests = [];
  files.set(manifest.manifestKey, Buffer.from(`${JSON.stringify(toPublicManifest(manifest), null, 2)}\n`));
  const fetcher = async (url, options) => {
    const key = new URL(url).pathname.replace(/^\//, ''), asset = assets.find(asset => asset.key === key), data = files.get(key);
    requests.push({key, ...options});
    const isManifest = key === manifest.manifestKey;
    const headers = new Headers({'Access-Control-Allow-Origin': options.headers.Origin,
      'Access-Control-Expose-Headers': 'ETag, Content-Length, Content-Range, Accept-Ranges',
      'ETag': `"${asset?.sha256 || 'manifest'}"`, 'Accept-Ranges': 'bytes',
      'Cache-Control': IMMUTABLE_CACHE, 'Content-Type': asset?.contentType || 'application/json; charset=utf-8'});
    let status = data ? 200 : 404, body = data || Buffer.from('not found');
    if (options.method === 'OPTIONS') {
      status = 204; body = null;
      headers.set('Access-Control-Allow-Methods', 'GET, HEAD');
      headers.set('Access-Control-Allow-Headers', 'Range');
    } else if (options.headers.Range && data) {
      const match = /^bytes=(\d+)-(\d+)$/.exec(options.headers.Range), start = Number(match[1]), end = Number(match[2]);
      status = 206; body = data.subarray(start, end + 1);
      headers.set('Content-Range', `bytes ${start}-${end}/${data.length}`);
    }
    if (body) headers.set('Content-Length', String(body.length));
    if (options.method === 'HEAD') { body = null; headers.set('Content-Length', String(data?.length || 0)); }
    const response = {key, asset, isManifest, method: options.method, options, headers, status, body};
    mutate(response);
    return new Response(response.body, {status: response.status, headers: response.headers});
  };
  return {manifest, files, requests, fetcher};
}
const verify = (data, options = {}) => verifyPublicRelease(data.manifest, {baseURL, origins, fetcher: data.fetcher, ...options});
const hasFailure = (report, code) => report.failures.some(failure => failure.code === code);

test('complete verified release produces only an operator proposal, with the public commit marker checked last', async () => {
  const data = fixture(), report = await verify(data);
  assert.equal(report.ok, true);
  assert.equal(report.verifiedFiles, data.manifest.assets.length);
  assert.equal(report.verifiedBytes, data.manifest.totalBytes);
  assert.equal(report.rangeSamples.length, 3);
  assert.deepEqual(report.operatorDownloadConfig, {schemaVersion: 1,
    assetBaseURL: 'https://downloads.test/releases/test-release/assets/',
    mapBaseURL: 'https://downloads.test/releases/test-release/maps/', fallbackToGameServer: false});
  assert.equal(data.requests.at(-1).key, data.manifest.manifestKey);
  assert(data.requests.every(request => ['GET', 'HEAD', 'OPTIONS'].includes(request.method)));
  assert(data.requests.every(request => request.credentials === 'omit' && request.redirect === 'error'));
  assert.equal(report.browserAcceptance.status, 'not-run');
  assert.equal(report.browserAcceptance.required, true);
  assert(!JSON.stringify(report).includes('C:/private'));
  for (const asset of data.manifest.assets) assert.equal(data.requests.filter(request => request.key === asset.key && request.method === 'HEAD').length, 2);
});

test('real loopback HTTP validates streamed bytes, CORS, ETag and byte ranges', async t => {
  const data = fixture();
  const server = createServer(async (req, res) => {
    try {
      const reply = await data.fetcher(`http://127.0.0.1${req.url}`, {method: req.method,
        headers: {Origin: req.headers.origin, ...(req.headers.range ? {Range: req.headers.range} : {})}});
      res.writeHead(reply.status, Object.fromEntries(reply.headers));
      res.end(req.method === 'HEAD' ? undefined : Buffer.from(await reply.arrayBuffer()));
    } catch { res.writeHead(500); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const report = await verifyPublicRelease(data.manifest, {baseURL: `http://127.0.0.1:${server.address().port}/`, origins,
    allowLocalhost: true, concurrency: 2});
  assert.equal(report.ok, true, JSON.stringify(report.failures));
  assert.equal(report.verifiedBytes, data.manifest.totalBytes);
});

test('same-size object corruption fails SHA-256 and cannot yield a configuration', async () => {
  const data = fixture(response => { if (response.asset && response.method === 'GET' && !response.options.headers.Range)
    response.body = Buffer.alloc(response.asset.bytes, 88); });
  const report = await verify(data);
  assert(hasFailure(report, 'sha256'));
  assert.equal(report.ok, false);
  assert.equal(report.operatorDownloadConfig, null);
});

test('HEAD size mismatch stops the object GET and rejects the release', async () => {
  const data = fixture(response => { if (response.asset && response.method === 'HEAD') response.headers.set('Content-Length', '1'); });
  const report = await verify(data);
  assert(hasFailure(report, 'content-length'));
  assert.equal(report.verifiedFiles, 0);
  assert(!data.requests.some(request => request.method === 'GET' && data.manifest.assets.some(asset => asset.key === request.key)));
});

test('HEAD response bodies and oversized GET streams fail without yielding a switch proposal', async () => {
  for (const mutate of [
    response => { if (response.asset && response.method === 'HEAD') response.body = Buffer.from('unexpected'); },
    response => { if (response.asset && response.method === 'GET' && !response.options.headers.Range)
      response.body = Buffer.alloc(response.asset.bytes + 1); },
  ]) {
    const data = fixture(mutate), report = await verify(data);
    assert(hasFailure(report, 'body-size'));
    assert.equal(report.operatorDownloadConfig, null);
  }
});

test('gzip transport rejects Content-Encoding even if the fetched decoded bytes happen to match', async () => {
  for (const encoding of ['gzip', 'identity']) {
    const data = fixture(response => { if (response.key.endsWith('.gz')) response.headers.set('Content-Encoding', encoding); });
    const report = await verify(data);
    assert(hasFailure(report, 'content-encoding'));
    assert.equal(report.ok, false);
  }
});

test('CORS rejects wildcard origins, missing exposure and credentialed delivery', async () => {
  for (const [name, value, code] of [
    ['Access-Control-Allow-Origin', '*', 'cors-origin'],
    ['Access-Control-Expose-Headers', 'ETag', 'cors-expose'],
    ['Access-Control-Allow-Credentials', 'true', 'cors-credentials'],
  ]) {
    const data = fixture(response => response.headers.set(name, value));
    const report = await verify(data);
    assert(hasFailure(report, code), JSON.stringify(report.failures));
    assert.equal(report.ok, false);
  }
});

test('the second game origin is checked separately', async () => {
  const data = fixture(response => {
    if (response.options.headers.Origin.endsWith(':8443')) response.headers.set('Access-Control-Allow-Origin', origins[0]);
  });
  const report = await verify(data);
  assert(hasFailure(report, 'cors-origin'));
  assert.equal(report.verifiedFiles, 0);
});

test('public CORS preflight must support Range without write methods', async () => {
  for (const [header, value, code] of [
    ['Access-Control-Allow-Methods', 'GET, HEAD, PUT', 'cors-methods'],
    ['Access-Control-Allow-Headers', 'Content-Type', 'cors-range'],
  ]) {
    const data = fixture(response => { if (response.method === 'OPTIONS') response.headers.set(header, value); });
    const report = await verify(data);
    assert(hasFailure(report, code));
    assert.equal(report.ok, false);
    assert.equal(report.operatorDownloadConfig, null);
  }
});

test('a CDN that ignores Range, reports a wrong interval or returns different bytes is rejected', async () => {
  for (const [mutate, code] of [
    [response => { response.status = 200; }, 'range-status'],
    [response => response.headers.set('Content-Range', 'bytes 1-2/3'), 'content-range'],
    [response => { response.body = Buffer.alloc(response.body.length, 88); }, 'range-bytes'],
  ]) {
    const data = fixture(response => { if (response.options.headers.Range) mutate(response); });
    const report = await verify(data);
    assert(hasFailure(report, code), JSON.stringify(report.failures));
    assert.equal(report.ok, false);
  }
});

test('HEAD and GET must represent the same immutable version', async () => {
  const data = fixture(response => { if (response.method === 'GET' && response.asset) response.headers.set('ETag', '"changed"'); });
  const report = await verify(data);
  assert(hasFailure(report, 'etag-stability'));
  assert.equal(report.verifiedFiles, 0);
});

test('a missing last-published manifest is incomplete even if every resource passed', async () => {
  const data = fixture(response => { if (response.isManifest) { response.status = 404; response.body = null; } });
  const report = await verify(data);
  assert.equal(report.verifiedFiles, data.manifest.fileCount);
  assert(hasFailure(report, 'manifest-unpublished'));
  assert.equal(report.operatorDownloadConfig, null);
  assert.equal(data.requests.at(-1).key, data.manifest.manifestKey);
});

test('manifest mismatches and local-path disclosure are rejected instead of being ignored', async () => {
  for (const mutate of [
    publicManifest => { publicManifest.assets[0].sha256 = '0'.repeat(64); },
    publicManifest => { publicManifest.assets[0].sourcePath = 'C:/secret/file'; },
  ]) {
    const data = fixture(response => {
      if (response.isManifest) {
        const value = JSON.parse(response.body); mutate(value); response.body = Buffer.from(JSON.stringify(value));
        response.headers.set('Content-Length', String(response.body.length));
      }
    });
    const report = await verify(data);
    assert(hasFailure(report, 'manifest-mismatch'));
    assert.equal(report.ok, false);
  }
});

test('unknown objects cannot succeed and directory listing cannot be exposed', async () => {
  const data = fixture(response => { if (response.status === 404) { response.status = 200; response.body = Buffer.from('index'); } });
  const report = await verify(data);
  assert.equal(report.failures.filter(failure => failure.code === 'negative-status').length, 2);
  assert.equal(report.ok, false);
});

test('asset requests are bounded, and hashing accepts a multi-chunk response stream', async () => {
  const data = fixture();
  let active = 0, maximum = 0;
  const fetcher = async (...args) => {
    active++; maximum = Math.max(maximum, active);
    await new Promise(resolve => setTimeout(resolve, 2));
    try {
      const response = await data.fetcher(...args);
      if (args[1].method !== 'GET' || !data.files.has(new URL(args[0]).pathname.slice(1))) return response;
      const bytes = Buffer.from(await response.arrayBuffer());
      return new Response(new ReadableStream({start(controller) {
        for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.subarray(i, i + 7));
        controller.close();
      }}), {status: response.status, headers: response.headers});
    } finally { active--; }
  };
  const report = await verify(data, {fetcher, concurrency: 2});
  assert.equal(report.ok, true);
  assert.equal(maximum, 2);
});

test('base and origin inputs fail closed before any HTTP request', async () => {
  for (const value of ['http://downloads.test/', 'https://u:p@downloads.test/', 'https://@downloads.test/', 'https://downloads.test/?token=x',
    'https://downloads.test/#fragment', 'https://downloads.test/a/../', 'https://downloads.test/%2e%2e/',
    'https://downloads.test/%2f/', 'https://downloads.test/\\other', ' https://downloads.test/'])
    assert.throws(() => validatePublicBase(value));
  assert.throws(() => validatePublicBase('http://downloads.test/', {allowLocalhost: true}));
  assert.equal(validatePublicBase('http://127.0.0.1:1234', {allowLocalhost: true}), 'http://127.0.0.1:1234/');
  const data = fixture();
  await assert.rejects(verify(data, {origins: ['https://game.test/private-path/']}), /origin/);
  await assert.rejects(verify(data, {origins: []}), /origin/);
  await assert.rejects(verify(data, {concurrency: 9}), /Concurrency/);
  assert.equal(data.requests.length, 0);
});

test('escaped, sensitive or duplicate keys fail before requests', async () => {
  for (const key of ['releases/test-release/assets/../secret.json', 'releases/test-release/assets/%2e%2e/secret.json',
    'releases/test-release/assets/.env', 'releases/test-release/assets/credentials.json',
    'releases/other/assets/texture.png', 'https://other.test/file.png']) {
    const data = fixture(); data.manifest.assets[0].key = key;
    await assert.rejects(verify(data)); assert.equal(data.requests.length, 0);
  }
  const data = fixture(); data.manifest.assets.push({...data.manifest.assets[0]});
  await assert.rejects(verify(data), /duplicate/i); assert.equal(data.requests.length, 0);
});

test('network errors are reported without leaking fetcher error text', async () => {
  const data = fixture(), report = await verify(data, {fetcher: async () => { throw Error('secret credential or URL'); }});
  assert.equal(report.ok, false);
  assert(!JSON.stringify(report).includes('secret credential'));
  assert.equal(report.operatorDownloadConfig, null);
});

test('CLI requires a persisted report, supports repeated origins, and exposes no insecure flag', () => {
  assert.deepEqual(parseVerifyArgs(['--manifest', 'local.json', '--base', baseURL, '--origin', origins[0],
    '--origin', origins[1], '--report', 'report.json', '--concurrency', '2']),
  {manifestPath: 'local.json', baseURL, origins, reportPath: 'report.json', concurrency: 2});
  for (const args of [[], ['--allow-localhost'], ['--manifest', 'a', '--manifest', 'b'], ['--origin']])
    assert.throws(() => parseVerifyArgs(args));
  assert.throws(() => parseVerifyArgs(['--manifest', 'same.json', '--base', baseURL, '--origin', origins[0], '--report', './same.json']), /overwrite/);
});

test('resume rechecks every historical ETag at both origins, rehashes failed and Range objects, and retains prior failures', async () => {
  const failed = fixture(response => {
    if (response.key.endsWith('test.png') && response.method === 'GET' && !response.options.headers.Range)
      response.body = Buffer.alloc(response.asset.bytes, 88);
  });
  const prior = await verify(failed, {rangeSamples: 1});
  assert.equal(prior.ok, false); assert.equal(prior.verifiedFiles, 2);
  const data = fixture(), report = await verify(data, {resumeReport: prior, rangeSamples: 1});
  assert.equal(report.ok, true, JSON.stringify(report.failures));
  assert.equal(report.verifiedFiles, 3); assert.equal(report.verifiedBytes, data.manifest.totalBytes);
  assert.equal(report.resume.reusedFiles, 1); assert.equal(report.resume.freshlyHashedFiles, 2);
  assert.deepEqual(report.resume.historicalFailures, prior.failures);
  assert.equal(report.resume.sourceReportSha256.length, 64);
  assert.equal(report.resume.reusedBytes + report.resume.freshlyHashedBytes, report.verifiedBytes);
  const reused = data.manifest.assets[1];
  assert(!data.requests.some(request => request.key === reused.key && request.method === 'GET'));
  for (const asset of data.manifest.assets)
    assert.equal(data.requests.filter(request => request.key === asset.key && request.method === 'HEAD').length, origins.length);
  assert.equal(data.requests[0].key, data.manifest.manifestKey);
  assert.equal(data.requests.at(-1).key, data.manifest.manifestKey);
  assert.equal(data.requests.filter(request => request.method === 'OPTIONS').length, origins.length);
});

test('resume rejects wrong identity, duplicates, tampered inventory proofs and inconsistent accounting before requests', async () => {
  const original = await verify(fixture(), {rangeSamples: 1});
  for (const mutate of [
    value => { value.schemaVersion = 2; },
    value => { value.kind = 'publisher'; },
    value => { value.releaseId = 'another-release'; },
    value => { value.baseURL = 'https://elsewhere.test/'; },
    value => { value.origins.reverse(); },
    value => { value.origins.push(origins[0]); },
    value => { value.assets.push({...value.assets[0]}); },
    value => { value.assets[0].bytes++; },
    value => { value.assets[0].sha256 = '0'.repeat(64); },
    value => { value.assets[0].etag = 'W/"weak"'; },
    value => { value.assets[0].extra = 'unrecognized'; },
    value => { value.assets[0].key = 'releases/test-release/assets/missing.png'; },
    value => { value.verifiedFiles++; },
    value => { value.verifiedBytes++; },
    value => { value.fileCount++; },
    value => { value.totalBytes++; },
    value => { value.completedAt = null; },
    value => { value.completedAt = '2000-01-01T00:00:00.000Z'; },
    value => { value.publicManifest.ok = false; },
    value => { value.publicManifest.key = 'releases/other/release-manifest.json'; },
    value => { value.publicManifest.sha256 = 'invalid'; },
    value => { value.rangeSamples.push({...value.rangeSamples[0]}); },
  ]) {
    const prior = structuredClone(original); mutate(prior);
    const data = fixture(); await assert.rejects(verify(data, {resumeReport: prior, rangeSamples: 1}), /Resume report/);
    assert.equal(data.requests.length, 0);
  }
});

test('resume requires complete object accounting and valid historical failure scopes', async () => {
  const failing = fixture(response => { if (response.key.endsWith('test.png')) response.status = 503; });
  const original = await verify(failing, {rangeSamples: 1});
  for (const mutate of [
    value => { value.failures = []; },
    value => { value.failures[0].scope = 'https://other.test/private'; },
    value => { value.failures.push({...value.failures[0]}); },
    value => { value.failures[0].scope = value.assets[0].key; },
    value => { value.failures[0].code = 'token=private'; },
    value => { value.failures[0].message += '\nunsafe'; },
  ]) {
    const prior = structuredClone(original); mutate(prior);
    const data = fixture(); await assert.rejects(verify(data, {resumeReport: prior, rangeSamples: 1}), /Resume report/);
    assert.equal(data.requests.length, 0);
  }
});

test('resume refuses a changed strong ETag or changed CORS metadata without accepting historical bytes', async () => {
  const prior = await verify(fixture(), {rangeSamples: 1});
  for (const [mutate, code] of [
    response => response.headers.set('ETag', '"changed-but-valid"'),
    response => response.headers.set('Access-Control-Allow-Origin', '*'),
  ].map((mutate, index) => [mutate, index ? 'cors-origin' : 'resume-etag-mismatch'])) {
    const data = fixture(response => { if (response.key.endsWith('asset-manifest.json') && response.method === 'HEAD') mutate(response); });
    const report = await verify(data, {resumeReport: prior, rangeSamples: 1});
    assert.equal(report.ok, false); assert(hasFailure(report, code));
    assert.equal(report.operatorDownloadConfig, null); assert.equal(report.verifiedFiles, 2);
  }
  const tampered = structuredClone(prior); tampered.assets[0].etag = '"forged-but-valid"';
  const report = await verify(fixture(), {resumeReport: tampered, rangeSamples: 1});
  assert(hasFailure(report, 'resume-etag-mismatch'));
});

test('resume checks fresh manifest bytes before reuse and rejects a wrong historical manifest digest', async () => {
  const prior = await verify(fixture(), {rangeSamples: 1});
  const altered = structuredClone(prior); altered.publicManifest.sha256 = '0'.repeat(64);
  const data = fixture(), report = await verify(data, {resumeReport: altered, rangeSamples: 1});
  assert.equal(report.ok, false); assert(hasFailure(report, 'resume-manifest-mismatch'));
  assert.equal(report.verifiedFiles, 0); assert.equal(data.requests.length, 1);
  const reformatted = fixture(response => { if (response.isManifest) {
    response.body = Buffer.from(JSON.stringify(JSON.parse(response.body)));
    response.headers.set('Content-Length', String(response.body.length));
  }});
  const changed = await verify(reformatted, {resumeReport: prior, rangeSamples: 1});
  assert(hasFailure(changed, 'resume-manifest-mismatch')); assert.equal(changed.verifiedFiles, 0);
});

test('resume fully reads Range samples, reruns global checks, and checks the commit marker last', async () => {
  const prior = await verify(fixture(), {rangeSamples: 1});
  for (const [mutate, code] of [
    [response => { if (response.key.endsWith('.gz') && response.method === 'GET' && !response.options.headers.Range)
      response.body = Buffer.alloc(response.asset.bytes, 88); }, 'sha256'],
    [response => { if (response.method === 'OPTIONS') response.headers.set('Access-Control-Allow-Methods', 'GET, PUT'); }, 'cors-methods'],
  ]) {
    const report = await verify(fixture(mutate), {resumeReport: prior, rangeSamples: 1});
    assert(hasFailure(report, code)); assert.equal(report.ok, false); assert.equal(report.operatorDownloadConfig, null);
  }
  let manifests = 0;
  const data = fixture(response => { if (response.isManifest && ++manifests === 2) {
    response.status = 503; response.body = null;
  }});
  const report = await verify(data, {resumeReport: prior, rangeSamples: 1});
  assert.equal(report.verifiedFiles, 3); assert(hasFailure(report, 'manifest-unpublished'));
  assert.equal(report.operatorDownloadConfig, null); assert.equal(data.requests.at(-1).key, data.manifest.manifestKey);
});

test('network retries are bounded and recorded without exposing raw error details', async () => {
  const data = fixture(); let attempts = 0;
  const fetcher = async (url, options) => {
    if (url.endsWith('test.png') && options.method === 'HEAD' && options.headers.Origin === origins[0] && ++attempts <= 2)
      throw Error('private credential');
    return data.fetcher(url, options);
  };
  const report = await verify(data, {fetcher});
  assert.equal(report.ok, true); assert.equal(attempts, 3);
  assert.equal(report.requestRetryPolicy.retryEvents.length, 2);
  assert(report.requestRetryPolicy.retryEvents.every(event => event.retryScheduled));
  assert(!JSON.stringify(report).includes('private credential'));
  let failedAttempts = 0;
  const persistent = await verify(fixture(), {fetcher: async () => { failedAttempts++; throw Error('private credential'); }});
  assert.equal(persistent.ok, false);
  assert.equal(persistent.requestRetryPolicy.retryEvents.filter(event => !event.retryScheduled).length, 8);
  // 3 object HEADs, 2 preflights (no retry), 2 negative GETs and 1 manifest GET.
  assert.equal(failedAttempts, 20);
});

test('HTTP and content failures are not retried, and external cancellation cannot start extra attempts', async () => {
  const data = fixture(response => { if (response.key.endsWith('test.png') && response.method === 'HEAD') response.status = 503; });
  const report = await verify(data);
  assert(hasFailure(report, 'http-status')); assert.equal(report.requestRetryPolicy.retryEvents.length, 0);
  assert.equal(data.requests.filter(request => request.key.endsWith('test.png') && request.method === 'HEAD').length, 1);
  const controller = new AbortController(); let attempts = 0;
  const cancelled = await verify(fixture(), {signal: controller.signal, fetcher: async () => {
    attempts++; controller.abort(); throw Error('cancelled');
  }});
  assert.equal(cancelled.ok, false); assert.equal(cancelled.requestRetryPolicy.retryEvents.length, 0);
  assert.equal(attempts, 8);
});

test('resume CLI preserves the historical report and accepts bounded retry settings', () => {
  const args = ['--manifest', 'local.json', '--base', baseURL, '--origin', origins[0], '--report', 'new.json'];
  const options = parseVerifyArgs([...args, '--resume-report', 'prior.json', '--network-retries', '1']);
  assert.equal(options.resumeReportPath, 'prior.json'); assert.equal(options.networkRetries, 1);
  assert.throws(() => parseVerifyArgs([...args, '--resume-report', './new.json']), /separate/);
  assert.throws(() => parseVerifyArgs([...args, '--resume-report', './local.json']), /separate/);
});
