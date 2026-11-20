import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {validateMapTransport, transportObjectName} from '../scripts/maps/transport-schema.mjs';
import {privateEntities} from '../shared/private-map-entities.js';

const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const hash = /^[0-9a-f]{64}$/;
const supportedMaps = ['de_dust2', 'de_mirage', 'de_inferno'];
const maxBuffer = 512 * 1024 * 1024;

// Run only against a source export from the same build as the worker's collision.
// All render URLs resolve through the manifest. Exporter machine paths are ignored.
function originalPack(id, gameRoot, library, transportRoot) {
  const ready = read(path.join(gameRoot, id, 'READY.json'));
  if (!hash.test(ready.gameplaySha256)) throw Error('地图版本无效');
  const mapDir = path.join(library, id);
  const build = fs.readdirSync(mapDir).find(name => /^[a-f0-9]{12}-[a-f0-9]{8}$/.test(name) && name.startsWith(ready.gameplaySha256.slice(0, 12) + '-'));
  if (!build) throw Error('缺少同版地图');
  const source = path.join(mapDir, build), report = read(path.join(source, 'source-manifest.json'));
  if (report.id !== id || report.sourceSha256 !== ready.gameplaySha256 || report.exportValidated !== true) throw Error('地图导出版本不符');
  const files = new Map();
  for (const entry of report.files) {
    if (!/^raw\/(?:map\.(?:gltf|bin)|[^\\/%:\x00-\x1f?#]+\.png)$/.test(entry.path)) continue;
    const name = entry.path.slice(4);
    if (files.has(name) || !hash.test(entry.sha256) || !Number.isSafeInteger(entry.bytes) || entry.bytes <= 0) throw Error('原图资源清单无效');
    files.set(name, {path:name, bytes:entry.bytes, sha256:entry.sha256});
  }
  let raw = path.join(source, 'raw');
  if (files.get('map.bin')?.bytes > maxBuffer) {
    const proof = read(path.join(source, 'derived', 'render-equivalence.json'));
    if (proof.byteEquivalent !== true || proof.threshold512MiBPassed !== true ||
        proof.source.gltfSha256 !== files.get('map.gltf').sha256 || proof.source.bufferSha256 !== files.get('map.bin').sha256 ||
        !hash.test(proof.derived.gltfSha256) || !hash.test(proof.derived.bufferSha256) || proof.derived.bufferBytes > maxBuffer) throw Error('缺少等价的可加载模型');
    raw = path.join(source, 'derived', 'raw');
    files.set('map.gltf', {path:'map.gltf', bytes:fs.statSync(path.join(raw, 'map.gltf')).size, sha256:proof.derived.gltfSha256});
    files.set('map.bin', {path:'map.bin', bytes:proof.derived.bufferBytes, sha256:proof.derived.bufferSha256});
  }
  const model = fs.readFileSync(path.join(raw, 'map.gltf')), gltf = JSON.parse(model);
  const gltfHash = digest(model), entities = privateEntities(id);
  if (gltfHash !== files.get('map.gltf')?.sha256 || (entities && entities.renderSha256 !== gltfHash) || !gltf.images?.length) throw Error('原图材质或实体版本不符');
  const used = new Set(['map.gltf']);
  for (const entry of [...gltf.images, ...gltf.buffers]) {
    const file = files.get(entry.uri);
    if (!file || (entry.byteLength && entry.byteLength !== file.bytes)) throw Error('原图缺少渲染依赖');
    used.add(entry.uri);
  }
  for (const entry of files.values()) {
    if (!used.has(entry.path)) { files.delete(entry.path); continue; }
    const stat = fs.statSync(path.join(raw, entry.path));
    if (!stat.isFile() || entry.bytes !== stat.size || entry.bytes > maxBuffer) throw Error('原图资源不完整');
  }
  const pack = {raw, files, manifest:{schemaVersion:1, id, sourceSha256:report.sourceSha256, files:[...files.values()]}};
  const folder = path.join(transportRoot, id), metadata = path.join(folder, 'transport-manifest.json');
  if (!fs.existsSync(metadata)) return pack;
  // Transport is optional. A changed archive must never override valid raw data.
  try {
    const manifest = read(metadata), objects = new Map();
    const entries = validateMapTransport(manifest, {...pack.manifest, originalRenderGltfSha256:gltfHash});
    for (const [name, entry] of entries) {
      const original = name.startsWith('raw/') ? files.get(name.slice(4))?.sha256 : ready.gameplayHashes[path.posix.basename(name)];
      // A new entity-state policy can share the exact same source model and physics.
      // Fetch that small JSON directly while retaining verified render/geometry chunks.
      if (name === 'entity-collision-policy.json' && original !== entry.sha256) {
        manifest.files = manifest.files.filter(file => file.path !== name);
        continue;
      }
      if (original !== entry.sha256) throw Error('压缩包和地图版本不符');
      for (const chunk of entry.chunks) {
        const key = transportObjectName(entry, chunk);
        if (objects.has(key)) continue;
        const location = path.join(folder, 'objects', key), stat = fs.statSync(location);
        if (!stat.isFile() || stat.size !== chunk.bytes) throw Error('压缩包不完整');
        objects.set(key, location);
      }
    }
    pack.transport = {manifest, objects};
  } catch (error) {
    console.warn('忽略地图压缩包 ' + id + '：' + error.message);
  }
  return pack;
}

export function findQualityPacks(gameRoot, activeMaps, library, transportRoot) {
  const packs = new Map();
  if (!fs.existsSync(library)) return packs;
  for (const id of supportedMaps) {
    if (!activeMaps.has(id) || !fs.existsSync(path.join(library, id))) continue;
    try { packs.set(id, originalPack(id, gameRoot, library, transportRoot)); }
    catch (error) { console.warn('原材质入口暂不可用 ' + id + '：' + error.message); }
  }
  return packs;
}
