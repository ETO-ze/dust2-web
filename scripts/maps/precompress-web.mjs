import {readdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {gzipSync} from 'node:zlib';

// Run on the built web release. The gateway negotiates these files at the
// original URL so the simulation never spends a tick compressing client JS.
const [dist]=process.argv.slice(2);
if(!dist)throw Error('Usage: node scripts/maps/precompress-web.mjs <client-dist>');
const directory=path.join(dist,'assets');
for(const entry of await readdir(directory,{withFileTypes:true})){
  if(!entry.isFile()||!(/\.(?:js|css)$/i.test(entry.name)))continue;
  const file=path.join(directory,entry.name),content=await readFile(file);
  if(content.length<1024)continue;
  const compressed=gzipSync(content,{level:9});
  if(compressed.length<content.length)await writeFile(file+'.gz',compressed);
}
