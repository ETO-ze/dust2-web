// Private Mirage shortcuts derived from the immutable source collision mesh.
// These are ordinary movement inputs; neither this controller nor the links
// override player position, velocity, jump impulse, collision, or damage.
export const MIRAGE_JUMP_IDENTITY=Object.freeze({mapId:'de_mirage',sourceSha256:'e66cdf1ae6a976f6f6ba510a2addd04b25a4c1cfd811f51f1ef13f0954e6e350',physicsSha256:'f76f6fd83d4283e308ca89340dff8d5e7fc60d8c34ea21d13ab20eda23a51399',airMovement:'source'});
export const MIRAGE_JUMP_LINKS=Object.freeze([
 {id:'mirage-mid-bench',name:'中路地面 → 长椅',from:{x:-26.3144,y:-6.70549,z:16.48447},to:{x:-26.9,y:-4.87669,z:18.1},navFrom:843,navTo:865,
  kind:'approach-jump',angle:2.7938,runup:0,crouchAt:1/30,maxFlight:2.5,landing:{minX:-27.4,maxX:-26.6,minZ:17.65,maxZ:18.4,y:-4.87669}},
 {id:'mirage-bench-window',name:'长椅 → VIP 窗口',from:{x:-26.9,y:-4.87669,z:18.1},to:{x:-29.4,y:-4.26709,z:15.7},navFrom:865,navTo:851,
  kind:'strafe-left',angle:0,runup:.2,crouchAt:.1,turnRate:2,maxFlight:1.4,landing:{minX:-31.5,maxX:-28.55,minZ:13.4,maxZ:17.5,y:-4.26709}},
 {id:'mirage-window-bricks',name:'VIP 窗沿 → 黑屋前砖堆',from:{x:-27.8,y:-3.42889,z:14.9},to:{x:-30.8,y:-2.43829,z:12.2},navFrom:836,navTo:896,
  kind:'direct',angle:.8,runup:4/30,crouchAt:0,maxFlight:1.4,landing:{minX:-31.6,maxX:-30.45,minZ:11.75,maxZ:12.85,y:-2.43829}},
 {id:'mirage-bricks-ladder',name:'砖堆 → 黑屋通风口',from:{x:-30.7,y:-2.43829,z:11.8},to:{x:-29.5,y:-1.42229,z:10.4},navFrom:896,navTo:841,
  requiresBroken:'mirage-ladder-vent',kind:'direct',angle:-.4,runup:2/30,crouchAt:.1,maxFlight:1.5,landing:{minX:-30.6,maxX:-28.9,minZ:9.7,maxZ:10.65,y:-1.42229}},
]);
const horizontal=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
const neutral=p=>({forward:0,right:0,jump:false,crouch:!!p.crouch,yaw:p.yaw});
export function jumpLinkLanded(link,p){const l=link.landing;return !!p.grounded&&p.x>=l.minX&&p.x<=l.maxX&&p.z>=l.minZ&&p.z<=l.maxZ&&Math.abs(p.y-l.y)<.12;}
export function createJumpLinkController(link){return {link,phase:'align',elapsed:0,total:0,settled:0,jumps:0,failed:null,done:false};}
/** A caller must use the same dt for this function and stepPlayer. The align
 * phase absorbs prior NAV momentum before the timed run-up. A closed vent,
 * stolen bot, death, lost footing, or timeout stops the shortcut safely. */
export function jumpLinkInput(state,p,dt=1/30,{broken=()=>false,controlled=false}={}){
 const {link}=state;dt=Math.min(.05,Math.max(.001,dt));state.total+=dt;
 const fail=reason=>{state.phase='failed';state.failed=reason;return neutral(p);};
 if(state.done||state.failed)return neutral(p);
 if(controlled||p.alive===false)return fail('control-lost');
 if(link.requiresBroken&&!broken(link.requiresBroken))return fail('breakable-closed');
 if(state.total>7)return fail('timeout');
 if(state.phase==='align'){
  if(Math.abs(p.y-link.from.y)>.3||!p.grounded)return fail('start-not-supported');
  const d=horizontal(p,link.from),speed=Math.hypot(p.vx,p.vz);
  if(d<.035&&speed<.06&&!p.crouch){if(++state.settled>=3){state.phase='run';state.elapsed=0;}}else state.settled=0;
  if(state.phase==='align')return {yaw:d>.015?Math.atan2(-(link.from.x-p.x),-(link.from.z-p.z)):link.angle,forward:d>.02?Math.min(.22,d*1.1):0,crouch:false,jump:false};
 }
 if(state.phase==='run'){
  if(!p.grounded)return fail('runup-left-support');
  if(state.elapsed+1e-8<link.runup){state.elapsed+=dt;return {yaw:link.angle,forward:1,crouch:false,jump:false};}
  state.phase='flight';state.elapsed=0;if(link.kind!=='approach-jump')state.jumps++;
 }
 if(state.phase==='flight'){
  if(state.elapsed>.1&&jumpLinkLanded(link,p)){state.phase='brake';state.elapsed=0;}
  else{
   if(state.elapsed>link.maxFlight)return fail('landing-missed');
   const t=state.elapsed;state.elapsed+=dt;
   if(link.kind==='approach-jump'){
    const remaining=horizontal(p,link.to),jump=p.grounded&&remaining<1.3&&state.jumps===0;
    if(jump)state.jumps++;
    return {yaw:Math.atan2(-(link.to.x-p.x),-(link.to.z-p.z)),forward:Math.min(1,remaining/.3),right:0,jump,crouch:!p.grounded};
   }
   return {yaw:link.angle+(link.kind==='strafe-left'?(link.turnRate||0)*t:0),forward:link.kind==='strafe-left'?0:1,right:link.kind==='strafe-left'?-1:0,crouch:t+1e-8>=link.crouchAt,jump:t===0};
  }
 }
 if(state.phase==='brake'){
  state.elapsed+=dt;if(!jumpLinkLanded(link,p))return fail('landing-lost');
  if(state.elapsed>=.25&&Math.hypot(p.vx,p.vz)<.12){state.done=true;state.phase='done';}
  return neutral(p);
 }
 return neutral(p);
}
