/** Private map AI adapter. Uses the map's own NAV, never Dust II coordinates.
 * Collision-validated edges are supplied by the preview validator. No known
 * valid path means no move order, rather than a direct line through a wall.
 */
export class MapTacticalGraph {
  constructor(map, areas, {edgeAllowed=()=>false, standAllowed=()=>false}={}) {
    this.map=map;
    this.nodes=new Map(areas.filter(a=>a.hull===0).map(a=>[a.id,a]));
    this.edgeAllowed=edgeAllowed;
    this.standAllowed=standAllowed;
  }
  nearest(point) {
    let best=null, distance=Infinity;
    for(const a of this.nodes.values()) {
      if(!this.standAllowed(a))continue;
      // Vertical distance must count, especially on Nuke. Do not snap to a
      // floor directly overhead because its horizontal distance is shorter.
      const d=Math.hypot(point.x-a.x,2*(point.y-a.y),point.z-a.z);
      if(d<distance){best=a;distance=d;}
    }
    return best;
  }
  route(start, end, {penalties=new Map(), maxVisited=12000}={}) {
    const from=typeof start==='number'?this.nodes.get(start):this.nearest(start);
    const to=typeof end==='number'?this.nodes.get(end):this.nearest(end);
    if(!from||!to||!this.standAllowed(from)||!this.standAllowed(to))return null;
    const scores=new Map([[from.id,0]]),parent=new Map(),open=new Set([from.id]);
    let visited=0;
    while(open.size&&visited++<maxVisited) {
      let current=null,best=Infinity;
      for(const id of open){const a=this.nodes.get(id),score=scores.get(id)+Math.hypot(a.x-to.x,a.y-to.y,a.z-to.z);if(score<best){current=id;best=score;}}
      if(current===to.id){const path=[];for(let id=current;id!==undefined;id=parent.get(id))path.push(this.nodes.get(id));return path.reverse();}
      open.delete(current);
      const a=this.nodes.get(current);
      for(const id of a.neighbors) {
        const b=this.nodes.get(id);
        if(!b||!this.standAllowed(b)||!this.edgeAllowed(a,b))continue;
        const cost=scores.get(current)+Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z)+(penalties.get(id)||0);
        if(cost>=(scores.get(id)??Infinity))continue;
        scores.set(id,cost);parent.set(id,current);open.add(id);
      }
    }
    return null;
  }
  alternatives(start,end,count=3) {
    const paths=[],penalties=new Map();
    for(let i=0;i<count;i++){
      const p=this.route(start,end,{penalties});
      if(!p||paths.some(old=>old.map(n=>n.id).join(',')===p.map(n=>n.id).join(',')))break;
      paths.push(p);
      for(const a of p.slice(1,-1))penalties.set(a.id,(penalties.get(a.id)||0)+8);
    }
    return paths;
  }
  guards(site, round=0, count=5) {
    const target=this.map.sites[site];
    if(!target)return [];
    const candidates=[...this.nodes.values()].filter(a=>this.standAllowed(a)&&Math.abs(a.y-target.y)<2.2&&Math.hypot(a.x-target.x,a.z-target.z)<15);
    candidates.sort((a,b)=>((a.id*31+round*79)%997)-((b.id*31+round*79)%997));
    const chosen=[];
    for(const p of candidates){if(chosen.every(a=>Math.hypot(a.x-p.x,a.z-p.z)>2.5)&&this.route(p,target))chosen.push(p);if(chosen.length===count)break;}
    return chosen;
  }
}

export function planMapRound(graph,{players,round=1,previousSite=null,eco=false}={}) {
  const bots=players.filter(p=>p.bot&&!p.controlledBy&&!p.controllerId&&p.alive!==false);
  const site=previousSite==='A'?'B':previousSite==='B'?'A':round%2?'A':'B';
  const attacks=bots.filter(p=>p.team==='T'),defenders=bots.filter(p=>p.team==='CT');
  const orders=[];
  const alternatives=attacks.length?graph.alternatives(attacks[0],graph.map.sites[site]):[];
  for(let i=0;i<attacks.length;i++){
    const p=attacks[i],preferred=alternatives[eco?0:i%Math.max(1,alternatives.length)];
    const path=preferred&&graph.route(p,preferred[0]);
    orders.push({playerId:p.id,site,role:i===0?'entry':i===1?'trade':i===2?'carrier':'support',
      path:path?[...path,...preferred.slice(1)]:[],state:path?'advance':'await-valid-route',
      // Tactical intent is separate from a verified lineup. No blind throws.
      utility:[],minTradeGap:1.5,maxTradeGap:4});
  }
  for(let i=0;i<defenders.length;i++){
    const p=defenders[i],hold=i%2?'B':'A',positions=graph.guards(hold,round,defenders.length),goal=positions[Math.floor(i/2)]||null;
    const path=goal&&graph.route(p,goal);
    orders.push({playerId:p.id,site:hold,role:i<2?'anchor':'rotator',path:path||[],state:path?'defend':'await-valid-route',utility:[]});
  }
  return {map:graph.map.id,round,site,tempo:eco?'contact':'split',orders};
}

export function verifiedUtility(profile, {sourceSha256,physicsSha256}={}) {
  // A strategy description or an old CS:GO lineup is not trajectory evidence.
  return (profile?.lineups||[]).filter(p=>p.validation?.passed===true&&p.validation.sourceSha256===sourceSha256&&p.validation.physicsSha256===physicsSha256&&p.release&&p.target);
}

/** Route through the actual shared NAV edge, not the centre-to-centre chord
 * which can cut the corner of two convex navigation polygons. */
export function navigationPortal(a,b) {
  const edge=a.portals?.find(p=>p.to===b.id);
  if(!edge)return null;
  const p=edge.a,q=edge.b,dx=q[0]-p[0],dz=q[2]-p[2],length2=dx*dx+dz*dz;
  if(length2<1e-8)return null;
  const reverse=b.portals?.find(p=>p.to===a.id);
  let lo=0,hi=1;
  if(reverse){
    const along=v=>((v[0]-p[0])*dx+(v[2]-p[2])*dz)/length2;
    const side=v=>Math.abs((v[0]-p[0])*dz-(v[2]-p[2])*dx)/Math.sqrt(length2);
    if(side(reverse.a)<.06&&side(reverse.b)<.06){lo=Math.max(0,Math.min(along(reverse.a),along(reverse.b)));hi=Math.min(1,Math.max(along(reverse.a),along(reverse.b)));}
  }
  if(hi<lo)return null;
  const t=(lo+hi)/2;
  return{x:p[0]+dx*t,y:p[1]+(q[1]-p[1])*t,z:p[2]+dz*t,width:Math.sqrt(length2)*(hi-lo)};
}
