import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {gzipSync} from 'node:zlib';
import {readFile} from 'node:fs/promises';
import gateway, {IMMUTABLE_CACHE, RELEASE_ID, RELEASE_PREFIX, permittedKey, serveDownload}
  from '../scripts/cdn/pages-gateway/gateway.mjs';
import {toPublicManifest} from '../scripts/cdn/release-manifest.mjs';
import {verifyPublicRelease} from '../scripts/cdn/verify-public.mjs';

const origins = ['https://cs2.duskrain.cn', 'https://cs2.duskrain.cn:8443'];
const baseURL = 'https://dustii-gateway.test/';
const pngKey = `${RELEASE_PREFIX}assets/textures/check.png`;
const gzKey = `${RELEASE_PREFIX}maps/de_inferno/transport/${'a'.repeat(64)}.gz`;
const manifestKey = `${RELEASE_PREFIX}release-manifest.json`;
const uploaded = new Date('2026-10-04T00:00:00Z');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

class TestCache {
  objects = new Map(); puts = 0; matches = [];
  async put(request, response) {
    assert.equal(request.method, 'GET'); assert.equal(response.status, 200);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
    assert.equal(response.headers.get('Content-Encoding'), null);
    this.puts++; this.objects.set(request.url, {data: Buffer.from(await response.arrayBuffer()), headers: response.headers});
  }
  async match(request) {
    this.matches.push(request);
    const entry = this.objects.get(request.url);
    if (!entry) return undefined;
    const headers = new Headers(entry.headers), range = /^bytes=(\d+)-(\d+)$/.exec(request.headers.get('Range') || '');
    if (range) {
      const start = Number(range[1]), end = Number(range[2]), data = entry.data.subarray(start, end + 1);
      headers.set('Content-Length', String(data.length));
      headers.set('Content-Range', `bytes ${start}-${end}/${entry.data.length}`);
      return new Response(data, {status: 206, headers});
    }
    return new Response(entry.data, {headers});
  }
}

function fixture() {
  const files = new Map([
    [pngKey, {data: Buffer.from('0123456789abcdefghijklmnopqrstuvwxyz'), type: 'image/png'}],
    [gzKey, {data: gzipSync(Buffer.from('map mesh '.repeat(40))), type: 'application/octet-stream'}],
    [`${RELEASE_PREFIX}assets/empty.json`, {data: Buffer.alloc(0), type: 'application/json; charset=utf-8'}],
  ]);
  const cache = new TestCache(), calls = [], pending = [];
  const metadata = entry => ({size: entry.data.length, etag: sha(entry.data), httpEtag: `"${sha(entry.data)}"`, uploaded,
    httpMetadata: {contentType: entry.type, cacheControl: IMMUTABLE_CACHE, ...entry.metadata}});
  const bucket = {
    async head(key) { calls.push({method: 'head', key}); const entry = files.get(key); return entry ? metadata(entry) : null; },
    async get(key, options) {
      calls.push({method: 'get', key, options}); const entry = files.get(key);
      if (!entry) return null;
      const object = metadata(entry);
      if (options.onlyIf.etagMatches !== object.etag) return object;
      const data = options.range ? entry.data.subarray(options.range.offset, options.range.offset + options.range.length) : entry.data;
      // Small chunks exercise streaming; the handler must not buffer the object.
      return {...object, body: new ReadableStream({start(controller) {
        for (let offset = 0; offset < data.length; offset += 7) controller.enqueue(data.subarray(offset, offset + 7));
        controller.close();
      }}), range: options.range};
    },
    async put() { assert.fail('Public endpoint must never write R2'); },
    async list() { assert.fail('Public endpoint must never list R2'); },
    async delete() { assert.fail('Public endpoint must never delete R2'); },
  };
  const env = {DELIVERY_ENABLED: 'true', DUSTII_DOWNLOADS: bucket};
  const ctx = {waitUntil(promise) { pending.push(promise); }};
  const request = (key = pngKey, {method = 'GET', origin = origins[0], headers = {}} = {}) => new Request(new URL(key, baseURL),
    {method, headers: {...(origin === null ? {} : {Origin: origin}), ...headers}});
  const call = (key, options) => serveDownload(request(key, options), env, ctx, cache);
  const flush = () => Promise.all(pending.splice(0));
  return {files, cache, calls, bucket, env, ctx, request, call, flush};
}

test('only the fixed release, runtime namespaces, three maps and public commit marker are addressable', async () => {
  const data = fixture();
  for (const key of ['', RELEASE_PREFIX, `${RELEASE_PREFIX}assets/`, `${RELEASE_PREFIX}release-local-manifest.json`,
    'releases/other/assets/p.png', `${RELEASE_PREFIX}maps/de_nuke/map.json`, `${RELEASE_PREFIX}assets/.env`,
    `${RELEASE_PREFIX}assets/config/credentials.json`, `${RELEASE_PREFIX}assets/archive.zip`,
    `${RELEASE_PREFIX}assets/p.png?proxy=https://secret.test`, `${RELEASE_PREFIX}assets/%2fsecret.json`,
    `${RELEASE_PREFIX}assets/%252e%252e/file.json`, `${RELEASE_PREFIX}assets/file.png/`,
    `${RELEASE_PREFIX}assets//file.png`, `${RELEASE_PREFIX}scripts/run.js`]) {
    assert.equal((await data.call(key)).status, 404, key);
  }
  assert.equal(data.calls.length, 0);
  for (const key of [pngKey, gzKey, manifestKey, `${RELEASE_PREFIX}maps/de_dust2/render-model/model.gltf`,
    `${RELEASE_PREFIX}maps/de_mirage/navigation.json`]) assert.equal(permittedKey(new URL(key, baseURL)), key);
});

test('unknown objects return 404 and write methods are rejected before touching R2', async () => {
  const data = fixture();
  assert.equal((await data.call(`${RELEASE_PREFIX}assets/missing.json`)).status, 404);
  data.calls.length = 0;
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const response = await data.call(pngKey, {method});
    assert.equal(response.status, 405); assert.equal(response.headers.get('Allow'), 'GET, HEAD, OPTIONS');
  }
  assert.equal(data.calls.length, 0); assert.equal(data.cache.puts, 0);
});

test('existing 12/64-character version hashes share the immutable cache; arbitrary or repeated queries cannot be served', async () => {
  const data = fixture(), hash = sha(data.files.get(pngKey).data);
  const first = await data.call(`${pngKey}?v=${hash.slice(0, 12)}`);
  assert.equal(first.status, 200); await first.arrayBuffer(); await data.flush();
  const second = await data.call(`${pngKey}?v=${hash}`);
  assert.equal(second.status, 200); assert.equal(second.headers.get('X-DustII-Cache'), 'HIT'); await second.arrayBuffer();
  assert.equal(data.cache.objects.size, 1);
  assert.equal(data.cache.puts, 1);
  for (const query of [`?v=${hash}&url=https://example.test`, `?v=${hash}&v=${hash}`,
    '?v=short', '?token=secret', '?v=%61aaaaaaaaaaa'])
    assert.equal((await data.call(`${pngKey}${query}`)).status, 404, query);
});

test('activation is explicit and missing bindings, booleans and preview configuration fail closed', async () => {
  const data = fixture();
  for (const value of ['false', undefined, true, '1']) {
    data.env.DELIVERY_ENABLED = value;
    assert.equal((await data.call()).status, 503);
  }
  data.env.DELIVERY_ENABLED = 'true'; delete data.env.DUSTII_DOWNLOADS;
  assert.equal((await data.call()).status, 503);
  assert.equal(data.calls.length, 0);
  const text = await readFile(new URL('../scripts/cdn/pages-gateway/wrangler.jsonc', import.meta.url), 'utf8');
  const config = JSON.parse(text.replace(/^\s*\/\/.*$/gm, ''));
  assert.equal(config.vars.DELIVERY_ENABLED, 'false');
  assert.equal(config.r2_buckets[0].bucket_name, 'dustii-downloads');
  assert.equal(config.env.preview.vars.DELIVERY_ENABLED, 'false');
  assert.deepEqual(config.env.preview.r2_buckets, []);
});

test('full GET and HEAD preserve compressed bytes, metadata and immutable no-transform without Content-Encoding', async () => {
  const data = fixture();
  const head = await data.call(gzKey, {method: 'HEAD'});
  assert.equal(head.status, 200); assert.equal((await head.arrayBuffer()).byteLength, 0);
  assert.equal(head.headers.get('Content-Length'), String(data.files.get(gzKey).data.length));
  assert.equal(data.calls.filter(call => call.method === 'get').length, 0);
  const response = await data.call(gzKey);
  assert.equal(response.status, 200); assert.equal(response.headers.get('Content-Type'), 'application/octet-stream');
  assert.equal(response.headers.get('Content-Encoding'), null); assert.equal(response.headers.get('Cache-Control'), IMMUTABLE_CACHE);
  assert.equal(response.headers.get('Accept-Ranges'), 'bytes');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), data.files.get(gzKey).data);
  await data.flush(); assert.equal(data.cache.puts, 1);
});

test('CORS is exact for both game origins even with a shared cache; missing Origin is a direct public download', async () => {
  const data = fixture();
  const first = await data.call(pngKey, {origin: origins[0]}); await first.arrayBuffer(); await data.flush();
  for (const origin of [origins[1], origins[0]]) {
    const response = await data.call(pngKey, {origin});
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), origin);
    assert.equal(response.headers.get('Vary'), 'Origin');
    assert.equal(response.headers.get('Access-Control-Allow-Credentials'), null);
    assert.equal(response.headers.get('X-DustII-Cache'), 'HIT'); await response.arrayBuffer();
  }
  const calls = data.calls.length;
  for (const origin of ['null', 'https://cs2.duskrain.cn.evil.test', 'http://cs2.duskrain.cn']) {
    const response = await data.call(pngKey, {origin});
    assert.equal(response.status, 403); assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
  }
  assert.equal(data.calls.length, calls);
  const direct = await data.call(pngKey, {origin: null});
  assert.equal(direct.status, 200); assert.equal(direct.headers.get('Access-Control-Allow-Origin'), null);
  assert.equal(direct.headers.get('Vary'), 'Origin');
  await direct.arrayBuffer();
});

test('preflight allows read and conditional headers only, checks existence, and never fills cache', async () => {
  const data = fixture();
  for (const origin of origins) {
    const response = await data.call(pngKey, {method: 'OPTIONS', origin,
      headers: {'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'Range, If-Range, If-None-Match'}});
    assert.equal(response.status, 204); assert.equal(response.headers.get('Access-Control-Allow-Origin'), origin);
    assert.equal(response.headers.get('Access-Control-Allow-Methods'), 'GET, HEAD, OPTIONS');
    assert.equal(response.headers.get('Access-Control-Allow-Credentials'), null);
    assert.equal((await response.arrayBuffer()).byteLength, 0);
  }
  const response = await data.call(`${RELEASE_PREFIX}assets/missing.json`, {method: 'OPTIONS',
    headers: {'Access-Control-Request-Method': 'HEAD'}});
  assert.equal(response.status, 404);
  const calls = data.calls.length;
  for (const headers of [{'Access-Control-Request-Method': 'PUT'},
    {'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'Authorization'}, {}])
    assert.equal((await data.call(pngKey, {method: 'OPTIONS', headers})).status, 403);
  assert.equal(data.calls.length, calls); assert.equal(data.cache.puts, 0);
});

test('single ranges support bounded, open, suffix, clamped and unsatisfiable reads without populating full cache', async () => {
  const data = fixture(), full = data.files.get(pngKey).data;
  for (const [value, start, end] of [['bytes=0-5', 0, 5], ['bytes=10-', 10, full.length - 1],
    ['bytes=-4', full.length - 4, full.length - 1], ['bytes=20-999', 20, full.length - 1], ['bytes=-999', 0, full.length - 1]]) {
    const response = await data.call(pngKey, {headers: {Range: value}});
    assert.equal(response.status, 206, value);
    assert.equal(response.headers.get('Content-Range'), `bytes ${start}-${end}/${full.length}`);
    assert.equal(response.headers.get('Content-Length'), String(end - start + 1));
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), full.subarray(start, end + 1));
  }
  for (const value of ['bytes=999-', 'bytes=9-3', 'bytes=-0']) {
    const response = await data.call(pngKey, {headers: {Range: value}});
    assert.equal(response.status, 416); assert.equal(response.headers.get('Content-Range'), `bytes */${full.length}`);
    assert.equal((await response.arrayBuffer()).byteLength, 0);
  }
  const empty = await data.call(`${RELEASE_PREFIX}assets/empty.json`, {headers: {Range: 'bytes=0-'}});
  assert.equal(empty.status, 416); assert.equal(empty.headers.get('Content-Range'), 'bytes */0');
  await data.flush(); assert.equal(data.cache.puts, 0);
});

test('HEAD ignores Range, and malformed or multiple ranges receive the full representation', async () => {
  const data = fixture(), size = data.files.get(pngKey).data.length;
  const head = await data.call(pngKey, {method: 'HEAD', headers: {Range: 'bytes=1-2'}});
  assert.equal(head.status, 200); assert.equal(head.headers.get('Content-Range'), null);
  assert.equal(head.headers.get('Content-Length'), String(size));
  for (const value of ['units=1-2', 'bytes=0-1,4-5', 'bytes=-', 'bytes=9007199254740993-', 'garbage']) {
    const response = await data.call(pngKey, {headers: {Range: value}});
    assert.equal(response.status, 200); assert.equal(response.headers.get('Content-Range'), null);
    assert.equal((await response.arrayBuffer()).byteLength, size); await data.flush();
  }
});

test('If-Range accepts strong current ETag or an unmodified date; mismatches and weak tags receive full bytes', async () => {
  const data = fixture(), etag = `"${sha(data.files.get(pngKey).data)}"`;
  for (const [value, status] of [[etag, 206], [uploaded.toUTCString(), 206], ['"other"', 200],
    [`W/${etag}`, 200], ['Tue, 01 Sep 2026 00:00:00 GMT', 200], ['garbage', 200]]) {
    const response = await data.call(pngKey, {headers: {Range: 'bytes=1-2', 'If-Range': value}});
    assert.equal(response.status, status, value); await response.arrayBuffer(); await data.flush();
  }
});

test('preconditions obey ETag precedence, weak/strong comparison and conditional-date rules', async () => {
  const data = fixture(), etag = `"${sha(data.files.get(pngKey).data)}"`;
  for (const [headers, status] of [
    [{'If-None-Match': etag, Range: 'bytes=0-2'}, 304], [{'If-None-Match': `W/${etag}`}, 304],
    [{'If-None-Match': `"other", ${etag}`}, 304], [{'If-None-Match': '*'}, 304],
    [{'If-Match': '"other"'}, 412], [{'If-Match': `W/${etag}`}, 412],
    [{'If-Match': etag, 'If-Unmodified-Since': 'Tue, 01 Sep 2026 00:00:00 GMT'}, 200],
    [{'If-Modified-Since': uploaded.toUTCString()}, 304], [{'If-Modified-Since': 'garbage'}, 200],
    [{'If-Unmodified-Since': 'Tue, 01 Sep 2026 00:00:00 GMT'}, 412],
    [{'If-None-Match': '"other"', 'If-Modified-Since': uploaded.toUTCString()}, 200],
  ]) {
    const response = await data.call(pngKey, {headers}); assert.equal(response.status, status, JSON.stringify(headers));
    if (status !== 200) assert.equal((await response.arrayBuffer()).byteLength, 0); else await response.arrayBuffer();
    await data.flush();
  }
});

test('cold HEAD and conditional 304 never cache empty bodies; only complete GET fills the cache', async () => {
  const data = fixture(), etag = `"${sha(data.files.get(pngKey).data)}"`;
  assert.equal((await data.call(pngKey, {method: 'HEAD'})).status, 200);
  assert.equal((await data.call(pngKey, {headers: {'If-None-Match': etag}})).status, 304);
  assert.equal(data.cache.puts, 0); assert.equal(data.calls.some(call => call.method === 'get'), false);
  const response = await data.call(); assert.equal(response.headers.get('X-DustII-Cache'), 'MISS');
  await response.arrayBuffer(); await data.flush(); assert.equal(data.cache.puts, 1);
  const calls = data.calls.length;
  const head = await data.call(pngKey, {method: 'HEAD'}); assert.equal(head.headers.get('X-DustII-Cache'), 'HIT');
  const range = await data.call(pngKey, {headers: {Range: 'bytes=5-9'}});
  assert.equal(range.status, 206); assert.equal(range.headers.get('X-DustII-Cache'), 'HIT');
  assert.equal(await range.text(), '56789'); assert.equal(data.calls.length, calls); assert.equal(data.cache.puts, 1);
});

test('a cache range miss uses a conditional R2 range read without ever caching partial content', async () => {
  const data = fixture(); await (await data.call()).arrayBuffer(); await data.flush();
  const match = data.cache.match.bind(data.cache);
  data.cache.match = async request => request.headers.has('Range') ? undefined : match(request);
  const response = await data.call(pngKey, {headers: {Range: 'bytes=1-4'}});
  assert.equal(response.status, 206); assert.equal(await response.text(), '1234');
  assert.equal(data.calls.at(-1).method, 'get'); assert.deepEqual(data.calls.at(-1).options.range, {offset: 1, length: 4});
  assert.equal(data.cache.puts, 1);
});

test('metadata corruption and an immutable-object race fail instead of returning transformed or mixed bytes', async () => {
  const data = fixture();
  const originalError = console.error; const logs = [];
  console.error = line => logs.push(line);
  try {
    for (const metadata of [{contentEncoding: 'gzip'}, {contentEncoding: 'identity'},
      {cacheControl: 'public, max-age=60'}, {contentType: 'text/plain'}]) {
      data.files.get(gzKey).metadata = metadata;
      const response = await gateway.fetch(data.request(gzKey), data.env, data.ctx);
      assert.equal(response.status, 502); assert(!await response.text().then(value => value.includes('incompatible')));
    }
    delete data.files.get(gzKey).metadata;
    data.bucket.get = async () => { const object = await data.bucket.head(gzKey); return {...object, httpEtag: '"changed"', body: new ReadableStream()}; };
    assert.equal((await gateway.fetch(data.request(gzKey), data.env, data.ctx)).status, 502);
    data.bucket.head = async () => { throw Error('private key example must never enter logs'); };
    assert.equal((await gateway.fetch(data.request(gzKey), data.env, data.ctx)).status, 502);
    assert(!logs.join('\n').includes('private key')); assert(!logs.join('\n').includes('incompatible'));
    assert(logs.every(line => JSON.parse(line).event === 'r2-read-failed'));
  } finally { console.error = originalError; }
});

test('cache failures preserve valid R2 delivery, while invalid cached encoding is discarded', async () => {
  const data = fixture(); await (await data.call()).arrayBuffer(); await data.flush();
  data.cache.objects.get(new URL(pngKey, baseURL).href).headers.set('Content-Encoding', 'gzip');
  let response = await data.call(); assert.equal(response.status, 200); assert.equal(response.headers.get('Content-Encoding'), null);
  assert.equal(await response.text(), data.files.get(pngKey).data.toString()); await data.flush();
  data.cache.match = async () => { throw Error('cache unavailable'); };
  data.cache.put = async () => { throw Error('cache unavailable'); };
  response = await data.call(); assert.equal(response.status, 200); await response.arrayBuffer(); await data.flush();
});

test('actual loopback HTTP passes the existing complete public acceptance verifier with both game origins', async t => {
  const data = fixture(), assets = [pngKey, gzKey].map(key => { const entry = data.files.get(key);
    return {key, sourcePath: `C:/local-only/${key}`, bytes: entry.data.length, sha256: sha(entry.data),
      contentType: entry.type, cacheControl: IMMUTABLE_CACHE}; });
  const manifest = {schemaVersion: 1, releaseId: RELEASE_ID, manifestKey, fileCount: assets.length,
    totalBytes: assets.reduce((n, asset) => n + asset.bytes, 0), assets, sourceRoots: ['C:/local-only']};
  data.files.set(manifestKey, {data: Buffer.from(`${JSON.stringify(toPublicManifest(manifest), null, 2)}\n`), type: 'application/json; charset=utf-8'});
  const server = createServer(async (request, response) => {
    try {
      const reply = await serveDownload(new Request(`http://127.0.0.1${request.url}`, {method: request.method, headers: request.headers}), data.env, data.ctx, data.cache);
      response.writeHead(reply.status, Object.fromEntries(reply.headers));
      response.end(request.method === 'HEAD' ? undefined : Buffer.from(await reply.arrayBuffer()));
    } catch { response.writeHead(500); response.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const report = await verifyPublicRelease(manifest, {baseURL: `http://127.0.0.1:${server.address().port}/`, origins,
    allowLocalhost: true, rangeSamples: 2});
  await data.flush();
  assert.equal(report.ok, true, JSON.stringify(report.failures));
  assert.equal(report.verifiedFiles, 2); assert.equal(report.publicManifest.ok, true);
  assert.equal(report.browserAcceptance.status, 'not-run'); assert.equal(report.operatorDownloadConfig.fallbackToGameServer, false);
});

test('armory release serves common assets only and preserves the existing map release',()=>{
 assert.equal(permittedKey(new URL('releases/20261011-armory-01/assets/weapons/test.glb',baseURL)),'releases/20261011-armory-01/assets/weapons/test.glb');
 assert.equal(permittedKey(new URL('releases/20261011-armory-01/maps/de_mirage/map.json',baseURL)),null);
 assert.equal(permittedKey(new URL('releases/20261011-armory-02/assets/weapons/test.glb',baseURL)),'releases/20261011-armory-02/assets/weapons/test.glb');
 assert.equal(permittedKey(new URL('releases/20261011-armory-02/maps/de_mirage/map.json',baseURL)),null);
 assert.equal(permittedKey(new URL('releases/20261004-cdn-01/maps/de_mirage/map.json',baseURL)),'releases/20261004-cdn-01/maps/de_mirage/map.json');
});
