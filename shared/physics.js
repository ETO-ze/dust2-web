import { BufferGeometry, Float32BufferAttribute, Vector3, Ray, Box3, Line3, DoubleSide } from 'three';
import { MeshBVH, CENTER } from 'three-mesh-bvh';
import { Capsule } from 'three/addons/math/Capsule.js';

export const PLAYER_RADIUS = 0.30;
export const STAND_HEIGHT = 1.80;
export const CROUCH_HEIGHT = 1.10;
// Source units are converted with the same 0.0254 scale as the map. These are
// the CS jump impulse and gravity, not world-space metres copied as units.
export const GRAVITY = 800 * .0254;
export const JUMP_SPEED = 301.993378 * .0254;
export const STEP_HEIGHT = .46;
export const JUMP_BUFFER_TIME = .05;
// Keep the existing prototype hitbox heights, but cap aerial leg retraction at
// CS's 18-unit standing/crouched hull difference rather than granting 0.70 m.
export const CROUCH_JUMP_LIFT = 18 * .0254;
const WALKABLE_Y = .7;
let world = null;
let worldBounds = new Box3();
const axis = new Vector3();
const motion = new Vector3();
const ray = new Ray();

// A typed-array BVH avoids the massive triangle duplication of an octree on
// long, almost planar map walls. The capsule adapter keeps callers unchanged.
class MapCollision {
  constructor(geometry){this.bvh=new MeshBVH(geometry,{strategy:CENTER,targetLeafSize:16,maxDepth:32});this.geometry=geometry;}
  rayIntersect(r){return this.bvh.raycastFirst(r,DoubleSide);}
  capsuleIntersect(c){
    const line=new Line3(c.start.clone(),c.end.clone());
    const bounds=new Box3().setFromPoints([line.start,line.end]).expandByScalar(c.radius+.002);
    const triPoint=new Vector3(),capPoint=new Vector3(),push=new Vector3(),surface=new Vector3(),contacts=[];
    this.bvh.shapecast({
      intersectsBounds:box=>box.intersectsBox(bounds),
      intersectsTriangle:tri=>{
        const distance=tri.closestPointToSegment(line,triPoint,capPoint);
        if(distance<c.radius){
          push.subVectors(capPoint,triPoint);
          if(push.lengthSq()<1e-12){tri.getNormal(push);const side=push.dot(line.start.clone().sub(tri.a));if(side<0)push.negate();}
          push.normalize();
          tri.getNormal(surface);if(surface.dot(push)<0)surface.negate();
          contacts.push({normal:push.clone(),surface:surface.clone(),walkable:surface.y>=WALKABLE_Y&&push.y>.3,depth:c.radius-distance});
          push.multiplyScalar(c.radius-distance);
          line.start.add(push);line.end.add(push);
          bounds.setFromPoints([line.start,line.end]).expandByScalar(c.radius+.002);
        }
        return false;
      }
    });
    const normal=line.start.sub(c.start),depth=normal.length();
    return depth>1e-7?{normal:normal.multiplyScalar(1/depth),depth,contacts,walkable:contacts.some(c=>c.walkable)}:false;
  }
}

export function initPhysics(positions) {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.computeBoundingBox();
  worldBounds.copy(geometry.boundingBox);
  world?.geometry?.dispose();
  world = new MapCollision(geometry);
  return world;
}

export function createPlayerState(spawn = {}) {
  return { x:spawn.x||0, y:spawn.y||0, z:spawn.z||0, vx:0,vy:0,vz:0,
    yaw:spawn.yaw||0,pitch:0,grounded:false,crouch:false,height:STAND_HEIGHT,
    lastJump:false,lastJumpId:0,jumpBufferRemaining:0,stepDistance:0 };
}

export function capsuleFor(p, height=p.crouch?CROUCH_HEIGHT:STAND_HEIGHT) {
  return new Capsule(new Vector3(p.x,p.y+PLAYER_RADIUS,p.z),
    new Vector3(p.x,p.y+height-PLAYER_RADIUS,p.z),PLAYER_RADIUS);
}

export function raycastWorld(origin, direction, maxDistance=300) {
  if (!world) return null;
  ray.origin.set(origin.x,origin.y,origin.z);
  ray.direction.set(direction.x,direction.y,direction.z).normalize();
  const hit=world.rayIntersect(ray);
  return hit && hit.distance<=maxDistance ? hit.distance : null;
}

export function floorHeight(x,z,fromY=80,maxDistance=200) {
  const d=raycastWorld({x,y:fromY,z},{x:0,y:-1,z:0},maxDistance);
  return d === null ? null : fromY-d;
}

function collide(capsule,p) {
  let grounded=false;
  for (let i=0;i<3;i++) {
    const hit=world?.capsuleIntersect(capsule);
    if (!hit) break;
    if(hit.walkable&&p.vy<=.1){grounded=true;p.vy=0;}
    for(const contact of hit.contacts){
      if(contact.walkable&&p.vy<=.1){
        grounded=true;
        // Projecting a landing's downward speed along a ramp gave players a
        // free horizontal kick. A walkable floor cancels fall speed instead.
        p.vy=0;
      }else{
        const normal=contact.walkable?contact.surface:contact.normal;
        const dot=p.vx*normal.x+p.vy*normal.y+p.vz*normal.z;
        if(dot<0){p.vx-=normal.x*dot;p.vy-=normal.y*dot;p.vz-=normal.z*dot;}
      }
    }
    capsule.translate(axis.copy(hit.normal).multiplyScalar(hit.depth+0.0001));
  }
  return grounded;
}

// Sweep the whole capsule, including its leading edge, down onto a tread or
// ramp. A centre ray misses support at the edge of the real Dust2 stairs.
function sweepDown(capsule,maxDrop){
  let clear=0;
  const samples=Math.max(1,Math.ceil(maxDrop/.052));
  for(let sample=1;sample<=samples;sample++){
    let blocked=maxDrop*sample/samples;
    const probe=capsule.clone().translate(new Vector3(0,-blocked,0)),hit=world.capsuleIntersect(probe);
    if(hit){
      if(!hit.walkable)return null;
      for(let i=0;i<8;i++){
        const mid=(clear+blocked)/2;
        if(world.capsuleIntersect(capsule.clone().translate(new Vector3(0,-mid,0))))blocked=mid;else clear=mid;
      }
      return capsule.clone().translate(new Vector3(0,-clear,0));
    }
    clear=blocked;
  }
  return null;
}

function updateCrouch(p,wanted){
  if(Boolean(wanted)===p.crouch)return;
  const oldHeight=p.crouch?CROUCH_HEIGHT:STAND_HEIGHT,newHeight=wanted?CROUCH_HEIGHT:STAND_HEIGHT;
  const lift=Math.sign(oldHeight-newHeight)*Math.min(Math.abs(oldHeight-newHeight),CROUCH_JUMP_LIFT);
  const y=p.y+(p.grounded?0:lift);
  const candidate={...p,y,crouch:Boolean(wanted)};
  const test=capsuleFor(candidate,newHeight);
  // Raising feet in air retracts the legs. Releasing crouch performs the
  // inverse motion only if the full hull fits; it cannot teleport through a
  // ceiling or the box on which the player is about to land.
  if(!wanted){
    test.translate(new Vector3(0,.0002,0));
    const hit=world.capsuleIntersect(test);
    if(hit&&hit.contacts.some(c=>c.depth>.0003))return;
  }
  p.y=y;p.crouch=Boolean(wanted);p.height=newHeight;
}

export function stepPlayer(p,input={},dt=1/60) {
  if(!world) return p;
  dt=Math.min(.05,Math.max(.001,dt));
  p.vx=Number.isFinite(p.vx)?p.vx:0;p.vy=Number.isFinite(p.vy)?p.vy:0;p.vz=Number.isFinite(p.vz)?p.vz:0;
  p.yaw=Number.isFinite(input.yaw)?input.yaw:p.yaw;
  p.pitch=Math.max(-1.48,Math.min(1.48,Number.isFinite(input.pitch)?input.pitch:p.pitch));
  if(p.vy>.1)p.grounded=false;
  const jumpId=Number.isSafeInteger(input.jumpId)&&input.jumpId>=0?input.jumpId:null;
  const newId=jumpId!==null&&jumpId>(p.lastJumpId||0);
  if(newId)p.lastJumpId=jumpId;
  if(newId||(input.jump&&!p.lastJump))p.jumpBufferRemaining=JUMP_BUFFER_TIME;
  p.lastJump=Boolean(input.jump);
  p.jumpBufferRemaining=Math.max(0,p.jumpBufferRemaining||0);
  let jumped=false;
  const tryJump=()=>{
    if(p.grounded&&p.jumpBufferRemaining>0){p.vy=JUMP_SPEED;p.grounded=false;p.jumpBufferRemaining=0;jumped=true;return true;}
    return false;
  };
  tryJump();
  updateCrouch(p,input.crouch);
  p.height=p.crouch?CROUCH_HEIGHT:STAND_HEIGHT;
  const forward=Math.max(-1,Math.min(1,Number(input.forward)||0));
  const right=Math.max(-1,Math.min(1,Number(input.right)||0));
  const len=Math.max(1,Math.hypot(forward,right));
  const mx=(-Math.sin(p.yaw)*forward+Math.cos(p.yaw)*right)/len;
  const mz=(-Math.cos(p.yaw)*forward-Math.sin(p.yaw)*right)/len;
  const speed=(p.crouch?2.15:input.walk?2.7:6.0)*(input.speedScale||1);
  const accel=p.grounded?12:2.2;
  const t=Math.min(1,accel*dt);
  p.vx+=(mx*speed-p.vx)*t;p.vz+=(mz*speed-p.vz)*t;
  if(p.grounded&&!forward&&!right){const friction=Math.max(0,1-14*dt);p.vx*=friction;p.vz*=friction;}
  const substeps=Math.max(3,Math.ceil(dt*180)),h=dt/substeps;
  const beforeX=p.x,beforeZ=p.z;
  const incomingHorizontalSpeed=Math.hypot(p.vx,p.vz);
  for(let i=0;i<substeps;i++) {
    tryJump();
    const wasGrounded=p.grounded;
    const horizontalSpeed=Math.hypot(p.vx,p.vz);
    p.vy-=GRAVITY*h*.5;
    const c=capsuleFor(p);
    const before=c.clone();
    motion.set(p.vx,p.vy,p.vz).multiplyScalar(h);
    c.translate(motion);
    const hit=world.capsuleIntersect(c);
    // Source stairs have 0.2–0.4 m risers. Try stepping only from grounded movement.
    let ground=false;
    if(hit&&hit.depth*Math.hypot(hit.normal.x,hit.normal.z)>.0001&&wasGrounded&&!jumped&&Math.hypot(motion.x,motion.z)>.001) {
      const stepped=before.clone();
      stepped.translate(new Vector3(motion.x,STEP_HEIGHT,motion.z));
      if(!world.capsuleIntersect(stepped)) {
        const support=sweepDown(stepped,STEP_HEIGHT+.06);
        if(support){c.copy(support);p.vy=0;ground=true;}
      }
    }
    ground=collide(c,p)||ground;
    if(!ground&&wasGrounded&&!jumped&&p.vy<=0){
      const support=sweepDown(c,STEP_HEIGHT);
      if(support){c.copy(support);ground=true;}
    }
    p.x=c.start.x;p.y=c.start.y-PLAYER_RADIUS;p.z=c.start.z;
    p.grounded=ground;
    if(ground){
      p.vy=0;
      // At seams a capsule can touch a steep decorative triangle immediately
      // before the supporting floor. Its tiny gravity projection must not add
      // horizontal energy even when those contacts arrive in separate passes.
      const afterSpeed=Math.hypot(p.vx,p.vz);
      if(afterSpeed>horizontalSpeed&&afterSpeed>0){const scale=horizontalSpeed/afterSpeed;p.vx*=scale;p.vz*=scale;}
    }else p.vy-=GRAVITY*h*.5;
    p.jumpBufferRemaining=Math.max(0,p.jumpBufferRemaining-h);
  }
  if(p.grounded){
    const speed=Math.hypot(p.vx,p.vz);
    if(speed>incomingHorizontalSpeed&&speed>0){const scale=incomingHorizontalSpeed/speed;p.vx*=scale;p.vz*=scale;}
  }
  p.stepDistance=(p.stepDistance||0)+Math.hypot(p.x-beforeX,p.z-beforeZ);
  p.outOfWorld=p.y<worldBounds.min.y-12 || p.x<worldBounds.min.x-20 || p.x>worldBounds.max.x+20 || p.z<worldBounds.min.z-20 || p.z>worldBounds.max.z+20;
  return p;
}
