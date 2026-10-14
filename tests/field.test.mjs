import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeTile, sample, sampleTime } from '../src/sim/field.js';
import { buildTile } from './helpers/tile.mjs';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);

test('decodeTile header round-trip', () => {
  const f = decodeTile(buildTile({ nx: 3, ny: 2, nframes: 2, lon0: -10, lat0: 5, dlon: 0.5, dlat: 0.25, scale: 0.01, cell: (fr, y, x) => [fr * 100 + y * 10 + x, -x] }));
  assert.equal(f.nx, 3); assert.equal(f.ny, 2); assert.equal(f.nframes, 2);
  assert.equal(f.lon0, -10); assert.equal(f.lat0, 5); assert.equal(f.dlon, 0.5); assert.equal(f.dlat, 0.25);
  near(f.scale, 0.01, 1e-8);
  assert.ok(f.data instanceof Int16Array);
  assert.equal(f.data.length, 2 * 2 * 3 * 2);
  // [frame][y][x][2]
  assert.equal(f.data[((1 * 2 + 1) * 3 + 2) * 2], 112);
  assert.equal(f.data[((1 * 2 + 1) * 3 + 2) * 2 + 1], -2);
});

test('decodeTile accepts a Node Buffer slice and rejects bad magic/version', () => {
  const ab = buildTile({ nx: 1, ny: 1, lon0: 0, lat0: 0, dlon: 1, dlat: 1, cell: () => [1, 2] });
  const pad = Buffer.concat([Buffer.alloc(5), Buffer.from(ab)]);
  const view = pad.subarray(5);
  const f = decodeTile(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));
  assert.equal(f.data[0], 1);
  const bad = ab.slice(0); new Uint8Array(bad)[0] = 0x58;
  assert.throws(() => decodeTile(bad), /magic/i);
  const badV = ab.slice(0); new DataView(badV).setUint16(4, 2, true);
  assert.throws(() => decodeTile(badV), /version/i);
});

test('sample bilinear in the interior', () => {
  const f = decodeTile(buildTile({ nx: 3, ny: 3, lon0: 0, lat0: 0, dlon: 1, dlat: 1, scale: 0.1, cell: (fr, y, x) => [x * 10, y * 10] }));
  const [u, v] = sample(f, 0.5, 1.25);
  near(u, 0.5, 1e-5); near(v, 1.25, 1e-5);
});

test('sample wraps across 180 degrees (global grid)', () => {
  // 360 columns, dlon 1, lon0 -179.5: centres -179.5 .. 179.5. u = column index.
  const f = decodeTile(buildTile({ nx: 360, ny: 2, lon0: -179.5, lat0: 0, dlon: 1, dlat: 1, scale: 1, cell: (fr, y, x) => [x, 0] }));
  // 179.9 lies between col 359 (179.5) and col 0 (-179.5) at fraction 0.4
  const [u] = sample(f, 179.9, 0.5);
  near(u, 359 * 0.6 + 0 * 0.4, 1e-4);
  const [u2] = sample(f, -179.9, 0.5); // between col 359 (-0.5 -> 179.5) and col 0, fraction 0.6
  near(u2, 359 * 0.4, 1e-4);
});

test('sample beyond lat range is null; regional lon outside is null', () => {
  const f = decodeTile(buildTile({ nx: 3, ny: 3, lon0: 0, lat0: 0, dlon: 1, dlat: 1, cell: () => [1, 1] }));
  assert.equal(sample(f, 1, 2.01), null);
  assert.equal(sample(f, 1, -0.01), null);
  assert.equal(sample(f, -0.01, 1), null);
  assert.equal(sample(f, 2.01, 1), null);
  assert.notEqual(sample(f, 2, 2), null);
});

test('any land corner gives null', () => {
  const f = decodeTile(buildTile({ nx: 4, ny: 4, lon0: 0, lat0: 0, dlon: 1, dlat: 1, cell: (fr, y, x) => (x === 1 && y === 1 ? [-32768, 0] : [1, 1]) }));
  assert.equal(sample(f, 0.5, 0.5), null);
  assert.equal(sample(f, 1.5, 1.5), null);
  assert.equal(sample(f, 1, 1), null);
  assert.notEqual(sample(f, 2.5, 2.5), null);
  // v land too
  const g = decodeTile(buildTile({ nx: 2, ny: 2, lon0: 0, lat0: 0, dlon: 1, dlat: 1, cell: (fr, y, x) => (x === 1 && y === 1 ? [0, -32768] : [1, 1]) }));
  assert.equal(sample(g, 0.5, 0.5), null);
});

test('sampleTime blends frames, wraps modulo nframes, null if either null', () => {
  const f = decodeTile(buildTile({ nx: 2, ny: 2, nframes: 3, lon0: 0, lat0: 0, dlon: 1, dlat: 1, scale: 1, cell: (fr) => [fr * 10, 0] }));
  near(sampleTime(f, 0.5, 0.5, 0.5)[0], 5);
  near(sampleTime(f, 0.5, 0.5, 2.5)[0], 10); // frame 2 (20) -> frame 0 (0)
  near(sampleTime(f, 0.5, 0.5, 3.25)[0], 2.5);               // wraps to 0.25
});

test('sampleTime negative t wraps and land in either frame is null', () => {
  const f = decodeTile(buildTile({ nx: 2, ny: 2, nframes: 2, lon0: 0, lat0: 0, dlon: 1, dlat: 1, scale: 1, cell: (fr, y, x) => (fr === 1 && x === 1 && y === 1 ? [-32768, 0] : [fr * 10, 0]) }));
  assert.equal(sampleTime(f, 0.5, 0.5, 0.5), null);
  assert.equal(sampleTime(f, 0.5, 0.5, -0.5), null);
  assert.notEqual(sampleTime(f, 0.5, 0.5, 0), null);
});

test('float32 dlon=0.1, nx=3600 is still a global grid (wraps across the seam)', () => {
  const f = decodeTile(buildTile({ nx: 3600, ny: 2, lon0: -179.95, lat0: 0, dlon: 0.1, dlat: 1, scale: 1, cell: (fr, y, x) => [x, 0] }));
  const r = sample(f, 179.99, 0.5);
  assert.notEqual(r, null);
  const fx = (179.99 - f.lon0) / f.dlon;
  near(r[0], 3599 * (1 - (fx - 3599)), 1e-6);
});
