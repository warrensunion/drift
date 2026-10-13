import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTile } from './helpers/tile.mjs';
import { decodeTile } from '../src/sim/field.js';
import { makeRng } from '../src/sim/fragment.js';
import { CONSTANTS } from '../src/sim/constants.js';
import {
  createSalishEnv, stepMember, salishSnapshotHours, createSalishSim, packSalish, SALISH, MEMBER,
} from '../src/sim/salish.js';

// A 21 x 21 regional grid like the real one (0.01 x 0.005 degrees), centred on 49.2 N.
const GRID = { nx: 21, ny: 21, lon0: -123.5, lat0: 49.15, dlon: 0.01, dlat: 0.005 };
const tile = (cell, nframes = 1) => decodeTile(buildTile({ ...GRID, nframes, scale: 0.001, cell }));
// land.png convention: 4 px per cell, row 0 = north. landCols: grid columns that are land.
function mask(landCols = []) {
  const width = GRID.nx * 4, height = GRID.ny * 4;
  const data = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (const c of landCols) for (let k = 0; k < 4; k++) data[y * width + c * 4 + k] = 255;
  return { width, height, data };
}
const LAND = -32768;
const M_PER_DEG_LAT = 6371000 * Math.PI / 180;
const mPerDegLon = (lat) => M_PER_DEG_LAT * Math.cos(lat * Math.PI / 180);

test('constants come from CONSTANTS.salish', () => {
  assert.equal(SALISH.K, CONSTANTS.salish.diffusivityM2s.value);
  assert.equal(SALISH.tauSeconds, CONSTANTS.salish.groundingTimescaleDays.value * 86400);
  assert.equal(SALISH.dtSeconds, 3600);
  assert.equal(SALISH.ensemble, 64);
});

test('random walk: per-axis variance is about 2 K dt', () => {
  const env = createSalishEnv({ tile: tile(() => [0, 0]), landMask: mask(), K: 0.6, tauSeconds: Infinity });
  const rng = makeRng(11);
  const n = 20000, lat0 = 49.2, lon0 = -123.4;
  let sx = 0, sy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    const m = { lon: lon0, lat: lat0, state: MEMBER.floating, distanceKm: 0 };
    stepMember(m, env, 0, rng);
    assert.equal(m.state, MEMBER.floating);
    const dx = (m.lon - lon0) * mPerDegLon(lat0), dy = (m.lat - lat0) * M_PER_DEG_LAT;
    sx += dx; sy += dy; sxx += dx * dx; syy += dy * dy;
  }
  const want = 2 * 0.6 * 3600; // 4320 m^2
  const vx = sxx / n - (sx / n) ** 2, vy = syy / n - (sy / n) ** 2;
  assert.ok(Math.abs(vx / want - 1) < 0.05, `var x ${vx} vs ${want}`);
  assert.ok(Math.abs(vy / want - 1) < 0.05, `var y ${vy} vs ${want}`);
  assert.ok(Math.abs(sx / n) < 3 * Math.sqrt(want / n) && Math.abs(sy / n) < 3 * Math.sqrt(want / n), 'no drift');
});

test('advection: a uniform 1 m/s east current moves a member 3.6 km in an hour', () => {
  const env = createSalishEnv({ tile: tile(() => [1000, 0]), landMask: mask(), K: 0, tauSeconds: Infinity });
  const m = { lon: -123.45, lat: 49.2, state: MEMBER.floating, distanceKm: 0 };
  stepMember(m, env, 0, makeRng(1));
  const east = (m.lon + 123.45) * mPerDegLon(49.2);
  assert.ok(Math.abs(east - 3600) < 3600 * 0.01, `moved ${east} m`);
  assert.ok(Math.abs(m.lat - 49.2) < 1e-9);
  assert.ok(Math.abs(m.distanceKm - 3.6) < 0.04);
});

test('tidal frames: velocity follows the hour (sampleTime over the looped frames)', () => {
  // Frames 0-1 east, frames 2-3 west: the hour starting at 0 and the one starting at 2 move in
  // opposite directions (the RK2 midpoint samples half an hour in).
  const env = createSalishEnv({ tile: tile((f) => [f < 2 ? 500 : -500, 0], 4), landMask: mask(), K: 0, tauSeconds: Infinity });
  const a = { lon: -123.45, lat: 49.2, state: MEMBER.floating, distanceKm: 0 };
  const b = { ...a };
  stepMember(a, env, 0, makeRng(1));
  stepMember(b, env, 2, makeRng(1));
  assert.ok(a.lon > -123.45 && b.lon < -123.45, `${a.lon} ${b.lon}`);
});

test('grounding in a coastal water cell matches 1 - exp(-dt/tau) per step', () => {
  // Column 10 is land; column 9 is a coastal water cell. No current, no random walk.
  const landCols = [10];
  const t = tile((f, y, x) => (x === 10 ? [LAND, LAND] : [0, 0]));
  const tau = 3 * 86400;
  const env = createSalishEnv({ tile: t, landMask: mask(landCols), K: 0, tauSeconds: tau });
  const lon = GRID.lon0 + 9 * GRID.dlon, lat = 49.2;
  assert.equal(env.isCoastal(lon, lat), true);
  assert.equal(env.isCoastal(GRID.lon0 + 3 * GRID.dlon, lat), false);
  const rng = makeRng(7);
  const n = 200000;
  let grounded = 0;
  for (let i = 0; i < n; i++) {
    const m = { lon, lat, state: MEMBER.floating, distanceKm: 0 };
    stepMember(m, env, 0, rng);
    if (m.state === MEMBER.grounded) grounded++;
  }
  const p = 1 - Math.exp(-3600 / tau);
  const sd = Math.sqrt(p * (1 - p) / n);
  assert.ok(Math.abs(grounded / n - p) < 4 * sd, `${grounded / n} vs ${p}`);
  // Away from the coast nothing grounds.
  const far = { lon: GRID.lon0 + 3 * GRID.dlon, lat, state: MEMBER.floating, distanceKm: 0 };
  for (let i = 0; i < 2000; i++) stepMember(far, env, 0, rng);
  assert.equal(far.state, MEMBER.floating);
});

test('a step into land grounds the member where it is', () => {
  const t = tile((f, y, x) => (x >= 12 ? [LAND, LAND] : [2000, 0])); // 2 m/s east toward land
  const env = createSalishEnv({ tile: t, landMask: mask([12, 13, 14, 15, 16, 17, 18, 19, 20]), K: 0, tauSeconds: Infinity });
  const m = { lon: GRID.lon0 + 9.6 * GRID.dlon, lat: 49.2, state: MEMBER.floating, distanceKm: 0 };
  const before = m.lon;
  stepMember(m, env, 0, makeRng(3));
  assert.equal(m.state, MEMBER.grounded);
  assert.equal(m.lon, before);
});

test('leaving the grid sets the member to left, and grounded/left members stay put', () => {
  const env = createSalishEnv({ tile: tile(() => [0, -2000]), landMask: mask(), K: 0, tauSeconds: Infinity });
  const m = { lon: -123.4, lat: GRID.lat0 + 0.002, state: MEMBER.floating, distanceKm: 0 };
  stepMember(m, env, 0, makeRng(2));
  assert.equal(m.state, MEMBER.left);
  const at = [m.lon, m.lat];
  stepMember(m, env, 1, makeRng(2));
  assert.deepEqual([m.lon, m.lat], at);
  assert.equal(m.state, MEMBER.left);
});

test('snapshot schedule: hourly to 72 h, then every 6 h to 720 h (30 days)', () => {
  const h = salishSnapshotHours();
  assert.equal(h[0], 0);
  assert.deepEqual(h.slice(0, 74), [...Array.from({ length: 73 }, (_, i) => i), 78]);
  assert.equal(h.at(-1), 720);
  assert.equal(h.length, 73 + 108);
  for (let i = 73; i < h.length; i++) assert.equal(h[i] - h[i - 1], 6);
  assert.equal(SALISH.maxHours, 720);
});

test('sim: a drop spawns 64 members, steps hour by hour and packs Float32 snapshots', () => {
  const sim = createSalishSim({ tile: tile(() => [300, 0]), landMask: mask(), rngFactory: makeRng });
  const id = sim.drop('bottle', -123.45, 49.2, 1, 9);
  assert.equal(sim.ageOf(id), 0);
  let snap = packSalish(sim, id);
  assert.ok(snap.positions instanceof Float32Array);
  assert.equal(snap.positions.length, 128);
  assert.equal(snap.meta.length, 128);
  assert.equal(snap.fragments.length, 1);
  assert.equal(snap.fragments[0].members, 64);
  for (let i = 0; i < 5; i++) sim.stepDrop(id);
  assert.equal(sim.ageOf(id), 5);
  assert.deepEqual(sim.activeDrops(), [id]);
  snap = packSalish(sim, id);
  const f = snap.fragments[0];
  const sum = Object.values(f.fates).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9);
  assert.deepEqual(Object.keys(f.fates).sort(), ['coast', 'floating', 'left']);
  assert.ok(f.distanceKm > 4 && f.distanceKm < 7, `${f.distanceKm} km`);
  // Meta: fragment local 0, size class of the item, fate code 0 (floating).
  assert.equal(snap.meta[0], 0);
  assert.equal(snap.meta[1] >> 2, 0);
  sim.clear();
  assert.equal(sim.drops.size, 0);
});

test('sim: the budget retires the oldest drop', () => {
  const retired = [];
  const sim = createSalishSim({ tile: tile(() => [0, 0]), landMask: mask(), budget: 130, onRetire: (id) => retired.push(id) });
  const a = sim.drop('bag', -123.45, 49.2, 1, 1);
  sim.drop('bag', -123.45, 49.2, 1, 2);
  sim.drop('bag', -123.45, 49.2, 1, 3);
  assert.deepEqual(retired, [a]);
  assert.equal(sim.drops.size, 2);
});

test('worker: mode salish loads the tide and posts hourly-then-6-hourly Float32 snapshots to 720 h', async () => {
  const { createWorkerCore } = await import('../src/sim/worker.js');
  const buf = buildTile({ ...GRID, nframes: 3, scale: 0.001, cell: () => [100, 50] });
  const fetchFn = async () => ({ ok: true, arrayBuffer: async () => buf.slice(0) });
  const msgs = [];
  let finish;
  const done = new Promise((r) => { finish = r; });
  const core = createWorkerCore((msg) => { msgs.push(msg); if (msg.type === 'done' || msg.type === 'error') finish(); }, { fetchFn });
  await core.handle({ type: 'mode', mode: 'salish', tideUrl: 'tide.bin', landMask: mask() });
  assert.ok(msgs.some((m) => m.type === 'status' && m.mode === 'salish'));
  assert.ok(msgs.some((m) => m.type === 'ready' && m.mode === 'salish'));
  core.handle({ type: 'drop', item: 'bottle', lon: -123.45, lat: 49.2, startDoy: 1, seed: 4 });
  await done;
  assert.ok(!msgs.some((m) => m.type === 'error'), JSON.stringify(msgs.find((m) => m.type === 'error')));
  const snaps = msgs.filter((m) => m.type === 'snapshot');
  assert.deepEqual(snaps.map((s) => s.day), [...salishSnapshotHours()]);
  assert.deepEqual(snaps.map((s) => s.index), salishSnapshotHours().map((_, i) => i));
  assert.ok(snaps[0].positions instanceof Float32Array);
  assert.equal(snaps[0].positions.length, 128);
});
