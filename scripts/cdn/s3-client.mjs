import https from 'node:https';
import { createReadStream } from 'node:fs';
import { createHash, createHmac } from 'node:crypto';

const EMPTY_HASH = createHash('sha256').update('').digest('hex');
const MAX_SINGLE_PUT = 5 * 1024 ** 3;
const sha256 = value => createHash('sha256').update(value).digest('hex');
const hmac = (key, value) => createHmac('sha256', key).update(value).digest();
const encode = value => encodeURIComponent(value).replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);

export class S3Error extends Error {
  constructor(operation, status = 0) {
    // Do not include provider bodies, signed headers or credential-bearing URLs.
    super(`R2 ${operation} failed${status ? ` (HTTP ${status})` : ' (network or timeout)'}`);
    this.name = 'S3Error';
    this.status = status;
    this.retryable = status === 0 || status === 408 || status === 429 || status >= 500;
  }
}

export function validateR2Endpoint(endpoint) {
  let url;
  try { url = new URL(endpoint); } catch { throw new Error('R2 endpoint must be an HTTPS Cloudflare R2 URL'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash ||
      url.pathname !== '/' || !/^[a-f0-9]{32}\.r2\.cloudflarestorage\.com$/i.test(url.hostname)) {
    throw new Error('R2 endpoint must be an HTTPS account endpoint at cloudflarestorage.com');
  }
  return url;
}

export function validateBucket(bucket) {
  if (typeof bucket !== 'string' || !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket) || /^\d+\.\d+\.\d+\.\d+$/.test(bucket)) {
    throw new Error('A valid explicit R2 bucket name is required');
  }
  return bucket;
}

/** Exported for deterministic signing tests. Never log the returned headers. */
export function signR2Request({ endpoint, bucket, key, method, payloadHash = EMPTY_HASH, headers = {}, credentials, now = new Date() }) {
  const url = validateR2Endpoint(endpoint);
  validateBucket(bucket);
  if (!credentials?.accessKeyId || !credentials?.secretAccessKey) throw new Error('R2 credentials are missing');
  if (!/^[a-f0-9]{64}$/.test(payloadHash)) throw new Error('Invalid payload SHA-256');
  if (typeof key !== 'string' || !key || key.includes('\0')) throw new Error('Invalid object key');
  const timestamp = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const date = timestamp.slice(0, 8);
  const requestHeaders = {};
  for (const [name, value] of Object.entries(headers)) {
    if (/[\r\n]/.test(name + String(value))) throw new Error('Invalid request header');
    requestHeaders[name.toLowerCase()] = String(value).trim().replace(/\s+/g, ' ');
  }
  Object.assign(requestHeaders, { host: url.host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': timestamp });
  if (/[\r\n]/.test(credentials.accessKeyId + credentials.secretAccessKey + (credentials.sessionToken ?? ''))) throw new Error('Invalid R2 credentials');
  if (credentials.sessionToken) requestHeaders['x-amz-security-token'] = credentials.sessionToken;
  const names = Object.keys(requestHeaders).sort();
  const signedHeaders = names.join(';');
  const canonicalPath = `/${encode(bucket)}/${key.split('/').map(encode).join('/')}`;
  const canonicalHeaders = names.map(name => `${name}:${requestHeaders[name]}\n`).join('');
  const canonicalRequest = `${method}\n${canonicalPath}\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;
  const scope = `${date}/auto/s3/aws4_request`;
  const stringToSign = `AWS4-HMAC-SHA256\n${timestamp}\n${scope}\n${sha256(canonicalRequest)}`;
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${credentials.secretAccessKey}`, date), 'auto'), 's3'), 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  requestHeaders.authorization = `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return { url, path: canonicalPath, headers: requestHeaders };
}

/** A small S3 client; explicit R2 endpoints prevent credentials reaching arbitrary hosts. */
export function createR2Client({ endpoint, bucket, credentials, timeoutMs = 120_000 }) {
  validateR2Endpoint(endpoint);
  validateBucket(bucket);
  if (!credentials?.accessKeyId || !credentials?.secretAccessKey) throw new Error('Set R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 600_000) throw new Error('Invalid R2 inactivity timeout');

  async function request(method, key, { headers, payloadHash, filePath, body, signal } = {}) {
    const signed = signR2Request({ endpoint, bucket, key, method, headers, payloadHash, credentials });
    return new Promise((resolve, reject) => {
      const operation = `${method} object`;
      let input;
      const req = https.request({ protocol: 'https:', hostname: signed.url.hostname, port: 443, path: signed.path,
        method, headers: signed.headers, signal }, response => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          const status = response.statusCode;
          response.destroy();
          reject(new S3Error(operation, status));
          return;
        }
        if (method === 'GET') {
          resolve({ headers: response.headers, body: response });
        } else {
          response.resume();
          response.once('end', () => resolve({ headers: response.headers }));
          response.once('error', () => reject(new S3Error(operation)));
        }
      });
      req.setTimeout(timeoutMs, () => req.destroy(new Error('R2 request timeout')));
      req.once('error', () => reject(new S3Error(operation)));
      req.once('close', () => { if (input && !input.destroyed) input.destroy(); });
      if (filePath) {
        input = createReadStream(filePath);
        input.once('error', () => req.destroy(new Error('Cannot read upload source')));
        input.pipe(req);
      } else req.end(body);
    });
  }

  return {
    async headObject(key, options) {
      try { return await request('HEAD', key, options); }
      catch (error) { if (error instanceof S3Error && error.status === 404) return null; throw error; }
    },
    async getObject(key, options) { return request('GET', key, options); },
    async putObject(key, { filePath, body, bytes, sha256: digest, contentType, cacheControl, signal, ifNoneMatch = '*' }) {
      if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > MAX_SINGLE_PUT) throw new Error('Object exceeds the supported 5 GiB single-upload limit');
      if ((!filePath && !Buffer.isBuffer(body)) || (filePath && body)) throw new Error('Supply one upload source');
      if (body && (body.length !== bytes || sha256(body) !== digest)) throw new Error('Upload buffer integrity mismatch');
      return request('PUT', key, { filePath, body, payloadHash: digest, signal,
        headers: { 'content-length': bytes, 'content-type': contentType,
          'cache-control': cacheControl, 'x-amz-meta-sha256': digest,
          ...(ifNoneMatch ? { 'if-none-match': ifNoneMatch } : {}) } });
    },
  };
}
