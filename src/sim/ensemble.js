// Drift ensemble simulation. Pure module: no DOM, no I/O; the model (`predict`), the feature
// builder (`featuresFn`) and the random streams are injected, so tests run in Node.
//
// Timelines: every drop is an independent simulation on its OWN clock. Day 0 is the moment it
// is dropped; it is stepped 0 -> maxDays (3650) independently (stepDrop), and its day of year is
// startDoy + its day. Only the member budget is shared. Each drop has its own random stream
// (rngFactory(seed)), so drops do not perturb each other.
//
// Rules (docs/spec.md "Simulation rules"):
// - Every fragment is a cloud of E (=24) members. Each day each floating member moves by the
//   model's next-day displacement mu + sigma * z (km east/north, sigma = exp(log_sigma),
//   z ~ N(0,1) by Box-Muller from the drop's rng), converted to degrees with metersToDeg.
// - If the next position is land (no data in the 1 deg current tile of that month) the member
//   beaches at its current position with p = beachProbabilityPerContactDay, else stays put that
//   day. Beached members resuspend (in place) with p = resuspensionProbabilityPerDay. Sunk
//   members never move again. Floating members sink with dailySinkProbability(class, gyre, floats).
// - Fragmentation: one fragmentSchedule per drop. A fragment of class C splits on the event whose
//   parent is C once the MEAN fragmentationClock of its surface (non-sunk) members reaches the
//   event day (members of one fragment share one lineage; sunk members' clocks are frozen, so
//   they count only when every member is sunk). Each child clones the parent's members
//   (positions, state, clocks, distance); the parent is retired.
// - Budget: <= budget (20,000) members across all drops. A new drop retires the oldest drops
//   until it fits. A split may only retire drops OLDER than the splitting drop; if that is not
//   enough, each child gets floor(free / nChildren) members (the parent's first ones), and if
//   that is 0 the split is skipped for good (fragment.noSplit).
// - Model failure: with predict == null members are advected by rk2Step on the current field
//   for one day (86400 s) and sim.usingFallback is true.
// - Concurrency: while a step is in flight (awaiting predict), drop/retireDrop/clear are queued
//   and applied when the step finishes, so a step never sees its member indices move.
import { CONSTANTS } from './constants.js';
import { sample } from './field.js';
import { rk2Step, metersToDeg, EARTH_RADIUS_M } from './advect.js';
import { ITEMS, SIZE_CLASSES, makeRng, startClassOf, floatsFor, fragmentSchedule, fragmentationClock, windageFor, windageFeature } from './fragment.js';
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
const R_KM = EARTH_RADIUS_M / 1000;
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
    distanceKm: new Float32Array(cap),
    bornDay: new Int32Array(cap), // the drop's day on which this member's fragment was born
    windage: new Float32Array(cap), // physical windage fraction
  };
}
const FIELDS = ['lon', 'lat', 'item', 'fragmentId', 'dropId', 'sizeClass', 'state', 'daysAtSea', 'daysBeached', 'distanceKm', 'bornDay', 'windage'];

/**
 * createSim({ fields: {current: tile[] (by month, frame 0), wind?: tile (12 frames)}, wind?, predict,
 *             rng?, rngFactory?, featuresFn?, ensemble?, budget?, maxDays?, onRetire? })
 * predict(x: Float32Array(10n), n) -> {mu, logSigma} (Float32Array(2n) each), sync or Promise; null = fallback.
 * featuresFn(lat, lon, uCur, vCur, uWind, vWind, doy, windageFeature, out?, offset?) -> Float32Array(10);
 *   required with predict. It may write into out[offset..offset+10) (the batch buffer) instead of
 *   allocating; if it returns a different array that array is copied in.
 * rngFactory(seed) -> () => [0,1): each drop's own stream (default makeRng). rng (default
 *   makeRng(1)) only supplies seeds for drops dropped without one.
 * onRetire(dropId): called when the budget retires a drop.
 */
export function createSim({ fields, wind, predict = null, rng = makeRng(1), rngFactory = makeRng, featuresFn = null, ensemble = ENSEMBLE, budget = BUDGET, maxDays = MAX_DAYS, onRetire = null } = {}) {
  if (!fields || !fields.current || !fields.current.length) throw new Error('createSim: fields.current (tiles by month) required');
  if (predict && typeof featuresFn !== 'function') throw new Error('createSim: featuresFn required with predict');
  const windTile = wind || fields.wind || null;
  const m = allocMembers(budget);
  const drops = new Map(); // id -> {id, item, lon, lat, startDoy, seed, rng, day, schedule, nextLocal}; insertion = age order
  const fragments = new Map(); // id -> {id, dropId, local, item, sizeClass, parentId, bornDay, windage, noSplit}
  let nextDrop = 0;
  let stepping = false;
  const queued = []; // ops deferred while a step is in flight

  const curTile = (month) => fields.current[month % fields.current.length];
  const landAt = (month, lon, lat) => sample(curTile(month), lon, lat, 0) === null;
  const t0 = fields.current[0];
  const latMin = Math.max(-89.9, Math.min(t0.lat0, t0.lat0 + (t0.ny - 1) * t0.dlat));
  const latMax = Math.min(89.9, Math.max(t0.lat0, t0.lat0 + (t0.ny - 1) * t0.dlat));

  const sim = {
    usingFallback: !predict,
    members: m,
    drops,
    fragments,
    budget,
    maxDays,
    /** Days computed for that drop (its own clock), or -1 if unknown/retired. */
    ageOf: (dropId) => { const d = drops.get(dropId); return d ? d.day : -1; },
    doyOf: (dropId) => { const d = drops.get(dropId); return d ? d.startDoy + d.day : NaN; },
    isActive: () => { for (const d of drops.values()) if (d.day < maxDays) return true; return false; },
    /** Ids of drops still below maxDays, newest first. */
    activeDrops: () => [...drops.values()].filter((d) => d.day < maxDays).map((d) => d.id).reverse(),
    get stepping() { return stepping; },
    drop, step, stepDrop, retireDrop, clear,
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

  function doRetire(dropId, notify) {
    if (!drops.has(dropId)) return false;
    drops.delete(dropId);
    for (const [id, f] of fragments) if (f.dropId === dropId) fragments.delete(id);
    compact((i) => m.dropId[i] !== dropId);
    if (notify && onRetire) onRetire(dropId);
    return true;
  }

  /** Retire a drop now (or after the in-flight step). */
  function retireDrop(dropId) {
    if (stepping) { queued.push(() => doRetire(dropId, false)); return drops.has(dropId); }
    return doRetire(dropId, false);
  }

  function clear() {
    if (stepping) { queued.push(clear); return; }
    drops.clear(); fragments.clear(); m.count = 0;
  }

  /** Retire the oldest drops with id < olderThan until `need` more members fit. */
  function makeRoom(need, olderThan) {
    while (m.count + need > budget) {
      const oldest = drops.values().next().value; // Map keeps insertion (= age) order
      if (!oldest || oldest.id >= olderThan) break;
      doRetire(oldest.id, true);
    }
    return budget - m.count;
  }

  function newFragment(d, sizeClass, parentId, windage) {
    const local = d.nextLocal++;
    const f = { id: d.id * FRAG_STRIDE + local, dropId: d.id, local, item: d.item, sizeClass, parentId, bornDay: d.day, windage, noSplit: false };
    fragments.set(f.id, f);
    return f;
  }

  /**
   * Drop an item at (lon, lat) on 1-based day-of-year startDoy, with its own rng stream from
   * `seed` (default: drawn from sim rng). Latitude is clamped into the current field's range.
   * Returns the drop id at once; while a step is in flight the drop is applied after it.
   */
  function drop(item, lon, lat, startDoy = 1, seed = undefined) {
    if (!ITEMS.includes(item)) throw new Error(`drop: unknown item ${item}`);
    const id = nextDrop++;
    const s = seed === undefined ? Math.floor(rng() * 4294967296) : seed >>> 0;
    const apply = () => {
      const n = Math.min(ensemble, budget);
      makeRoom(n, id);
      const drng = rngFactory(s);
      const la = Math.max(latMin, Math.min(latMax, lat));
      const d = { id, item, lon: normLon(lon), lat: la, startDoy, seed: s, rng: drng, day: 0, schedule: fragmentSchedule(item, drng), nextLocal: 0 };
      drops.set(id, d);
      const cls = startClassOf(item);
      const f = newFragment(d, cls, -1, windageFor(item, cls));
      const it = ITEMS.indexOf(item), ci = SIZE_CLASSES.indexOf(cls);
      for (let k = 0; k < n; k++) {
        const i = m.count++;
        m.lon[i] = d.lon; m.lat[i] = la; m.item[i] = it; m.fragmentId[i] = f.id; m.dropId[i] = id;
        m.sizeClass[i] = ci; m.state[i] = STATE.floating; m.daysAtSea[i] = 0; m.daysBeached[i] = 0;
        m.distanceKm[i] = 0; m.bornDay[i] = 0; m.windage[i] = f.windage;
      }
    };
    if (stepping) queued.push(apply); else apply();
    return id;
  }

  function flush() {
    while (queued.length) queued.shift()();
  }

  /** Advance one drop by one day (no-op if it is retired or at maxDays). */
  async function stepDrop(dropId) {
    if (stepping) throw new Error('stepDrop: a step is already in flight');
    stepping = true;
    try {
      const d = drops.get(dropId);
      if (d && d.day < maxDays) await stepOne(d);
    } finally {
      stepping = false;
      flush();
    }
  }

  /** Advance every active drop by one day, newest first. */
  async function step() {
    if (stepping) throw new Error('step: a step is already in flight');
    stepping = true;
    try {
      for (const id of sim.activeDrops()) { const d = drops.get(id); if (d) await stepOne(d); }
    } finally {
      stepping = false;
      flush();
    }
  }

  async function stepOne(d) {
    const rng = d.rng, doy = d.startDoy + d.day, month = monthOfDoy(doy);
    const tile = curTile(month);
    // 1. Floating members of this drop, and (before any mutation) the model's prediction, so a
    //    failed inference leaves the state untouched for a retry.
    const idx = [];
    for (let i = 0; i < m.count; i++) if (m.dropId[i] === d.id && m.state[i] === STATE.floating) idx.push(i);
    const n = idx.length;
    let out = null;
    if (predict && n > 0) {
      const x = new Float32Array(10 * n);
      for (let k = 0; k < n; k++) {
        const i = idx[k];
        const c = sample(tile, m.lon[i], m.lat[i], 0) || [0, 0];
        const w = (windTile && sample(windTile, m.lon[i], m.lat[i], month % windTile.nframes)) || [0, 0];
        const r = featuresFn(m.lat[i], m.lon[i], c[0], c[1], w[0], w[1], doy, windageFeature(m.windage[i]), x, 10 * k);
        if (r && r !== x) x.set(r, 10 * k);
      }
      out = await predict(x, n);
    }
    // 2. Members beached at the start of the day: one more day on the beach, maybe resuspend in
    //    place (they float again from tomorrow).
    for (let i = 0; i < m.count; i++) {
      if (m.dropId[i] !== d.id || m.state[i] !== STATE.beached) continue;
      m.daysBeached[i] += 1;
      if (rng() < P_RESUSPEND) m.state[i] = STATE.floating;
    }
    // 3. Move floating members (beaching on land contact), then sink.
    for (let k = 0; k < n; k++) {
      const i = idx[k];
      const lon = m.lon[i], lat = m.lat[i];
      let next = null, dxKm = 0, dyKm = 0;
      if (out) {
        const [z1, z2] = gaussianPair(rng);
        dxKm = out.mu[2 * k] + Math.exp(out.logSigma[2 * k]) * z1;
        dyKm = out.mu[2 * k + 1] + Math.exp(out.logSigma[2 * k + 1]) * z2;
        const [dLon, dLat] = metersToDeg(dxKm * 1000, dyKm * 1000, lat);
        next = [normLon(lon + dLon), clampLat(lat + dLat)];
      } else {
        next = rk2Step((lo, la) => sample(tile, lo, la, 0), lon, lat, 86400);
        if (next) next[1] = clampLat(next[1]);
      }
      if (!next || !Number.isFinite(next[0]) || !Number.isFinite(next[1]) || landAt(month, next[0], next[1])) {
        if (rng() < P_BEACH) m.state[i] = STATE.beached; // beaches where it is
      } else {
        if (!out) { // fallback distance from the displacement in degrees
          dxKm = ((next[0] - lon + 540) % 360 - 180) * Math.PI / 180 * R_KM * Math.cos(lat * Math.PI / 180);
          dyKm = (next[1] - lat) * Math.PI / 180 * R_KM;
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
    d.day += 1;
    // 4. Fragmentation of this drop.
    fragmentDrop(d);
  }

  function fragmentDrop(d) {
    const pending = new Map();
    for (const f of fragments.values()) {
      if (f.dropId !== d.id || f.noSplit) continue;
      const ev = d.schedule.find((e) => e.parent === f.sizeClass);
      if (ev) pending.set(f.id, { f, ev, sum: 0, n: 0, sumAll: 0, nAll: 0 });
    }
    if (!pending.size) return;
    // Mean fragmentation clock over each fragment's surface (floating or beached) members; sunk
    // members' clocks are frozen, so they count only when all members are sunk.
    for (let i = 0; i < m.count; i++) {
      const p = pending.get(m.fragmentId[i]);
      if (!p) continue;
      const c = fragmentationClock(p.f.item, { daysAtSea: m.daysAtSea[i], daysBeached: m.daysBeached[i] });
      p.sumAll += c; p.nAll++;
      if (m.state[i] !== STATE.sunk) { p.sum += c; p.n++; }
    }
    for (const { f, ev, sum, n, sumAll, nAll } of pending.values()) {
      const clock = n ? sum / n : nAll ? sumAll / nAll : -Infinity;
      if (clock < ev.day || !fragments.has(f.id) || !drops.has(d.id)) continue;
      split(f, d, ev);
    }
  }

  function split(f, d, ev) {
    let pCount = 0;
    for (let i = 0; i < m.count; i++) if (m.fragmentId[i] === f.id) pCount++;
    const nKids = ev.children.length;
    // Room needed beyond the parent's own slots (the parent is retired after cloning). Only
    // drops older than this one may be retired for it.
    makeRoom(pCount * nKids - pCount, d.id);
    const free = budget - m.count + pCount;
    const per = Math.min(pCount, Math.floor(free / nKids));
    if (per < 1) { f.noSplit = true; return; }
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
        m.fragmentId[i] = kid.id; m.sizeClass[i] = ci; m.windage[i] = c.windage; m.bornDay[i] = d.day;
      }
    }
  }

  return sim;
}

/**
 * Fractions of a fragment's members by fate at its drop's current computed day:
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
