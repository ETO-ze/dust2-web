/** Public maps reuse the existing root SHA cache without merging private or
 * installed-client storage. Resource URLs remain relative to their document. */
export function publicPoolAssetCacheBase(pageURL,{installed=false}={}) {
 const directory=new URL('.',pageURL);
 if(!installed&&['/','/play/de_dust2/','/play/de_mirage/'].includes(directory.pathname))return new URL('/',directory);
 return directory;
}
