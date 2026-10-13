// Salish Sea particle tracking (docs/science.md section 8). Pure module (worker + node tests).
//
// Each ensemble member moves hour by hour with SalishSeaCast's near-surface currents (midpoint RK2
// on the hourly frames, looping the 25-hour tidal cycle) plus a random walk dx = sqrt(2 K dt) N(0,1)
// per axis (K from CONSTANTS.salish). The drift model is not used here: it was trained on daily
// open-ocean steps and knows no tides. No windage either: there is no regional wind field.
// Grounding: a step that ends on land grounds the member where it is; a member in a coastal water
// cell grounds with probability 1 - exp(-dt / tau) per step (tau = grounding timescale). A member
// that crosses the grid edge has left the strait. Fragmentation is not modelled here: its timescales
// are years and this view runs 30 days.
import { CONSTANTS } from './constants.js';
import { sampleTime } from './field.js';
import { makeRng, startClassOf, SIZE_CLASSES } from './fragment.js';
import { metersToDeg } from './advect.js';

export const SALISH = Object.freeze({
  K: CONSTANTS.salish.diffusivityM2s.value,
  tauSeconds: CONSTANTS.salish.groundingTimescaleDays.value * 86400,
  dtSeconds: 3600,
  ensemble: 64,
  maxHours: 720,
  budget: 20000,
});

export const MEMBER = Object.freeze({ floating: 0, grounded: 1, left: 2 });
// Fate codes packed into snapshot meta (same 2-bit slot as the global FATES): floating 0,
// grounded -> 2 ('coast'), left -> 3 (drawn like the global 'seafloor': fades out where it left).
const FATE_CODE = [0, 2, 3];
const LAND = -32768;

let HOURS = null;
/** Snapshot hours: hourly 0..72, then every 6 hours to 720 (30 days). 181 snapshots. */
export function salishSnapshotHours() {
  if (HOURS) return HOURS;
  const out = [];
  for (let h = 0; h <= 72; h++) out.push(h);
  for (let h = 78; h <= SALISH.maxHours; h += 6) out.push(h);
  HOURS = Object.freeze(out);
  return HOURS;
}

/**
 * Environment for stepping: the hourly tidal tile (DRFT, regional), and the land mask (land.png:
 * width x height bytes, row 0 = north, >= 128 land) covering the same extent as the tile's cells.
 */
export function createSalishEnv({ tile, landMask, K = SALISH.K, tauSeconds = SALISH.tauSeconds, dtSeconds = SALISH.dtSeconds }) {
  const { nx, ny, lon0, lat0, dlon, dlat, data } = tile;
  const west = lon0 - dlon / 2, east = lon0 + (nx - 0.5) * dlon;
  const south = lat0 - dlat / 2, north = lat0 + (ny - 0.5) * dlat;
  const inside = (lon, lat) => lon >= west && lon < east && lat >= south && lat < north;
  const cellLand = (i, j) => i < 0 || j < 0 || i >= nx || j >= ny || data[2 * (j * nx + i)] === LAND;
  // Coastal water cells: water in the tile with land among its 8 neighbours.
  const coastal = new Uint8Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    if (cellLand(i, j)) continue;
    let c = 0;
    for (let dj = -1; dj <= 1 && !c; dj++) for (let di = -1; di <= 1; di++) {
      if ((di || dj) && i + di >= 0 && j + dj >= 0 && i + di < nx && j + dj < ny && cellLand(i + di, j + dj)) { c = 1; break; }
    }
    coastal[j * nx + i] = c;
  }
  const { width: mw, height: mh, data: md } = landMask;
  const stride = landMask.stride || 1;
  const isLand = (lon, lat) => {
    if (!inside(lon, lat)) return false;
    const x = Math.min(mw - 1, Math.floor((lon - west) / (east - west) * mw));
    const y = Math.min(mh - 1, Math.floor((north - lat) / (north - south) * mh));
    return md[(y * mw + x) * stride] >= 128;
  };
  const isCoastal = (lon, lat) => {
    const i = Math.round((lon - lon0) / dlon), j = Math.round((lat - lat0) / dlat);
    return i >= 0 && j >= 0 && i < nx && j < ny && coastal[j * nx + i] === 1;
  };
  // Velocity (m/s) at a time in hours since frame 0, or null outside the grid or next to land
  // (the bilinear sample needs four water corners).
  const velocity = (lon, lat, hour) => (inside(lon, lat) ? sampleTime(tile, lon, lat, hour) : null);
  return { inside, isLand, isCoastal, velocity, K, dt: dtSeconds, pGround: 1 - Math.exp(-dtSeconds / tauSeconds) };
}

function gauss(rng) {
  let u = 0;
  while (u <= 1e-12) u = rng();
  const v = rng();
  const r = Math.sqrt(-2 * Math.log(u));
  return [r * Math.cos(2 * Math.PI * v), r * Math.sin(2 * Math.PI * v)];
}

/** Advance one member {lon, lat, state, distanceKm} by one step starting at `hour`. Mutates it. */
export function stepMember(m, env, hour, rng) {
  if (m.state !== MEMBER.floating) return m;
  const { dt } = env;
  // Midpoint RK2 in time and space; Euler if the midpoint falls outside or next to land; no
  // current (random walk only) where the member itself sits next to land.
  const k1 = env.velocity(m.lon, m.lat, hour) || [0, 0];
  const [h1, h2] = metersToDeg(k1[0] * dt * 0.5, k1[1] * dt * 0.5, m.lat);
  const k2 = env.velocity(m.lon + h1, m.lat + h2, hour + 0.5) || k1;
  const s = Math.sqrt(2 * env.K * dt);
  const [z1, z2] = gauss(rng);
  const dx = k2[0] * dt + s * z1, dy = k2[1] * dt + s * z2;
  const [dLon, dLat] = metersToDeg(dx, dy, m.lat);
  const lon = m.lon + dLon, lat = m.lat + dLat;
  if (!env.inside(lon, lat)) {
    m.lon = lon; m.lat = lat; m.state = MEMBER.left;
    m.distanceKm += Math.hypot(dx, dy) / 1000;
    return m;
  }
  if (env.isLand(lon, lat)) { m.state = MEMBER.grounded; return m; } // grounds where it is
  m.lon = lon; m.lat = lat;
  m.distanceKm += Math.hypot(dx, dy) / 1000;
  if (env.isCoastal(lon, lat) && rng() < env.pGround) m.state = MEMBER.grounded;
  return m;
}

/**
 * The Salish simulation, with the same surface as ensemble.js's sim where the worker needs it:
 * drops, ageOf, activeDrops, drop, stepDrop, retireDrop, clear, usingFallback, members.count.
 * Ages are in hours (one step = one hour).
 */
export function createSalishSim({ tile, landMask, rngFactory = makeRng, K = SALISH.K, tauSeconds = SALISH.tauSeconds, ensemble = SALISH.ensemble, budget = SALISH.budget, maxHours = SALISH.maxHours, onRetire = null } = {}) {
  const env = createSalishEnv({ tile, landMask, K, tauSeconds });
  const drops = new Map();
  let nextDrop = 0;
  let total = 0;
  const retire = (id, notify) => {
    const d = drops.get(id);
    if (!d) return false;
    total -= d.members.length;
    drops.delete(id);
    if (notify && onRetire) onRetire(id);
    return true;
  };
  const sim = {
    usingFallback: false,
    drops,
    env,
    maxDays: maxHours,
    members: { get count() { return total; } },
    ageOf: (id) => { const d = drops.get(id); return d ? d.day : -1; },
    activeDrops: () => [...drops.values()].filter((d) => d.day < maxHours).map((d) => d.id).reverse(),
    isActive: () => [...drops.values()].some((d) => d.day < maxHours),
    setPredict() {},
    drop(item, lon, lat, startDoy = 1, seed = 1) {
      const id = nextDrop++;
      const n = Math.min(ensemble, budget);
      while (total + n > budget && drops.size) retire(drops.keys().next().value, true);
      const rng = rngFactory(seed >>> 0);
      const sizeClass = startClassOf(item);
      const members = Array.from({ length: n }, () => ({ lon, lat, state: MEMBER.floating, distanceKm: 0 }));
      drops.set(id, { id, item, lon, lat, startDoy, seed, rng, day: 0, members, sizeClass });
      total += n;
      return id;
    },
    stepDrop(id) {
      const d = drops.get(id);
      if (!d || d.day >= maxHours) return;
      for (const m of d.members) stepMember(m, env, d.day, d.rng);
      d.day += 1;
    },
    retireDrop: (id) => retire(id, false),
    clear() { drops.clear(); total = 0; },
  };
  return sim;
}

/** Pack one drop like snapshots.js's packSnapshot, but with Float32 lon/lat (the grid is ~700 m). */
export function packSalish(sim, dropId) {
  const d = sim.drops.get(dropId);
  const n = d ? d.members.length : 0;
  const positions = new Float32Array(2 * n);
  const meta = new Uint8Array(2 * n);
  const counts = [0, 0, 0];
  let dist = 0;
  const sizeIdx = d ? SIZE_CLASSES.indexOf(d.sizeClass) : 0;
  for (let k = 0; k < n; k++) {
    const m = d.members[k];
    positions[2 * k] = m.lon;
    positions[2 * k + 1] = m.lat;
    meta[2 * k] = 0;
    meta[2 * k + 1] = sizeIdx | (FATE_CODE[m.state] << 2);
    counts[m.state]++;
    dist += m.distanceKm;
  }
  const fragments = d ? [{
    id: dropId * 256, local: 0, sizeClass: d.sizeClass, parentId: -1, bornDay: 0, members: n,
    distanceKm: n ? dist / n : 0,
    fates: { floating: n ? counts[0] / n : 0, coast: n ? counts[1] / n : 0, left: n ? counts[2] / n : 0 },
  }] : [];
  return { positions, meta, fragments, count: n };
}
