import * as THREE from 'three';

function makeFeedbackSprite(lines) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 256, 128);
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(8, 8, 240, 112);
  ctx.font = 'bold 28px Segoe UI, Microsoft YaHei, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const colors = ['#f0a060', '#ff7a5c', '#9ad0ff'];
  lines.forEach((line, i) => {
    ctx.fillStyle = colors[i] || '#ffffff';
    ctx.fillText(line, 20, 32 + i * 32);
  });
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(2.4, 1.2, 1);
  sprite.center.set(0.5, 0);
  sprite.renderOrder = 20;
  sprite.userData.dispose = () => {
    tex.dispose();
    mat.dispose();
  };
  sprite.userData.key = lines.join('|');
  return sprite;
}

/** Floating HE / fire / flash readout above practice dummies. */
export class PracticeDummyHud {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.scene?.add(this.group);
    this.sprites = new Map();
  }

  sync(players = [], enabled = false) {
    if (!enabled) {
      this.clear();
      return;
    }
    const alive = new Set();
    for (const p of players) {
      if (!p?.practiceDummy) continue;
      const hud = p.practiceHud || {};
      const he = Math.round(Number(hud.he) || 0);
      const fire = Math.round(Number(hud.fire) || 0);
      const flashPct = Math.round(Number(hud.flashPct) || 0);
      const flashSec = Math.round((Number(hud.flashSec) || 0) * 10) / 10;
      if (!he && !fire && !flashPct && !flashSec) {
        this.remove(p.id);
        continue;
      }
      alive.add(p.id);
      const lines = [
        `雷:${he}`,
        `火:${fire}`,
        `闪:${flashPct}% ${flashSec}s`,
      ];
      const key = lines.join('|');
      let sprite = this.sprites.get(p.id);
      if (!sprite || sprite.userData.key !== key) {
        this.remove(p.id);
        sprite = makeFeedbackSprite(lines);
        this.sprites.set(p.id, sprite);
        this.group.add(sprite);
      }
      const height = p.crouch ? 1.55 : 2.05;
      sprite.position.set(p.x, (p.y || 0) + height, p.z);
    }
    for (const id of [...this.sprites.keys()]) {
      if (!alive.has(id)) this.remove(id);
    }
  }

  remove(id) {
    const sprite = this.sprites.get(id);
    if (!sprite) return;
    this.group.remove(sprite);
    sprite.userData.dispose?.();
    this.sprites.delete(id);
  }

  clear() {
    for (const id of [...this.sprites.keys()]) this.remove(id);
  }

  dispose() {
    this.clear();
    this.group.removeFromParent();
  }
}
