import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDropTrack, addSnapshot, stateAt, fragmentStats, ABSENT } from '../src/globe/tracks.js';

// Members as [lon, lat, fragLocal, sizeClass, fate]; packed like the worker's packSnapshot.
function snap(index, day, members, fragments) {
  const positions = new Int16Array(2 * members.length);
  const meta = new Uint8Array(2 * members.length);
  members.forEach(([lon, lat, local, size = 0, fate = 0], k) => {
    positions[2 * k] = Math.round(lon * 90);
    positions[2 * k + 1] = Math.round(lat * 180);
    meta[2 * k] = local;
    meta[2 * k + 1] = size | (fate << 2);
  });
  return { index, day, positions, meta, fragments };
}
const frag = (local, { parent = -1, size = 'macro', members = 3, distanceKm = 0, fates = {} } = {}) => ({
  id: local, local, sizeClass: size, parentId: parent, bornDay: 0, members, distanceKm,
  fates: { floating: 0, gyre: 0, coast: 0, seafloor: 0, ...fates },
});
const near = (a, b, eps = 0.02) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

function splitTrack() {
  const tr = createDropTrack({ dropId: 0, item: 'bag', lon: -150, lat: 30, startDoy: 1 });
  addSnapshot(tr, snap(0, 0, [[-150, 30, 0], [-150, 30, 0], [-150, 30, 0]], [frag(0)]));
  addSnapshot(tr, snap(1, 1, [[-151, 30, 0], [-152, 31, 0], [-153, 29, 0]], [frag(0)]));
  // Split: the parent (local 0) is gone; children 2 and 1 (in that member order) copy its
  // members' positions. The worker appends children after other fragments, so order changes.
  addSnapshot(tr, snap(2, 2, [
    [-151.5, 30, 2, 1], [-152.5, 31, 2, 1], [-153.5, 29, 2, 1],
    [-151.4, 30, 1, 1], [-152.4, 31, 1, 1], [-153.4, 29, 1, 1],
  ], [frag(1, { parent: 0, size: 'meso' }), frag(2, { parent: 0, size: 'meso' })]));
  return tr;
}

test('fragments keep their identities across snapshots', () => {
  const tr = splitTrack();
  for (let id = 0; id < 3; id++) {
    const a = stateAt(tr, id, 0), b = stateAt(tr, id, 1);
    near(a.lon, -150);
    near(b.lon, -151 - id);
  }
});

test('the first child of a split inherits the parent identities, later children descend from them', () => {
  const tr = splitTrack();
  assert.equal(tr.ancestor.length, 6, 'three inherited + three new identities');
  // First child in member order is local 2: it inherits identities 0..2.
  for (let id = 0; id < 3; id++) {
    const s = stateAt(tr, id, 2);
    assert.equal((s.code >> 4) & 255, 2);
    near(s.lon, -151.5 - id);
  }
  // Identities 3..5 belong to local 1, born at snapshot 2, ancestors 0..2.
  for (let id = 3; id < 6; id++) {
    assert.equal(tr.born[id], 2);
    assert.equal(tr.ancestor[id], id - 3);
    const s = stateAt(tr, id, 2);
    assert.equal((s.code >> 4) & 255, 1);
    near(s.lon, -151.4 - (id - 3));
    // Before birth it reports its ancestor's history (so trails and interpolation stay continuous).
    near(stateAt(tr, id, 1).lon, -151 - (id - 3));
  }
  assert.ok(tr.version > 0);
});

test('a fragment of unknown parentage descends from the nearest previous member', () => {
  const tr = splitTrack();
  // Several splits happened between snapshots: local 7's parent (local 5) was never seen.
  addSnapshot(tr, snap(3, 3, [[-153.45, 29.05, 7, 2], [-151.45, 30.02, 7, 2]], [frag(7, { parent: 5, size: 'micro', members: 2 })]));
  const ids = [6, 7];
  near(stateAt(tr, ids[0], 3).lon, -153.45);
  // Nearest at snapshot 2 to (-153.45, 29.05) is identity 2 (-153.5) or 5 (-153.4): both 0.05 away;
  // either is fine, but it must be one of them.
  assert.ok([2, 5].includes(tr.ancestor[ids[0]]), `ancestor ${tr.ancestor[ids[0]]}`);
  assert.ok([0, 3].includes(tr.ancestor[ids[1]]), `ancestor ${tr.ancestor[ids[1]]}`);
  // Identities absent from snapshot 3 (the earlier children) are not alive there.
  assert.equal(stateAt(tr, 0, 3), null);
  assert.equal(tr.snaps[3].code[0], ABSENT);
});

test('sunk day is recorded once, at the first seafloor snapshot', () => {
  const tr = createDropTrack({ dropId: 1, item: 'bottle' });
  addSnapshot(tr, snap(0, 0, [[0, 0, 0], [0, 0, 0]], [frag(0, { members: 2 })]));
  addSnapshot(tr, snap(1, 1, [[1, 0, 0, 0, 3], [1, 0, 0]], [frag(0, { members: 2 })]));
  addSnapshot(tr, snap(2, 2, [[1, 0, 0, 0, 3], [2, 0, 0, 0, 3]], [frag(0, { members: 2 })]));
  assert.equal(tr.sunkDay[0], 1);
  assert.equal(tr.sunkDay[1], 2);
});

test('fragmentStats sums the lineage and normalises fates over the end members', () => {
  const tr = splitTrack();
  // Latest snapshot: replace fragments' stats with known values (3 members each).
  tr.snaps[2].fragments = [
    frag(1, { parent: 0, size: 'meso', members: 3, distanceKm: 100, fates: { gyre: 1 } }),
    frag(2, { parent: 0, size: 'meso', members: 1, distanceKm: 300, fates: { coast: 0.5, seafloor: 0.5 } }),
  ];
  const s = fragmentStats(tr, 0, 2);
  assert.equal(s.pieces, 2);
  assert.deepEqual(s.sizeClasses, ['meso']);
  assert.equal(s.members, 4);
  assert.equal(s.endMembers, 4);
  near(s.distanceKm, (3 * 100 + 1 * 300) / 4, 1e-9);
  near(s.fates.gyre, 0.75, 1e-9);
  near(s.fates.coast, 0.125, 1e-9);
  near(s.fates.seafloor, 0.125, 1e-9);
  near(s.fates.gyre + s.fates.coast + s.fates.seafloor + s.fates.floating, 1, 1e-9);
  // Selecting a child before it existed reports its ancestor (the parent) at that age.
  const early = fragmentStats(tr, 1, 1);
  assert.deepEqual(early.sizeClasses, ['macro']);
  assert.equal(early.pieces, 1);
});

test('lineage follows copies through splits whose intermediate fragments were never seen', () => {
  const tr = splitTrack();
  // Fragment 7 (parent 5, never seen) holds copies descended from identities 0 and 3.
  addSnapshot(tr, snap(3, 3, [[-151.45, 30.02, 7, 2], [-151.35, 30.0, 7, 2]], [frag(7, { parent: 5, size: 'micro', members: 2, fates: { gyre: 1 } })]));
  const s = fragmentStats(tr, 0, 3);
  assert.deepEqual(s.sizeClasses, ['micro'], 'the root fragment 0 is now micro fragment 7');
  assert.equal(s.endMembers, 2);
  assert.equal(s.fates.gyre, 1);
});

test('distance from the drop point: great-circle mean and 10th-90th percentile spread', async () => {
  const { greatCircleKm } = await import('../src/globe/tracks.js');
  near(greatCircleKm(0, 0, 1, 0), 111.19, 0.01);
  const tr = createDropTrack({ dropId: 0, item: 'bottle', lon: 0, lat: 0, startDoy: 1 });
  addSnapshot(tr, snap(0, 0, Array.from({ length: 10 }, () => [0, 0, 0]), [frag(0, { members: 10 })]));
  // Copies 1..10 degrees east: distances 111..1112 km.
  addSnapshot(tr, snap(1, 1, Array.from({ length: 10 }, (_, k) => [k + 1, 0, 0]), [frag(0, { members: 10, distanceKm: 99999 })]));
  const s = fragmentStats(tr, 0, 1);
  near(s.fromDropKm.mean, 5.5 * 111.19, 0.5);
  near(s.fromDropKm.p10, 2 * 111.19, 0.5);
  near(s.fromDropKm.p90, 9 * 111.19, 0.5);
  assert.equal(s.fromDropKm.n, 10);
  assert.equal(s.sankFirstWeek, 0);
});

test('sankFirstWeek counts copies that reached the seafloor within 7 days', () => {
  const tr = createDropTrack({ dropId: 0, item: 'line', lon: 0, lat: 0, startDoy: 1 });
  addSnapshot(tr, snap(0, 0, [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]], [frag(0, { members: 4 })]));
  addSnapshot(tr, snap(1, 5, [[0, 0, 0, 0, 3], [0, 0, 0, 0, 3], [0, 0, 0, 0, 3], [0, 0, 0]], [frag(0, { members: 4 })]));
  assert.equal(fragmentStats(tr, 0, 5).sankFirstWeek, 0.75);
});

test('fragmentStats reports the days the drop was moved by plain advection', () => {
  const tr = createDropTrack({ dropId: 0, item: 'bottle', lon: 0, lat: 0 });
  addSnapshot(tr, { ...snap(0, 0, [[0, 0, 0]], [frag(0, { members: 1 })]), advectionDays: 0 });
  addSnapshot(tr, { ...snap(1, 1, [[1, 0, 0]], [frag(0, { members: 1 })]), advectionDays: 1 });
  assert.equal(fragmentStats(tr, 0, 1).advectionDays, 1);
  assert.equal(fragmentStats(tr, 0, 1).computedDay, 1);
});
