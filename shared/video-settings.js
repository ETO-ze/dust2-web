export function normalizeVideo(value={}) {
  return {aspect:value.aspect==='4:3'?'4:3':'16:9',display:value.display==='stretch'?'stretch':'bars'};
}
export function viewportSize(width,height,settings={}) {
  if(settings.mobile){const w=Math.max(1,Math.round(width)),h=Math.max(1,Math.round(height));return {aspect:w/h,width:w,height:h,displayWidth:w,displayHeight:h};}
  const video=normalizeVideo(settings),aspect=video.aspect==='4:3'?4/3:16/9;
  const h=Math.max(1,Math.min(height,width/aspect)),w=h*aspect;
  return {aspect,width:Math.round(w),height:Math.round(h),displayWidth:video.display==='stretch'?width:Math.round(w),displayHeight:video.display==='stretch'?height:Math.round(h)};
}
