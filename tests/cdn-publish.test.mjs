import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Readable } from 'node:stream';
import { Writable } from 'node:stream';
import https from 'node:https';
import { createHash } from 'node:crypto';
import { publishRelease, validateReleasePlan, IMMUTABLE_CACHE_CONTROL } from '../scripts/cdn/publish-release.mjs';
import { S3Error, validateR2Endpoint, signR2Request, createR2Client } from '../scripts/cdn/s3-client.mjs';
import { toPublicManifest } from '../scripts/cdn/release-manifest.mjs';

const hash = data => createHash('sha256').update(data).digest('hex');
const endpoint = `https://${'a'.repeat(32)}.r2.cloudflarestorage.com`;
const credentials = { accessKeyId: 'test-access-key', secretAccessKey: 'test-secret-value' };

async function fixture(t, count = 2) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dust2-cdn-publish-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sourceRoot = path.join(root, 'source');
  await mkdir(sourceRoot);
  const plan = { schemaVersion: 1, releaseId: 'test-v1', manifestKey: 'releases/test-v1/release-manifest.json', sourceRoots: [sourceRoot], assets: [] };
  for (let index = 0; index < count; index++) {
    const body = Buffer.from(`verified bytes ${index} ${(index + 1).toString().repeat(30)}`);
    const sourcePath = path.join(sourceRoot, `${index}.bin`);
    await writeFile(sourcePath, body);
    plan.assets.push({ key: `releases/test-v1/assets/${index}.bin`, sourcePath, bytes: body.length,
      sha256: hash(body), contentType: 'application/octet-stream', cacheControl: IMMUTABLE_CACHE_CONTROL });
  }
  return { root, sourceRoot, plan, readyPath: path.join(root, 'evidence', 'READY.json') };
}

function mockR2({ beforePut, afterPut, mutateGet, failGet, latency = 0 } = {}) {
  const objects = new Map();
  const calls = [];
  let active = 0;
  let maxActive = 0;
  const attempts = new Map();
  function count(method, key) { const k = `${method} ${key}`; const n = (attempts.get(k) ?? 0) + 1; attempts.set(k, n); return n; }
  const pause = () => latency ? new Promise(resolve => setTimeout(resolve, latency)) : Promise.resolve();
  const client = {
    async headObject(key) {
      calls.push(['HEAD', key]); count('HEAD', key);
      const stored = objects.get(key);
      return stored ? { headers: { ...stored.headers } } : null;
    },
    async putObject(key, options) {
      calls.push(['PUT', key, options]);
      const attempt = count('PUT', key);
      active++; maxActive = Math.max(maxActive, active);
      try {
        await pause();
        await beforePut?.(key, options, attempt);
        if (objects.has(key) && options.ifNoneMatch === '*') throw new S3Error('PUT object', 412);
        const body = options.body ?? await readFile(options.sourcePath ?? options.filePath);
        objects.set(key, { body, headers: { 'content-length': String(body.length), 'content-type': options.contentType,
          'cache-control': options.cacheControl, 'x-amz-meta-sha256': options.sha256, etag: 'opaque-etag' } });
        await afterPut?.(key, options, attempt);
        return { headers: {} };
      } finally { active--; }
    },
    async getObject(key) {
      calls.push(['GET', key]);
      const attempt = count('GET', key);
      const stored = objects.get(key);
      if (!stored) throw new S3Error('GET object', 404);
      await pause();
      const failure = failGet?.(key, attempt);
      if (failure) {
        return { headers: { ...stored.headers }, body: Readable.from((async function* () {
          yield stored.body.subarray(0, 2);
          throw new Error('simulated interrupted stream');
        })()) };
      }
      const body = mutateGet?.(key, stored.body, attempt) ?? stored.body;
      return { headers: { ...stored.headers }, body: Readable.from([body.subarray(0, 2), body.subarray(2)]) };
    },
  };
  return { client, objects, calls, attempts, get maxActive() { return maxActive; } };
}

const noDelay = async () => {};

test('dry-run hashes every source without credentials, remote access or READY writes', async t => {
  const f = await fixture(t);
  const remote = mockR2();
  const result = await publishRelease(f.plan, { client: remote.client, readyPath: f.readyPath });
  assert.equal(result.dryRun, true);
  assert.equal(result.uploaded, 0);
  assert.equal(result.activated, false);
  assert.equal(remote.calls.length, 0);
  await assert.rejects(readFile(f.readyPath), { code: 'ENOENT' });
  const expectedPublic = Buffer.from(`${JSON.stringify(toPublicManifest(f.plan), null, 2)}\n`);
  assert.equal(result.manifestSha256, hash(expectedPublic));
  assert.ok(!expectedPublic.toString().includes(f.sourceRoot));
});

test('publishes exact keys, streams verification and publishes completion manifest last', async t => {
  const f = await fixture(t);
  const remote = mockR2();
  const result = await publishRelease(f.plan, { client: remote.client, dryRun: false, readyPath: f.readyPath, delay: noDelay });
  assert.equal(result.uploaded, 2);
  assert.equal(result.verified, 2);
  assert.equal(result.activated, false);
  assert.deepEqual(JSON.parse(await readFile(f.readyPath, 'utf8')), result);
  const puts = remote.calls.filter(c => c[0] === 'PUT');
  assert.deepEqual(new Set(puts.map(c => c[1])), new Set([...f.plan.assets.map(a => a.key), f.plan.manifestKey]));
  assert.equal(puts.at(-1)[1], f.plan.manifestKey);
  const manifestPutIndex = remote.calls.findIndex(c => c[0] === 'PUT' && c[1] === f.plan.manifestKey);
  for (const asset of f.plan.assets) {
    assert.ok(remote.calls.findIndex(c => c[0] === 'GET' && c[1] === asset.key) < manifestPutIndex);
  }
  for (const call of puts) { assert.equal(call[2].ifNoneMatch, '*'); assert.equal(call[2].contentEncoding, undefined); }
  const publicBody = remote.objects.get(f.plan.manifestKey).body.toString();
  assert.ok(!publicBody.includes('sourcePath'));
  assert.ok(!publicBody.includes('sourceRoots'));
  assert.ok(!publicBody.includes(f.root));
});

test('repeat publication skips PUT but rechecks full bytes and archives prior proof', async t => {
  const f = await fixture(t);
  const remote = mockR2();
  const options = { client: remote.client, dryRun: false, readyPath: f.readyPath, delay: noDelay };
  await publishRelease(f.plan, options);
  const offset = remote.calls.length;
  const result = await publishRelease(f.plan, options);
  const calls = remote.calls.slice(offset);
  assert.equal(result.uploaded, 0);
  assert.equal(result.reused, 2);
  assert.equal(result.manifestResult, 'reused');
  assert.equal(calls.filter(c => c[0] === 'PUT').length, 0);
  assert.equal(calls.filter(c => c[0] === 'GET').length, 3);
  assert.ok((await readdir(path.dirname(f.readyPath))).some(name => name.startsWith('READY.json.previous-')));
});

test('transient PUT failures retry within bound', async t => {
  const f = await fixture(t, 1);
  const remote = mockR2({ beforePut: (key, _options, attempt) => {
    if (key !== f.plan.manifestKey && attempt < 3) throw new S3Error('PUT object', 503);
  } });
  const result = await publishRelease(f.plan, { client: remote.client, dryRun: false, readyPath: f.readyPath, retries: 2, delay: noDelay });
  assert.equal(result.status, 'READY');
  assert.equal(remote.attempts.get(`PUT ${f.plan.assets[0].key}`), 3);
});

test('exhausted retry budget and missing write permission do not publish completion', async t => {
  const f = await fixture(t, 1);
  const remote = mockR2({ beforePut: () => { throw new S3Error('PUT object', 503); } });
  await assert.rejects(publishRelease(f.plan, { client: remote.client, dryRun: false, readyPath: f.readyPath, retries: 2, delay: noDelay }), /HTTP 503/);
  assert.equal(remote.attempts.get(`PUT ${f.plan.assets[0].key}`), 3);
  assert.ok(!remote.objects.has(f.plan.manifestKey));
  await assert.rejects(readFile(f.readyPath), { code: 'ENOENT' });
});

test('lost successful PUT response resumes using conditional winner without overwrite', async t => {
  const f = await fixture(t, 1);
  const remote = mockR2({ afterPut: (key, _options, attempt) => {
    if (key === f.plan.assets[0].key && attempt === 1) throw new S3Error('PUT object');
  } });
  const result = await publishRelease(f.plan, { client: remote.client, dryRun: false, readyPath: f.readyPath, delay: noDelay });
  assert.equal(result.reused, 1);
  assert.equal(remote.attempts.get(`PUT ${f.plan.assets[0].key}`), 2);
  assert.equal(remote.objects.get(f.plan.assets[0].key).body.toString(), (await readFile(f.plan.assets[0].sourcePath)).toString());
});

test('stream interruption retries complete GET, never trusts a partial hash', async t => {
  const f = await fixture(t, 1);
  const remote = mockR2({ failGet: (key, attempt) => key === f.plan.assets[0].key && attempt === 1 });
  await publishRelease(f.plan, { client: remote.client, dryRun: false, readyPath: f.readyPath, delay: noDelay });
  assert.equal(remote.attempts.get(`GET ${f.plan.assets[0].key}`), 2);
});

test('remote byte corruption with matching metadata and ETag prevents manifest and READY', async t => {
  const f = await fixture(t, 1);
  const remote = mockR2({ mutateGet: (key, body) => key === f.plan.assets[0].key ? Buffer.alloc(body.length, 120) : body });
  await assert.rejects(publishRelease(f.plan, { client: remote.client, dryRun: false, readyPath: f.readyPath, delay: noDelay }), /SHA-256 conflict/);
  assert.ok(!remote.objects.has(f.plan.manifestKey));
  await assert.rejects(readFile(f.readyPath), { code: 'ENOENT' });
  const putsBefore = remote.calls.filter(c => c[0] === 'PUT').length;
  await assert.rejects(publishRelease(f.plan, { client: remote.client, dryRun: false, readyPath: f.readyPath, delay: noDelay }), /SHA-256 conflict/);
  assert.equal(remote.calls.filter(c => c[0] === 'PUT').length, putsBefore);
});

test('failed completion marker can resume from verified objects without republishing assets', async t => {
  const f = await fixture(t);
  let fail = true;
  const remote = mockR2({ beforePut: key => { if (fail && key === f.plan.manifestKey) throw new S3Error('PUT object', 403); } });
  const options = { client: remote.client, dryRun: false, readyPath: f.readyPath, delay: noDelay };
  await assert.rejects(publishRelease(f.plan, options), /HTTP 403/);
  await assert.rejects(readFile(f.readyPath), { code: 'ENOENT' });
  fail = false;
  const result = await publishRelease(f.plan, options);
  assert.equal(result.reused, 2);
  assert.equal(result.uploaded, 0);
  assert.equal(result.status, 'READY');
});

test('existing incompatible headers are immutable conflicts, including gzip encoding', async t => {
  const f = await fixture(t, 1);
  const remote = mockR2();
  const asset = f.plan.assets[0];
  await remote.client.putObject(asset.key, { ...asset, ifNoneMatch: '*' });
  remote.objects.get(asset.key).headers['content-encoding'] = 'gzip';
  const before = remote.calls.length;
  await assert.rejects(publishRelease(f.plan, { client: remote.client, dryRun: false, readyPath: f.readyPath }), /Content-Encoding/);
  assert.equal(remote.calls.slice(before).filter(c => c[0] === 'PUT').length, 0);
});

test('recheck failure archives old READY without presenting stale proof as current', async t => {
  const f = await fixture(t, 1);
  const remote = mockR2();
  const options = { client: remote.client, dryRun: false, readyPath: f.readyPath };
  await publishRelease(f.plan, options);
  remote.objects.get(f.plan.assets[0].key).body.fill(0);
  await assert.rejects(publishRelease(f.plan, options), /SHA-256 conflict/);
  await assert.rejects(readFile(f.readyPath), { code: 'ENOENT' });
  assert.ok((await readdir(path.dirname(f.readyPath))).some(name => name.startsWith('READY.json.previous-')));
});

test('local integrity failure is discovered before any remote request', async t => {
  const f = await fixture(t);
  const asset = f.plan.assets[1];
  await writeFile(asset.sourcePath, Buffer.alloc(asset.bytes, 1));
  const remote = mockR2();
  await assert.rejects(publishRelease(f.plan, { client: remote.client, dryRun: false, readyPath: f.readyPath }), /Source SHA-256 mismatch/);
  assert.equal(remote.calls.length, 0);
});

test('object allowlist rejects repo, traversal and reserved completion-marker keys', async t => {
  const f = await fixture(t, 1);
  for (const badKey of ['releases/test-v1/server/index.json', 'releases/test-v1/assets/../secret.json',
    'releases/test-v1/assets/%2e%2e/secret.json', 'releases/test-v1/assets/.env.json',
    'releases/test-v1/assets/credentials.json', 'releases/test-v1/release-manifest.json',
    'releases/other-v1/assets/a.bin', 'releases/test-v1/maps/de_mirage/server.bin']) {
    assert.throws(() => validateReleasePlan({ ...f.plan, assets: [{ ...f.plan.assets[0], key: badKey }] }));
  }
});

test('source root escape is rejected even if the key and hash are valid', async t => {
  const f = await fixture(t, 1);
  const outside = path.join(f.root, 'outside.bin');
  await writeFile(outside, await readFile(f.plan.assets[0].sourcePath));
  f.plan.assets[0].sourcePath = outside;
  const remote = mockR2();
  await assert.rejects(publishRelease(f.plan, { client: remote.client, dryRun: false, readyPath: f.readyPath }), /approved roots/);
  assert.equal(remote.calls.length, 0);
});

test('READY output cannot overwrite source assets', async t => {
  const f = await fixture(t, 1);
  const remote = mockR2();
  await assert.rejects(publishRelease(f.plan, { client: remote.client, dryRun: false, readyPath: path.join(f.sourceRoot, 'READY.json') }), /outside all asset source roots/);
  assert.equal(remote.calls.length, 0);
});

test('realpath rejects symlink escape from an approved root', async t => {
  const f = await fixture(t, 1);
  const outsideDir = path.join(f.root, 'outside-directory');
  await mkdir(outsideDir);
  const outside = path.join(outsideDir, 'outside.bin');
  await writeFile(outside, await readFile(f.plan.assets[0].sourcePath));
  const link = path.join(f.sourceRoot, 'linked-directory');
  await symlink(outsideDir, link, process.platform === 'win32' ? 'junction' : 'dir');
  f.plan.assets[0].sourcePath = path.join(link, 'outside.bin');
  await assert.rejects(publishRelease(f.plan), /approved roots/);
});

test('bounded upload workers do not exceed requested concurrency', async t => {
  const f = await fixture(t, 8);
  const remote = mockR2({ latency: 5 });
  await publishRelease(f.plan, { client: remote.client, dryRun: false, concurrency: 2, readyPath: f.readyPath, delay: noDelay });
  assert.equal(remote.maxActive, 2);
});

test('R2 client refuses cleartext, custom hosts, userinfo, query and URL paths', () => {
  for (const url of ['http://a.r2.cloudflarestorage.com', 'https://example.com',
    `${endpoint}/secret`, `${endpoint}?token=unsafe`, `${endpoint}:8443`,
    `https://${'a'.repeat(32)}.apac.r2.cloudflarestorage.com`,
    `https://user:pass@${'a'.repeat(32)}.r2.cloudflarestorage.com`,
    `https://${'a'.repeat(32)}.r2.cloudflarestorage.com.evil.test`]) assert.throws(() => validateR2Endpoint(url));
  assert.equal(validateR2Endpoint(endpoint).protocol, 'https:');
  assert.throws(() => createR2Client({ endpoint, bucket: 'fixture-bucket' }), /R2_ACCESS_KEY_ID/);
});

test('SigV4 signs date, exact encoded object path, conditional PUT and payload SHA', () => {
  const request = signR2Request({ endpoint, bucket: 'fixture-bucket', key: 'releases/v1/assets/space name.bin', method: 'PUT',
    payloadHash: hash('fixture'), credentials, now: new Date('2026-10-04T00:00:00.000Z'),
    headers: { 'content-type': 'application/octet-stream', 'content-length': '7', 'if-none-match': '*' } });
  assert.equal(request.path, '/fixture-bucket/releases/v1/assets/space%20name.bin');
  assert.equal(request.headers['x-amz-date'], '20261004T000000Z');
  assert.equal(request.headers['x-amz-content-sha256'], hash('fixture'));
  assert.equal(request.headers['if-none-match'], '*');
  assert.match(request.headers.authorization, /Credential=test-access-key\/20261004\/auto\/s3\/aws4_request/);
  assert.match(request.headers.authorization, /SignedHeaders=content-length;content-type;host;if-none-match;x-amz-content-sha256;x-amz-date/);
  assert.ok(!JSON.stringify(request.headers).includes(credentials.secretAccessKey));
  assert.throws(() => signR2Request({ endpoint, bucket: 'fixture-bucket', key: 'a', method: 'GET', credentials, headers: { 'x-test': 'bad\r\nvalue' } }), /header/);
});

test('native R2 client streams file bytes with signed conditional headers and no encoding', async t => {
  const f = await fixture(t, 1);
  const asset = f.plan.assets[0];
  const requests = [];
  const objects = new Map();
  t.mock.method(https, 'request', (options, callback) => {
    requests.push(options);
    const chunks = [];
    const request = new Writable({
      write(chunk, _encoding, done) { chunks.push(Buffer.from(chunk)); done(); },
      final(done) {
        let statusCode = 200;
        const key = options.path;
        const body = Buffer.concat(chunks);
        if (options.method === 'PUT') {
          assert.equal(options.headers['content-length'], String(body.length));
          assert.equal(options.headers['x-amz-content-sha256'], hash(body));
          if (objects.has(key) && options.headers['if-none-match'] === '*') statusCode = 412;
          else objects.set(key, { body, headers: { 'content-length': String(body.length), 'content-type': options.headers['content-type'],
            'cache-control': options.headers['cache-control'], 'x-amz-meta-sha256': options.headers['x-amz-meta-sha256'] } });
        } else if (!objects.has(key)) statusCode = 404;
        const stored = objects.get(key);
        const response = Readable.from(options.method === 'GET' && stored ? [stored.body.subarray(0, 2), stored.body.subarray(2)] : []);
        response.statusCode = statusCode;
        response.headers = stored?.headers ?? {};
        callback(response);
        done();
      },
    });
    request.setTimeout = () => request;
    return request;
  });
  const client = createR2Client({ endpoint, bucket: 'fixture-bucket', credentials });
  const result = await publishRelease(f.plan, { client, dryRun: false, readyPath: f.readyPath, delay: noDelay });
  assert.equal(result.status, 'READY');
  assert.deepEqual(objects.get(`/fixture-bucket/${asset.key}`).body, await readFile(asset.sourcePath));
  for (const options of requests) {
    assert.equal(options.hostname, `${'a'.repeat(32)}.r2.cloudflarestorage.com`);
    assert.equal(options.headers['content-encoding'], undefined);
    assert.ok(options.headers.authorization.startsWith('AWS4-HMAC-SHA256 '));
    assert.ok(!options.headers.authorization.includes(credentials.secretAccessKey));
    if (options.method === 'PUT') assert.equal(options.headers['if-none-match'], '*');
  }
});
