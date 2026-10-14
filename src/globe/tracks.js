// Main-thread store of every drop's snapshots, re-ordered into stable member identities so that
// member k of snapshot i and member k of snapshot i+1 are the same simulated copy (the worker
// compacts its arrays when a fragment splits, which reorders members). Pure module (no DOM/three).
//
// Identity rules, applied when snapshot s+1 arrives after s:
//  - a fragment present in both keeps its identities in member order;
//  - the first child of a fragment that split inherits the parent's identities, later children get
//    new identities whose ancestor is the parent's j-th identity (their history before birth is the
//    ancestor's);
//  - a fragment with no known parent (several splits between two snapshots) takes, per member, the
//    nearest member of the previous snapshot as ancestor.
import { snapshotDays, indexForDay } from '../sim/snapshots.js';

export const ABSENT = 0xffff;
const SIZE_NAMES = ['macro', 'meso', 'micro', 'small'];
const FATE_NAMES = ['floating', 'gyre', 'coast', 'seafloor'];

export const codeOf = (metaByte1, fragLocal) => ((metaByte1 & 15) | ((fragLocal & 255) << 4));
export const codeSize = (code) => code & 3;
export const codeFate = (code) => (code >> 2) & 3;
export const codeFrag = (code) => (code >> 4) & 255;

/** Index of the last schedule entry <= min(t, computed) and the fraction toward the next one. */
export function indexForSchedule(days, t, computed) {
  const eff = Math.max(0, Math.min(t, computed));
  let lo = 0, hi = days.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (days[mid] <= eff) lo = mid; else hi = mid - 1;
  }
  const next = days[lo + 1];
  const frac = next !== undefined && next <= computed ? (eff - days[lo]) / (next - days[lo]) : 0;
  return { index: lo, frac };
}

/**
 * schedule: snapshot times (default the global snapshotDays(); Salish passes its hours). Positions
 * arrive as Int16 (lon*90, lat*180, global) or Float32 degrees (Salish); sx/sy hold the scale.
 */
export function createDropTrack({ dropId, item, lon, lat, startDoy, schedule = null }) {
  return {
    dropId, item, lon, lat, startDoy,
    schedule,
    sx: 90, sy: 180,
    snaps: [], // by snapshot index: {day, n (identities), pos Int16Array[2n], code Uint16Array[n], fragments}
    lastIndex: -1,
    lastDay: -1,
    computedDay: 0,
    done: false,
    ancestor: [], // identity -> ancestor identity or -1
    born: [], // identity -> snapshot index it first appears
    sunkDay: [], // identity -> first day seen on the seafloor (Infinity if never)
    frags: new Map(), // fragment global id -> {id, local, sizeClass, parentId, bornDay}
    groups: new Map(), // fragment local -> identity list, for the latest snapshot
    version: 0, // bumps when identities are added (loaded layers must be rewritten)
  };
}

const newIdentity = (tr, ancestor, index) => {
  const id = tr.ancestor.length;
  tr.ancestor.push(ancestor);
  tr.born.push(index);
  tr.sunkDay.push(Infinity);
  return id;
};

/** Add a worker snapshot to a drop track. */
export function addSnapshot(tr, { index, day, positions, meta, fragments, advectionDays = null }) {
  const n = positions.length >> 1;
  if (positions instanceof Float32Array || positions instanceof Float64Array) { tr.sx = 1; tr.sy = 1; }
  for (const f of fragments || []) tr.frags.set(f.id, { id: f.id, local: f.local, sizeClass: f.sizeClass, parentId: f.parentId, bornDay: f.bornDay });
  const prev = index === tr.lastIndex + 1 ? tr.snaps[tr.lastIndex] : null;
  const prevGroups = prev ? tr.groups : new Map();
  const byLocal = new Map();
  for (let k = 0; k < n; k++) {
    const local = meta[2 * k];
    let g = byLocal.get(local);
    if (!g) byLocal.set(local, (g = []));
    g.push(k);
  }
  const idOf = new Int32Array(n);
  const consumed = new Set();
  const before = tr.ancestor.length;
  const localToFrag = new Map();
  for (const f of fragments || []) localToFrag.set(f.local & 255, f);
  for (const [local, ks] of byLocal) {
    const same = prevGroups.get(local);
    if (same && !consumed.has(local)) {
      consumed.add(local);
      for (let j = 0; j < ks.length; j++) idOf[ks[j]] = j < same.length ? same[j] : newIdentity(tr, same[j % same.length], index);
      continue;
    }
    const f = localToFrag.get(local);
    const parentLocal = f && f.parentId >= 0 ? f.parentId & 255 : -1;
    const parent = parentLocal >= 0 ? prevGroups.get(parentLocal) : null;
    if (parent && parent.length) {
      const inherit = !consumed.has(parentLocal) && !byLocal.has(parentLocal);
      if (inherit) consumed.add(parentLocal);
      for (let j = 0; j < ks.length; j++) {
        idOf[ks[j]] = inherit && j < parent.length ? parent[j] : newIdentity(tr, parent[j % parent.length], index);
      }
      continue;
    }
    for (let j = 0; j < ks.length; j++) {
      const k = ks[j];
      idOf[k] = newIdentity(tr, prev ? nearestIdentity(prev, positions[2 * k], positions[2 * k + 1], tr.sx, tr.sy) : -1, index);
    }
  }
  const total = tr.ancestor.length;
  const pos = new positions.constructor(2 * total);
  const code = new Uint16Array(total).fill(ABSENT);
  for (let k = 0; k < n; k++) {
    const id = idOf[k];
    pos[2 * id] = positions[2 * k];
    pos[2 * id + 1] = positions[2 * k + 1];
    const c = codeOf(meta[2 * k + 1], meta[2 * k]);
    code[id] = c;
    if (codeFate(c) === 3 && tr.sunkDay[id] === Infinity) tr.sunkDay[id] = day;
  }
  const groups = new Map();
  for (const [local, ks] of byLocal) groups.set(local, ks.map((k) => idOf[k]));
  tr.groups = groups;
  tr.snaps[index] = { day, n: total, pos, code, fragments: fragments || [], members: n };
  tr.lastIndex = Math.max(tr.lastIndex, index);
  tr.lastDay = Math.max(tr.lastDay, day);
  if (advectionDays != null) tr.advectionDays = Math.max(tr.advectionDays || 0, advectionDays);
  tr.computedDay = Math.max(tr.computedDay, day);
  if (total !== before) tr.version++;
  return tr;
}

function nearestIdentity(snap, qx, qy, sx, sy) {
  let best = -1, bd = Infinity;
  for (let id = 0; id < snap.n; id++) {
    if (snap.code[id] === ABSENT) continue;
    let dx = Math.abs(snap.pos[2 * id] - qx) / sx; // degrees
    if (dx > 180) dx = 360 - dx;
    const dy = (snap.pos[2 * id + 1] - qy) / sy;
    const d = dx * dx + dy * dy;
    if (d < bd) { bd = d; best = id; }
  }
  return best;
}

/**
 * Identity `id`'s state at snapshot `index`: {lon, lat, code} or null (not alive then). Identities
 * born after `index` report their ancestor's state.
 */
export function stateAt(tr, id, index) {
  const snap = tr.snaps[index];
  if (!snap) return null;
  let i = id;
  while (i >= 0 && tr.born[i] > index) i = tr.ancestor[i];
  if (i < 0 || i >= snap.n) return null;
  const c = snap.code[i];
  if (c === ABSENT) return null;
  return { lon: snap.pos[2 * i] / tr.sx, lat: snap.pos[2 * i + 1] / tr.sy, code: c };
}

/** Snapshot index and fraction for the shared age t (days), clamped to this drop's computed days. */
export function frameFor(tr, t) {
  if (tr.lastIndex < 0) return null;
  const { index, frac } = tr.schedule ? indexForSchedule(tr.schedule, t, tr.lastDay) : indexForDay(t, tr.lastDay);
  return { index: Math.min(index, tr.lastIndex), frac: index >= tr.lastIndex ? 0 : frac, day: Math.max(0, Math.min(t, tr.lastDay)) };
}

const hasLocal = (snap, local) => {
  if (!snap) return false;
  for (let i = 0; i < snap.n; i++) if (snap.code[i] !== ABSENT && ((snap.code[i] >> 4) & 255) === local) return true;
  return false;
};

/**
 * Fragment locals at snapshot `index` that hold the selected fragment's copies: the fragment
 * itself, every fragment its members broke into, or (before it existed) the fragment it came
 * from. Traced through member identities, so it holds even when several splits happened between
 * two snapshots and the intermediate fragments were never seen.
 */
export function lineageLocalsAt(tr, fragId, index) {
  const out = new Set();
  const snap = tr.snaps[index];
  if (!snap) return out;
  const local = fragId & 255;
  let sF = -1;
  for (let s = Math.min(index, tr.lastIndex); s >= 0 && sF < 0; s--) if (hasLocal(tr.snaps[s], local)) sF = s;
  if (sF < 0) for (let s = index + 1; s <= tr.lastIndex && sF < 0; s++) if (hasLocal(tr.snaps[s], local)) sF = s;
  if (sF < 0) return out;
  const src = tr.snaps[sF];
  const members = new Set();
  for (let i = 0; i < src.n; i++) if (src.code[i] !== ABSENT && ((src.code[i] >> 4) & 255) === local) members.add(i);
  if (sF > index) {
    // Not born yet at this age: report what its copies were then.
    for (const id of members) {
      const st = stateAt(tr, id, index);
      if (st) out.add((st.code >> 4) & 255);
    }
    return out;
  }
  for (let id = 0; id < snap.n; id++) {
    if (snap.code[id] === ABSENT) continue;
    let i = id, guard = 0;
    while (i >= 0 && !members.has(i) && guard++ < 4096) i = tr.ancestor[i];
    if (i >= 0 && members.has(i)) out.add((snap.code[id] >> 4) & 255);
  }
  return out;
}

/** Fragments of snapshot `index` in the selected fragment's lineage (see lineageLocalsAt). */
export function lineageAt(tr, index, fragId) {
  const snap = tr.snaps[index];
  if (!snap) return [];
  const locals = lineageLocalsAt(tr, fragId, index);
  return snap.fragments.filter((f) => locals.has(f.local & 255));
}

const R_KM = 6371;
export function greatCircleKm(lon1, lat1, lon2, lat2) {
  const r = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Mean and 10th/90th percentile distance (km) from the drop point of the copies in `locals`. */
export function distancesFromDrop(tr, snap, locals) {
  if (!snap || tr.lon == null) return null;
  const d = [];
  for (let i = 0; i < snap.n; i++) {
    const c = snap.code[i];
    if (c === ABSENT || !locals.has((c >> 4) & 255)) continue;
    d.push(greatCircleKm(tr.lon, tr.lat, snap.pos[2 * i] / tr.sx, snap.pos[2 * i + 1] / tr.sy));
  }
  if (!d.length) return null;
  d.sort((a, b) => a - b);
  const q = (p) => d[Math.min(d.length - 1, Math.max(0, Math.round(p * (d.length - 1))))];
  return { mean: d.reduce((s, v) => s + v, 0) / d.length, p10: q(0.1), p90: q(0.9), n: d.length };
}

/**
 * Panel stats for a selected fragment at age t: size classes now, mean distance (km), members,
 * and fate probabilities across the ensemble at the latest computed snapshot.
 */
export function fragmentStats(tr, fragId, t) {
  const fr = frameFor(tr, t);
  if (!fr) return null;
  const snap = tr.snaps[fr.index];
  const now = lineageAt(tr, fr.index, fragId);
  let members = 0, dist = 0;
  const classes = new Map();
  for (const f of now) {
    members += f.members;
    dist += f.distanceKm * f.members;
    classes.set(f.sizeClass, (classes.get(f.sizeClass) || 0) + 1);
  }
  const last = tr.snaps[tr.lastIndex];
  const end = lineageAt(tr, tr.lastIndex, fragId);
  // Fate keys come from the snapshots (global: floating/gyre/coast/seafloor; Salish:
  // floating/coast/left).
  const fates = Object.fromEntries(FATE_NAMES.map((k) => [k, 0]));
  let endMembers = 0;
  for (const f of end) {
    endMembers += f.members;
    for (const [k, v] of Object.entries(f.fates)) fates[k] = (fates[k] || 0) + (v || 0) * f.members;
  }
  if (endMembers) for (const k of Object.keys(fates)) fates[k] /= endMembers;
  const root = tr.frags.get(fragId);
  // Straight-line (great-circle) distance of each copy from the drop point at this age: the
  // path length (distanceKm) adds up every random-walk step and overstates how far it got.
  const fromDrop = distancesFromDrop(tr, snap, lineageLocalsAt(tr, fragId, fr.index));
  // Share of all copies (alive at any time) that reached the seafloor within the first week.
  let ids = 0, early = 0;
  if (!tr.schedule) {
    for (let i = 0; i < tr.sunkDay.length; i++) { ids++; if (tr.sunkDay[i] <= 7) early++; }
  }
  return {
    item: tr.item,
    fromDropKm: fromDrop,
    advectionDays: tr.advectionDays || 0,
    sankFirstWeek: ids ? early / ids : 0,
    day: fr.day,
    pieces: now.length,
    sizeClasses: [...classes.keys()].sort((a, b) => SIZE_NAMES.indexOf(a) - SIZE_NAMES.indexOf(b)),
    originalSize: root ? root.sizeClass : null,
    members,
    distanceKm: members ? dist / members : 0,
    fates, // fractions over endMembers
    endMembers,
    fatesDay: last ? last.day : 0,
    computedDay: tr.lastDay,
    done: tr.done,
  };
}

export { snapshotDays, SIZE_NAMES, FATE_NAMES };
