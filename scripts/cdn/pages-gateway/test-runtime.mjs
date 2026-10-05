// Entirely local workerd/R2/cache validation. This does not authenticate to or
// modify Cloudflare and does not load any local S3/OAuth credentials.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';
import {Miniflare, convertV4MiniflareOptions} from 'miniflare';
import {IMMUTABLE_CACHE, RELEASE_ID, RELEASE_PREFIX} from './gateway.mjs';
import {toPublicManifest} from '../release-manifest.mjs';
import {verifyPublicRelease} from '../verify-public.mjs';

const sha = data => createHash('sha256').update(data).digest('hex');
const origins = ['https://cs2.duskrain.cn', 'https://cs2.duskrain.cn:8443'];
const baseURL = 'https://dustii-gateway.test/';
const mf = new Miniflare({...convertV4MiniflareOptions({modules: true, scriptPath: fileURLToPath(new URL('./build/_worker.js', import.meta.url)),
  compatibilityDate: '2026-10-04', bindings: {DELIVERY_ENABLED: 'true'},
  r2Buckets: {DUSTII_DOWNLOADS: 'dustii-downloads-local-test'}}), telemetry: {enabled: false}});
try {
  const files = [
    {key: `${RELEASE_PREFIX}assets/test.png`, data: Buffer.from('unchanged source bytes '.repeat(8)), contentType: 'image/png'},
    {key: `${RELEASE_PREFIX}maps/de_mirage/transport/${'a'.repeat(64)}.gz`,
      data: gzipSync(Buffer.from('unchanged map bytes '.repeat(8))), contentType: 'application/octet-stream'},
  ];
  const assets = files.map(({key, data, contentType}) => ({key, bytes: data.length, sha256: sha(data), contentType, cacheControl: IMMUTABLE_CACHE}));
  const manifest = {schemaVersion: 1, releaseId: RELEASE_ID, manifestKey: `${RELEASE_PREFIX}release-manifest.json`,
    assets, fileCount: assets.length, totalBytes: assets.reduce((n, asset) => n + asset.bytes, 0)};
  files.push({key: manifest.manifestKey, data: Buffer.from(`${JSON.stringify(toPublicManifest(manifest), null, 2)}\n`), contentType: 'application/json; charset=utf-8'});
  const bucket = await mf.getR2Bucket('DUSTII_DOWNLOADS');
  for (const file of files) await bucket.put(file.key, file.data, {httpMetadata: {contentType: file.contentType, cacheControl: IMMUTABLE_CACHE}});
  // Miniflare's development HTTP proxy can compress JSON independently of the
  // Worker. Identity isolates the handler's framing; public Cloudflare delivery
  // must separately prove that no-transform preserves real browser requests.
  const fetcher = (url, options = {}) => mf.dispatchFetch(url, {...options,
    headers: {...options.headers, 'Accept-Encoding': 'identity'}});
  const report = await verifyPublicRelease(manifest, {baseURL, origins, fetcher, rangeSamples: 2});
  assert.equal(report.ok, true, JSON.stringify(report.failures));
  const key = files[0].key;
  const caches = await mf.getCaches();
  let cached;
  for (let attempt = 0; attempt < 10 && !cached; attempt++) {
    cached = await caches.default.match(new URL(key, baseURL));
    if (!cached) await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert(cached, 'waitUntil must populate the local runtime cache after complete GET');
  assert.equal(cached.headers.get('Access-Control-Allow-Origin'), null);
  assert.equal(cached.headers.get('Content-Encoding'), null);
  assert.deepEqual(Buffer.from(await cached.arrayBuffer()), files[0].data);
  const response = await mf.dispatchFetch(new URL(`${key}?v=${assets[0].sha256.slice(0, 12)}`, baseURL), {headers: {Origin: origins[1]}});
  assert.equal(response.headers.get('X-DustII-Cache'), 'HIT');
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), origins[1]);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), files[0].data);
  const etag = response.headers.get('ETag');
  for (const [headers, status] of [[{Range: 'bytes=-5'}, 206], [{Range: 'bytes=9999-'}, 416],
    [{'If-None-Match': `W/${etag}`}, 304], [{'If-Match': '"other"'}, 412],
    [{Range: 'bytes=1-2', 'If-Range': '"other"'}, 200]]) {
    const reply = await mf.dispatchFetch(new URL(key, baseURL), {headers: {Origin: origins[0], ...headers}});
    assert.equal(reply.status, status, JSON.stringify(headers)); await reply.arrayBuffer();
  }
  console.log(JSON.stringify({ok: true, runtime: 'local workerd via Miniflare', verifiedFiles: report.verifiedFiles,
    compressedBytesPreserved: true, corsOrigins: origins, localCacheHit: true, conditionalRanges: true,
    localTransportEncoding: 'identity', cloudflareDeployment: false, edgeCacheAcceptance: 'not-run', browserAcceptance: 'not-run'}));
} finally { await mf.dispose(); }
