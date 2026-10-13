// Drift ensemble simulation. Pure module: no DOM, no I/O; the model (`predict`), the feature
// builder (`featuresFn`) and the random stream (`rng`) are injected, so tests run in Node.
//
// Rules (docs/spec.md "Simulation rules"):
// - Every fragment is a cloud of E (=24) members. Each day each floating member moves by the
//   model's next-day displacement mu + sigma * z (km east/north, sigma = exp(log_sigma),
//   z ~ N(0,1) by Box-Muller from the seeded rng), converted to degrees with metersToDeg.
// - If the next position is land (no data in the 1 deg current tile of that month) the member
//   beaches at its current position with p = beachProbabilityPerContactDay, else stays put that
//   day. Beached members resuspend (in place) with p = resuspensionProbabilityPerDay. Sunk
//   members never move again. Floating members sink with dailySinkProbability(class, gyre, floats).
// - Fragmentation: one fragmentSchedule per drop. A fragment of class C splits on the event whose
//   parent is C once the MEAN fragmentationClock of its surface (non-sunk) members reaches the
//   event day (simplest consistent choice; members of one fragment share one lineage; sunk
//   members' clocks are frozen, so they count only when every member is sunk). Each child clones the parent's
//   members (positions, state, clocks, distance); the parent is retired.
// - Budget: <= BUDGET members. A drop or split that would exceed it retires the oldest other drop
//   first; if this drop alone still exceeds it, each child gets floor(free / nChildren) members
//   (the first ones of the parent), and if that is 0 the split is skipped for good.
// - Model failure: with predict == null the member is advected by rk2Step on the current field
//   for one day (86400 s) and sim.usingFallback is true.
import { CONSTANTS } from './constants.js';
import { sample } from './field.js';
import { rk2Step, metersToDeg } from './advect.js';
import { ITEMS, SIZE_CLASSES, startClassOf, floatsFor, fragmentSchedule, fragmentationClock, windageFor, windageFeature } from './fragment.js';
import { inGyre, dailySinkProbability } from './fate.js';

export const BUDGET = 20000;
export const ENSEMBLE = 24;
export const MAX_DAYS = 3650;
/** Member states. 'gyre' is not a state: it is a fate label for floating members inside a gyre box. */
export const STATE = Object.freeze({ floating: 0, beached: 1, sunk: 2 });
export const STATE_NAMES = Object.freeze(['floating', 'beached', 'sunk']);
/** Fragment ids are global: dropId * FRAG_STRIDE + local index (<= 85 per drop), so id & 255 is unique within a drop. */
export const FRAG_STRIDE = 256;

const P_BEACH = CONSTANTS.beachProbabilityPerContactDay.value;
const P_RESUSPEND = CONSTANTS.resuspensionProbabilityPerDay.value;
const MONTH_START = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334, 365];

/** Month index 0..11 of a 1-based day of year (wrapped into 1..365). */
export function monthOfDoy(doy) {
  const d = ((((Math.floor(doy) - 1) % 365) + 365) % 365);
  let m = 0;
  while (m < 11 && d >= MONTH_START[m + 1]) m++;
  return m;
}

/** Two independent N(0,1) draws (Box-Muller). u1 = 1 - rng() so it is never 0. */
export function gaussianPair(rng) {
  const u1 = 1 - rng(), u2 = rng();
  const r = Math.sqrt(-2 * Math.log(u1));
  return [r * Math.cos(2 * Math.PI * u2), r * Math.sin(2 * Math.PI * u2)];
}

const normLon = (lon) => ((((lon + 180) % 360) + 360) % 360) - 180;
const clampLat = (lat) => Math.max(-89.9, Math.min(89.9, lat));

function allocMembers(cap) {
  return {
    count: 0,
    lon: new Float64Array(cap), lat: new Float64Array(cap),
    item: new Uint8Array(cap), // index into ITEMS
    fragmentId: new Int32Array(cap), dropId: new Int32Array(cap),
    sizeClass: new Uint8Array(cap), // index into SIZE_CLASSES
    state: new Uint8Array(cap), // STATE
    daysAtSea: new Float32Array(cap), daysBeached: new Float32Array(cap),
    distanceKm: new Float32Array(cap), bornDay: new Int32Array(cap),
    windage: new Float32Array(cap), // physical windage fraction
  };
}
const FIELDS = ['lon', 'lat', 'item', 'fragmentId', 'dropId', 'sizeClass', 'state', 'daysAtSea', 'daysBeached', 'distanceKm', 'bornDay', 'windage'];

/**
 * createSim({ fields: {current: tile[] (by month, frame 0), wind?: tile (12 frames)}, wind?, predict,
 *             rng, featuresFn?, ensemble?, budget?, maxDays? })
 * predict(x: Float32Array(10n), n) -> {mu, logSigma} (Float32Array(2n) each), sync or Promise; null = fallback.
 * featuresFn(lat, lon, uCur, vCur, uWind, vWind, doy, windageFeature) -> Float32Array(10); required with predict.
 */
export function createSim({ fields, wind, predict = null, rng, featuresFn = null, ensemble = ENSEMBLE, budget = BUDGET, maxDays = MAX_DAYS } = {}) {
  if (!fields || !fields.current || !fields.current.length) throw new Error('createSim: fields.current (tiles by month) required');
  if (typeof rng !== 'function') throw new Error('createSim: rng required');
  if (predict && typeof featuresFn !== 'function') throw new Error('createSim: featuresFn required with predict');
  const windTile = wind || fields.wind || null;
  const m = allocMembers(budget);
  const drops = new Map(); // id -> {id, item, lon, lat, startDoy, bornDay, schedule, nextLocal}
  const fragments = new Map(); // id -> {id, dropId, local, item, sizeClass, parentId, bornDay, windage, noSplit}
  let nextDrop = 0;

  const curTile = (month) => fields.current[month % fields.current.length];
  const landAt = (month, lon, lat) => sample(curTile(month), lon, lat, 0) === null;

  const sim = {
    day: 0,
    usingFallback: !predict,
    members: m,
    drops,
    fragments,
    budget,
    ageOf: (dropId) => { const d = drops.get(dropId); return d ? Math.min(sim.day - d.bornDay, maxDays) : -1; }, // computed days of that drop
    doyOf: (dropId) => { const d = drops.get(dropId); return d ? d.startDoy + (sim.day - d.bornDay) : NaN; },
    isActive: () => { for (const d of drops.values()) if (sim.day - d.bornDay < maxDays) return true; return false; },
    drop, step, retireDrop, clear,
    /** Swap the model (e.g. null after a runtime inference failure -> advection fallback). */
    setPredict(p) {
      if (p && typeof featuresFn !== 'function') throw new Error('setPredict: featuresFn required');
      predict = p || null; sim.usingFallback = !predict;
    },
  };

  function compact(keep) {
    let w = 0;
    for (let r = 0; r < m.count; r++) {
      if (!keep(r)) continue;
      if (w !== r) for (const k of FIELDS) m[k][w] = m[k][r];
      w++;
    }
    m.count = w;
  }

  function retireDrop(dropId) {
    if (!drops.has(dropId)) return false;
    drops.delete(dropId);
    for (const [id, f] of fragments) if (f.dropId === dropId) fragments.delete(id);
    compact((i) => m.dropId[i] !== dropId);
    return true;
  }

  function clear() {
    drops.clear(); fragments.clear(); m.count = 0; sim.day = 0;
  }

  /** Retire oldest drops (other than `except`) until `need` more members fit. Returns free slots. */
  function makeRoom(need, except) {
    while (m.count + need > budget) {
      let oldest = null;
      for (const d of drops.values()) if (d.id !== except) { oldest = d; break; } // Map keeps insertion order
      if (!oldest) break;
      retireDrop(oldest.id);
    }
    return budget - m.count;
  }

  function newFragment(d, sizeClass, parentId, windage) {
    const local = d.nextLocal++;
    const f = { id: d.id * FRAG_STRIDE + local, dropId: d.id, local, item: d.item, sizeClass, parentId, bornDay: sim.day, windage, noSplit: false };
    fragments.set(f.id, f);
    return f;
  }

  /** Drop an item at (lon, lat) on 1-based day-of-year startDoy. Returns the drop id. */
  function drop(item, lon, lat, startDoy = 1) {
    if (!ITEMS.includes(item)) throw new Error(`drop: unknown item ${item}`);
    const n = Math.min(ensemble, budget);
    const id = nextDrop++;
    makeRoom(n, id);
    const d = { id, item, lon: normLon(lon), lat, startDoy, bornDay: sim.day, schedule: fragmentSchedule(item, rng), nextLocal: 0 };
    drops.set(id, d);
    const cls = startClassOf(item);
    const f = newFragment(d, cls, -1, windageFor(item, cls));
    const it = ITEMS.indexOf(item), ci = SIZE_CLASSES.indexOf(cls);
    for (let k = 0; k < n; k++) {
      const i = m.count++;
      m.lon[i] = d.lon; m.lat[i] = lat; m.item[i] = it; m.fragmentId[i] = f.id; m.dropId[i] = id;
      m.sizeClass[i] = ci; m.state[i] = STATE.floating; m.daysAtSea[i] = 0; m.daysBeached[i] = 0;
      m.distanceKm[i] = 0; m.bornDay[i] = sim.day; m.windage[i] = f.windage;
    }
    return id;
  }

  function memberDoy(i) {
    const d = drops.get(m.dropId[i]);
    return d.startDoy + (sim.day - d.bornDay);
  }

  /** Advance every active drop (age < maxDays) by one day. */
  async function step() {
    const activeDrop = new Set();
    for (const d of drops.values()) if (sim.day - d.bornDay < maxDays) activeDrop.add(d.id);
    // 0. Members beached at the start of the day: one more day on the beach, maybe resuspend
    //    in place (a resuspended member floats again from today).
    for (let i = 0; i < m.count; i++) {
      if (m.state[i] !== STATE.beached || !activeDrop.has(m.dropId[i])) continue;
      m.daysBeached[i] += 1;
      if (rng() < P_RESUSPEND) m.state[i] = STATE.floating;
    }
    // 1. Floating members of active drops, and their model inputs.
    const idx = [];
    for (let i = 0; i < m.count; i++) if (m.state[i] === STATE.floating && activeDrop.has(m.dropId[i])) idx.push(i);
    const n = idx.length;
    let out = null;
    if (predict && n > 0) {
      const x = new Float32Array(10 * n);
      for (let k = 0; k < n; k++) {
        const i = idx[k], doy = memberDoy(i), month = monthOfDoy(doy);
        const c = sample(curTile(month), m.lon[i], m.lat[i], 0) || [0, 0];
        const w = (windTile && sample(windTile, m.lon[i], m.lat[i], month % windTile.nframes)) || [0, 0];
        x.set(featuresFn(m.lat[i], m.lon[i], c[0], c[1], w[0], w[1], doy, windageFeature(m.windage[i])), 10 * k);
      }
      out = await predict(x, n);
    }
    // 2. Move floating members (beaching on land contact), then sink.
    for (let k = 0; k < n; k++) {
      const i = idx[k], month = monthOfDoy(memberDoy(i));
      const lon = m.lon[i], lat = m.lat[i];
      let next = null, dxKm = 0, dyKm = 0;
      if (out) {
        const [z1, z2] = gaussianPair(rng);
        dxKm = out.mu[2 * k] + Math.exp(out.logSigma[2 * k]) * z1;
        dyKm = out.mu[2 * k + 1] + Math.exp(out.logSigma[2 * k + 1]) * z2;
        const [dLon, dLat] = metersToDeg(dxKm * 1000, dyKm * 1000, lat);
        next = [normLon(lon + dLon), clampLat(lat + dLat)];
      } else {
        const t = curTile(month);
        next = rk2Step((lo, la) => sample(t, lo, la, 0), lon, lat, 86400);
        if (next) next[1] = clampLat(next[1]);
      }
      if (!next || !Number.isFinite(next[0]) || !Number.isFinite(next[1]) || landAt(month, next[0], next[1])) {
        if (rng() < P_BEACH) m.state[i] = STATE.beached; // beaches where it is
      } else {
        if (!out) { // fallback distance from the displacement in degrees
          const R = 6371;
          dxKm = ((next[0] - lon + 540) % 360 - 180) * Math.PI / 180 * R * Math.cos(lat * Math.PI / 180);
          dyKm = (next[1] - lat) * Math.PI / 180 * R;
        }
        m.lon[i] = next[0]; m.lat[i] = next[1];
        m.distanceKm[i] += Math.hypot(dxKm, dyKm);
      }
      if (m.state[i] === STATE.floating) {
        m.daysAtSea[i] += 1;
        const item = ITEMS[m.item[i]], cls = SIZE_CLASSES[m.sizeClass[i]];
        const p = dailySinkProbability(cls, { inGyre: !!inGyre(m.lon[i], m.lat[i]), floats: floatsFor(item, cls) });
        if (rng() < p) m.state[i] = STATE.sunk;
      }
    }
    sim.day += 1;
    // 3. Fragmentation.
    fragmentAll(activeDrop);
  }

  function fragmentAll(activeDrop) {
    // Fragments with a pending split event, and that event.
    const pending = new Map();
    for (const f of fragments.values()) {
      if (f.noSplit || !activeDrop.has(f.dropId)) continue;
      const ev = drops.get(f.dropId).schedule.find((e) => e.parent === f.sizeClass);
      if (ev) pending.set(f.id, { f, ev, sum: 0, n: 0, sumAll: 0, nAll: 0 });
    }
    if (!pending.size) return;
    // One pass: mean fragmentation clock per pending fragment, over its surface (floating or
    // beached) members; sunk members' clocks are frozen, so they only count when all are sunk.
    for (let i = 0; i < m.count; i++) {
      const p = pending.get(m.fragmentId[i]);
      if (!p) continue;
      const c = fragmentationClock(p.f.item, { daysAtSea: m.daysAtSea[i], daysBeached: m.daysBeached[i] });
      p.sumAll += c; p.nAll++;
      if (m.state[i] !== STATE.sunk) { p.sum += c; p.n++; }
    }
    for (const { f, ev, sum, n, sumAll, nAll } of pending.values()) {
      const clock = n ? sum / n : nAll ? sumAll / nAll : -Infinity;
      if (clock < ev.day || !fragments.has(f.id) || !drops.has(f.dropId)) continue;
      split(f, drops.get(f.dropId), ev);
    }
  }

  function split(f, d, ev) {
    const pCount = (() => { let c = 0; for (let i = 0; i < m.count; i++) if (m.fragmentId[i] === f.id) c++; return c; })();
    const nKids = ev.children.length;
    // Room needed beyond the parent's own slots (the parent is retired after cloning).
    makeRoom(pCount * nKids - pCount, d.id);
    const free = budget - m.count + pCount;
    const per = Math.min(pCount, Math.floor(free / nKids));
    if (per < 1) { f.noSplit = true; return; }
    // Copy the parent's members (first `per` of them) out before compaction.
    const src = [];
    for (let i = 0; i < m.count && src.length < per; i++) if (m.fragmentId[i] === f.id) {
      const o = {};
      for (const k of FIELDS) o[k] = m[k][i];
      src.push(o);
    }
    fragments.delete(f.id);
    compact((i) => m.fragmentId[i] !== f.id);
    for (const c of ev.children) {
      const kid = newFragment(d, c.sizeClass, f.id, c.windage);
      const ci = SIZE_CLASSES.indexOf(c.sizeClass);
      for (const o of src) {
        const i = m.count++;
        for (const k of FIELDS) m[k][i] = o[k];
        m.fragmentId[i] = kid.id; m.sizeClass[i] = ci; m.windage[i] = c.windage; m.bornDay[i] = sim.day;
      }
    }
  }

  return sim;
}

/**
 * Fractions of a fragment's members by fate at the current computed day:
 * floating (outside gyres), gyre (floating inside a gyre box), coast (beached), seafloor (sunk).
 */
export function fateSummary(sim, fragmentId) {
  const m = sim.members;
  let floating = 0, gyre = 0, coast = 0, seafloor = 0;
  for (let i = 0; i < m.count; i++) {
    if (m.fragmentId[i] !== fragmentId) continue;
    const s = m.state[i];
    if (s === STATE.sunk) seafloor++;
    else if (s === STATE.beached) coast++;
    else if (inGyre(m.lon[i], m.lat[i])) gyre++;
    else floating++;
  }
  const n = floating + gyre + coast + seafloor;
  if (!n) return { floating: 0, gyre: 0, coast: 0, seafloor: 0 };
  return { floating: floating / n, gyre: gyre / n, coast: coast / n, seafloor: seafloor / n };
}
