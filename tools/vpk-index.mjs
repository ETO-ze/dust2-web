// Read-only VPK directory inventory. This never modifies a game installation.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function readVpkIndex(filename) {
  const fd = fs.openSync(filename, 'r');
  try {
    const header = Buffer.alloc(28); fs.readSync(fd, header, 0, 28, 0);
    if (header.readUInt32LE(0) !== 0x55aa1234) throw new Error('Invalid VPK signature');
    const version = header.readUInt32LE(4), treeSize = header.readUInt32LE(8), headerSize = version === 2 ? 28 : 12;
    const tree = Buffer.alloc(treeSize); fs.readSync(fd, tree, 0, treeSize, headerSize);
    let cursor = 0;
    const string = () => { const end = tree.indexOf(0, cursor); if (end < 0) throw new Error('Invalid VPK tree'); const value = tree.toString('utf8', cursor, end); cursor = end + 1; return value; };
    const entries = [];
    for (let ext = string(); ext; ext = string()) {
      for (let folder = string(); folder; folder = string()) {
        for (let name = string(); name; name = string()) {
          const crc = tree.readUInt32LE(cursor), preloadBytes = tree.readUInt16LE(cursor + 4), archiveIndex = tree.readUInt16LE(cursor + 6), offset = tree.readUInt32LE(cursor + 8), length = tree.readUInt32LE(cursor + 12);
          if (tree.readUInt16LE(cursor + 16) !== 0xffff) throw new Error('Invalid VPK entry terminator');
          cursor += 18 + preloadBytes;
          entries.push({ path: `${folder === ' ' ? '' : folder + '/'}${name}.${ext}`, crc, preloadBytes, archiveIndex, offset, length });
        }
      }
    }
    return { file: path.resolve(filename), version, headerSize, treeSize, entries };
  } finally { fs.closeSync(fd); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const result = readVpkIndex(process.argv[2]);
  if (process.argv[3]) fs.writeFileSync(process.argv[3], JSON.stringify(result));
  const counts = {};
  for (const entry of result.entries) { const ext = path.extname(entry.path); counts[ext] = (counts[ext] || 0) + 1; }
  console.log(JSON.stringify({ file: result.file, version: result.version, entries: result.entries.length, counts }, null, 2));
}
