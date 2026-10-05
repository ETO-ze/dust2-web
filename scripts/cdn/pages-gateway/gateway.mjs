// Shared handler for the Pages advanced-mode entry. No credentials or game server
// connection belong in this project; the only data source is the R2 binding.
export const RELEASE_ID = '20261004-cdn-01';
export const RELEASE_PREFIX = `releases/${RELEASE_ID}/`;
export const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable, no-transform';
const ORIGINS = new Set(['https://cs2.duskrain.cn', 'https://cs2.duskrain.cn:8443']);
const METHODS = 'GET, HEAD, OPTIONS';
const REQUEST_HEADERS = new Set(['range', 'if-range', 'if-match', 'if-none-match', 'if-modified-since', 'if-unmodified-since']);
const TYPES = Object.freeze({bin: 'application/octet-stream', f32: 'application/octet-stream',
  glb: 'model/gltf-binary', gltf: 'model/gltf+json', gz: 'application/octet-stream', hdr: 'application/octet-stream',
  json: 'application/json; charset=utf-8', mp3: 'audio/mpeg', ogg: 'audio/ogg', png: 'image/png',
  svg: 'image/svg+xml', webp: 'image/webp'});

export function permittedKey(url) {
  // Existing clients retain either the short resource hash or full map hash.
  // Only that exact cache-buster is accepted; it never changes an object key.
  if ((url.search && !/^\?v=(?:[a-f0-9]{12}|[a-f0-9]{64})$/i.test(url.search)) || url.hash
      || url.pathname.length > 1024 || !url.pathname.startsWith(`/${RELEASE_PREFIX}`)) return null;
  const key = url.pathname.slice(1), tail = key.slice(RELEASE_PREFIX.length);
  if (tail === 'release-manifest.json') return key;
  if (!/^(?:assets\/|maps\/(?:de_dust2|de_mirage|de_inferno)\/)[a-zA-Z0-9._/-]+$/.test(tail)) return null;
  if (tail.split('/').some(part => !part || part.startsWith('.'))
      || /(?:^|\/)(?:credentials?|secrets?|tokens?|passwords?|id_rsa|id_ed25519)(?:[./_-]|$)/i.test(tail)) return null;
  return Object.hasOwn(TYPES, key.split('.').at(-1)) ? key : null;
}

function withCors(request, response, cacheStatus) {
  const headers = new Headers(response.headers), origin = request.headers.get('Origin');
  // The no-Origin response is also a variant in browsers/shared caches.
  const vary = headers.get('Vary');
  if (!(vary || '').split(',').some(value => value.trim().toLowerCase() === 'origin'))
    headers.set('Vary', vary ? `${vary}, Origin` : 'Origin');
  if (ORIGINS.has(origin)) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges, ETag, Content-Encoding, Last-Modified, CF-Cache-Status, X-DustII-Cache');
  }
  if (cacheStatus) headers.set('X-DustII-Cache', cacheStatus);
  return new Response(response.body, {status: response.status, headers});
}

function failure(request, status, message, extra = {}) {
  return withCors(request, new Response(request.method === 'HEAD' ? null : message, {status,
    headers: {'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': String(message.length),
      'Cache-Control': 'no-store, no-transform', 'X-Content-Type-Options': 'nosniff', ...extra}}));
}

function objectMetadata(key, object) {
  const type = TYPES[key.split('.').at(-1)], metadata = object.httpMetadata || {};
  if (!Number.isSafeInteger(object.size) || object.size < 0 || !/^"[^"\\\r\n]+"$/.test(object.httpEtag || '')
      || object.uploaded === null || object.uploaded === undefined
      || !Number.isFinite(new Date(object.uploaded).getTime()) || metadata.contentType !== type
      || metadata.cacheControl !== IMMUTABLE_CACHE || metadata.contentEncoding !== undefined)
    throw Error('incompatible-object-metadata');
  return {size: object.size, etag: object.httpEtag, uploaded: new Date(object.uploaded), type};
}

function cachedMetadata(key, response) {
  if (response.status !== 200 || response.headers.get('Content-Encoding') !== null) throw Error('incompatible-cache-entry');
  const length = response.headers.get('Content-Length');
  if (!/^(?:0|[1-9]\d*)$/.test(length || '')) throw Error('incompatible-cache-length');
  return objectMetadata(key, {size: Number(length), httpEtag: response.headers.get('ETag'),
    uploaded: response.headers.get('Last-Modified'), httpMetadata: {
      contentType: response.headers.get('Content-Type'), cacheControl: response.headers.get('Cache-Control')}});
}

function headersFor(metadata, status = 200, range = null) {
  const headers = new Headers({'Content-Type': metadata.type, 'Cache-Control': IMMUTABLE_CACHE,
    'ETag': metadata.etag, 'Last-Modified': metadata.uploaded.toUTCString(), 'Accept-Ranges': 'bytes',
    'X-Content-Type-Options': 'nosniff'});
  if (status === 200) headers.set('Content-Length', String(metadata.size));
  if (status === 206) {
    headers.set('Content-Length', String(range.length));
    headers.set('Content-Range', `bytes ${range.offset}-${range.offset + range.length - 1}/${metadata.size}`);
  }
  if (status === 412 || status === 416) headers.set('Cache-Control', 'no-store, no-transform');
  if (status === 416) headers.set('Content-Range', `bytes */${metadata.size}`);
  return headers;
}

function tagsMatch(value, etag, weak) {
  if (value.trim() === '*') return true;
  return (value.match(/(?:W\/)?"[^"\r\n]*"/g) || []).some(tag => (weak ? tag.replace(/^W\//, '') : tag) === etag);
}
const seconds = date => Math.floor(new Date(date).getTime() / 1000);

export function conditionalStatus(headers, metadata) {
  const match = headers.get('If-Match'), unmodified = headers.get('If-Unmodified-Since');
  if (match !== null && !tagsMatch(match, metadata.etag, false)) return 412;
  if (match === null && unmodified !== null && seconds(metadata.uploaded) > seconds(unmodified)) return 412;
  const none = headers.get('If-None-Match'), modified = headers.get('If-Modified-Since');
  if (none !== null && tagsMatch(none, metadata.etag, true)) return 304;
  if (none === null && modified !== null && seconds(metadata.uploaded) <= seconds(modified)) return 304;
  return null;
}

/** Single ranges are supported. RFC 9110 permits ignoring malformed, unknown-
 * unit and multiple-range headers; these receive the full representation. */
export function requestedRange(headers, metadata) {
  const value = headers.get('Range');
  if (!value) return null;
  const ifRange = headers.get('If-Range');
  if (ifRange !== null && !(ifRange === metadata.etag || (!/^(?:W\/)?"/.test(ifRange)
      && seconds(ifRange) >= seconds(metadata.uploaded)))) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || (!match[1] && !match[2])) return null;
  const size = metadata.size, start = match[1] ? Number(match[1]) : null, end = match[2] ? Number(match[2]) : null;
  if ((start !== null && !Number.isSafeInteger(start)) || (end !== null && !Number.isSafeInteger(end))) return null;
  if (!size || (start === null && end === 0) || (start !== null && (start >= size || (end !== null && end < start)))) return false;
  const offset = start === null ? Math.max(0, size - end) : start;
  return {offset, length: (start === null || end === null ? size - 1 : Math.min(end, size - 1)) - offset + 1};
}

async function discard(response) {
  if (response?.body && !response.body.locked) await response.body.cancel().catch(() => {});
}
function safeLog(event) { console.error(JSON.stringify({component: 'dustii-pages-downloads', event})); }

/** The cache instance is injectable only for local tests. Deployed requests use
 * the Pages runtime cache; no Node modules, fetch proxies or S3 secrets exist. */
export async function serveDownload(request, env, ctx, cache = globalThis.caches?.default) {
  const key = permittedKey(new URL(request.url));
  if (!key) return failure(request, 404, 'Not found');
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return failure(request, 405, 'Method not allowed', {Allow: METHODS});
  const origin = request.headers.get('Origin');
  if (origin !== null && !ORIGINS.has(origin)) return failure(request, 403, 'Origin not allowed');
  if (env.DELIVERY_ENABLED !== 'true' || !env.DUSTII_DOWNLOADS) return failure(request, 503, 'Downloads not enabled');
  if (request.method === 'OPTIONS') {
    const method = request.headers.get('Access-Control-Request-Method');
    const requested = (request.headers.get('Access-Control-Request-Headers') || '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
    if (!ORIGINS.has(origin) || !['GET', 'HEAD'].includes(method) || requested.some(header => !REQUEST_HEADERS.has(header)))
      return failure(request, 403, 'Preflight not allowed');
    const object = await env.DUSTII_DOWNLOADS.head(key);
    if (!object) return failure(request, 404, 'Not found');
    objectMetadata(key, object);
    return withCors(request, new Response(null, {status: 204, headers: {'Cache-Control': 'no-store, no-transform',
      'Access-Control-Allow-Methods': METHODS, 'Access-Control-Allow-Headers': [...REQUEST_HEADERS].join(', '),
      'Access-Control-Max-Age': '3600'}}));
  }

  // Store origin-neutral complete representations. CORS is added after lookup,
  // so one game's origin cannot contaminate the other game's response headers.
  const cacheURL = new URL(request.url); cacheURL.search = '';
  const cacheKey = new Request(cacheURL, {method: 'GET'});
  let cached, metadata;
  if (cache) {
    try { cached = await cache.match(cacheKey); if (cached) metadata = cachedMetadata(key, cached); }
    catch { await discard(cached); cached = null; metadata = null; safeLog('cache-read-failed'); }
  }
  if (!metadata) {
    const object = await env.DUSTII_DOWNLOADS.head(key);
    if (!object) return failure(request, 404, 'Not found');
    metadata = objectMetadata(key, object);
  }
  const status = conditionalStatus(request.headers, metadata);
  if (status || request.method === 'HEAD') {
    await discard(cached);
    return withCors(request, new Response(null, {status: status || 200, headers: headersFor(metadata, status || 200)}), cached ? 'HIT' : 'MISS');
  }
  const range = requestedRange(request.headers, metadata);
  if (range === false) {
    await discard(cached);
    return withCors(request, new Response(null, {status: 416, headers: headersFor(metadata, 416)}), cached ? 'HIT' : 'MISS');
  }
  if (cached && !range) return withCors(request, cached, 'HIT');
  if (cached && range) {
    await discard(cached);
    let partial;
    try {
      partial = await cache.match(new Request(cacheKey, {headers: {Range: `bytes=${range.offset}-${range.offset + range.length - 1}`}}));
      if (partial?.status === 206 && partial.headers.get('ETag') === metadata.etag
          && partial.headers.get('Content-Length') === String(range.length)
          && partial.headers.get('Content-Range') === `bytes ${range.offset}-${range.offset + range.length - 1}/${metadata.size}`
          && partial.headers.get('Content-Encoding') === null && partial.headers.get('Content-Type') === metadata.type
          && partial.headers.get('Cache-Control') === IMMUTABLE_CACHE) return withCors(request, partial, 'HIT');
      await discard(partial);
    } catch { await discard(partial); safeLog('cache-range-read-failed'); }
  }
  // Bind the read to the metadata's ETag, including cached metadata. A changed
  // immutable object cannot silently produce a header/body version mismatch.
  const object = await env.DUSTII_DOWNLOADS.get(key, {onlyIf: {etagMatches: metadata.etag.slice(1, -1)}, ...(range ? {range} : {})});
  if (!object) return failure(request, 404, 'Not found');
  let read;
  try {
    read = objectMetadata(key, object);
    if (!object.body || read.etag !== metadata.etag || read.size !== metadata.size
        || (range && (object.range?.offset !== range.offset || object.range?.length !== range.length)))
      throw Error('immutable-object-changed');
  } catch (error) { await discard(object); throw error; }
  const response = new Response(object.body, {status: range ? 206 : 200, headers: headersFor(metadata, range ? 206 : 200, range)});
  // HEAD, 206, 304, failures and preflights never fill the full-object cache.
  if (cache && !range && ctx?.waitUntil) ctx.waitUntil(cache.put(cacheKey, response.clone()).catch(() => safeLog('cache-write-failed')));
  return withCors(request, response, 'MISS');
}

export default {
  async fetch(request, env, ctx) {
    try { return await serveDownload(request, env, ctx); }
    catch { safeLog('r2-read-failed'); return failure(request, 502, 'Download temporarily unavailable'); }
  },
};
