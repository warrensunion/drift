// Snapshot schedule and packing. Pure module (worker + node tests).
import { SIZE_CLASSES } from './fragment.js';
import { inGyre } from './fate.js';
import { STATE } from './ensemble.js';

export const FATES = Object.freeze(['floating', 'gyre', 'coast', 'seafloor']);

let DAYS = null;
/**
 * Snapshot days: daily 0..60, every 3 days to 365, every 15 days to 3650. The step that would
 * overshoot a boundary lands on it, so 365 and 3650 are always included (60+3k stops at 363,
 * then 365; 365+15k hits 3650 exactly). Length = 61 + ceil(305/3) + ceil(3285/15) = 382.
 */
export function snapshotDays() {
  if (DAYS) return DAYS;
  const out = [0];
  let d = 0;
  while (d < 60) out.push(d += 1);
  while (d < 365) out.push(d = Math.min(d + 3, 365));
  while (d < 3650) out.push(d = Math.min(d + 15, 3650));
  DAYS = Object.freeze(out);
  return DAYS;
}

/**
 * Index of the last snapshot <= min(day, computedDay), and the interpolation fraction toward the
 * next snapshot when that next snapshot is already computed (<= computedDay), else frac = 0.
 */
export function indexForDay(day, computedDay) {
  const days = snapshotDays();
  const eff = Math.max(0, Math.min(day, computedDay));
  let lo = 0, hi = days.length - 1;
  while (lo < hi) { // last index with days[i] <= eff
    const mid = (lo + hi + 1) >> 1;
    if (days[mid] <= eff) lo = mid; else hi = mid - 1;
  }
  const next = days[lo + 1];
  const frac = next !== undefined && next <= computedDay ? (eff - days[lo]) / (next - days[lo]) : 0;
  return { index: lo, frac };
}

/**
 * Pack one drop's members.
 * positions: Int16Array[2 * n], member k at [2k] = round(lon * 90), [2k+1] = round(lat * 180)
 *            (lon in -180..180 -> +-16200, lat in -90..90 -> +-16200; ~1.2 km / 0.6 km steps).
 * meta:      Uint8Array[2 * n], [2k] = fragment id low 8 bits (unique within a drop: ids are
 *            dropId*256 + local index), [2k+1] = sizeClassIndex | fateIndex << 2, with
 *            sizeClassIndex into SIZE_CLASSES (macro, meso, micro, small) and fateIndex into
 *            FATES (floating, gyre = floating inside a gyre box, coast = beached, seafloor = sunk).
 * fragments: per live fragment of the drop {id, local, sizeClass, parentId, bornDay, members,
 *            distanceKm (mean), fates (same fractions as fateSummary)} for the UI side panel.
 */
export function packSnapshot(sim, dropId) {
  const m = sim.members;
  let n = 0;
  for (let i = 0; i < m.count; i++) if (m.dropId[i] === dropId) n++;
  const positions = new Int16Array(2 * n);
  const meta = new Uint8Array(2 * n);
  const dist = new Map();
  let k = 0;
  for (let i = 0; i < m.count; i++) {
    if (m.dropId[i] !== dropId) continue;
    positions[2 * k] = Math.round(m.lon[i] * 90);
    positions[2 * k + 1] = Math.round(m.lat[i] * 180);
    const s = m.state[i];
    const fate = s === STATE.sunk ? 3 : s === STATE.beached ? 2 : inGyre(m.lon[i], m.lat[i]) ? 1 : 0;
    meta[2 * k] = m.fragmentId[i] & 255;
    meta[2 * k + 1] = m.sizeClass[i] | (fate << 2);
    const e = dist.get(m.fragmentId[i]) || { sum: 0, n: 0, f: [0, 0, 0, 0] };
    e.sum += m.distanceKm[i]; e.n++; e.f[fate]++;
    dist.set(m.fragmentId[i], e);
    k++;
  }
  const fragments = [];
  for (const f of sim.fragments.values()) {
    if (f.dropId !== dropId) continue;
    const e = dist.get(f.id) || { sum: 0, n: 0, f: [0, 0, 0, 0] };
    fragments.push({
      id: f.id, local: f.local, sizeClass: f.sizeClass, parentId: f.parentId, bornDay: f.bornDay,
      members: e.n, distanceKm: e.n ? e.sum / e.n : 0, fates: Object.fromEntries(FATES.map((name, j) => [name, e.n ? e.f[j] / e.n : 0])),
    });
  }
  return { positions, meta, fragments, count: n };
}

/** Decode member k's meta bytes. */
export function unpackMeta(meta, k) {
  const b = meta[2 * k + 1];
  return { fragment: meta[2 * k], sizeClass: SIZE_CLASSES[b & 3], fate: FATES[(b >> 2) & 3] };
}
