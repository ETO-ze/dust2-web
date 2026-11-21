import {createRadarView,radarFloor,bombRadarMarker} from './radar-view.js';

const floorImages={
  de_nuke:new URL('./radar-assets/de_nuke_lower_radar_psd.png',import.meta.url).href,
  de_train:new URL('./radar-assets/de_train_lower_radar_psd.png',import.meta.url).href,
  de_vertigo:new URL('./radar-assets/de_vertigo_lower_radar_psd.png',import.meta.url).href,
};
const symbolURLs={
  bomb:new URL('./radar-assets/c4_sml_png.png',import.meta.url).href,
  above:new URL('./radar-assets/icon-radar-bomb-above_png.png',import.meta.url).href,
  below:new URL('./radar-assets/icon-radar-bomb-below_png.png',import.meta.url).href,
};
const images=new Map();
function loaded(url){
  if(!url)return null;
  let img=images.get(url);
  if(!img){img=new Image();img.src=url;images.set(url,img);}
  return img.complete&&img.naturalWidth?img:null;
}
function circle(ctx,x,y,r,fill,stroke){
  ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);
  if(fill){ctx.fillStyle=fill;ctx.fill();}
  if(stroke){ctx.strokeStyle=stroke;ctx.stroke();}
}
function chevron(ctx,point,yaw,fill,size=7){
  ctx.save();ctx.translate(point.x,point.y);ctx.rotate(yaw);
  ctx.beginPath();ctx.moveTo(0,-size);ctx.lineTo(size*.72,size*.77);ctx.lineTo(0,size*.37);ctx.lineTo(-size*.72,size*.77);ctx.closePath();
  ctx.lineWidth=1.8;ctx.strokeStyle='#15201b';ctx.stroke();ctx.fillStyle=fill;ctx.fill();ctx.restore();
}
function floorSign(map,y,focusY){
  const units=map.metersPerSourceUnit||.0254;
  if(map.overview?.verticalsections){
    if(radarFloor(map.overview,y,units)===radarFloor(map.overview,focusY,units))return '';
  }else if(Math.abs(y-focusY)<3)return '';
  return y>focusY?'above':'below';
}
function paintBomb(ctx,view,marker,map,focusY,time){
  const target=view.edge(marker.point,18),{x,y}=target;
  const carried=marker.kind==='carried',site=marker.kind==='site',planted=marker.kind==='planted'||site;
  const color=planted?'#ff6855':'#ffcc55';
  ctx.save();
  if(target.atEdge)chevron(ctx,{x:x+Math.cos(target.angle)*10,y:y+Math.sin(target.angle)*10},target.angle+Math.PI/2,color,4);
  const cx=carried&&!target.atEdge?x+8:x,cy=carried&&!target.atEdge?y-7:y;
  const radius=carried?7:10;
  if(!carried){
    const progress=(time%(planted?760:1600))/(planted?760:1600);
    ctx.globalAlpha=.78*(1-progress);ctx.lineWidth=2;circle(ctx,x,y,radius+progress*7,null,color);ctx.globalAlpha=1;
  }
  ctx.lineWidth=1.8;circle(ctx,cx,cy,radius,'#281f15',color);
  const icon=site?null:loaded(symbolURLs.bomb);
  if(site){ctx.fillStyle=color;ctx.textAlign='center';ctx.font='bold 13px sans-serif';ctx.fillText(marker.site,cx,cy+4);}
  else if(icon){const w=carried?16:22;ctx.drawImage(icon,cx-w/2,cy-w*.355,w,w*.71);}
  else {ctx.fillStyle=color;ctx.textAlign='center';ctx.font='bold 9px sans-serif';ctx.fillText('C4',cx,cy+3);}
  const level=floorSign(map,marker.point.y,focusY);
  if(level){
    const layer=loaded(symbolURLs[level]);
    const fy=cy+(level==='above'?-13:13);
    if(layer)ctx.drawImage(layer,cx-6,fy-5,12,10);
    else chevron(ctx,{x:cx,y:fy},level==='above'?0:Math.PI,'#fff2c7',4);
  }
  ctx.restore();
}
export function renderMatchRadar({canvas,ctx,map,image,snapshot,viewer,focus,time,receivedAt,revealed,bombCamera=false,rotate=true}){
  const {width,height}=canvas,units=map.metersPerSourceUnit||.0254;
  const view=createRadarView({width,height,overview:map.overview,units,focus,yaw:rotate?focus.yaw||0:0});
  const floor=radarFloor(map.overview,focus.y,units);
  const background=floor==='lower'?loaded(floorImages[map.id])||image:image;
  ctx.save();ctx.clearRect(0,0,width,height);
  ctx.beginPath();ctx.arc(view.cx,view.cy,view.radius,0,Math.PI*2);ctx.clip();
  ctx.fillStyle='#111816';ctx.fillRect(0,0,width,height);
  if(background){ctx.globalAlpha=.89;view.background(ctx,background);ctx.globalAlpha=1;}
  for(const p of snapshot.players||[]){
    if(!p.alive||p.team!==viewer.team||p.id===focus.id)continue;
    const point=view.edge(p,8),color=p.team==='T'?'#eabe54':'#83acdf';
    ctx.save();
    if(floorSign(map,p.y,focus.y))ctx.globalAlpha=.62;
    if(!point.atEdge)chevron(ctx,point,view.yaw-(p.yaw||0),color,7);
    ctx.lineWidth=1.4;circle(ctx,point.x,point.y,4.7,color,'#151b17');
    if(Number.isInteger(p.seat)){ctx.fillStyle='#17201d';ctx.font='bold 8px sans-serif';ctx.textAlign='center';ctx.fillText(String(p.seat+1),point.x,point.y+2.8);}
    ctx.restore();
  }
  const seen=new Set();
  for(const contact of snapshot.radarContacts||[]){
    const age=snapshot.time-contact.at+Math.max(0,time-receivedAt);
    if(age>=1400)continue;
    seen.add(contact.id);
    const p=view.point(contact);
    ctx.save();ctx.translate(p.x,p.y);ctx.globalAlpha=Math.min(1,(1400-age)/600);ctx.lineWidth=1.7;
    ctx.strokeStyle=ctx.fillStyle='#ff7967';ctx.beginPath();ctx.moveTo(0,-5);ctx.lineTo(4,0);ctx.lineTo(0,5);ctx.lineTo(-4,0);ctx.closePath();
    if(age<350)ctx.fill();else ctx.stroke();
    const level=floorSign(map,contact.y,focus.y);
    if(level){ctx.font='bold 9px sans-serif';ctx.fillText(level==='above'?'↑':'↓',5,3);}
    ctx.restore();
  }
  for(const [id,report] of revealed){
    if(report.until<=time){revealed.delete(id);continue;}
    if(seen.has(id))continue;
    const p=view.point(report);ctx.globalAlpha=Math.min(1,(report.until-time)/450);circle(ctx,p.x,p.y,3.5,'#ee8169');ctx.globalAlpha=1;
  }
  if(!bombCamera)chevron(ctx,{x:view.cx,y:view.cy},view.yaw-(focus.yaw||0),viewer.alive||focus.id!==viewer.id?'#f3ffc7':'#aaaaaa',7.8);
  const marker=bombRadarMarker(snapshot,viewer,{bombCamera,sites:map.sites,focus});
  if(marker)paintBomb(ctx,view,marker,map,focus.y,time);
  ctx.restore();
}
