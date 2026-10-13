// The memorable element: chapter headlines in Anybody that break into fragments and drift apart.
// Each letter is drawn three times, each copy clipped to one shard of the glyph (two random cut
// lines across the letter). While whole, the shards line up exactly; as `f` rises they separate,
// turn and fade, and the whole line narrows on Anybody's width axis (125 -> 60).

import { clamp01, smoothstep } from './ease.js';

const WDTH_WHOLE = 125;
const WDTH_BROKEN = 60;

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

/** Two cut lines across a letter -> three clip polygons (top, middle, bottom shard). */
function shardPolys(r) {
  const a = 28 + r() * 16, b = 28 + r() * 16; // first cut, left and right edge (% of height)
  const c = 58 + r() * 16, d = 58 + r() * 16; // second cut
  // Overshoot the box so overhanging glyph parts are never clipped away.
  const L = -30, R = 130, T = -40, B = 140;
  return [
    `polygon(${L}% ${T}%, ${R}% ${T}%, ${R}% ${b}%, ${L}% ${a}%)`,
    `polygon(${L}% ${a}%, ${R}% ${b}%, ${R}% ${d}%, ${L}% ${c}%)`,
    `polygon(${L}% ${c}%, ${R}% ${d}%, ${R}% ${B}%, ${L}% ${B}%)`,
  ];
}

/**
 * createHeadline(el, text, {seed, reduced}) -> {set(f)}
 * f = 0 whole, 1 fully broken and gone.
 */
export function createHeadline(el, text, { seed = 1, reduced = false } = {}) {
  el.setAttribute('aria-label', text);
  el.textContent = '';
  if (reduced) {
    const span = document.createElement('span');
    span.textContent = text;
    span.setAttribute('aria-hidden', 'true');
    el.append(span);
    return { set() {}, el };
  }

  const r = rng(seed * 7919);
  const pieces = [];
  const letters = [];
  const words = text.split(' ');
  words.forEach((word, wi) => {
    const w = document.createElement('span');
    w.className = 'hl-word';
    w.setAttribute('aria-hidden', 'true');
    for (const ch of word) {
      const letter = document.createElement('span');
      letter.className = 'hl-letter';
      const polys = shardPolys(r);
      const delay = r() * 0.45; // letters let go at different moments
      const L = { el: letter, polys: [], shards: [], broken: null };
      letters.push(L);
      polys.forEach((poly, k) => {
        const p = document.createElement('span');
        p.className = k === 0 ? 'hl-shard hl-shard--flow' : 'hl-shard';
        p.textContent = ch;
        letter.append(p);
        L.polys.push(poly);
        L.shards.push(p);
        const up = k === 0 ? 1.25 : k === 1 ? 0.9 : 0.6; // top shards rise most
        pieces.push({
          el: p,
          letter: L,
          delay,
          dx: (r() - 0.35) * 150, // a slight drift to the right, like the current
          dy: -(30 + r() * 120) * up,
          rot: (r() - 0.5) * 50,
          spin: 0.6 + r() * 0.8,
        });
      });
      w.append(letter);
    }
    el.append(w);
    if (wi < words.length - 1) el.append(document.createTextNode(' '));
  });

  // While a letter is whole it is drawn once, unclipped (no hairline seams between shards).
  function setBroken(L, on) {
    if (L.broken === on) return;
    L.broken = on;
    L.shards.forEach((sh, k) => {
      sh.style.clipPath = on ? L.polys[k] : '';
      if (k > 0) sh.style.visibility = on ? '' : 'hidden';
    });
  }
  letters.forEach((L) => setBroken(L, false));

  let last = -1;
  function set(f) {
    f = clamp01(f);
    if (Math.abs(f - last) < 0.0005) return;
    last = f;
    el.style.fontVariationSettings = `'wdth' ${(WDTH_WHOLE + (WDTH_BROKEN - WDTH_WHOLE) * smoothstep(0, 0.8, f)).toFixed(1)}`;
    for (const L of letters) L.any = false;
    for (const p of pieces) {
      const g = clamp01((f - p.delay * 0.6) / (1 - p.delay * 0.6));
      if (g > 0) p.letter.any = true;
      if (g <= 0) {
        if (p.on !== false) { p.el.style.transform = ''; p.el.style.opacity = ''; p.on = false; }
        continue;
      }
      p.on = true;
      const e = g * g * (3 - 2 * g);
      // A hairline separation appears first, then the pieces drift.
      const sep = Math.min(g * 6, 1) * 2;
      p.el.style.transform = `translate3d(${(p.dx * e).toFixed(1)}px, ${(p.dy * e - sep).toFixed(1)}px, 0) rotate(${(p.rot * e * p.spin).toFixed(2)}deg)`;
      p.el.style.opacity = (1 - smoothstep(0.45, 1, g)).toFixed(3);
    }
    for (const L of letters) setBroken(L, L.any);
  }
  return { set, el };
}
