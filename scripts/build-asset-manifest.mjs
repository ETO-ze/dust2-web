import { readFile, writeFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const root = path.resolve('public');
const files = new Set();
async function add(relative, group) {
  if (files.has(relative)) return;
  files.add(relative);
  const content = await readFile(path.join(root, relative));
  entries.push({ path: relative.replaceAll('\\', '/'), bytes: content.length, sha256: createHash('sha256').update(content).digest('hex'), group });
  if (relative.endsWith('.gltf')) {
    const gltf = JSON.parse(content);
    for (const item of [...gltf.buffers || [], ...gltf.images || []]) if (item.uri && !item.uri.startsWith('data:')) {
      if (/^[a-z]+:/i.test(item.uri)) throw new Error('Runtime assets must be local: ' + item.uri);
      await add(path.posix.join(path.posix.dirname(relative), decodeURIComponent(item.uri)), group);
    }
  }
}
async function walk(dir, group) {
  for (const entry of await readdir(path.join(root, dir), { withFileTypes: true })) {
    const file = dir + '/' + entry.name;
    if(file==='assets/viewmodel/arms.glb')continue;
    if (entry.isDirectory() && !['optional','arms'].includes(entry.name)) await walk(file, group);
    else if (/\.(glb|gltf|bin|webp|png|jpe?g|mp3|wav|ogg|svg)$/i.test(file)) await add(file, group);
  }
}
const entries = [];
await add('assets/map-cs2/dust2-web.gltf', 'map');
await add('assets/map/positions.f32', 'collision');
await add('assets/sky/daylight.hdr','sky');
await add('assets/sky/source.json','sky');
await walk('assets/audio', 'audio');
await add('assets/audio/cs2/manifest.json', 'audio');
await add('assets/audio/music/manifest.json','audio');
await walk('assets/characters-cs2','characters');
for(const id of ['ct-sas','t-phoenix'])await add(`assets/characters-cs2/arms/${id}.glb`,'characters');
await walk('assets/weapons/cs2-loadout/previews','weapons');
await walk('assets/ui-cs2','interface');
for (const dir of ['assets/viewmodel']) {
  if (await stat(path.join(root, dir)).catch(() => null)) await walk(dir, 'weapons');
}
// Gun and utility models are fetched on equip; only their previews and shared
// arm animation bundle belong to the initial download.
entries.sort((a, b) => a.path.localeCompare(b.path));
const version = createHash('sha256').update(JSON.stringify(entries)).digest('hex').slice(0, 16);
const manifest = { version, totalBytes: entries.reduce((sum, entry) => sum + entry.bytes, 0), files: entries };
await writeFile(path.join(root, 'assets/asset-manifest.json'), JSON.stringify(manifest));
console.log(`Runtime asset manifest ${version}: ${entries.length} files, ${(manifest.totalBytes / 1048576).toFixed(1)} MiB`);
