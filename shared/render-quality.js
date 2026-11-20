export const normalizeClarity=value=>['performance','sharp'].includes(value)?value:'clear';

/** CSS layout and camera aspect stay unchanged; only the 3D drawing buffer changes. */
export function renderPixelRatio({width,height,dpr=1,mobile=false,quality='low',clarity='clear'}={}){
  const area=Math.max(1,width*height),density=Number.isFinite(dpr)?Math.max(.1,dpr):1;
  if(!mobile)return Math.min(quality==='low'?1:1.5,density,Math.sqrt((quality==='low'?1440000:2073600)/area));
  const profile={performance:{ratio:1,pixels:921600},clear:{ratio:2,pixels:1600000},sharp:{ratio:3,pixels:2400000}}[normalizeClarity(clarity)];
  return Math.min(density,profile.ratio,Math.sqrt(profile.pixels/area));
}

export function normalizeFlatScale(value) {
  const scale = Number(value);
  return [0.75, 1, 1.25, 1.5].includes(scale) ? scale : 1;
}

/** Percentages use the native display density up to the base pixel budget.
 * Scale the actual display rectangle so 4:3 stretch does not first render a
 * narrower framebuffer and then blur it horizontally in the compositor.
 */
export function flatDrawingBuffer(viewport, {dpr = 1, mobile = false, scale = 1, maxDimension = 8192} = {}) {
  const width = Math.max(1, Math.round(viewport.displayWidth));
  const height = Math.max(1, Math.round(viewport.displayHeight));
  const area = width * height;
  const density = Number.isFinite(dpr) ? Math.max(0.1, dpr) : 1;
  const native = Math.min(density, Math.sqrt((mobile ? 2600000 : 3686400) / area));
  const ratio = Math.min(native * normalizeFlatScale(scale),
    Math.sqrt((mobile ? 3400000 : 8294400) / area), maxDimension / Math.max(width, height));
  return {width, height, ratio};
}
