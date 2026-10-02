import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {DEFAULT_SKINS,getSkin} from '../shared/skins.js';
import {UTILITY_ASSETS} from '../shared/utility-assets.js';
import {CLIENT_BUILD,ASSET_VERSION} from '../shared/online-build.js';
const root=path.resolve(process.env.DUSTII_WEB_DIST||'dist');
const stage=path.resolve(process.env.DUSTII_INSTALLED_CLIENT||'artifacts/installed-client');
if(path.basename(stage)!=='installed-client')throw Error('Staging must be a dedicated installed-client directory');
await fs.mkdir(stage,{recursive:true});
const out=await fs.realpath(stage);
const lock=JSON.parse(await fs.readFile('config/assets-lock.json','utf8'));
if(lock.version!==ASSET_VERSION)throw Error('Update shared asset identity before packaging.');
const locked=new Map(lock.files.map(f=>[f.path,f])),wanted=new Set();
// HUD/menu images are loaded directly, outside the 3D preload manifests.
// Include catalog previews and metadata, while optional models/music stay remote.
for(const f of lock.files)if(/\.(png|webp|jpg|jpeg|svg)$/.test(f.path)||f.path.endsWith('manifest.json'))wanted.add(f.path);
for(const name of ['asset-manifest.json','asset-manifest-mobile.json']){
 wanted.add('assets/'+name);const manifest=JSON.parse(await fs.readFile(path.join(root,'assets',name),'utf8'));for(const f of manifest.files)wanted.add(f.path);
}
for(const asset of [...Object.values(DEFAULT_SKINS).map(getSkin),...Object.values(UTILITY_ASSETS)]){
 if(asset?.model)wanted.add(asset.model);if(asset?.animation?.model)wanted.add(asset.animation.model);
}
// Build chunks, icons and shell only; downloads and optional cosmetics stay out.
for(const name of await fs.readdir(root))if(/\.(html|js|webmanifest)$/.test(name))wanted.add(name);
for(const name of await fs.readdir(path.join(root,'assets')))if(/\.(js|css)$/.test(name))wanted.add('assets/'+name);
for(const name of await fs.readdir(path.join(root,'icons')))wanted.add('icons/'+name);
await fs.mkdir(out,{recursive:true});
// Rebuild only this generated staging directory, with a checked absolute target.
if(out!==await fs.realpath(stage)||out===root)throw Error('Invalid staging path');
for(const entry of await fs.readdir(out))await fs.rm(path.join(out,entry),{recursive:true,force:true});
const files=[];
for(const relative of [...wanted].sort()){
 let bytes=await fs.readFile(path.join(root,relative));const sha=createHash('sha256').update(bytes).digest('hex');
 const expected=locked.get(relative);if(relative.startsWith('assets/')&&!/\.(js|css)$/.test(relative)&&(!expected||expected.bytes!==bytes.length||expected.sha256!==sha))throw Error('Asset integrity: '+relative);
 if(relative==='index.html')bytes=Buffer.from(bytes.toString().replace('<head>','<head><script>globalThis.__DUST2_PORTABLE__={mode:"online",bundledAssets:true,socketURL:"wss://cs2.duskrain.cn/ws"};</script>'));
 const dest=path.join(out,relative);await fs.mkdir(path.dirname(dest),{recursive:true});await fs.writeFile(dest,bytes);
 files.push({path:relative,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
}
await fs.writeFile(path.join(out,'bundle-manifest.json'),JSON.stringify({clientBuild:CLIENT_BUILD,assetVersion:ASSET_VERSION,files}));
console.log(JSON.stringify({directory:out,files:files.length,MiB:Math.round(files.reduce((n,f)=>n+f.bytes,0)/1048576)}));
