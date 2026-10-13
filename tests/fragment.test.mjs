import test from 'node:test';
import assert from 'node:assert/strict';
import { CONSTANTS } from '../src/sim/constants.js';
import {
  ITEMS, makeRng, fragmentSchedule, fragmentationClock, windageFor, windageFeature,
  startClassOf, floatsFor, SIZE_CLASSES,
} from '../src/sim/fragment.js';

const KEY = { bottle: 'bottle', bag: 'bag', line: 'fishingLine', tyre: 'tyreWear' };
const spec = (item) => CONSTANTS.items[KEY[item]];
const hl = (item, cls) => spec(item).halfLifeToNextSizeClassDays[cls].value;

test('ITEMS lists the four items', () => {
  assert.deepEqual([...ITEMS], ['bottle', 'bag', 'line', 'tyre']);
});

test('makeRng is deterministic and in [0,1)', () => {
  const a = makeRng(7), b = makeRng(7), c = makeRng(8);
  const xs = Array.from({ length: 50 }, a), ys = Array.from({ length: 50 }, b);
  assert.deepEqual(xs, ys);
  assert.ok(xs.every((x) => x >= 0 && x < 1));
  assert.notDeepEqual(xs, Array.from({ length: 50 }, c));
});

test('no fragmentation before each item onset', () => {
  for (const item of ['bottle', 'bag', 'line']) {
    const onset = spec(item).onsetDays.value;
    for (let seed = 1; seed <= 20; seed++) {
      const sched = fragmentSchedule(item, makeRng(seed));
      assert.ok(sched.length > 0, item);
      assert.ok(sched.every((e) => e.day >= onset), `${item} seed ${seed}`);
    }
  }
});

test('macro->micro day lies in range implied by JSON half-lives (bag, line)', () => {
  for (const item of ['bag', 'line']) {
    const onset = spec(item).onsetDays.value;
    const lo = onset + 0.5 * (hl(item, 'macro') + hl(item, 'meso'));
    const hi = onset + 1.5 * (hl(item, 'macro') + hl(item, 'meso'));
    for (let seed = 1; seed <= 50; seed++) {
      const sched = fragmentSchedule(item, makeRng(seed));
      const toMicro = sched.find((e) => e.parent === 'meso');
      assert.ok(toMicro.day >= lo && toMicro.day <= hi, `${item}: ${toMicro.day} not in [${lo},${hi}]`);
    }
  }
});

test('schedule is ordered, cascades macro->meso->micro->small, children per JSON/assumption', () => {
  const s = fragmentSchedule('bag', makeRng(3));
  assert.deepEqual(s.map((e) => e.parent), ['macro', 'meso', 'micro']);
  assert.deepEqual(s.map((e) => e.children[0].sizeClass), ['meso', 'micro', 'small']);
  assert.ok(s[0].day < s[1].day && s[1].day < s[2].day);
  for (const e of s) {
    assert.equal(e.children.length, CONSTANTS.childrenPerSplit.value);
    for (const ch of e.children) assert.equal(ch.windage, windageFor('bag', ch.sizeClass));
  }
});

test('same seed gives same schedule', () => {
  assert.deepEqual(fragmentSchedule('line', makeRng(5)), fragmentSchedule('line', makeRng(5)));
});

test('tyre starts small (per JSON smallMicro), never fragments, does not float', () => {
  assert.equal(CONSTANTS.items.tyreWear.startClass, 'smallMicro');
  assert.equal(startClassOf('tyre'), 'small');
  assert.deepEqual(fragmentSchedule('tyre', makeRng(1)), []);
  assert.equal(floatsFor('tyre', 'small'), false);
  assert.equal(floatsFor('line', 'macro'), false);
  assert.equal(floatsFor('bag', 'macro'), true);
  assert.equal(floatsFor('bag', 'small'), true);
  assert.equal(floatsFor('bottle', 'macro'), true);
  assert.equal(floatsFor('bottle', 'meso'), false);
});

test('size classes', () => {
  assert.deepEqual([...SIZE_CLASSES], ['macro', 'meso', 'micro', 'small']);
});

test('a beached bottle fragments before an at-sea bottle given the same rng', () => {
  const sched = fragmentSchedule('bottle', makeRng(11));
  const first = sched[0].day;
  const sea = fragmentationClock('bottle', { daysAtSea: first - 1, daysBeached: 0 });
  assert.ok(sea < first);
  // find the real day the schedule fires for each regime
  const dayFired = (perDayBeached) => {
    for (let d = 0; d < 20000; d++) {
      const clock = perDayBeached
        ? fragmentationClock('bottle', { daysAtSea: 0, daysBeached: d })
        : fragmentationClock('bottle', { daysAtSea: d, daysBeached: 0 });
      if (clock >= first) return d;
    }
    return Infinity;
  };
  assert.ok(dayFired(true) < dayFired(false));
  // beached onset is the JSON range lower bound (255 d) vs at-sea 5475 d
  assert.equal(dayFired(false), Math.ceil(first));
  const [lo] = CONSTANTS.items.bottle.onsetDays.range;
  assert.ok(dayFired(true) <= Math.ceil(first * lo / CONSTANTS.items.bottle.onsetDays.value) + 1);
});

test('clock: at-sea days count 1:1, zero exposure is zero', () => {
  assert.equal(fragmentationClock('bag', { daysAtSea: 100, daysBeached: 0 }), 100);
  assert.equal(fragmentationClock('bag', { daysAtSea: 0, daysBeached: 0 }), 0);
});

test('windageFeature anchors', () => {
  assert.equal(windageFeature(0.001), 0);
  assert.equal(windageFeature(0.01), 1);
  assert.equal(windageFeature(0.02), 1);
  assert.equal(windageFeature(0), 0);
  assert.ok(Math.abs(windageFeature(0.0055) - 0.5) < 1e-12);
});

test('windageFor reads the JSON', () => {
  assert.equal(windageFor('bottle', 'macro'), CONSTANTS.items.bottle.initialWindage.value);
  assert.equal(windageFor('bag', 'micro'), CONSTANTS.windageBySizeClass.filmOverride.value);
  assert.equal(windageFor('bag', 'small'), 0.01);
  assert.equal(windageFor('bottle', 'meso'), CONSTANTS.windageBySizeClass.meso.value);
  assert.equal(windageFor('bottle', 'micro'), CONSTANTS.windageBySizeClass.micro.value);
  assert.equal(windageFor('bottle', 'small'), CONSTANTS.windageBySizeClass.smallMicro.value);
  assert.equal(windageFor('line', 'macro'), 0);
  assert.equal(windageFor('tyre', 'small'), 0);
});
