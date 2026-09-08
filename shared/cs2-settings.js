/**
 * CS uses a horizontal FOV at a 4:3 reference aspect; Three uses vertical FOV.
 * Primary implementation evidence (Source SDK, not published CS2 engine code):
 * https://github.com/ValveSoftware/source-sdk-2013/blob/master/src/game/client/view.cpp
 * https://github.com/ValveSoftware/source-sdk-2013/blob/master/src/game/client/in_mouse.cpp
 * AWP values verified in installed CS2 scripts/weapons.vdata_c / weapon_awp,
 * extracted read-only to output/cs2-settings/weapons.vdata on 2026-09-08.
 */
export const CS2_BASE_FOV = 90;
export const CS2_MOUSE_YAW = 0.022;
export const CS2_MOUSE_PITCH = 0.022;
export const AWP_ZOOM_FOVS = Object.freeze([90, 40, 10]);
export const AWP_ZOOM_TIME = 0.05;
export const DEFAULT_SENSITIVITY = 1;
export const DEFAULT_ZOOM_SENSITIVITY = 1;

const RAD = Math.PI / 180;
const finite = (value, fallback, min, max) => {
  if (value === null || value === '' || typeof value === 'boolean') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const flag = (value, fallback) => value === true || value === 1 || value === '1' ? true
  : value === false || value === 0 || value === '0' ? false : fallback;
const angle = value => finite(value, CS2_BASE_FOV, 1, 179);

export function cs2FovToVertical(fov43 = CS2_BASE_FOV) {
  return 2 * Math.atan(Math.tan(angle(fov43) * RAD / 2) * 3 / 4) / RAD;
}

export function cs2FovToHorizontal(fov43 = CS2_BASE_FOV, aspect = 16 / 9) {
  const ratio = finite(aspect, 16 / 9, 0.1, 10);
  return 2 * Math.atan(Math.tan(angle(fov43) * RAD / 2) * ratio * 3 / 4) / RAD;
}

/**
 * Positive angular magnitude per mouse count; the caller applies its axis sign.
 * SDK view.cpp: scoped adjustment = localFOV / defaultFOV * zoom_sensitivity_ratio.
 * Use the engine's 4:3 FOV here, not vertical FOV or a tan-based magnification.
 * No frame time, display DPI or render resolution multiplier belongs in this rule.
 * Browser movementX/Y equal raw device counts only when raw Pointer Lock is
 * supported and granted; otherwise OS/browser acceleration or scaling can differ.
 */
export function mouseRadiansPerCount(sensitivity = DEFAULT_SENSITIVITY, axis = 'yaw',
  zoomFov = CS2_BASE_FOV, zoomSensitivity = DEFAULT_ZOOM_SENSITIVITY) {
  if (axis !== 'yaw' && axis !== 'pitch') throw new TypeError('Mouse axis must be yaw or pitch');
  const s = finite(sensitivity, DEFAULT_SENSITIVITY, 0.01, 20);
  const fov = angle(zoomFov);
  const zoom = finite(zoomSensitivity, DEFAULT_ZOOM_SENSITIVITY, 0.01, 5);
  const multiplier = fov === CS2_BASE_FOV ? 1 : fov / CS2_BASE_FOV * zoom;
  return s * (axis === 'yaw' ? CS2_MOUSE_YAW : CS2_MOUSE_PITCH) * RAD * multiplier;
}

export function normalizeAimSettings(settings = {}) {
  const s = settings && typeof settings === 'object' ? settings : {};
  return {
    sensitivity: finite(s.sensitivity, DEFAULT_SENSITIVITY, 0.01, 20),
    zoomSensitivity: finite(s.zoomSensitivity, DEFAULT_ZOOM_SENSITIVITY, 0.01, 5),
    invertY: flag(s.invertY, false),
  };
}

export const DONK_CROSSHAIR_SOURCE = Object.freeze({
  player: 'donk', date: '2026-09-06', match: 'Spirit vs MOUZ', map: 'Nuke',
  url: 'https://totalcsgo.com/crosshairs/donk',
  code: 'CSGO-VeUo2-qw76k-xJeKX-izb9a-GVOAK',
  note: 'Total CS per-match record, not a claim of an official or permanently latest player setting.',
});

/**
 * Share-code wire format verified against the author's MIT implementation:
 * https://github.com/akiver/csgo-sharecode/blob/main/src/index.ts
 * Independent decoder: base-57 little-endian digits, 18-byte big-endian payload,
 * checksum byte followed by version 1 and packed fields. Reject damaged codes.
 */
export function decodeCrosshairCode(code) {
  const alphabet = 'ABCDEFGHJKLMNOPQRSTUVWXYZabcdefhijkmnopqrstuvwxyz23456789';
  const value = typeof code === 'string' ? code.trim() : '';
  if (!new RegExp(`^CSGO(?:-[${alphabet}]{5}){5}$`).test(value)) {
    throw new TypeError('Invalid CS2 crosshair code');
  }
  const digits = value.slice(5).replaceAll('-', '');
  let packed = 0n;
  for (let i = digits.length - 1; i >= 0; i--) {
    const digit = alphabet.indexOf(digits[i]);
    if (digit < 0) throw new TypeError('Invalid CS2 crosshair character');
    packed = packed * 57n + BigInt(digit);
  }
  if (packed >= 1n << 144n) throw new TypeError('Crosshair code exceeds its payload size');
  const bytes = new Uint8Array(18);
  for (let i = 17; i >= 0; i--) { bytes[i] = Number(packed & 255n); packed >>= 8n; }
  if (bytes[0] !== bytes.slice(1).reduce((sum, n) => sum + n, 0) % 256) {
    throw new TypeError('Crosshair code checksum mismatch');
  }
  if (bytes[1] !== 1) throw new TypeError('Unsupported crosshair code version');
  const signed = n => n > 127 ? n - 256 : n;
  return {
    style: (bytes[13] & 15) >> 1,
    size: bytes[14] / 10, thickness: bytes[12] / 10, gap: signed(bytes[2]) / 10,
    color: bytes[10] & 7, red: bytes[4], green: bytes[5], blue: bytes[6],
    alpha: bytes[7], useAlpha: !!(bytes[13] & 64), dot: !!(bytes[13] & 16),
    outline: !!(bytes[10] & 8), outlineThickness: bytes[3] / 2,
    tStyle: !!(bytes[13] & 128), followRecoil: !!(bytes[8] & 128),
    gapUseWeaponValue: !!(bytes[13] & 32), fixedCrosshairGap: signed(bytes[9]) / 10,
    splitDistance: bytes[8] & 7, innerSplitAlpha: (bytes[10] >> 4) / 10,
    outerSplitAlpha: (bytes[11] & 15) / 10, splitSizeRatio: (bytes[11] >> 4) / 10,
  };
}

export const DEFAULT_CROSSHAIR = Object.freeze(decodeCrosshairCode(DONK_CROSSHAIR_SOURCE.code));

/** Whitelist and bound persisted/UI input; valid zero values are preserved. */
export function normalizeCrosshair(settings = {}) {
  const source = settings && typeof settings === 'object' ? settings : {};
  const result = {};
  const bounds = {
    style: [0, 5], size: [0, 25.5], thickness: [0, 25.5], gap: [-12.8, 12.7],
    color: [0, 5], red: [0, 255], green: [0, 255], blue: [0, 255], alpha: [0, 255],
    outlineThickness: [0, 3], fixedCrosshairGap: [-12.8, 12.7],
    splitDistance: [0, 7], innerSplitAlpha: [0, 1], outerSplitAlpha: [0, 1], splitSizeRatio: [0, 1],
  };
  const integers = new Set(['style', 'color', 'red', 'green', 'blue', 'alpha', 'splitDistance']);
  for (const [key, [min, max]] of Object.entries(bounds)) {
    const n = finite(source[key], DEFAULT_CROSSHAIR[key], min, max);
    result[key] = integers.has(key) ? Math.round(n) : n;
  }
  for (const key of ['useAlpha', 'dot', 'outline', 'tStyle', 'followRecoil', 'gapUseWeaponValue']) {
    result[key] = flag(source[key], DEFAULT_CROSSHAIR[key]);
  }
  return result;
}
