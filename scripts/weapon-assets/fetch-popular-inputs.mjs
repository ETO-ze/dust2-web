import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {crc32} from 'node:zlib';
import {readVpkIndex} from '../../tools/vpk-index.mjs';

// Extract only selected paint inputs from matching Valve depot volumes. Missing
// volumes are emitted as a DepotDownloader file list for the next pass.
const work = path.resolve('artifacts/popular-skins');
const source = path.resolve('artifacts/weapon-expansion/source');
const indexFile = process.env.CS2_PAINT_VPK_INDEX || 'artifacts/flat-sky-source/current/game/csgo/pak01_dir.vpk';
const roots = [
  ...(process.env.CS2_PAINT_VPK_DIRS || '').split(path.delimiter).filter(Boolean),
  path.join(work, 'depot/game/csgo'), path.join(work, 'depot2/game/csgo'),
  ...['depot','material-depot','last-depot'].map(name => path.resolve('artifacts/skin-expansion-work', name, 'game/csgo')),
  'artifacts/performance-maps/source-extra/steam-files/game/csgo',
  'artifacts/skin-library-review/depot/game/csgo', path.dirname(indexFile)
];
const cli = process.env.SOURCE2VIEWER_CLI || [
  'tools/source2viewer/Source2Viewer-CLI.exe'
].find(candidate => fs.existsSync(candidate));
if (!cli) throw new Error('Set SOURCE2VIEWER_CLI to the Source 2 Viewer executable.');
const index = new Map(readVpkIndex(indexFile).entries.map(entry => [entry.path, entry]));
const specs = JSON.parse(fs.readFileSync(new URL('./popular-skins.json',import.meta.url)));
const needed = new Set();

function extractCompiled(resource) {
  const entry = index.get(resource);
  if (!entry || entry.preloadBytes) throw new Error('Unsupported VPK entry: ' + resource);
  const looseFile = path.join(work, 'loose', resource);
  if (fs.existsSync(looseFile) && crc32(fs.readFileSync(looseFile)) === entry.crc) return looseFile;
  const archive = 'pak01_' + String(entry.archiveIndex).padStart(3,'0') + '.vpk';
  for (const root of roots) {
    const filename = path.join(root, archive);
    if (!fs.existsSync(filename)) continue;
    let fd;
    try {
      fd = fs.openSync(filename, 'r');
      const bytes = Buffer.alloc(entry.length);
      if (fs.readSync(fd, bytes, 0, bytes.length, entry.offset) !== bytes.length || crc32(bytes) !== entry.crc) continue;
      fs.mkdirSync(path.dirname(looseFile), {recursive:true});
      fs.writeFileSync(looseFile, bytes);
      return looseFile;
    } catch (error) {
      if (error.code !== 'EBUSY') throw error;
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
  }
  needed.add(archive);
  return null;
}

function decompile(resource, target) {
  if (fs.existsSync(target)) return true;
  const compiled = extractCompiled(resource);
  if (!compiled) return false;
  fs.mkdirSync(path.dirname(target), {recursive:true});
  const result = spawnSync(cli, ['-i',compiled,'-o',target,'-d'], {encoding:'utf8',windowsHide:true});
  if (result.status !== 0 || !fs.existsSync(target)) throw new Error(resource + '\n' + (result.error || result.stderr || result.stdout));
  return true;
}

const textures = {TexturePattern:'g_tPattern',TextureNormal:'g_tNormal',TexturePearlescenceMask:'g_tPearlescenceMask',TextureWear:'g_tWear'};
for (const spec of specs) {
  const previewReady = decompile(spec.preview, path.join(source,'panorama/images/econ/default_generated',spec.inventory + '_light_png.png'));
  const material = path.join(source, spec.material.replace(/_c$/, ''));
  if (!decompile(spec.material, material)) continue;
  const text = fs.readFileSync(material, 'utf8');
  const params = Object.fromEntries([...text.matchAll(/"([^"\r\n]+)"\s+"([^"\r\n]*)"/g)].map(match => [match[1],match[2]]));
  let ready = previewReady;
  for (const [property, compiled] of Object.entries(textures)) {
    if (!params[property] || (property === 'TextureWear' && !spec.wearMin)) continue;
    if (!params[compiled]) throw new Error(spec.paint + ' missing ' + compiled);
    if (!decompile(params[compiled] + '_c', path.join(path.dirname(material),path.basename(params[property])))) ready = false;
  }
  console.log(spec.file, ready ? 'ready' : 'pending');
}
fs.mkdirSync(work,{recursive:true});
fs.writeFileSync(path.join(work,'needed.txt'),[...needed].sort().map(name => 'game/csgo/' + name + '\n').join(''));
console.log('Required Steam depot volumes:', needed.size);
