import * as THREE from 'three';
import { GrenadeSimulation } from '../server/grenades.js';
import { EQUIPMENT } from '../shared/equipment.js';
import { raycastWorld, raycastWorldContact } from '../shared/physics.js';
import { calloutAt, calloutLabel } from '../shared/map-callouts.js';
import { grenadeStrength } from '../shared/match-rules.js';

const WEAPON_LABEL = Object.freeze({
  hegrenade: '手雷',
  flashbang: '闪光',
  smokegrenade: '烟雾',
  molotov: '燃烧瓶',
  incgrenade: '燃烧弹',
  decoy: '诱饵',
});
const KIND_ZH = Object.freeze({ he: '爆炸', flash: '闪光', smoke: '烟雾', fire: '燃烧', failed: '失效' });
/** Helpers only visible in the PiP camera. */
const PIP_LAYER = 2;
/** Logical base size before display scale. */
const BASE_W = 320;
const BASE_H = 180;
/** CSS display scales relative to BASE. */
const SCALE_NORMAL = 2;
const SCALE_ZOOM = 2.5;
/** Internal render buffer — crisp enough for 2× window, still lighter than full CSS size. */
const RENDER_W = 480;
const RENDER_H = 270;
const PREDICT_PRIMED_MS = 90;
const PREDICT_FLIGHT_MS = 200;
const SETTLE_MS = 450;
/** Only keep samples near the landing for the ground trail. */
const GROUND_TRAIL_M = 4.5;

/** Same production sim as the server — returns polyline + landing. */
export function sampleThrowPath(player, weapon, input, { maxTicks = 180, seed = null } = {}) {
  let now = 0;
  let result = null;
  let ticks = 0;
  let bounces = 0;
  const samples = [];
  const finish = (g, kind) => {
    result = { kind, point: { x: g.x, y: g.y, z: g.z }, seconds: now / 1000, bounces };
  };
  const sim = new GrenadeSimulation({
    clock: () => now,
    raycastWorld,
    raycastContact: raycastWorldContact,
    onFlash: (g) => finish(g, 'flash'),
    onExplosion: (g) => finish(g, 'he'),
    emit: (type, e) => {
      if (type === 'grenade_bounce') bounces += 1;
      if (type === 'smoke') finish(e.origin, 'smoke');
      if (type === 'fire_started') finish(e.origin, 'fire');
      if (type === 'fire_failed') finish(e.origin, 'failed');
    },
  });
  if (seed) {
    const config = EQUIPMENT[weapon];
    if (!config) return { samples: [], result: null };
    sim.projectiles.push({
      id: 'preview',
      weapon,
      ownerId: 'preview',
      team: 'T',
      x: seed.x,
      y: seed.y,
      z: seed.z,
      vx: seed.vx || 0,
      vy: seed.vy || 0,
      vz: seed.vz || 0,
      throwMode: 'full',
      throwStrength: 1,
      bornAt: 0,
      detonateAt: (config.fuse || 1.5) * 1000,
    });
  } else if (!sim.throwGrenade({ ...player, inventory: {} }, weapon, input)) {
    return { samples: [], result: null };
  }
  while (!result && ticks < maxTicks) {
    ticks += 1;
    now = (ticks * 1000) / 30;
    const g = sim.projectiles[0];
    if (g && ticks % 3 === 0) samples.push({ x: g.x, y: g.y, z: g.z });
    sim.tick(1 / 30);
  }
  if (!result) {
    const last = samples[samples.length - 1] || { x: player?.x || 0, y: player?.y || 0, z: player?.z || 0 };
    result = { kind: 'failed', point: last, seconds: now / 1000, bounces };
  }
  if (result.point) samples.push({ ...result.point });
  return { samples, result };
}

/**
 * CS2-style utility assist: top-right PiP.
 * Primed = landing overview; flight = chase-cam locked to one nade until it detonates.
 * Hold Backquote (~) to enlarge. Window is exclusive — next throw only after close.
 */
export class PracticeTrajectory {
  constructor(scene, hudRoot) {
    this.scene = scene;
    this.enabled = false;
    this.ownerId = null;
    this.active = false;
    this._lastPredictAt = 0;
    this._trackingId = null;
    this._landing = null;
    this._kind = '';
    this._weapon = '';
    this._hideTimer = 0;
    this._mode = 'idle'; // idle | primed | flight | settle
    this._live = null;
    this._throwOrigin = null;
    this._zoomHeld = false;
    this._displayScale = SCALE_NORMAL;
    this._camPos = new THREE.Vector3();
    this._camTarget = new THREE.Vector3();
    this._desiredPos = new THREE.Vector3();
    this._desiredTarget = new THREE.Vector3();
    this._camReady = false;
    this._vel = new THREE.Vector3();
    this._smoothVel = new THREE.Vector3(0, 0, 1);

    const positions = new Float32Array(64 * 3);
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.geometry.setDrawRange(0, 0);
    this.line = new THREE.Line(
      this.geometry,
      new THREE.LineBasicMaterial({ color: 0xeabe54, transparent: true, opacity: 0.9, depthWrite: false }),
    );
    this.line.frustumCulled = false;
    this.line.visible = false;
    this.line.layers.set(PIP_LAYER);
    scene.add(this.line);

    this.marker = new THREE.Mesh(
      new THREE.RingGeometry(0.28, 0.48, 20),
      new THREE.MeshBasicMaterial({ color: 0xff6b4a, transparent: true, opacity: 0.95, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.marker.rotation.x = -Math.PI / 2;
    this.marker.visible = false;
    this.marker.layers.set(PIP_LAYER);
    scene.add(this.marker);

    this.pin = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xffd27a, depthWrite: false }),
    );
    this.pin.visible = false;
    this.pin.layers.set(PIP_LAYER);
    scene.add(this.pin);

    this.panel = document.createElement('div');
    this.panel.id = 'practice-landing';
    this.panel.hidden = true;
    this.panel.innerHTML =
      `<canvas class="practice-pip-canvas" width="${RENDER_W}" height="${RENDER_H}"></canvas>` +
      '<div class="practice-landing-overlay">' +
      '<div class="practice-landing-title">道具辅助 · ` 放大</div>' +
      '<b class="practice-landing-place">—</b>' +
      '<span class="practice-landing-meta"></span>' +
      '<small class="practice-landing-xyz"></small>' +
      '</div>';
    (hudRoot || document.getElementById('hud') || document.body).append(this.panel);
    this._canvas = this.panel.querySelector('.practice-pip-canvas');
    this._place = this.panel.querySelector('.practice-landing-place');
    this._meta = this.panel.querySelector('.practice-landing-meta');
    this._xyz = this.panel.querySelector('.practice-landing-xyz');
    this._applyDisplayScale(SCALE_NORMAL);

    this.pipCamera = new THREE.PerspectiveCamera(52, RENDER_W / RENDER_H, 0.12, 220);
    this.pipCamera.layers.enable(0);
    this.pipCamera.layers.enable(PIP_LAYER);

    this._onKeyDown = (e) => {
      if (e.code !== 'Backquote' || e.repeat) return;
      if (e.target?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
      this._zoomHeld = true;
      this._applyDisplayScale(SCALE_ZOOM);
    };
    this._onKeyUp = (e) => {
      if (e.code !== 'Backquote') return;
      this._zoomHeld = false;
      this._applyDisplayScale(SCALE_NORMAL);
    };
    window.addEventListener('keydown', this._onKeyDown, true);
    window.addEventListener('keyup', this._onKeyUp, true);
    window.addEventListener('blur', () => {
      this._zoomHeld = false;
      this._applyDisplayScale(SCALE_NORMAL);
    });

    try {
      this.pipRenderer = new THREE.WebGLRenderer({
        canvas: this._canvas,
        antialias: false,
        alpha: false,
        powerPreference: 'high-performance',
        stencil: false,
        depth: true,
      });
      this.pipRenderer.setPixelRatio(1);
      this.pipRenderer.setSize(RENDER_W, RENDER_H, false);
      this.pipRenderer.outputColorSpace = THREE.SRGBColorSpace;
      this.pipRenderer.toneMapping = THREE.NoToneMapping;
      this.pipRenderer.autoClear = true;
      this.pipRenderer.shadowMap.enabled = false;
    } catch {
      this.pipRenderer = null;
    }
  }

  _applyDisplayScale(scale) {
    this._displayScale = scale;
    const w = Math.round(BASE_W * scale);
    const h = Math.round(BASE_H * scale);
    this.panel.style.width = `${w}px`;
    this.panel.style.height = `${h}px`;
    this.panel.classList.toggle('practice-pip-zoomed', scale > SCALE_NORMAL + 0.01);
  }

  /** True while this window is reserved for one throw (flight or brief settle). */
  get busy() {
    return this._mode === 'flight' || this._mode === 'settle' || !!this._trackingId;
  }

  setEnabled(on, ownerId = null) {
    this.enabled = !!on;
    this.ownerId = ownerId;
    if (!on) this.clear();
  }

  clear() {
    clearTimeout(this._hideTimer);
    this._hideTimer = 0;
    this.active = false;
    this._mode = 'idle';
    this._live = null;
    this.line.visible = false;
    this.marker.visible = false;
    this.pin.visible = false;
    this.panel.hidden = true;
    this.geometry.setDrawRange(0, 0);
    this._trackingId = null;
    this._landing = null;
    this._camReady = false;
    this._throwOrigin = null;
  }

  dispose() {
    this.clear();
    window.removeEventListener('keydown', this._onKeyDown, true);
    window.removeEventListener('keyup', this._onKeyUp, true);
    this.line.removeFromParent();
    this.marker.removeFromParent();
    this.pin.removeFromParent();
    this.geometry.dispose();
    this.line.material.dispose();
    this.marker.geometry.dispose();
    this.marker.material.dispose();
    this.pin.geometry.dispose();
    this.pin.material.dispose();
    this.pipRenderer?.dispose();
    this.panel.remove();
  }

  update({ player, weapon, mode, strength, lookYaw, lookPitch, snapshot, myId, now = performance.now() }) {
    if (!this.enabled || !player?.alive) {
      this.clear();
      return;
    }

    const owner = this.ownerId || myId;
    const mine = (snapshot?.grenades || []).filter((g) => g.ownerId === owner);

    // Exclusive lock: once a flight starts, stay on that nade until detonation closes the window.
    if (this._trackingId || this._mode === 'flight' || this._mode === 'settle') {
      const live = this._trackingId ? mine.find((g) => g.id === this._trackingId) : null;
      if (live) {
        this._followFlight(live, now);
        return;
      }
      if (this._mode === 'flight') {
        this._beginSettle();
        return;
      }
      // settle (or orphaned lock): wait for clear(); ignore new throws
      return;
    }

    // Start a new exclusive session on the newest live grenade.
    if (mine.length) {
      const live = mine[mine.length - 1];
      this._trackingId = live.id;
      this._throwOrigin = { x: live.x, y: live.y, z: live.z };
      this._followFlight(live, now);
      return;
    }

    const primed = player.grenadeState?.state === 'primed';
    if (!primed || !weapon) {
      if (!this._hideTimer) this.clear();
      return;
    }

    this._mode = 'primed';
    this.active = true;
    this.panel.hidden = false;
    this._throwOrigin = { x: player.x, y: player.y + (player.crouch ? 0.95 : 1.62), z: player.z };

    if (now - this._lastPredictAt < PREDICT_PRIMED_MS) {
      if (this._landing) this._aimLandingOverview(this._landing);
      return;
    }
    this._lastPredictAt = now;
    const throwMode = mode || player.grenadeState?.mode || 'full';
    const throwStrength = Number.isFinite(strength)
      ? strength
      : Number.isFinite(player.grenadeState?.strength)
        ? player.grenadeState.strength
        : grenadeStrength(throwMode);
    const { samples, result } = sampleThrowPath(
      {
        x: player.x,
        y: player.y,
        z: player.z,
        vx: player.vx || 0,
        vy: player.vy || 0,
        vz: player.vz || 0,
        crouch: !!player.crouch,
      },
      weapon,
      { yaw: lookYaw, pitch: lookPitch, throwMode, throwStrength },
    );
    this._weapon = weapon;
    this._drawGroundTrail(samples, result?.point);
    this._setLanding(result?.point, result?.kind, weapon);
    this.pin.visible = false;
    if (this._landing) {
      this.marker.position.set(this._landing.x, this._landing.y + 0.04, this._landing.z);
      this.marker.visible = true;
      this._aimLandingOverview(this._landing, true);
    }
  }

  _followFlight(live, now) {
    this._live = live;
    this._mode = 'flight';
    this.active = true;
    this.panel.hidden = false;
    this._trackingId = live.id;

    if (now - this._lastPredictAt > PREDICT_FLIGHT_MS) {
      this._lastPredictAt = now;
      this._weapon = live.weapon;
      const { samples, result } = sampleThrowPath(null, live.weapon, null, {
        seed: { x: live.x, y: live.y, z: live.z, vx: live.vx, vy: live.vy, vz: live.vz },
      });
      this._drawGroundTrail(samples, result?.point);
      this._setLanding(result?.point, result?.kind, live.weapon);
    }

    this.pin.visible = true;
    this.pin.position.set(live.x, live.y, live.z);
    if (this._landing) {
      this.marker.position.set(this._landing.x, this._landing.y + 0.04, this._landing.z);
      this.marker.visible = true;
    }
    this._aimChase(live);
  }

  _beginSettle() {
    this._mode = 'settle';
    this._live = null;
    this.line.visible = false;
    this.pin.visible = false;
    const landing = this._landing;
    if (landing) {
      this.active = true;
      this.panel.hidden = false;
      this.marker.position.set(landing.x, landing.y + 0.04, landing.z);
      this.marker.visible = true;
      this._meta.textContent = `${WEAPON_LABEL[this._weapon] || this._weapon} · 已生效`;
      this._aimLandingOverview(landing, true);
      clearTimeout(this._hideTimer);
      // Close after effect — only then unlock for the next nade.
      this._hideTimer = setTimeout(() => this.clear(), SETTLE_MS);
    } else {
      this.clear();
    }
    // Keep _trackingId until clear() so busy stays true and other nades can't hijack.
  }

  /** Every main frame — high PiP fps. */
  render() {
    if (!this.active || this.panel.hidden || !this.pipRenderer) return;
    this._settleCamera(this._mode === 'flight' ? 0.42 : 0.22);
    try {
      this.pipRenderer.render(this.scene, this.pipCamera);
    } catch {
      /* ignore transient context issues */
    }
  }

  /** Chase cam locked onto the flying utility. */
  _aimChase(live) {
    this._vel.set(live.vx || 0, live.vy || 0, live.vz || 0);
    if (this._vel.lengthSq() > 0.04) this._smoothVel.lerp(this._vel.normalize(), 0.28);
    else if (this._smoothVel.lengthSq() < 1e-6) this._smoothVel.set(0, 0, 1);
    this._smoothVel.normalize();

    const fx = this._smoothVel.x;
    const fy = this._smoothVel.y;
    const fz = this._smoothVel.z;
    this._desiredPos.set(
      live.x - fx * 3.4,
      live.y - fy * 3.4 + 1.45,
      live.z - fz * 3.4,
    );
    if (this._landing) {
      this._desiredTarget.set(
        live.x * 0.35 + this._landing.x * 0.65,
        live.y * 0.35 + this._landing.y * 0.65 + 0.35,
        live.z * 0.35 + this._landing.z * 0.65,
      );
    } else {
      this._desiredTarget.set(live.x + fx * 5, live.y + fy * 5 + 0.2, live.z + fz * 5);
    }
    if (!this._camReady) {
      this._camPos.copy(this._desiredPos);
      this._camTarget.copy(this._desiredTarget);
      this._camReady = true;
    }
  }

  _aimLandingOverview(landing, snap = false) {
    if (!landing) return;
    this._desiredPos.set(landing.x + 5.2, landing.y + 7.5, landing.z + 5.2);
    this._desiredTarget.set(landing.x, landing.y + 0.35, landing.z);
    if (snap || !this._camReady) {
      this._camPos.copy(this._desiredPos);
      this._camTarget.copy(this._desiredTarget);
      this._camReady = true;
      this._settleCamera(1);
    }
  }

  _settleCamera(alpha = 0.3) {
    if (!this._camReady) return;
    this._camPos.lerp(this._desiredPos, alpha);
    this._camTarget.lerp(this._desiredTarget, Math.min(1, alpha + 0.08));
    this.pipCamera.position.copy(this._camPos);
    this.pipCamera.lookAt(this._camTarget);
  }

  /** Only draw the path near the ground landing. */
  _drawGroundTrail(samples, landing) {
    const attr = this.geometry.getAttribute('position');
    if (!landing || !samples?.length) {
      this.geometry.setDrawRange(0, 0);
      this.line.visible = false;
      return;
    }
    const trail = [];
    for (let i = samples.length - 1; i >= 0; i--) {
      const p = samples[i];
      const d = Math.hypot(p.x - landing.x, p.z - landing.z);
      if (d > GROUND_TRAIL_M && trail.length > 2) break;
      if (p.y > landing.y + 2.8 && trail.length > 1) continue;
      trail.push(p);
    }
    trail.reverse();
    if (trail.length < 2) {
      trail.length = 0;
      trail.push(
        { x: landing.x - 0.6, y: landing.y + 0.05, z: landing.z },
        { x: landing.x, y: landing.y + 0.05, z: landing.z },
      );
    }
    const n = Math.min(trail.length, attr.count);
    for (let i = 0; i < n; i++) {
      const p = trail[i];
      attr.setXYZ(i, p.x, Math.max(p.y, landing.y + 0.03), p.z);
    }
    attr.needsUpdate = true;
    this.geometry.setDrawRange(0, n);
    this.line.visible = n > 1;
  }

  _setLanding(point, kind, weapon) {
    if (!point) return;
    const moved =
      !this._landing ||
      Math.hypot(point.x - this._landing.x, point.y - this._landing.y, point.z - this._landing.z) > 0.35;
    this._landing = { x: point.x, y: point.y, z: point.z };
    this._kind = kind || '';
    this._weapon = weapon || this._weapon;
    if (!moved && this._place.textContent) {
      const phase = this._mode === 'flight' ? '飞行中' : KIND_ZH[kind] || '落点';
      this._meta.textContent = `${WEAPON_LABEL[weapon] || weapon || '道具'} · ${phase}`;
      return;
    }
    const hit = calloutAt(this._landing, { maxDistance: 22 });
    this._place.textContent = calloutLabel(hit?.point) || '未命名区域';
    const phase = this._mode === 'flight' ? '飞行中' : KIND_ZH[kind] || '落点';
    this._meta.textContent = `${WEAPON_LABEL[weapon] || weapon || '道具'} · ${phase}`;
    this._xyz.textContent = `${this._landing.x.toFixed(1)} / ${this._landing.y.toFixed(1)} / ${this._landing.z.toFixed(1)}`;
  }
}
