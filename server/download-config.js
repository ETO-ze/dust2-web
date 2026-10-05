import {validateDownloadConfig} from '../shared/download-config.js';

/** Operators configure delivery; players cannot redirect downloads through URL
 * parameters or saved settings. This describes static resources only. */
export function serverDownloadConfig(environment=process.env) {
 const fallback=environment.DUST2_DOWNLOAD_FALLBACK;
 if(fallback!==undefined&&!['true','false'].includes(fallback))
  throw Error('DUST2_DOWNLOAD_FALLBACK must be true or false');
 return validateDownloadConfig({schemaVersion:1,
  assetBaseURL:environment.DUST2_ASSET_DOWNLOAD_BASE||null,
  mapBaseURL:environment.DUSTII_MAP_DOWNLOAD_BASE||null,
  fallbackToGameServer:fallback==='true'},'http://127.0.0.1/');
}

export function sendDownloadConfig(request,response,config) {
 const bytes=Buffer.from(JSON.stringify(config));
 response.writeHead(200,{'Content-Type':'application/json; charset=utf-8',
  'Content-Length':bytes.length,'Cache-Control':'no-store'});
 response.end(request.method==='HEAD'?undefined:bytes);
}
