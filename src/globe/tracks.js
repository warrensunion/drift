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

export function createDropTrack({ dropId, item, lon, lat, startDoy }) {
  return {
    dropId, item, lon, lat, startDoy,
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
export function addSnapshot(tr, { index, day, positions, meta, fragments }) {
  const n = positions.length >> 1;
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
      idOf[k] = newIdentity(tr, prev ? nearestIdentity(prev, positions[2 * k], positions[2 * k + 1]) : -1, index);
    }
  }
  const total = tr.ancestor.length;
  const pos = new Int16Array(2 * total);
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
  tr.computedDay = Math.max(tr.computedDay, day);
  if (total !== before) tr.version++;
  return tr;
}

function nearestIdentity(snap, qx, qy) {
  let best = -1, bd = Infinity;
  for (let id = 0; id < snap.n; id++) {
    if (snap.code[id] === ABSENT) continue;
    let dx = Math.abs(snap.pos[2 * id] - qx);
    if (dx > 16200) dx = 32400 - dx; // lon*90 wraps at +-16200
    const dy = (snap.pos[2 * id + 1] - qy) * 0.5; // lat*180 -> same degree scale as lon*90
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
  return { lon: snap.pos[2 * i] / 90, lat: snap.pos[2 * i + 1] / 180, code: c };
}

/** Snapshot index and fraction for the shared age t (days), clamped to this drop's computed days. */
export function frameFor(tr, t) {
  if (tr.lastIndex < 0) return null;
  const { index, frac } = indexForDay(t, tr.lastDay);
  return { index: Math.min(index, tr.lastIndex), frac: index >= tr.lastIndex ? 0 : frac, day: Math.max(0, Math.min(t, tr.lastDay)) };
}

const isDescendant = (tr, fragId, rootId) => {
  let f = tr.frags.get(fragId), guard = 0;
  while (f && guard++ < 64) {
    if (f.id === rootId) return true;
    f = tr.frags.get(f.parentId);
  }
  return false;
};

/** Fragments of `snap` that are `fragId`, its descendants, or (before it was born) its ancestor. */
export function lineageAt(tr, snap, fragId) {
  if (!snap) return [];
  const own = snap.fragments.filter((f) => isDescendant(tr, f.id, fragId));
  if (own.length) return own;
  const anc = snap.fragments.filter((f) => isDescendant(tr, fragId, f.id));
  return anc;
}

/**
 * Panel stats for a selected fragment at age t: size classes now, mean distance (km), members,
 * and fate probabilities across the ensemble at the latest computed snapshot.
 */
export function fragmentStats(tr, fragId, t) {
  const fr = frameFor(tr, t);
  if (!fr) return null;
  const snap = tr.snaps[fr.index];
  const now = lineageAt(tr, snap, fragId);
  let members = 0, dist = 0;
  const classes = new Map();
  for (const f of now) {
    members += f.members;
    dist += f.distanceKm * f.members;
    classes.set(f.sizeClass, (classes.get(f.sizeClass) || 0) + 1);
  }
  const last = tr.snaps[tr.lastIndex];
  const end = lineageAt(tr, last, fragId);
  const fates = { gyre: 0, coast: 0, seafloor: 0, floating: 0 };
  let endMembers = 0;
  for (const f of end) {
    endMembers += f.members;
    for (const k of FATE_NAMES) fates[k] += (f.fates[k] || 0) * f.members;
  }
  if (endMembers) for (const k of FATE_NAMES) fates[k] /= endMembers;
  const root = tr.frags.get(fragId);
  return {
    item: tr.item,
    day: fr.day,
    pieces: now.length,
    sizeClasses: [...classes.keys()].sort((a, b) => SIZE_NAMES.indexOf(a) - SIZE_NAMES.indexOf(b)),
    originalSize: root ? root.sizeClass : null,
    members,
    distanceKm: members ? dist / members : 0,
    fates,
    fatesDay: last ? last.day : 0,
    computedDay: tr.lastDay,
    done: tr.done,
  };
}

export { snapshotDays, SIZE_NAMES, FATE_NAMES };
