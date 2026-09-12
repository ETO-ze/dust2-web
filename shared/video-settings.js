export function normalizeVideo(value={}) {
  return {aspect:value.aspect==='4:3'?'4:3':'16:9',display:value.display==='stretch'?'stretch':'bars'};
}
export function viewportSize(width,height,settings={}) {
  const video=normalizeVideo(settings),aspect=video.aspect==='4:3'?4/3:16/9;
  const h=Math.max(1,Math.min(height,width/aspect)),w=h*aspect;
  return {aspect,width:Math.round(w),height:Math.round(h),displayWidth:video.display==='stretch'?width:Math.round(w),displayHeight:video.display==='stretch'?height:Math.round(h)};
}
