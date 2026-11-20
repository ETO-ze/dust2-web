// Single-class, one-stage detector for the server's small actor silhouette buffer.
// The input belongs to this simulated room. No images or target IDs leave the server.
import weights from './grid-vision-weights.json' with {type:'json'};
import {eyePosition} from '../shared/aim.js';

const WIDTH = 80, HEIGHT = 48, STRIDE = 4, PATCH = 16, HIDDEN = 16;
const kernel = Float32Array.from(weights.kernel);
const frame = new Uint8Array(WIDTH * HEIGHT);
const hidden = new Float32Array(HIDDEN);
const outputs = new Float32Array(5);

function project(observer, actor) {
  const eye = eyePosition(observer);
  const dx = actor.x - eye.x, dz = actor.z - eye.z;
  const sin = Math.sin(observer.yaw), cos = Math.cos(observer.yaw);
  const forward = -dx * sin - dz * cos;
  const h = actor.crouch ? 1.1 : 1.8;
  const dy = actor.y + h / 2 - eye.y;
  const tilt = observer.pitch || 0;
  const depth = forward * Math.cos(tilt) + dy * Math.sin(tilt);
  if (depth < .25 || depth > 110) return null;
  const scale = 40 / depth;
  const cx = WIDTH / 2 + (dx * cos - dz * sin) * scale;
  const cy = HEIGHT / 2 - (dy * Math.cos(tilt) - forward * Math.sin(tilt)) * scale;
  const height = Math.max(2, scale * h), width = Math.max(1.6, scale * .56);
  if (cx+width/2 < 0 || cx-width/2 >= WIDTH || cy+height/2 < 0 || cy-height/2 >= HEIGHT) return null;
  return {cx, cy, height, width, actor, depth};
}

function paint(b, parts) {
  for (let y = Math.max(0, Math.floor(b.cy-b.height/2)); y < Math.min(HEIGHT, b.cy+b.height/2); y++) {
    const f = (y+.5-b.cy) / b.height + .5;
    if (f < 0 || f >= 1) continue;
    const part = f < .23 ? 0 : f < .67 ? 1 : 2;
    if (!parts[part]) continue;
    const radius = b.width * [.35,.5,.4][part];
    const start = Math.max(0, Math.ceil(b.cx-radius-.5));
    const end = Math.min(WIDTH, Math.floor(b.cx+radius-.5)+1);
    if (end > start) frame.fill(1,y*WIDTH+start,y*WIDTH+end);
  }
}

function predictCell(x,y) {
  hidden.set(weights.bias);
  let lit = false;
  for (let j=0;j<PATCH;j++) {
    const py = y+j-6;
    if (py<0 || py>=HEIGHT) continue;
    for (let i=Math.max(0,6-x);i<Math.min(PATCH,WIDTH+6-x);i++) {
      if (!frame[py*WIDTH+x+i-6]) continue;
      lit = true;
      const k = j*PATCH+i;
      for (let h=0;h<HIDDEN;h++) hidden[h] += kernel[h*PATCH*PATCH+k];
    }
  }
  if (!lit) return null;
  outputs.set(weights.outBias);
  for (let o=0;o<5;o++) for (let h=0;h<HIDDEN;h++) outputs[o] += weights.head[o*HIDDEN+h]*Math.max(0,hidden[h]);
  if (outputs[0] < 0) return null;
  return {x:x+outputs[1]*STRIDE, y:y+outputs[2]*STRIDE, w:Math.max(1,outputs[3]*16), h:Math.max(2,outputs[4]*16)};
}

// Invoked at AI decision cadence only. Match detections to already visible simulated
// opponents. The existing reaction timer, aim interpolation and legal shot rays still apply.
export function recognizeOpponents(room, observer, candidates) {
  if (!room.gridVision || !candidates.length) return candidates;
  if (room.clock() < (observer.flashBlindUntil||0)) return [];
  frame.fill(0);
  const boxes=[], cells=new Set(), near=[];
  const eye=eyePosition(observer);
  for (const candidate of candidates) {
    const box=project(observer,candidate);
    if (!box) continue;
    const height=candidate.crouch?1.1:1.8;
    const visible=[.88,.57,.24].map(f=>room.visibleToBot(eye,{x:candidate.x,y:candidate.y+f*height,z:candidate.z}));
    if (!visible.some(Boolean)) continue;
    if (box.height>24) {near.push(candidate);continue;} // close contact exceeds the detector's trained scale
    paint(box,visible);
    boxes.push(box);
    // A zero-valued cell outside every foreground object's footprint cannot own a box.
    for (let y=Math.max(0,Math.floor((box.cy-box.height/2)/STRIDE));y<=Math.min(HEIGHT/STRIDE-1,Math.floor((box.cy+box.height/2)/STRIDE));y++)
      for (let x=Math.max(0,Math.floor((box.cx-box.width/2)/STRIDE));x<=Math.min(WIDTH/STRIDE-1,Math.floor((box.cx+box.width/2)/STRIDE));x++)
        cells.add(y*(WIDTH/STRIDE)+x);
  }
  const seen=new Set(near);
  for (const key of cells) {
    const d=predictCell(key%(WIDTH/STRIDE)*STRIDE,Math.floor(key/(WIDTH/STRIDE))*STRIDE);
    if (!d) continue;
    let match=null, best=.14;
    for (const b of boxes) {
      const iw=Math.max(0,Math.min(d.x+d.w/2,b.cx+b.width/2)-Math.max(d.x-d.w/2,b.cx-b.width/2));
      const ih=Math.max(0,Math.min(d.y+d.h/2,b.cy+b.height/2)-Math.max(d.y-d.h/2,b.cy-b.height/2));
      const score=iw*ih/(d.w*d.h+b.width*b.height-iw*ih);
      if (score>best) {best=score;match=b.actor;}
    }
    if(match) seen.add(match);
  }
  return candidates.filter(p=>seen.has(p));
}
