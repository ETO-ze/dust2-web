import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AWP_ZOOM_FOVS, AWP_ZOOM_TIME, CS2_BASE_FOV, DEFAULT_CROSSHAIR,
  DONK_CROSSHAIR_SOURCE, cs2FovToVertical, cs2FovToHorizontal,
  mouseRadiansPerCount, decodeCrosshairCode, normalizeCrosshair, normalizeAimSettings,
} from '../shared/cs2-settings.js';
import { crosshairGeometry } from '../client/crosshair.js';

const near = (actual, expected, tolerance = 1e-10) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);

test('CS reference FOV is horizontal 4:3, while Three receives vertical degrees', () => {
  near(cs2FovToVertical(90), 73.73979529168804);
  near(cs2FovToHorizontal(90, 4 / 3), 90);
  near(cs2FovToHorizontal(90, 16 / 9), 106.26020470831196);
  for (const fov of AWP_ZOOM_FOVS) {
    const vertical = cs2FovToVertical(fov);
    near(2 * Math.atan(Math.tan(vertical * Math.PI / 360) * 4 / 3) * 180 / Math.PI, fov);
  }
  assert.deepEqual(AWP_ZOOM_FOVS, [90, 40, 10]);
  assert.equal(AWP_ZOOM_TIME, 0.05);
});

test('CS mouse counts retain .022 degree base, and use linear engine FOV zoom ratio', () => {
  near(mouseRadiansPerCount(1) * 180 / Math.PI, 0.022);
  near(mouseRadiansPerCount(2, 'pitch'), 2 * mouseRadiansPerCount(1));
  near(mouseRadiansPerCount(1, 'yaw', 40) / mouseRadiansPerCount(1), 40 / 90);
  near(mouseRadiansPerCount(1, 'yaw', 10, 0.818933) / mouseRadiansPerCount(1), 10 / 90 * 0.818933);
  near(mouseRadiansPerCount(1, 'yaw', CS2_BASE_FOV, 0.5), mouseRadiansPerCount(1));
  near(mouseRadiansPerCount(1) * (360 / 0.022), 2 * Math.PI);
  assert.throws(() => mouseRadiansPerCount(1, 'x'), /axis/);
});

test('dated donk Nuke match code has verified RGB and complete static settings', () => {
  assert.equal(DONK_CROSSHAIR_SOURCE.date, '2026-09-06');
  assert.equal(DONK_CROSSHAIR_SOURCE.map, 'Nuke');
  assert.deepEqual(DEFAULT_CROSSHAIR, {
    style: 4, size: 1, thickness: 1.5, gap: -4, color: 5, red: 0, green: 255, blue: 165,
    alpha: 255, useAlpha: true, dot: false, outline: false, outlineThickness: 0,
    tStyle: false, followRecoil: false, gapUseWeaponValue: false, fixedCrosshairGap: 0,
    splitDistance: 3, innerSplitAlpha: 0, outerSplitAlpha: 1, splitSizeRatio: 1,
  });
  assert.ok(Object.isFrozen(DEFAULT_CROSSHAIR));
});

test('independent public share-code fixture exercises signed values and packed flags', () => {
  const fixture = decodeCrosshairCode('CSGO-WsnnD-eHaMw-QNDf9-oxuDh-ydOUD');
  assert.equal(fixture.gap, -2.2);
  assert.equal(fixture.thickness, 0.6);
  assert.equal(fixture.size, 10);
  assert.deepEqual([fixture.red, fixture.green, fixture.blue], [50, 250, 50]);
  assert.equal(fixture.followRecoil, true);
  assert.equal(fixture.gapUseWeaponValue, true);
  assert.equal(fixture.outline, true);
  assert.equal(fixture.style, 2);
  assert.throws(() => decodeCrosshairCode(DONK_CROSSHAIR_SOURCE.code.replace('VeUo2', 'VeUo3')), /checksum/);
  assert.throws(() => decodeCrosshairCode('CSGO-VeUo0-qw76k-xJeKX-izb9a-GVOAK'), /Invalid/);
  assert.throws(() => decodeCrosshairCode(null), /Invalid/);
});

test('persisted/UI settings preserve zero, reject markup and clamp nonfinite values', () => {
  const s = normalizeCrosshair({ size: 0, gap: 0, alpha: 0, dot: '0', red: '<svg onload=alert(1)>',
    green: 999, blue: -1, outlineThickness: Infinity, __unexpected: 'ignore' });
  assert.equal(s.size, 0); assert.equal(s.gap, 0); assert.equal(s.alpha, 0); assert.equal(s.dot, false);
  assert.equal(s.red, 0); assert.equal(s.green, 255); assert.equal(s.blue, 0);
  assert.equal(s.outlineThickness, 0); assert.equal(s.__unexpected, undefined);
  assert.deepEqual(normalizeCrosshair(null), normalizeCrosshair(DEFAULT_CROSSHAIR));
  assert.deepEqual(normalizeAimSettings({ sensitivity: NaN, zoomSensitivity: -100, invertY: '0' }),
    { sensitivity: 1, zoomSensitivity: 0.01, invertY: false });
});

test('style 4 never widens on movement; classic dynamic style and preview options work', () => {
  assert.deepEqual(crosshairGeometry(DEFAULT_CROSSHAIR, { spread: 99 }), crosshairGeometry(DEFAULT_CROSSHAIR));
  const dynamic = { ...DEFAULT_CROSSHAIR, style: 3 };
  assert.notDeepEqual(crosshairGeometry(dynamic, { spread: 12 }).rects, crosshairGeometry(dynamic).rects);
  assert.equal(crosshairGeometry({ ...DEFAULT_CROSSHAIR, tStyle: true }).rects.length, 3);
  assert.equal(crosshairGeometry({ ...DEFAULT_CROSSHAIR, size: 0, dot: true }).rects.length, 1);
  assert.equal(crosshairGeometry({ ...DEFAULT_CROSSHAIR, alpha: 0 }).opacity, 0);
  assert.equal(crosshairGeometry({ ...DEFAULT_CROSSHAIR, useAlpha: false, alpha: 0 }).opacity, 1);
});
