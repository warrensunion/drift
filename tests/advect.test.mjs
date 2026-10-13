import test from 'node:test';
import assert from 'node:assert/strict';
import { rk2Step, metersToDeg } from '../src/sim/advect.js';

test('metersToDeg at equator and at 60N', () => {
  const [dLon, dLat] = metersToDeg(86400, 0, 0);
  assert.ok(Math.abs(dLon - 86.4 / 111.195) < 1e-4);
  assert.ok(Math.abs(dLat) < 1e-12);
  const [lon60, lat60] = metersToDeg(1000, 1000, 60);
  assert.ok(Math.abs(lon60 - 2 * (1000 / 6371000) * 180 / Math.PI) < 1e-9);
  assert.ok(Math.abs(lat60 - (1000 / 6371000) * 180 / Math.PI) < 1e-9);
});

test('uniform 1 m/s east for 86400 s moves 86.4 km (0.77703 deg at equator)', () => {
  const r = rk2Step(() => [1, 0], 10, 0, 86400);
  assert.ok(Math.abs(r[0] - 10 - 86.4 / 111.195) < 1e-4);
  assert.ok(Math.abs(r[1]) < 1e-9);
});

test('null sample at either stage gives null', () => {
  assert.equal(rk2Step(() => null, 0, 0, 100), null);
  let n = 0;
  assert.equal(rk2Step(() => (n++ === 0 ? [1, 0] : null), 0, 0, 100), null);
});

test('output longitude normalised to [-180,180)', () => {
  const r = rk2Step(() => [1, 0], 179.9, 0, 86400);
  assert.ok(r[0] >= -180 && r[0] < 180);
  near(r[0], 179.9 + 86.4 / 111.195 - 360);
  function near(a, b) { assert.ok(Math.abs(a - b) < 1e-4, `${a} vs ${b}`); }
});

test('solid-body rotation: 360 RK2 steps return within 1% of start', () => {
  // Rotation about (0,0) with angular rate w, in metres: u = -w*y, v = w*x
  const R = 6371000, rad = Math.PI / 180;
  const radiusM = 500000;
  const w = 2 * Math.PI / (360 * 3600); // one revolution in 360 steps of 1 h
  const field = (lon, lat) => {
    const x = lon * rad * R, y = lat * rad * R; // near equator
    return [-w * y, w * x];
  };
  const start = [radiusM / (rad * R), 0];
  let p = start;
  for (let i = 0; i < 360; i++) p = rk2Step(field, p[0], p[1], 3600);
  const err = Math.hypot(p[0] - start[0], p[1] - start[1]);
  assert.ok(err < 0.01 * start[0], `err ${err} vs ${start[0]}`);
});
