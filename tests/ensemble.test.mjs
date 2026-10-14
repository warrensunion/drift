import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTile } from './helpers/tile.mjs';
import { decodeTile } from '../src/sim/field.js';
import { metersToDeg } from '../src/sim/advect.js';
import { makeRng } from '../src/sim/fragment.js';
import { createSim, gaussianPair, fateSummary, STATE, BUDGET } from '../src/sim/ensemble.js';
import { snapshotDays, indexForDay, packSnapshot, unpackMeta } from '../src/sim/snapshots.js';

const LAND = -32768;
// Regional 1 deg tile, lon -20..20, lat -20..20, still water. Columns with lon >= 10 are land.
function tile({ landEast = false } = {}) {
  return decodeTile(buildTile({
    nx: 41, ny: 41, lon0: -20, lat0: -20, dlon: 1, dlat: 1, scale: 0.01,
    cell: (f, y, x) => (landEast && x >= 30 ? [LAND, LAND] : [0, 0]),
  }));
}
function fields(opts) {
  const cur = tile(opts);
  return { current: [cur], wind: decodeTile(buildTile({ nx: 41, ny: 41, nframes: 12, lon0: -20, lat0: -20, dlon: 1, dlat: 1, scale: 0.01, cell: () => [0, 0] })) };
}
// Fake model: constant displacement (km) and log sigma for every row.
const fakePredict = (mx, my, logSigma) => (x, n) => {
  const mu = new Float32Array(2 * n), ls = new Float32Array(2 * n);
  for (let i = 0; i < n; i++) { mu[2 * i] = mx; mu[2 * i + 1] = my; ls[2 * i] = logSigma; ls[2 * i + 1] = logSigma; }
  return Promise.resolve({ mu, logSigma: ls });
};
const fakeFeatures = () => new Float32Array(10);
const constRng = (v) => () => v;
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg ?? ''} ${a} vs ${b}`);
const membersOf = (sim, pred) => {
  const m = sim.members, out = [];
  for (let i = 0; i < m.count; i++) if (pred(i)) out.push(i);
  return out;
};

test('members move by mu exactly when sigma is ~0', async () => {
  const sim = createSim({ fields: fields(), predict: fakePredict(10, 5, Math.log(1e-9)), rng: makeRng(1), featuresFn: fakeFeatures });
  sim.drop('bag', 0, 1, 100);
  assert.equal(sim.members.count, 24);
  await sim.step();
  const [dLon, dLat] = metersToDeg(10000, 5000, 1);
  for (let i = 0; i < 24; i++) {
    near(sim.members.lon[i], dLon, 1e-6, 'lon');
    near(sim.members.lat[i], 1 + dLat, 1e-6, 'lat');
    near(sim.members.distanceKm[i], Math.hypot(10, 5), 1e-4, 'distance');
  }
  assert.equal(sim.ageOf(0), 1);
});

test('members move by mu + sigma*z (Box-Muller from the injected rng)', async () => {
  const sigma = 2;
  const sim = createSim({ fields: fields(), predict: fakePredict(10, 5, Math.log(sigma)), rngFactory: () => constRng(0.3), featuresFn: fakeFeatures });
  sim.drop('bag', 0, 0, 100);
  await sim.step();
  const [z1, z2] = gaussianPair(constRng(0.3));
  assert.ok(Math.abs(z1) > 0.1, 'z1 non-trivial');
  const [dLon, dLat] = metersToDeg((10 + sigma * z1) * 1000, (5 + sigma * z2) * 1000, 0);
  near(sim.members.lon[0], dLon, 1e-6, 'lon');
  near(sim.members.lat[0], dLat, 1e-6, 'lat');
});

test('gaussianPair is standard normal-ish', () => {
  const rng = makeRng(42);
  let s = 0, s2 = 0; const n = 20000;
  for (let i = 0; i < n / 2; i++) { const [a, b] = gaussianPair(rng); s += a + b; s2 += a * a + b * b; }
  near(s / n, 0, 0.03, 'mean'); near(s2 / n, 1, 0.05, 'var');
});

test('a landward move beaches with p=0.095 at the current position, else stays put', async () => {
  // rng 0.01 < 0.095 -> beaches.
  let sim = createSim({ fields: fields({ landEast: true }), predict: fakePredict(100, 0, Math.log(1e-9)), rngFactory: () => constRng(0.01), featuresFn: fakeFeatures });
  sim.drop('bag', 8.5, 0, 100);
  await sim.step();
  for (let i = 0; i < 24; i++) {
    assert.equal(sim.members.state[i], STATE.beached);
    near(sim.members.lon[i], 8.5, 1e-9); near(sim.members.lat[i], 0, 1e-9);
  }
  // rng 0.5 >= 0.095 -> stays where it is, still floating.
  sim = createSim({ fields: fields({ landEast: true }), predict: fakePredict(100, 0, Math.log(1e-9)), rngFactory: () => constRng(0.5), featuresFn: fakeFeatures });
  sim.drop('bag', 8.5, 0, 100);
  await sim.step();
  for (let i = 0; i < 24; i++) {
    assert.equal(sim.members.state[i], STATE.floating);
    near(sim.members.lon[i], 8.5, 1e-9);
  }
});

test('beached and sunk members stop moving', async () => {
  const sim = createSim({ fields: fields(), predict: fakePredict(10, 5, Math.log(1e-9)), rngFactory: () => constRng(0.5), featuresFn: fakeFeatures });
  sim.drop('bag', 0, 0, 100);
  const m = sim.members;
  for (let i = 0; i < 8; i++) m.state[i] = STATE.beached;
  for (let i = 8; i < 16; i++) m.state[i] = STATE.sunk;
  await sim.step();
  for (let i = 0; i < 16; i++) { assert.equal(m.lon[i], 0); assert.equal(m.lat[i], 0); }
  for (let i = 0; i < 8; i++) { assert.equal(m.state[i], STATE.beached); assert.equal(m.daysBeached[i], 1); }
  for (let i = 8; i < 16; i++) assert.equal(m.state[i], STATE.sunk);
  for (let i = 16; i < 24; i++) assert.ok(m.lon[i] > 0, 'floating ones move');
});

test('a fragmentation event clones parent positions into each child', async () => {
  const sim = createSim({ fields: fields(), predict: fakePredict(0, 0, Math.log(1e-9)), rngFactory: () => constRng(0.5), featuresFn: fakeFeatures });
  const dropId = sim.drop('bag', 0, 0, 100);
  const m = sim.members;
  const parentId = m.fragmentId[0];
  const firstSplit = sim.drops.get(dropId).schedule[0];
  assert.equal(firstSplit.parent, 'macro');
  const pos = [];
  for (let i = 0; i < 24; i++) {
    m.lon[i] = -5 + i * 0.1; m.lat[i] = 3 - i * 0.05;
    m.daysAtSea[i] = firstSplit.day; // clock already at the event
    pos.push([m.lon[i], m.lat[i]]);
  }
  await sim.step();
  assert.ok(!sim.fragments.has(parentId), 'parent retired');
  const kids = [...sim.fragments.values()].filter((f) => f.dropId === dropId);
  assert.equal(kids.length, firstSplit.children.length);
  assert.equal(m.count, 24 * kids.length);
  for (const k of kids) {
    assert.equal(k.sizeClass, 'meso');
    assert.equal(k.parentId, parentId);
    const idx = membersOf(sim, (i) => m.fragmentId[i] === k.id);
    assert.equal(idx.length, 24);
    idx.forEach((i, j) => { near(m.lon[i], pos[j][0], 1e-6); near(m.lat[i], pos[j][1], 1e-6); });
  }
});

test('budget retires oldest drop at 20,000', () => {
  assert.equal(BUDGET, 20000);
  const retired = [];
  const sim = createSim({ fields: fields(), predict: fakePredict(0, 0, 0), rng: makeRng(3), featuresFn: fakeFeatures, onRetire: (id) => retired.push(id) });
  const perDrop = 24, fit = Math.floor(BUDGET / perDrop);
  const ids = [];
  for (let i = 0; i < fit; i++) ids.push(sim.drop('bottle', 0, 0, 1));
  assert.equal(sim.members.count, fit * perDrop);
  assert.ok(sim.drops.has(ids[0]));
  const last = sim.drop('bottle', 1, 1, 1);
  assert.ok(sim.members.count <= BUDGET);
  assert.ok(!sim.drops.has(ids[0]), 'oldest drop retired');
  assert.deepEqual(retired, [ids[0]]);
  assert.ok(sim.drops.has(ids[1]) && sim.drops.has(last));
  assert.equal(membersOf(sim, (i) => sim.members.dropId[i] === ids[0]).length, 0);
  assert.equal(membersOf(sim, (i) => sim.members.dropId[i] === last).length, perDrop);
});

test('model failure fallback: predict null -> RK2 advection on the current field', async () => {
  // Uniform 0.5 m/s eastward current.
  const cur = decodeTile(buildTile({ nx: 41, ny: 41, lon0: -20, lat0: -20, dlon: 1, dlat: 1, scale: 0.01, cell: () => [50, 0] }));
  const sim = createSim({ fields: { current: [cur] }, predict: null, rng: makeRng(1) });
  sim.drop('bag', 0, 0, 100);
  await sim.step();
  assert.equal(sim.usingFallback, true);
  const [dLon] = metersToDeg(0.5 * 86400, 0, 0);
  near(sim.members.lon[0], dLon, 1e-6);
});

test('setPredict(null) switches a running sim to the advection fallback', async () => {
  const cur = decodeTile(buildTile({ nx: 41, ny: 41, lon0: -20, lat0: -20, dlon: 1, dlat: 1, scale: 0.01, cell: () => [50, 0] }));
  const sim = createSim({ fields: { current: [cur] }, predict: fakePredict(0, 0, Math.log(1e-9)), rng: makeRng(1), featuresFn: fakeFeatures });
  sim.drop('bag', 0, 0, 100);
  assert.equal(sim.usingFallback, false);
  sim.setPredict(null);
  assert.equal(sim.usingFallback, true);
  await sim.step();
  near(sim.members.lon[0], metersToDeg(0.5 * 86400, 0, 0)[0], 1e-6);
});

test('sinking members of a non-floating item leave the surface fast', async () => {
  const sim = createSim({ fields: fields(), predict: fakePredict(0, 0, Math.log(1e-9)), rng: makeRng(9), featuresFn: fakeFeatures });
  sim.drop('line', 0, 0, 100);
  for (let d = 0; d < 10; d++) await sim.step();
  const sunk = membersOf(sim, (i) => sim.members.state[i] === STATE.sunk).length;
  assert.ok(sunk >= 22, `sunk ${sunk}`); // p = 0.632/day
  const f = fateSummary(sim, sim.members.fragmentId[0]);
  near(f.floating + f.gyre + f.coast + f.seafloor, 1, 1e-9);
  near(f.seafloor, sunk / 24, 1e-9);
});

test('drops stop stepping at maxDays (3650 by default)', async () => {
  const sim = createSim({ fields: fields(), predict: fakePredict(0, 0, Math.log(1e-9)), rng: makeRng(1), featuresFn: fakeFeatures, maxDays: 3 });
  const id = sim.drop('bag', 0, 0, 100);
  for (let d = 0; d < 5; d++) await sim.step();
  assert.equal(sim.ageOf(id), 3);
  assert.equal(sim.isActive(), false);
});

test('snapshotDays: 0..3650, strictly increasing, daily/3-day/15-day', () => {
  const d = snapshotDays();
  assert.equal(d[0], 0);
  assert.equal(d[d.length - 1], 3650);
  for (let i = 1; i < d.length; i++) assert.ok(d[i] > d[i - 1]);
  const expected = 61 + Math.ceil((365 - 60) / 3) + Math.ceil((3650 - 365) / 15);
  assert.equal(d.length, expected);
  assert.ok(d.includes(60) && d.includes(365));
  assert.equal(d[61] - d[60], 3);
});

test('snapshot index clamps to computed', () => {
  const d = snapshotDays();
  assert.deepEqual(indexForDay(100, 30), { index: 30, frac: 0 });
  assert.deepEqual(indexForDay(30.5, 100), { index: 30, frac: 0.5 });
  const r = indexForDay(61, 100);
  assert.equal(r.index, 60); near(r.frac, 1 / 3, 1e-12);
  assert.deepEqual(indexForDay(61, 61), { index: 60, frac: 0 }); // next (63) not computed
  assert.deepEqual(indexForDay(-5, 100), { index: 0, frac: 0 });
  assert.deepEqual(indexForDay(99999, 99999), { index: d.length - 1, frac: 0 });
});

test('packSnapshot quantises positions and packs meta', async () => {
  const sim = createSim({ fields: fields(), predict: fakePredict(0, 0, Math.log(1e-9)), rngFactory: () => constRng(0.5), featuresFn: fakeFeatures });
  const id = sim.drop('bag', -12.345, 6.789, 100);
  sim.members.state[1] = STATE.sunk;
  sim.members.state[2] = STATE.beached;
  const s = packSnapshot(sim, id);
  assert.ok(s.positions instanceof Int16Array && s.meta instanceof Uint8Array);
  assert.equal(s.positions.length, 48); assert.equal(s.meta.length, 48);
  assert.equal(s.positions[0], Math.round(-12.345 * 90));
  assert.equal(s.positions[1], Math.round(6.789 * 180));
  assert.deepEqual(unpackMeta(s.meta, 0), { fragment: sim.members.fragmentId[0] & 255, sizeClass: 'macro', fate: 'floating' });
  assert.equal(unpackMeta(s.meta, 1).fate, 'seafloor');
  assert.equal(unpackMeta(s.meta, 2).fate, 'coast');
  assert.equal(s.fragments.length, 1);
});

// Worker glue smoke test. worker.js statically imports features.js (Task 5); skip until it exists.
import { existsSync } from 'node:fs';
const hasFeatures = existsSync(new URL('../src/sim/features.js', import.meta.url));
test('worker core: imports without DOM, falls back to advection, posts every snapshot to 3650', { skip: !hasFeatures && 'src/sim/features.js not present yet' }, async () => {
  const { createWorkerCore } = await import('../src/sim/worker.js');
  const cur = buildTile({ nx: 41, ny: 41, lon0: -20, lat0: -20, dlon: 1, dlat: 1, scale: 0.01, cell: () => [0, 0] });
  const wind = buildTile({ nx: 41, ny: 41, nframes: 12, lon0: -20, lat0: -20, dlon: 1, dlat: 1, scale: 0.01, cell: () => [0, 0] });
  const fetchFn = async (url) => url.endsWith('.onnx')
    ? { ok: false, status: 404 }
    : { ok: true, arrayBuffer: async () => (url.includes('wind') ? wind : cur).slice(0) };
  const msgs = [];
  let finish;
  const done = new Promise((r) => { finish = r; });
  const core = createWorkerCore((msg) => { msgs.push(msg); if (msg.type === 'done' || msg.type === 'error') finish(); }, { fetchFn });
  await core.handle({ type: 'init', currentUrls: Array.from({ length: 12 }, (_, i) => `cur${i}.bin`), windUrl: 'wind.bin', modelUrl: 'drift.onnx' });
  assert.ok(msgs.some((m) => m.type === 'status' && m.fallback === true));
  assert.ok(msgs.some((m) => m.type === 'ready' && m.fallback === true));
  core.handle({ type: 'drop', item: 'tyre', lon: 0, lat: 0, startDoy: 100, seed: 5 });
  await done;
  assert.ok(!msgs.some((m) => m.type === 'error'), JSON.stringify(msgs.find((m) => m.type === 'error')));
  const snaps = msgs.filter((m) => m.type === 'snapshot');
  assert.equal(snaps.length, snapshotDays().length);
  assert.deepEqual(snaps.map((s) => s.index), snapshotDays().map((_, i) => i));
  assert.equal(snaps.at(-1).day, 3650);
  assert.ok(snaps[0].positions instanceof Int16Array && snaps[0].meta instanceof Uint8Array);
  core.handle({ type: 'mode', mode: 'salish' });
  assert.deepEqual(msgs.at(-1), { type: 'status', mode: 'salish' });
  core.handle({ type: 'clear' });
  assert.equal(msgs.at(-1).type, 'cleared');
  assert.equal(core.sim.members.count, 0);
});

test('the split clock is the mean over surface (non-sunk) members; sunk ones do not hold it back', async () => {
  const sim = createSim({ fields: fields(), predict: fakePredict(0, 0, Math.log(1e-9)), rngFactory: () => constRng(0.5), featuresFn: fakeFeatures });
  const dropId = sim.drop('bag', 0, 0, 100);
  const m = sim.members, parentId = m.fragmentId[0];
  const ev = sim.drops.get(dropId).schedule[0];
  for (let i = 0; i < 20; i++) { m.state[i] = STATE.sunk; m.daysAtSea[i] = 10; }
  for (let i = 20; i < 24; i++) m.daysAtSea[i] = ev.day;
  await sim.step();
  assert.ok(!sim.fragments.has(parentId), 'split happened');
  assert.equal(m.count, 24 * ev.children.length, 'children clone all members, sunk ones included');
});

// --- Fix round 1: independent timelines, per-drop rng, deferred mutation, split budget ---
const tick = () => new Promise((r) => setTimeout(r, 1));
// Predict resolving on a macrotask (like a real ONNX session.run); `during` runs while it is pending.
const slowPredict = (mx, my, logSigma, during) => {
  let calls = 0;
  return (x, n) => new Promise((resolve) => {
    calls++;
    if (during) during(calls);
    setTimeout(() => resolve(fakePredict(mx, my, logSigma)(x, n)), 1);
  }).then((r) => r);
};

test('each drop runs on its own timeline (day 0 = when it was dropped)', async () => {
  const sim = createSim({ fields: fields(), predict: fakePredict(10, 0, Math.log(1e-9)), featuresFn: fakeFeatures });
  const a = sim.drop('bag', 0, 0, 100, 1);
  for (let d = 0; d < 5; d++) await sim.stepDrop(a);
  const b = sim.drop('bag', 0, 0, 200, 2);
  assert.equal(sim.ageOf(a), 5); assert.equal(sim.ageOf(b), 0);
  assert.deepEqual(sim.activeDrops(), [b, a]); // newest first
  await sim.step();
  assert.equal(sim.ageOf(a), 6); assert.equal(sim.ageOf(b), 1);
  assert.equal(sim.doyOf(b), 201);
  const [dl] = metersToDeg(10000, 0, 0);
  const bm = membersOf(sim, (i) => sim.members.dropId[i] === b && sim.members.state[i] === STATE.floating);
  for (const i of bm) near(sim.members.lon[i], dl, 1e-9, 'b moved exactly one day');
});

test('each drop has its own rng stream: another drop does not perturb it', async () => {
  const run = async (withOther) => {
    const sim = createSim({ fields: fields(), predict: fakePredict(3, 2, Math.log(5)), featuresFn: fakeFeatures });
    if (withOther) sim.drop('bag', -3, -3, 50, 99);
    const a = sim.drop('bag', 0, 0, 100, 7);
    for (let d = 0; d < 4; d++) await sim.step();
    return membersOf(sim, (i) => sim.members.dropId[i] === a).map((i) => [sim.members.lon[i], sim.members.lat[i]]);
  };
  assert.deepEqual(await run(true), await run(false));
});

test('a drop issued while predict is pending is applied after the step (no stale indices)', async () => {
  let sim, c;
  const during = (calls) => { if (calls === 1) c = sim.drop('bag', 5, 5, 100, 3); }; // forces budget retirement of A
  sim = createSim({ fields: fields(), predict: slowPredict(10, 0, Math.log(1e-9), during), featuresFn: fakeFeatures, budget: 48 });
  const a = sim.drop('bag', 0, 0, 100, 1);
  const b = sim.drop('bag', -10, 0, 100, 2);
  const p = sim.step(); // steps b first (newest), then a
  await tick();
  assert.equal(sim.drops.has(c), false, 'not applied mid-step');
  await p;
  const [dl] = metersToDeg(10000, 0, 0);
  assert.ok(!sim.drops.has(a), 'oldest retired after the step');
  assert.equal(sim.ageOf(b), 1);
  for (const i of membersOf(sim, (i) => sim.members.dropId[i] === b && sim.members.state[i] === STATE.floating)) near(sim.members.lon[i], -10 + dl, 1e-9, 'b displaced by its own mu');
  assert.equal(sim.ageOf(c), 0);
  for (const i of membersOf(sim, (i) => sim.members.dropId[i] === c)) { assert.equal(sim.members.lon[i], 5); assert.equal(sim.members.lat[i], 5); }
  await sim.stepDrop(c);
  assert.equal(sim.ageOf(c), 1);
  for (const i of membersOf(sim, (i) => sim.members.dropId[i] === c && sim.members.state[i] === STATE.floating)) near(sim.members.lon[i], 5 + metersToDeg(10000, 0, 5)[0], 1e-9, 'c one real step');
});

const forceSplit = (sim, dropId) => {
  const ev = sim.drops.get(dropId).schedule[0];
  for (const i of membersOf(sim, (i) => sim.members.dropId[i] === dropId)) sim.members.daysAtSea[i] = ev.day;
  return ev;
};

test('split budget: capped children when the drop alone exceeds the budget', async () => {
  const sim = createSim({ fields: fields(), predict: fakePredict(0, 0, Math.log(1e-9)), featuresFn: fakeFeatures, rngFactory: () => constRng(0.5), budget: 30 });
  const a = sim.drop('bag', 0, 0, 100);
  const ev = forceSplit(sim, a);
  await sim.step();
  const kids = [...sim.fragments.values()];
  assert.equal(kids.length, ev.children.length);
  const per = Math.floor(30 / ev.children.length); // 7
  for (const k of kids) assert.equal(membersOf(sim, (i) => sim.members.fragmentId[i] === k.id).length, per);
  assert.ok(sim.members.count <= 30);
});

test('split budget: no room for one member per child -> the split is skipped for good', async () => {
  const sim = createSim({ fields: fields(), predict: fakePredict(0, 0, Math.log(1e-9)), featuresFn: fakeFeatures, rngFactory: () => constRng(0.5), ensemble: 2, budget: 3 });
  const a = sim.drop('bag', 0, 0, 100);
  const parent = sim.members.fragmentId[0];
  forceSplit(sim, a);
  await sim.step();
  assert.ok(sim.fragments.has(parent));
  assert.equal(sim.fragments.get(parent).noSplit, true);
  assert.equal(sim.members.count, 2);
});

test('split budget: a split retires only OLDER drops, never a newer one', async () => {
  const retired = [];
  const sim = createSim({ fields: fields(), predict: fakePredict(0, 0, Math.log(1e-9)), featuresFn: fakeFeatures, rngFactory: () => constRng(0.5), budget: 60, onRetire: (id) => retired.push(id) });
  const a = sim.drop('bag', 0, 0, 100);
  const b = sim.drop('bag', 1, 1, 100);
  forceSplit(sim, a); // oldest drop splits: nothing older to retire -> capped
  await sim.stepDrop(a);
  assert.ok(sim.drops.has(b), 'newer drop kept');
  assert.deepEqual(retired, []);
  assert.equal(membersOf(sim, (i) => sim.members.dropId[i] === a).length, 4 * Math.floor((60 - 24) / 4));
  forceSplit(sim, b); // newer drop splits: may retire the older one
  await sim.stepDrop(b);
  assert.deepEqual(retired, [a]);
  assert.ok(!sim.drops.has(a));
  assert.equal(membersOf(sim, (i) => sim.members.dropId[i] === b).length, 4 * Math.floor(60 / 4));
});

test('worker: a drop arriving while session.run is pending is queued; both timelines stay exact', { skip: !hasFeatures && 'src/sim/features.js not present yet' }, async () => {
  const { createWorkerCore } = await import('../src/sim/worker.js');
  const tileBuf = (nframes) => buildTile({ nx: 41, ny: 41, nframes, lon0: -20, lat0: -20, dlon: 1, dlat: 1, scale: 0.01, cell: () => [0, 0] });
  const cur = tileBuf(1), wind = tileBuf(12);
  const fetchFn = async (url) => ({ ok: true, arrayBuffer: async () => (url.endsWith('.onnx') ? new ArrayBuffer(8) : (url.includes('wind') ? wind : cur).slice(0)) });
  let core, calls = 0;
  const ortLib = {
    env: { wasm: {} },
    Tensor: class { constructor(type, data, dims) { this.data = data; this.dims = dims; } },
    InferenceSession: { create: async () => ({
      run: ({ x }) => {
        const n = x.dims[0];
        const mu = new Float32Array(2 * n), ls = new Float32Array(2 * n).fill(Math.log(1e-9));
        for (let i = 0; i < n; i++) mu[2 * i] = 10;
        const res = { mu: { data: mu }, log_sigma: { data: ls } };
        if (++calls === 3) { // drop B while A's day-3 inference is in flight
          core.handle({ type: 'drop', item: 'bag', lon: 5, lat: 5, startDoy: 10, seed: 2 });
          return new Promise((r) => setTimeout(() => r(res), 2));
        }
        return Promise.resolve(res);
      },
    }) },
  };
  const msgs = [];
  const doneIds = new Set();
  let finish;
  const done = new Promise((r) => { finish = r; });
  core = createWorkerCore((msg) => {
    msgs.push(msg);
    if (msg.type === 'done') doneIds.add(msg.dropId);
    if (doneIds.size === 2 || msg.type === 'error') finish();
  }, { fetchFn, ortLib, featuresFn: () => new Float32Array(10) });
  await core.handle({ type: 'init', currentUrls: Array.from({ length: 12 }, (_, i) => `cur${i}.bin`), windUrl: 'wind.bin', modelUrl: 'drift.onnx' });
  // Ready comes first (plain advection while the model loads); the model is then announced.
  assert.ok(msgs.some((m) => m.type === 'ready' && m.modelPending === true));
  assert.ok(msgs.some((m) => m.type === 'status' && m.model === 'ready'));
  core.handle({ type: 'drop', item: 'bag', lon: 0, lat: 0, startDoy: 100, seed: 1 });
  await done;
  assert.ok(!msgs.some((m) => m.type === 'error'), JSON.stringify(msgs.find((m) => m.type === 'error')));
  const snaps = (id) => msgs.filter((m) => m.type === 'snapshot' && m.dropId === id);
  const floatingLons = (s) => { const out = []; for (let k = 0; k < s.meta.length / 2; k++) if (((s.meta[2 * k + 1] >> 2) & 3) === 0) out.push(s.positions[2 * k]); return out; };
  // A: every snapshot to day 60 sits at day * one-day displacement.
  const [dl0] = metersToDeg(10000, 0, 0);
  for (const s of snaps(0).filter((s) => s.day <= 60)) for (const q of floatingLons(s)) assert.equal(q, Math.round(s.day * dl0 * 90), `A day ${s.day}`);
  // B: day 0 at the drop point, day 1 after exactly one real step.
  const b = snaps(1);
  assert.equal(b[0].day, 0); assert.equal(b[1].day, 1);
  for (const q of floatingLons(b[0])) assert.equal(q, 450);
  const [dl5] = metersToDeg(10000, 0, 5);
  for (const q of floatingLons(b[1])) assert.equal(q, Math.round((5 + dl5) * 90));
  assert.equal(snaps(0).length, snapshotDays().length);
  assert.equal(snaps(1).length, snapshotDays().length);
});
