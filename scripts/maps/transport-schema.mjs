// The transport changes bytes on the wire only. Source glTF, node indices and
// authoritative collision hashes remain the compatibility contract.
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const positive=(n,max)=>Number.isSafeInteger(n)&&n>0&&n<=max;
export const TRANSPORT_BLOCK_BYTES=4*1024*1024;
export function validateMapTransport(manifest,identity){
 if(manifest?.schemaVersion!==1||manifest.id!==identity.id||manifest.sourceSha256!==identity.sourceSha256||manifest.originalRenderGltfSha256!==identity.originalRenderGltfSha256||!hash(manifest.originalRenderGltfSha256)||!Array.isArray(manifest.files)||manifest.files.length>4096)throw Error('地图加速资源与原图版本不一致');
 const files=new Map();let totalChunks=0;
 for(const file of manifest.files){
  if(!/^(?:raw\/[^\\/%\x00-\x1f?#]+|compiled\/(?:physics\.f32|physics-mask\.u8|physics-groups\.json)|entity-collision-policy\.json)$/.test(file.path)||['raw/.','raw/..'].includes(file.path)||files.has(file.path)||!positive(file.bytes,512*1024*1024)||!hash(file.sha256)||!['gzip-chunks','webp-lossless'].includes(file.encoding)||!Array.isArray(file.chunks)||!file.chunks.length||file.chunks.length>512)throw Error('地图加速清单无效');
  totalChunks+=file.chunks.length;if(totalChunks>8192)throw Error('地图加速分块过多');
  let offset=0;
  for(const chunk of file.chunks){
   const max=file.encoding==='gzip-chunks'?TRANSPORT_BLOCK_BYTES:256*1024*1024;
   if(chunk.offset!==offset||!positive(chunk.bytes,file.encoding==='gzip-chunks'?TRANSPORT_BLOCK_BYTES+65536:64*1024*1024)||!positive(chunk.decodedBytes,max)||!hash(chunk.sha256)||!hash(chunk.decodedSha256))throw Error('地图加速分块无效');
   offset+=chunk.decodedBytes;
  }
  if(file.encoding==='gzip-chunks'&&offset!==file.bytes)throw Error('地图加速分块长度不匹配');
  if(file.encoding==='webp-lossless'&&(!file.path.startsWith('raw/')||!file.path.endsWith('.png')||file.chunks.length!==1||!positive(file.width,16384)||!positive(file.height,16384)||file.decodedFormat!=='rgba8'||!hash(file.pixelSha256)||file.width*file.height*4!==offset||file.chunks[0].decodedSha256!==file.pixelSha256))throw Error('原图像素校验信息无效');
  files.set(file.path,file);
 }
 return files;
}
export function transportObjectName(file,chunk){return chunk.sha256+(file.encoding==='gzip-chunks'?'.gz':'.webp');}
export function transportBytes(file){return file.chunks.reduce((sum,chunk)=>sum+chunk.bytes,0);}
