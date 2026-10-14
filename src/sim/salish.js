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

/** land.png values: 0 water, 255 land, 128 outside the model domain (open boundaries). */
export const MASK = Object.freeze({ water: 0, outside: 128, land: 255 });

/**
 * Bilinear sample of a regional DRFT tile over its water corners only: corners on land or with
 * no data drop out and the remaining weights are renormalised, so a member next to the coast
 * still feels the current instead of a zero-current band. Null outside the grid or when all four
 * corners are dry. Returns [u, v] in m/s.
 */
export function sampleWater(tile, lon, lat, frame = 0) {
  const { nx, ny, lon0, lat0, dlon, dlat, scale, data } = tile;
  const fx = (lon - lon0) / dlon, fy = (lat - lat0) / dlat;
  if (!(fx >= -0.5 && fx <= nx - 0.5 && fy >= -0.5 && fy <= ny - 0.5)) return null;
  const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
  const base = frame * nx * ny * 2;
  let u = 0, v = 0, w = 0;
  for (let k = 0; k < 4; k++) {
    const x = x0 + (k & 1), y = y0 + (k >> 1);
    if (x < 0 || y < 0 || x >= nx || y >= ny) continue;
    const i = base + (y * nx + x) * 2;
    if (data[i] === LAND || data[i + 1] === LAND) continue;
    const wk = (k & 1 ? tx : 1 - tx) * (k >> 1 ? ty : 1 - ty);
    if (wk <= 0) continue;
    u += data[i] * wk; v += data[i + 1] * wk; w += wk;
  }
  if (!(w > 1e-9)) return null;
  return [(u / w) * scale, (v / w) * scale];
}

/** sampleWater at a time t in frames, looping the tile's frames and blending the two around t. */
export function sampleWaterTime(tile, lon, lat, t) {
  const n = tile.nframes;
  const tw = ((t % n) + n) % n;
  const f0 = Math.floor(tw) % n, f1 = (f0 + 1) % n, w = tw - Math.floor(tw);
  const a = sampleWater(tile, lon, lat, f0);
  if (!a || w === 0) return a;
  const b = sampleWater(tile, lon, lat, f1);
  if (!b) return a;
  return [a[0] * (1 - w) + b[0] * w, a[1] * (1 - w) + b[1] * w];
}

/**
 * Environment for stepping: the hourly tidal tile (DRFT, regional; its header gives the extent)
 * and the land mask (land.png: width x height bytes, row 0 = north, values as MASK) covering the
 * same extent as the tile's cells.
 */
export function createSalishEnv({ tile, landMask, K = SALISH.K, tauSeconds = SALISH.tauSeconds, dtSeconds = SALISH.dtSeconds }) {
  const { nx, ny, lon0, lat0, dlon, dlat } = tile;
  const west = lon0 - dlon / 2, east = lon0 + (nx - 0.5) * dlon;
  const south = lat0 - dlat / 2, north = lat0 + (ny - 0.5) * dlat;
  const inside = (lon, lat) => lon >= west && lon < east && lat >= south && lat < north;
  const { width: mw, height: mh, data: md } = landMask;
  const stride = landMask.stride || 1;
  const maskAt = (lon, lat) => {
    const x = Math.min(mw - 1, Math.max(0, Math.floor((lon - west) / (east - west) * mw)));
    const y = Math.min(mh - 1, Math.max(0, Math.floor((north - lat) / (north - south) * mh)));
    return md[(y * mw + x) * stride];
  };
  const isLand = (lon, lat) => inside(lon, lat) && maskAt(lon, lat) >= 192;
  const isOutside = (lon, lat) => !inside(lon, lat) || (maskAt(lon, lat) >= 64 && maskAt(lon, lat) < 192);
  // Coastal water cells: water at the cell centre with land (not "outside the model") at one of
  // its 8 neighbours' centres.
  const centre = (i, j) => maskAt(lon0 + i * dlon, lat0 + j * dlat);
  const coastal = new Uint8Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    if (centre(i, j) >= 64) continue;
    let c = 0;
    for (let dj = -1; dj <= 1 && !c; dj++) for (let di = -1; di <= 1; di++) {
      if ((di || dj) && i + di >= 0 && j + dj >= 0 && i + di < nx && j + dj < ny && centre(i + di, j + dj) >= 192) { c = 1; break; }
    }
    coastal[j * nx + i] = c;
  }
  const isCoastal = (lon, lat) => {
    const i = Math.round((lon - lon0) / dlon), j = Math.round((lat - lat0) / dlat);
    return i >= 0 && j >= 0 && i < nx && j < ny && coastal[j * nx + i] === 1;
  };
  // Velocity (m/s) at a time in hours since frame 0 (land-aware bilinear), or null outside the
  // grid or where all four corners are dry.
  const velocity = (lon, lat, hour) => (inside(lon, lat) ? sampleWaterTime(tile, lon, lat, hour) : null);
  return { inside, isLand, isOutside, isCoastal, velocity, K, dt: dtSeconds, pGround: 1 - Math.exp(-dtSeconds / tauSeconds) };
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
  // Midpoint RK2 in time and space (the midpoint is dt/2 later); Euler if the midpoint has no
  // water corner; random walk only where the member itself has none (inside land cells).
  const k1 = env.velocity(m.lon, m.lat, hour) || [0, 0];
  const [h1, h2] = metersToDeg(k1[0] * dt * 0.5, k1[1] * dt * 0.5, m.lat);
  const k2 = env.velocity(m.lon + h1, m.lat + h2, hour + dt / 7200) || k1;
  const s = Math.sqrt(2 * env.K * dt);
  const [z1, z2] = gauss(rng);
  const dx = k2[0] * dt + s * z1, dy = k2[1] * dt + s * z2;
  const [dLon, dLat] = metersToDeg(dx, dy, m.lat);
  const lon = m.lon + dLon, lat = m.lat + dLat;
  if (env.isOutside(lon, lat)) { // past the grid edge or into the area outside the model domain
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
      d.day += env.dt / 3600; // ages are in hours
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
