import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rayToLonLat, isTap, isLandAt, dropTarget, lonLatToVec3, vec3ToLonLat, LAND_MESSAGE } from '../src/globe/pick.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('rayToLonLat: a ray down -z from +z hits lon 0, lat 0', () => {
  const [lon, lat] = rayToLonLat({ origin: [0, 0, 5], direction: [0, 0, -1] });
  close(lon, 0); close(lat, 0);
});

test('rayToLonLat: rays toward +x, +y and an oblique point', () => {
  let [lon, lat] = rayToLonLat({ origin: { x: 4, y: 0, z: 0 }, direction: { x: -2, y: 0, z: 0 } });
  close(lon, 90); close(lat, 0);
  [lon, lat] = rayToLonLat({ origin: [0, 3, 0], direction: [0, -1, 0] });
  close(lat, 90);
  const p = lonLatToVec3(-150, 35);
  const o = p.map((v) => v * 4);
  [lon, lat] = rayToLonLat({ origin: o, direction: p.map((v) => -v) });
  close(lon, -150, 1e-6); close(lat, 35, 1e-6);
});

test('rayToLonLat: the nearer hit is returned, not the far side', () => {
  const [lon] = rayToLonLat({ origin: [0, 0, -5], direction: [0, 0, 1] });
  close(Math.abs(lon), 180);
});

test('rayToLonLat: a miss, a ray pointing away and a bad ray give null', () => {
  assert.equal(rayToLonLat({ origin: [0, 2, 5], direction: [0, 0, -1] }), null);
  assert.equal(rayToLonLat({ origin: [0, 0, 5], direction: [0, 0, 1] }), null);
  assert.equal(rayToLonLat({ origin: [0, 0, 5], direction: [0, 0, 0] }), null);
  assert.equal(rayToLonLat(null), null);
});

test('lonLatToVec3 / vec3ToLonLat round trip', () => {
  for (const [lo, la] of [[0, 0], [123.4, -45.6], [-179.5, 80], [90, -10]]) {
    const [x, y, z] = lonLatToVec3(lo, la);
    const [lon, lat] = vec3ToLonLat(x, y, z);
    close(lon, lo, 1e-9); close(lat, la, 1e-9);
  }
});

test('isTap thresholds: < 8 px and < 300 ms', () => {
  const d = { x: 100, y: 100, t: 1000 };
  assert.equal(isTap(d, { x: 100, y: 100, t: 1100 }), true);
  assert.equal(isTap(d, { x: 107, y: 100, t: 1299 }), true);
  assert.equal(isTap(d, { x: 108, y: 100, t: 1100 }), false, '8 px is a drag');
  assert.equal(isTap(d, { x: 100, y: 108, t: 1100 }), false, 'a vertical drag rotates/scrolls');
  assert.equal(isTap(d, { x: 105, y: 105, t: 1100 }), true, 'diagonal 7.07 px');
  assert.equal(isTap(d, { x: 100, y: 100, t: 1300 }), false, '300 ms is a press');
  assert.equal(isTap(d, null), false);
});

// Tiny synthetic mask, 8 x 4 (45 degree cells), row 0 = north. Land: the cell holding lon 0..45,
// lat 0..45, i.e. column 4, row 1.
function tinyMask() {
  const width = 8, height = 4;
  const data = new Uint8Array(width * height);
  data[1 * width + 4] = 255;
  return { width, height, data };
}

test('isLandAt looks up the equirectangular mask', () => {
  const m = tinyMask();
  assert.equal(isLandAt(m, 20, 20), true);
  assert.equal(isLandAt(m, -20, 20), false);
  assert.equal(isLandAt(m, 20, -20), false);
  assert.equal(isLandAt(m, 20 + 360, 20), true, 'longitude wraps');
  assert.equal(isLandAt(m, 0, 90), false, 'pole clamps to row 0');
});

test('drop on land is refused', () => {
  const m = tinyMask();
  const land = lonLatToVec3(20, 20);
  const r = dropTarget({ origin: land.map((v) => v * 3), direction: land.map((v) => -v) }, m);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'land');
  assert.equal(r.message, LAND_MESSAGE);
  assert.equal(r.message, 'Drop it in the water');

  const sea = lonLatToVec3(-150, 30);
  const ok = dropTarget({ origin: sea.map((v) => v * 3), direction: sea.map((v) => -v) }, m);
  assert.equal(ok.ok, true);
  close(ok.lon, -150, 1e-6); close(ok.lat, 30, 1e-6);

  const miss = dropTarget({ origin: [0, 3, 5], direction: [0, 0, -1] }, m);
  assert.equal(miss.ok, false);
  assert.equal(miss.reason, 'miss');

  // A predicate works too (e.g. the 1 degree current field's land cells).
  const r2 = dropTarget({ origin: sea.map((v) => v * 3), direction: sea.map((v) => -v) }, () => true);
  assert.equal(r2.ok, false);
});
