import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { syncAsset, syncAssets, validateAssetPath } from '../scripts/fetch-assets.mjs';

function entry(filePath, body) {
  return { path: filePath, bytes: Buffer.byteLength(body), sha256: createHash('sha256').update(body).digest('hex') };
}

async function fixture(t, handler) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'dust2-assets-test-'));
  const root = path.join(temporary, 'public', 'assets');
  const requests = [];
  const server = createServer((request, response) => {
    requests.push(request.url);
    Promise.resolve(handler(request, response)).catch(error => response.destroy(error));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await rm(temporary, { recursive: true, force: true });
  });
  return { temporary, root, requests, baseURL: `http://127.0.0.1:${server.address().port}/dust2/` };
}

test('asset bootstrap streams verified bytes, pins the URL, and skips a second download', async t => {
  const body = Buffer.from('verified asset data '.repeat(8192));
  const item = entry('assets/models/example.bin', body);
  const context = await fixture(t, (_request, response) => {
    response.write(body.subarray(0, 9000));
    response.end(body.subarray(9000));
  });
  assert.equal((await syncAsset(item, context)).status, 'downloaded');
  assert.deepEqual(await readFile(path.join(context.root, 'models', 'example.bin')), body);
  assert.equal(context.requests[0], `/dust2/assets/models/example.bin?v=${item.sha256}`);
  assert.equal((await syncAsset(item, context)).status, 'skipped');
  assert.equal(context.requests.length, 1);
  assert.deepEqual(await readdir(path.join(context.root, 'models')), ['example.bin']);
});

test('a wrong hash never replaces existing data and removes its partial file', async t => {
  const context = await fixture(t, (_request, response) => response.end('bad-content'));
  await mkdir(context.root, { recursive: true });
  await writeFile(path.join(context.root, 'sample.bin'), 'previous-version');
  await assert.rejects(syncAsset(entry('assets/sample.bin', 'new-content'), context), /SHA-256 mismatch/);
  assert.equal(await readFile(path.join(context.root, 'sample.bin'), 'utf8'), 'previous-version');
  assert.deepEqual(await readdir(context.root), ['sample.bin']);
});

test('interrupted transfer leaves no final or partial asset', async t => {
  const context = await fixture(t, async (_request, response) => {
    response.writeHead(200, { 'content-length': '100000' });
    response.write(Buffer.alloc(300));
    await delay(20);
    response.destroy();
  });
  await assert.rejects(syncAsset(entry('assets/large.bin', Buffer.alloc(100000)), context));
  assert.deepEqual(await readdir(context.root), []);
});

test('oversized responses are rejected before writing extra bytes', async t => {
  const context = await fixture(t, (_request, response) => response.end('too much data'));
  await assert.rejects(syncAsset(entry('assets/small.bin', 'ok'), context), /Size mismatch/);
  assert.deepEqual(await readdir(context.root), []);
});

test('--check detects missing and changed files without network access or creating directories', async t => {
  const context = await fixture(t, (_request, response) => response.end('unused'));
  const item = entry('assets/example.bin', 'correct');
  await assert.rejects(syncAsset(item, { ...context, check: true }), /Missing or modified/);
  await assert.rejects(readdir(context.root), { code: 'ENOENT' });
  await mkdir(context.root, { recursive: true });
  await writeFile(path.join(context.root, 'example.bin'), 'changed');
  await assert.rejects(syncAsset(item, { ...context, check: true }), /Missing or modified/);
  assert.equal(await readFile(path.join(context.root, 'example.bin'), 'utf8'), 'changed');
  assert.equal(context.requests.length, 0);
});

test('traversal, encoded separators, Windows device names and alternate streams are rejected', async t => {
  const context = await fixture(t, (_request, response) => response.end('unused'));
  for (const unsafe of ['assets/../outside.bin', 'assets/sub/../../outside.bin', 'assets/%2e%2e/outside.bin', 'assets/sub\\outside.bin', '/assets/a.bin', 'assets//a.bin', 'assets/a.bin:stream', 'assets/CON', 'assets/sub./a.bin']) {
    assert.throws(() => validateAssetPath(unsafe), /[Uu]nsafe|must start/);
    await assert.rejects(syncAsset(entry(unsafe, 'x'), context));
  }
  assert.equal(context.requests.length, 0);
  await assert.rejects(readdir(context.root), { code: 'ENOENT' });
});

test('directory symlinks and a symlinked assets root cannot escape the destination', async t => {
  const context = await fixture(t, (_request, response) => response.end('x'));
  const outside = path.join(context.temporary, 'outside');
  await mkdir(outside);
  await mkdir(context.root, { recursive: true });
  await symlink(outside, path.join(context.root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(syncAsset(entry('assets/linked/outside.bin', 'x'), context), /Symlink\/junction/);
  const linkedRoot = path.join(context.temporary, 'linked-root');
  await symlink(outside, linkedRoot, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(syncAsset(entry('assets/outside.bin', 'x'), { ...context, root: linkedRoot }), /Symlink\/junction/);
  assert.deepEqual(await readdir(outside), []);
  assert.equal(context.requests.length, 0);
});

test('the whole lock is validated before any network requests or writes', async t => {
  const context = await fixture(t, (_request, response) => response.end('x'));
  const lock = { schemaVersion: 1, baseURL: context.baseURL, files: [entry('assets/good.bin', 'x'), entry('assets/../escape.bin', 'x')] };
  await assert.rejects(syncAssets(lock, context), /Unsafe/);
  assert.equal(context.requests.length, 0);
  await assert.rejects(readdir(context.root), { code: 'ENOENT' });
});

test('four concurrent workers finish remaining assets and report individual failures', async t => {
  let active = 0;
  let peak = 0;
  const context = await fixture(t, async (request, response) => {
    peak = Math.max(peak, ++active);
    await delay(40);
    active--;
    if (request.url.includes('/missing.bin')) response.writeHead(404).end('not found');
    else response.end('ok');
  });
  const files = Array.from({ length: 9 }, (_, index) => entry(`assets/${index}.bin`, 'ok'));
  files.splice(2, 0, entry('assets/missing.bin', 'ok'));
  const result = await syncAssets({ schemaVersion: 1, baseURL: context.baseURL, files }, { root: context.root });
  assert.equal(peak, 4);
  assert.equal(result.downloaded, 9);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].path, 'assets/missing.bin');
  assert.match(result.errors[0].message, /HTTP 404/);
  assert.equal((await readdir(context.root)).filter(file => file.endsWith('.part')).length, 0);
});
