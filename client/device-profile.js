// Input mode can be changed manually; the asset budget follows the device.
export function mobileDevice(){
  return globalThis.matchMedia?.('(pointer: coarse)').matches===true||/Android|iPhone|iPad/i.test(globalThis.navigator?.userAgent||'');
}
export const assetManifestName=()=>mobileDevice()?'asset-manifest-mobile.json':'asset-manifest.json';
