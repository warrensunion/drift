// Fate and sinking rules for Drift. Numbers from constants.js (docs/science.md section 3, 5).
import { CONSTANTS } from './constants.js';

const JSON_CLASS = { macro: 'macro', meso: 'meso', micro: 'micro', small: 'smallMicro' };

const wrapLon = (lon) => ((((lon + 180) % 360) + 360) % 360) - 180;

/** Name of the gyre box containing (lon, lat), or null. */
export function inGyre(lon, lat) {
  const x = wrapLon(lon);
  for (const g of CONSTANTS.gyres) {
    if (x >= g.lonMin && x <= g.lonMax && lat >= g.latMin && lat <= g.latMax) return g.name;
  }
  return null;
}

/**
 * Daily probability of sinking out of the surface layer: 1 - exp(-1/tau).
 * Floating pieces use the class tau (x gyreMultiplier inside a gyre); pieces denser than
 * seawater (floats:false) use tau = denserThanSeawater (1 d) everywhere.
 */
export function dailySinkProbability(sizeClass, { inGyre: gyre = false, floats = true } = {}) {
  const T = CONSTANTS.sinkTimescaleDays;
  if (!floats) return 1 - Math.exp(-1 / T.denserThanSeawater.value);
  const entry = T[JSON_CLASS[sizeClass]];
  if (!entry) throw new Error(`unknown size class: ${sizeClass}`);
  const tau = entry.value * (gyre ? T.gyreMultiplier.value : 1);
  return 1 - Math.exp(-1 / tau);
}

/**
 * member: { lon, lat, sunk?, beached? }; landAt: (lon, lat) => boolean (or a plain boolean).
 * Precedence: seafloor > coast > gyre > floating.
 */
export function fateOf(member, landAt) {
  if (member.sunk) return 'seafloor';
  const onLand = typeof landAt === 'function' ? landAt(member.lon, member.lat) : !!landAt;
  if (member.beached || onLand) return 'coast';
  if (inGyre(member.lon, member.lat)) return 'gyre';
  return 'floating';
}
