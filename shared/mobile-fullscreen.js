export const isAndroidApp=(ua=navigator.userAgent)=>/\bDustIIAndroid\//.test(ua);
// Keep the protected call before the first await: a touch click activates it.
export async function requestGameFullscreen({doc=document,nav=navigator,screenObject=screen,native=isAndroidApp()}={}){
  if(native)return {fullscreen:true,native:true};
  if(!doc.fullscreenElement){
    if(!doc.documentElement.requestFullscreen)return {fullscreen:false,reason:'unsupported'};
    if(nav.userActivation?.isActive===false)return {fullscreen:false,reason:'gesture'};
    try{await doc.documentElement.requestFullscreen({navigationUI:'hide'});}
    catch{return {fullscreen:false,reason:'denied'};}
  }
  try{await screenObject.orientation?.lock?.('landscape');}catch{/* Fullscreen still works without an orientation lock. */}
  return {fullscreen:!!doc.fullscreenElement};
}
