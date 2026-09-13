export const normalizeClarity=value=>['performance','sharp'].includes(value)?value:'clear';

/** CSS layout and camera aspect stay unchanged; only the 3D drawing buffer changes. */
export function renderPixelRatio({width,height,dpr=1,mobile=false,quality='low',clarity='clear'}={}){
  const area=Math.max(1,width*height),density=Number.isFinite(dpr)?Math.max(.1,dpr):1;
  if(!mobile)return Math.min(quality==='low'?1:1.5,density,Math.sqrt((quality==='low'?1440000:2073600)/area));
  const profile={performance:{ratio:1,pixels:921600},clear:{ratio:2,pixels:1600000},sharp:{ratio:3,pixels:2400000}}[normalizeClarity(clarity)];
  return Math.min(density,profile.ratio,Math.sqrt(profile.pixels/area));
}
