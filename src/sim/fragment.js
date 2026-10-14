// Fragmentation rules for Drift. All numbers come from constants.js (docs/science.md),
// except childrenPerSplit (modelling assumption, flagged there) and the +-50 % jitter below.
import { CONSTANTS } from './constants.js';

export const ITEMS = Object.freeze(['bottle', 'bag', 'line', 'tyre']);
// Public size-class names. The JSON calls the smallest class "smallMicro".
export const SIZE_CLASSES = Object.freeze(['macro', 'meso', 'micro', 'small']);

const JSON_ITEM = { bottle: 'bottle', bag: 'bag', line: 'fishingLine', tyre: 'tyreWear' };
const JSON_CLASS = { macro: 'macro', meso: 'meso', micro: 'micro', small: 'smallMicro' };
const FROM_JSON_CLASS = { macro: 'macro', meso: 'meso', micro: 'micro', smallMicro: 'small' };

const spec = (item) => {
  const s = CONSTANTS.items[JSON_ITEM[item]];
  if (!s) throw new Error(`unknown item: ${item}`);
  return s;
};

/** mulberry32: deterministic seeded generator returning floats in [0,1). */
export function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const startClassOf = (item) => FROM_JSON_CLASS[spec(item).startClass];

/** Does a piece of this item at this size class float? (macro: the item; below: its fragments) */
export function floatsFor(item, sizeClass) {
  const s = spec(item);
  return (sizeClass === startClassOf(item) ? s.floats : s.fragmentsFloat).value;
}

/**
 * Onset used when beached. The JSON gives a range only for the bottle (onsetDays.range =
 * [255, 5475]); its lower bound (255 d, beached polyolefin, Song2017) is the documented
 * beached onset, so we use it for every item, capped by the item's own at-sea onset.
 */
const BEACHED_ONSET_DAYS = CONSTANTS.items.bottle.onsetDays.range[0];
export const onsetDaysAtSea = (item) => spec(item).onsetDays.value;
export const onsetDaysBeached = (item) => Math.min(onsetDaysAtSea(item), BEACHED_ONSET_DAYS);

/**
 * Effective fragmentation clock ("at-sea-equivalent days"). The schedule from fragmentSchedule
 * is expressed in at-sea days; a beached day advances the clock by onsetAtSea/onsetBeached
 * (e.g. 5475/255 = 21.5 for a bottle) because beaching shortens the onset by that factor.
 * Fire every schedule event whose day <= this value. The factor scales the whole timetable,
 * not only the onset (so later splits are accelerated equally).
 */
export function fragmentationClock(item, { daysAtSea = 0, daysBeached = 0 }) {
  const atSea = onsetDaysAtSea(item);
  const factor = atSea === 0 ? 1 : atSea / onsetDaysBeached(item);
  return daysAtSea + daysBeached * factor;
}

/**
 * One lineage's fragmentation timetable, in at-sea days. The first split happens a half-life
 * (jittered) after the onset; each later split a half-life of the parent class after the
 * previous one. Jitter is uniform in [0.5, 1.5] x half-life (mean = half-life; modelling choice).
 * Every split yields childrenPerSplit children one class smaller. Not clipped to the 10-year
 * horizon: the caller compares against fragmentationClock().
 */
export function fragmentSchedule(item, rng) {
  const s = spec(item);
  const out = [];
  let cls = startClassOf(item);
  let day = s.onsetDays.value;
  let i = SIZE_CLASSES.indexOf(cls);
  while (i < SIZE_CLASSES.length - 1) {
    const hl = s.halfLifeToNextSizeClassDays[JSON_CLASS[SIZE_CLASSES[i]]];
    if (!hl) break;
    day += hl.value * (0.5 + rng());
    const child = SIZE_CLASSES[i + 1];
    out.push({
      day,
      parent: SIZE_CLASSES[i],
      children: Array.from({ length: CONSTANTS.childrenPerSplit.value }, () => ({
        sizeClass: child,
        windage: windageFor(item, child),
      })),
    });
    i++;
  }
  return out;
}

/** Physical windage fraction (0.02 = 2 %). Sinking items (zero initial windage, fragments sink) get 0. */
export function windageFor(item, sizeClass) {
  const s = spec(item);
  if (item === 'bag') return CONSTANTS.windageBySizeClass.filmOverride.value;
  if (!s.fragmentsFloat.value && s.initialWindage.value === 0) return 0;
  if (sizeClass === 'macro') return s.initialWindage.value;
  return CONSTANTS.windageBySizeClass[JSON_CLASS[sizeClass]].value;
}

/** Model input 0..1 from physical windage: drogued slip 0.1 % -> 0, undrogued slip 1 % -> 1. */
export function windageFeature(w) {
  const f = (w - 0.001) / (0.01 - 0.001);
  return Math.min(1, Math.max(0, f));
}
