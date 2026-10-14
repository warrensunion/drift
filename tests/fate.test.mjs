import test from 'node:test';
import assert from 'node:assert/strict';
import { CONSTANTS } from '../src/sim/constants.js';
import { inGyre, dailySinkProbability, fateOf } from '../src/sim/fate.js';

test('inGyre true at every box centre, false at (0,0)', () => {
  for (const g of CONSTANTS.gyres) {
    const lon = (g.lonMin + g.lonMax) / 2, lat = (g.latMin + g.latMax) / 2;
    assert.equal(inGyre(lon, lat), g.name);
    assert.equal(inGyre(lon + 360, lat), g.name, 'lon wraps');
  }
  assert.equal(inGyre(0, 0), null);
});

test('sink probability strictly increases as size falls', () => {
  for (const opts of [{ inGyre: false }, { inGyre: true }]) {
    const p = ['macro', 'meso', 'micro', 'small'].map((c) => dailySinkProbability(c, opts));
    for (let i = 1; i < p.length; i++) assert.ok(p[i] > p[i - 1], JSON.stringify(opts));
  }
});

test('sink probability matches 1-exp(-1/tau) from JSON; gyre is 3x tau', () => {
  const T = CONSTANTS.sinkTimescaleDays;
  assert.equal(dailySinkProbability('meso'), 1 - Math.exp(-1 / T.meso.value));
  assert.equal(dailySinkProbability('small'), 1 - Math.exp(-1 / T.smallMicro.value));
  assert.equal(
    dailySinkProbability('macro', { inGyre: true }),
    1 - Math.exp(-1 / (T.macro.value * T.gyreMultiplier.value)),
  );
  assert.ok(dailySinkProbability('micro', { inGyre: true }) < dailySinkProbability('micro'));
});

test('items denser than seawater sink with tau = 1 d, gyre or not', () => {
  const p = 1 - Math.exp(-1 / CONSTANTS.sinkTimescaleDays.denserThanSeawater.value);
  assert.equal(dailySinkProbability('micro', { floats: false }), p);
  assert.equal(dailySinkProbability('macro', { floats: false, inGyre: true }), p);
});

test('fateOf', () => {
  const sea = () => false;
  const land = () => true;
  assert.equal(fateOf({ lon: 0, lat: 0 }, sea), 'floating');
  assert.equal(fateOf({ lon: -143, lat: 33 }, sea), 'gyre');
  assert.equal(fateOf({ lon: -143, lat: 33, beached: true }, sea), 'coast');
  assert.equal(fateOf({ lon: 0, lat: 0 }, land), 'coast');
  assert.equal(fateOf({ lon: -143, lat: 33, sunk: true }, sea), 'seafloor');
  assert.equal(fateOf({ lon: 0, lat: 0, sunk: true, beached: true }, sea), 'seafloor');
});
