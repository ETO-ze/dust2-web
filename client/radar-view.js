const XZ_UNITS = .0254;
const ZOOM = 1.72;

export function radarFloor(overview, y, units=XZ_UNITS) {
  const split=Number(overview?.verticalsections?.lower?.AltitudeMax);
  return Number.isFinite(split) && Number.isFinite(y) && y/units < split ? 'lower' : 'default';
}

// The overview's north is -Z. Three.js positive yaw turns left. Apply the same
// affine projection to the background and every world marker; glyphs stay upright.
export function createRadarView({width,height,overview={},units=XZ_UNITS,focus,yaw=0}) {
  const scale=(overview.scale || 4.4)*units;
  const side=overview.size||1024;
  const pixelSize=Math.min(width,height)*ZOOM;
  const factor=pixelSize/side;
  const cx=width/2,cy=height/2,c=Math.cos(yaw),s=Math.sin(yaw);
  const px=(focus.x/units-(overview.pos_x??-2476))/(overview.scale||4.4);
  const py=((overview.pos_y??3239)+focus.z/units)/(overview.scale||4.4);
  const radius=Math.min(cx,cy);
  function point(p) {
    const x=(p.x-focus.x)*factor/scale,y=(p.z-focus.z)*factor/scale;
    return {x:cx+x*c-y*s,y:cy+x*s+y*c};
  }
  function edge(p,padding=16) {
    const v=point(p),dx=v.x-cx,dy=v.y-cy,len=Math.hypot(dx,dy),limit=radius-padding;
    if(len<=limit)return {...v,atEdge:false};
    return {x:cx+dx*limit/len,y:cy+dy*limit/len,atEdge:true,angle:Math.atan2(dy,dx)};
  }
  function background(ctx,img) {
    ctx.save();ctx.translate(cx,cy);ctx.rotate(yaw);
    ctx.drawImage(img,-px*factor,-py*factor,pixelSize,pixelSize);ctx.restore();
  }
  return {point,edge,background,cx,cy,radius,yaw};
}

export function bombRadarMarker(snapshot,viewer,{bombCamera=false,sites,focus}={}) {
  const bomb=snapshot.bomb;
  if(snapshot.mode!=='defuse'||!bomb)return null;
  if(bomb.state==='carried') {
    const carrier=snapshot.players?.find(p=>p.id===bomb.carrierId&&p.alive);
    if(viewer.team!=='T'||!carrier)return null;
    return {kind:'carried',point:focus?.id===carrier.id?focus:carrier};
  }
  if(bomb.state!=='planted'&&bomb.state!=='dropped')return null;
  if(viewer.team!=='T'&&!snapshot.bombSpotted&&!(bombCamera&&bomb.state==='planted')) {
    // The round HUD announces the site. Before a defender spots the device,
    // show that announced site, without exposing the planting position.
    if(bomb.state==='planted'&&sites?.[bomb.site])return {kind:'site',site:bomb.site,point:sites[bomb.site]};
    return null;
  }
  return {kind:bomb.state,point:bomb};
}
