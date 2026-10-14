// JS features and field sampler vs the Python training pipeline (tests/fixtures/onnx-ref.json,
// written by scripts/train/export.py).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { features } from '../src/sim/features.js';
import { decodeTile, sample } from '../src/sim/field.js';

const ref = JSON.parse(readFileSync(new URL('./fixtures/onnx-ref.json', import.meta.url), 'utf8'));
const tile = (p) => decodeTile(readFileSync(new URL(`../public/data/${p}`, import.meta.url)));

test('fixture has 64 rows and at least 16 samples', () => {
  assert.equal(ref.rows.length, 64);
  assert.ok(ref.samples.length >= 16);
});

test('JS features equal the Python features within 1e-6 (both call forms)', () => {
  const buf = new Float32Array(10 * ref.rows.length);
  ref.rows.forEach((r, k) => {
    const f = features(r.lat, r.lon, r.u_cur, r.v_cur, r.u_wind, r.v_wind, r.doy, r.windage);
    assert.ok(f instanceof Float32Array && f.length === 10);
    const ret = features(r.lat, r.lon, r.u_cur, r.v_cur, r.u_wind, r.v_wind, r.doy, r.windage, buf, 10 * k);
    assert.equal(ret, buf);
    for (let j = 0; j < 10; j++) {
      assert.ok(Math.abs(f[j] - r.features[j]) <= 1e-6, `row ${k} feature ${j} (${ref.featureNames[j]}): ${f[j]} vs ${r.features[j]}`);
      assert.equal(buf[10 * k + j], f[j]);
    }
  });
});

test('JS sample() on the shipped tiles equals the Python sampler within 1e-6', () => {
  const wind = tile('wind/clim.bin');
  const cur = new Map();
  for (const s of ref.samples) {
    const mm = String(s.month).padStart(2, '0');
    if (!cur.has(mm)) cur.set(mm, tile(`currents/clim-${mm}.bin`));
    const c = sample(cur.get(mm), s.lon, s.lat, 0);
    assert.ok(c, `current sample null at ${s.lon},${s.lat}`);
    const w = sample(wind, s.lon, s.lat, s.windFrame);
    assert.ok(w, `wind sample null at ${s.lon},${s.lat}`);
    for (let j = 0; j < 2; j++) {
      assert.ok(Math.abs(c[j] - s.current[j]) <= 1e-6, `current ${j} at ${s.lon},${s.lat} m${s.month}: ${c[j]} vs ${s.current[j]}`);
      assert.ok(Math.abs(w[j] - s.wind[j]) <= 1e-6, `wind ${j} at ${s.lon},${s.lat} m${s.month}: ${w[j]} vs ${s.wind[j]}`);
    }
  }
});

test('the wind tile has no land cells (gap-filled)', () => {
  const w = tile('wind/clim.bin');
  assert.ok(!w.data.includes(-32768));
});
