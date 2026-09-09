import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
try {
  const manifest = JSON.parse(await readFile(path.join(root, 'package-manifest.json'), 'utf8'));
  let checked = 0;
  for (const entry of manifest.files) {
    if (path.isAbsolute(entry.path) || /[\0\\:]/.test(entry.path) || entry.path.split('/').some(p=>!p||p==='..')) throw new Error('Invalid manifest path');
    const file = path.join(root, entry.path), info = await stat(file);
    if (info.size !== entry.bytes) throw new Error(`文件不完整：${entry.path}`);
    const hash = createHash('sha256'); for await (const chunk of createReadStream(file)) hash.update(chunk);
    if (hash.digest('hex') !== entry.sha256) throw new Error(`校验失败：${entry.path}`);
    if (++checked % 200 === 0) console.log(`已检查 ${checked} / ${manifest.files.length}`);
  }
  console.log(`PASS：${checked} 个文件完整，SHA-256 全部匹配。`);
} catch (error) { console.error(error.message); process.exitCode = 1; }
