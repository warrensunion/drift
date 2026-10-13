// The six chapters: copy, depth layers, particles and the sweep that leads into each one.
// buildScene() turns a chapter into DOM and returns the per-frame update the scroll controller calls.

import { cite } from './sources.js';
import { createHeadline } from './headline.js';
import { createParticles, splinePath } from './particles.js';
import { resolveArt, preferSmall, decodeImg } from './assets.js';
import { smoothstep, clamp01, ease } from './ease.js';

const range = (name, n) => Array.from({ length: n }, (_, i) => `frag/${name}-${i + 1}.webp`);
const SHARD = range('shard', 8);
const FILM = range('film', 8);
const NURDLE = range('nurdles', 12);
const FIBRE = range('fibres', 8);

/**
 * Depth bands. px: share of cursor travel (measured makemepulse: background +2 %, pivot 0,
 * foreground -3 %, frame-edge -11 %). sy: share of the viewport height a layer drifts while you
 * scroll through the chapter (nearer layers drift more).
 */
export const DEPTH = {
  bg: { px: 0.02, sy: 0.03 },
  far: { px: 0.012, sy: 0.05 },
  mid: { px: 0, sy: 0.08 },
  near: { px: -0.015, sy: 0.13 },
  fg: { px: -0.03, sy: 0.2 },
  edge: { px: -0.11, sy: 0.34 },
};

const STREAM = [[0.6, -0.04], [0.7, 0.14], [0.64, 0.33], [0.79, 0.52], [0.66, 0.72], [0.52, 0.88], [0.44, 1.06]];

export const CHAPTERS = [
  {
    id: 'bottle',
    title: 'One bottle',
    sweep: 'reeds', // the sweep that carries you OUT of this chapter into the next
    copy: [
      'This is one bottle. It slipped off a riverbank with its cap screwed on, and the air inside keeps it afloat. The river does the rest, carrying it down toward the sea.',
      `How long will it last? You may have heard 450 years. Researchers who checked 57 public infographics of plastic lifetimes could not find a credible scientific source behind them.${cite('WardReddy2020')}`,
      'So this story keeps to what has been measured, and says so where nobody knows.',
    ],
    layers: [
      { cls: 'sky', src: 's1-sky.webp', small: 's1-sky-1280.webp', depth: 'bg', plate: true },
      { cls: 'rays', src: 's3-rays.webp', depth: 'bg' },
      { cls: 'hills', src: 's1-hills.webp', depth: 'far' },
      { cls: 'river', src: 's1-river.webp', depth: 'mid', plate: true },
      { cls: 'under', depth: 'mid', html: '<i class="under__light"></i><i class="under__line"></i>' },
      { cls: 'weed', src: 's1-reeds.webp', depth: 'near' },
      { cls: 'bubbles', depth: 'near', particles: { mode: 'rise', count: 26, size: [0.25, 0.9], speed: 0.07, box: [0.5, 0.66, 0.14, 0.3], cls: 'pt--bubble', opacity: [0.35, 0.8] } },
      { cls: 'bank', src: 's1-bank.webp', depth: 'near' },
      {
        cls: 'bottle', src: 'asset-bottle.webp', depth: 'near',
        move: (t, time) => ({ x: -t * 2.5, y: smoothstep(0.1, 0.9, t) * 9 + Math.sin(time * 0.9) * 0.4, r: -58 - smoothstep(0.1, 0.9, t) * 30 + Math.sin(time * 0.7) * 2, unit: 'vh' }),
      },
      { cls: 'reeds-l', src: 's1-reeds.webp', depth: 'fg' },
      { cls: 'reeds-r', src: 's1-reeds.webp', depth: 'edge' },
    ],
  },
  {
    id: 'breaks',
    title: 'It breaks',
    sweep: 'wave',
    copy: [
      `Floating at sea, a bottle changes slowly. Bottles recovered from the seafloor stayed chemically sound for about 15 years.${cite('Ioakeimidis2016')}`,
      `The breaking happens mostly on shore, where sunlight, heat and sand work together. In a lab, a polypropylene pellet given a year of strong UV, roughly four years of real sun, and then two months of tumbling in sand split into about 6,000 pieces.${cite('Song2017')}`,
      'No one has timed this for a bottle on a real beach, so the timing here is uncertain, and the simulation says so.',
    ],
    layers: [
      { cls: 'sky2', depth: 'bg', html: '<i class="sun"></i>' },
      { cls: 'clouds-far', src: 's3-clouds.webp', depth: 'bg' },
      { cls: 'isle', src: 's1-hills.webp', depth: 'far' },
      { cls: 'sea', src: 's3-ocean.webp', small: 's3-ocean-1280.webp', depth: 'far', plate: true },
      { cls: 'underwater', src: 's2-surface.webp', small: 's2-surface-1280.webp', depth: 'mid', plate: true },
      { cls: 'rays2', src: 's3-rays.webp', depth: 'mid' },
      { cls: 'sand', depth: 'near', html: '<i class="sand__lip"></i>' },
      { cls: 'specks', depth: 'near', particles: { mode: 'cascade', count: 70, size: [0.2, 0.6], speed: 0.05, from: [0.24, 0.3], to: [0.9, 0.98], spreadAt: 0.3, cls: 'pt--speck', reveal: (t) => 0.3 + 0.7 * smoothstep(0.05, 0.65, t) } },
      { cls: 'wave', src: 's2-wave.webp', depth: 'near' },
      {
        cls: 'bottle2', src: 'asset-bottle.webp', depth: 'near',
        move: (t, time) => ({ x: Math.sin(time * 0.6) * 0.4, y: Math.sin(time * 0.8) * 0.6, r: -104 + Math.sin(time * 0.5) * 3, o: 1 - 0.55 * smoothstep(0.2, 0.9, t), unit: 'vh' }),
      },
      { cls: 'shards', depth: 'fg', particles: { mode: 'cascade', count: 30, size: [1.4, 7.5], speed: 0.035, spin: 90, from: [0.24, 0.3], to: [0.84, 0.96], spreadAt: 0.26, srcs: [...SHARD, ...SHARD, ...FILM.slice(0, 3), ...NURDLE.slice(0, 4)], reveal: (t) => 0.35 + 0.65 * smoothstep(0.05, 0.7, t) } },
      { cls: 'edge-shard', src: 'frag/shard-1.webp', depth: 'edge' },
      { cls: 'edge-film', src: 'frag/film-5.webp', depth: 'edge' },
    ],
  },
  {
    id: 'currents',
    title: 'The currents carry it',
    sweep: 'cloud',
    copy: [
      'A high tide lifts the pieces back off the beach. Now the surface currents take over, and the wind pushes whatever rides high in the water.',
      `Most of it never gets far. In a global simulation, at least 77 % of floating plastic was on a beach or within 10 km of one after five years.${cite('Onink2021')}`,
      `What escapes can cross an ocean. After the 2011 tsunami in Japan, the debris that caught the most wind reached North America within the first year.${cite('Maximenko2018')}`,
    ],
    layers: [
      { cls: 'ocean', src: 's3-ocean.webp', small: 's3-ocean-1280.webp', depth: 'bg', plate: true },
      { cls: 'rays3', src: 's3-rays.webp', depth: 'bg' },
      { cls: 'clouds-top', src: 's3-clouds.webp', depth: 'far' },
      { cls: 'streams', depth: 'mid', svg: 'streams' },
      { cls: 'drift', depth: 'mid', particles: { mode: 'stream', count: 48, size: [0.6, 3.4], speed: 0.022, width: 0.035, points: STREAM, srcs: [...NURDLE, ...FILM, ...SHARD, ...FIBRE.slice(0, 3)] } },
      { cls: 'bird', src: 'life-albatross.webp', depth: 'near', move: (t, time) => ({ x: -8 + t * 22 + Math.sin(time * 0.3) * 0.6, y: -t * 6 + Math.sin(time * 0.9) * 0.5, r: -6 + Math.sin(time * 0.4) * 2, unit: 'vw' }) },
      { cls: 'clouds-bl', src: 's3-clouds.webp', depth: 'edge' },
      { cls: 'clouds-br', src: 's3-clouds.webp', depth: 'edge' },
    ],
  },
  {
    id: 'gyre',
    title: 'Gyres collect it',
    sweep: 'bubbles',
    copy: [
      `In the middle of each ocean basin the currents turn in a slow, wide circle. Floating debris gathers where they meet, in five subtropical gyres.${cite('Maximenko2012')}`,
      `The one in the North Pacific holds an estimated 79,000 tonnes across 1.6 million km². Microplastics are 94 % of its pieces but only 8 % of its weight; fishing nets are at least 46 %.${cite('Lebreton2018')}`,
    ],
    layers: [
      { cls: 'water4', depth: 'bg', bg: 'ui-water.webp' },
      { cls: 'gyre-ghost', src: 's4-gyre.webp', depth: 'bg', inner: 'spin-slow' },
      { cls: 'gyre', src: 's4-gyre.webp', depth: 'mid', inner: 'spin' },
      { cls: 'rays4', src: 's3-rays.webp', depth: 'far' },
      { cls: 'spiral', depth: 'mid', particles: { mode: 'spiral', count: 96, size: [0.4, 2.8], speed: 0.018, center: [0.66, 0.5], radius: 0.62, turns: 2.4, squash: 1.15, srcs: [...NURDLE, ...SHARD, ...FILM, ...FIBRE] } },
      { cls: 'edge-film4', src: 'frag/film-3.webp', depth: 'edge' },
      { cls: 'edge-shard4', src: 'frag/shard-4.webp', depth: 'edge' },
    ],
  },
  {
    id: 'deep',
    title: 'The deep and the food chain',
    sweep: 'snow',
    copy: [
      `Small pieces grow a skin of algae and sink. Tethered in a bay, plastic pieces reached an even chance of sinking after 17 to 66 days, the smallest first.${cite('FazeyRyan2016')}`,
      `Far more plastic lies on the seafloor than floats.${cite('Eriksen2014', 'Barrett2020')} A bag has been found 10,898 m down in the Mariana Trench,${cite('Chiba2018')} and 65 of 90 amphipods from six of the deepest trenches had eaten synthetic particles.${cite('Jamieson2019')}`,
      `Near the surface, 59 % of the seabird species studied between 1962 and 2012 had swallowed plastic.${cite('Wilcox2015')}`,
    ],
    layers: [
      { cls: 'deep', src: 's5-deep.webp', small: 's5-deep-1280.webp', depth: 'bg', plate: true },
      { cls: 'rays5', src: 's3-rays.webp', depth: 'bg' },
      { cls: 'whale', src: 'life-whale.webp', depth: 'far', move: (t, time) => ({ x: -t * 8 + Math.sin(time * 0.15) * 1, y: Math.sin(time * 0.25) * 0.8, r: 0, unit: 'vw' }) },
      { cls: 'snow-back', depth: 'far', bg: 's5-snow.webp' },
      { cls: 'fish', src: 'life-fish.webp', depth: 'mid', move: (t, time) => ({ x: -t * 6 + Math.sin(time * 0.5) * 0.6, y: Math.sin(time * 0.7) * 0.6, r: Math.sin(time * 0.4) * 1.2, unit: 'vw' }) },
      { cls: 'turtle', src: 'life-turtle.webp', depth: 'near', move: (t, time) => ({ x: -t * 10 + Math.sin(time * 0.35) * 0.5, y: t * 3 + Math.sin(time * 0.6) * 0.8, r: Math.sin(time * 0.5) * 2, unit: 'vw' }) },
      { cls: 'sinking', depth: 'near', particles: { mode: 'sink', count: 36, size: [0.5, 2.4], speed: 0.03, box: [0.34, -0.1, 0.66, 1.2], srcs: [...SHARD, ...FILM, ...NURDLE, ...FIBRE] } },
      { cls: 'jelly', src: 'life-jelly.webp', depth: 'fg', move: (t, time) => ({ x: 0, y: -t * 8 + Math.sin(time * 0.8) * 1.2, r: Math.sin(time * 0.6) * 2, unit: 'vh' }) },
      { cls: 'snow-front', depth: 'edge', bg: 's5-snow.webp' },
    ],
  },
  {
    id: 'yours',
    title: 'Drop your own',
    sweep: null,
    copy: [
      'One bottle told as one line is too neat. The honest picture is a cloud of possible paths.',
      'Drop a bottle, a bag, a fishing line or tyre dust anywhere in the ocean and watch ten simulated years unfold, moved by a small model trained on real drifting buoys.',
      'It is a simulation with uncertainty, not a forecast.',
    ],
    cta: true,
    layers: [
      { cls: 'night', depth: 'bg', bg: 'ui-water.webp' },
      { cls: 'rays6', src: 's3-rays.webp', depth: 'bg' },
      { cls: 'limb', depth: 'far' },
      { cls: 'item item--bag', src: 'item-bag.webp', depth: 'mid', move: (t, time) => ({ x: Math.sin(time * 0.3) * 0.5, y: -t * 4 + Math.sin(time * 0.5) * 0.8, r: -8 + Math.sin(time * 0.4) * 4, unit: 'vh' }) },
      { cls: 'item item--line', src: 'item-line.webp', depth: 'mid', move: (t, time) => ({ x: Math.sin(time * 0.25 + 1) * 0.5, y: -t * 3 + Math.sin(time * 0.45 + 1) * 0.8, r: 6 + Math.sin(time * 0.35) * 3, unit: 'vh' }) },
      { cls: 'item item--tyre', src: 'item-tyre.webp', depth: 'near', move: (t, time) => ({ x: Math.sin(time * 0.28 + 2) * 0.5, y: -t * 6 + Math.sin(time * 0.55 + 2) * 0.8, r: 10 + Math.sin(time * 0.3) * 3, unit: 'vh' }) },
      { cls: 'item item--bottle', src: 'asset-bottle.webp', depth: 'near', move: (t, time) => ({ x: Math.sin(time * 0.32 + 3) * 0.5, y: -t * 7 + Math.sin(time * 0.5 + 3) * 0.8, r: -30 + Math.sin(time * 0.4) * 4, unit: 'vh' }) },
      { cls: 'motes', depth: 'fg', particles: { mode: 'float', count: 28, size: [0.4, 1.8], box: [0.42, 0.08, 0.56, 0.84], srcs: [...NURDLE, ...SHARD.slice(0, 4), ...FILM.slice(0, 3)] } },
      { cls: 'snow-front6', depth: 'edge', bg: 's5-snow.webp' },
    ],
  },
];

/** Every art file a chapter needs (for preloading and progress), picking -1280 plates on small screens. */
export function chapterFiles(ch, small = preferSmall()) {
  const files = new Set();
  for (const l of ch.layers) {
    if (l.src) files.add(small && l.small ? l.small : l.src);
    if (l.bg) files.add(l.bg);
    if (l.particles && l.particles.srcs) l.particles.srcs.forEach((s) => files.add(s));
  }
  return [...files];
}

function streamsSvg(layer) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('streams__svg');
  const lines = [];
  const offsets = [[-0.07, 0.0, 0.35], [-0.04, 0.01, 0.55], [-0.015, 0, 0.9], [0.015, -0.005, 0.7], [0.045, 0.01, 0.5], [0.08, 0, 0.3], [0.11, 0.01, 0.2]];
  offsets.forEach(([ox, oy, a], i) => {
    const p = document.createElementNS(ns, 'path');
    p.setAttribute('class', `stream stream--${i % 3}`);
    p.style.opacity = a;
    svg.append(p);
    lines.push({ p, off: [ox, oy] });
  });
  layer.append(svg);
  return {
    resize(w, h) {
      svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
      for (const l of lines) l.p.setAttribute('d', splinePath(STREAM, w, h, l.off));
    },
  };
}

/**
 * buildScene(chapter, index, {reduced, phone}) -> scene controller.
 */
export function buildScene(ch, index, { reduced = false, phone = false } = {}) {
  const el = document.createElement('section');
  el.className = `scene scene--${ch.id}`;
  el.dataset.index = String(index);
  el.setAttribute('aria-labelledby', `hl-${ch.id}`);

  const art = document.createElement('div');
  art.className = 'scene__art';
  art.setAttribute('aria-hidden', 'true');
  el.append(art);

  const small = preferSmall();
  const layers = [];
  const imgs = [];
  const bgEls = [];
  const systems = [];
  const svgs = [];
  ch.layers.forEach((spec, li) => {
    if (phone && spec.phoneHide) return;
    const d = DEPTH[spec.depth] || DEPTH.mid;
    const layer = document.createElement('div');
    layer.className = `layer ${spec.cls.split(' ').map((c) => `l-${c}`).join(' ')}`;
    if (spec.html) layer.innerHTML = spec.html;
    let target = layer;
    if (spec.inner) {
      target = document.createElement('div');
      target.className = `inner ${spec.inner}`;
      layer.append(target);
    }
    if (spec.src) {
      const img = document.createElement('img');
      img.alt = '';
      img.decoding = 'async';
      img.draggable = false;
      img.className = spec.plate ? 'art art--plate' : 'art';
      img.dataset.src = small && spec.small ? spec.small : spec.src;
      target.append(img);
      imgs.push(img);
    }
    if (spec.bg) {
      const field = document.createElement('div');
      field.className = 'bgfield';
      layer.append(field);
      bgEls.push({ el: field, file: spec.bg });
    }
    if (spec.svg === 'streams') svgs.push(streamsSvg(layer));
    if (spec.particles) systems.push(createParticles(layer, spec.particles, { phone, reduced, seed: index * 31 + li + 1 }));
    art.append(layer);
    layers.push({ el: layer, spec, d, last: '' });
  });

  // Copy column
  const copy = document.createElement('div');
  copy.className = 'copy';
  const hl = document.createElement('h2');
  hl.className = 'hl';
  hl.id = `hl-${ch.id}`;
  copy.append(hl);
  const body = document.createElement('div');
  body.className = 'copy__body';
  body.innerHTML = ch.copy.map((p) => `<p>${p}</p>`).join('');
  if (ch.cta) {
    const a = document.createElement('a');
    a.className = 'cta';
    a.href = '#globe';
    a.dataset.cursor = 'Drop';
    a.innerHTML = '<span class="cta__label">Drop your own</span><span class="cta__arrow" aria-hidden="true"></span>';
    body.append(a);
  }
  copy.append(body);
  el.append(copy);
  const headline = createHeadline(hl, ch.title, { seed: index + 3, reduced });
  const paras = [...body.querySelectorAll('p')];
  let lastStep = -1;
  if (phone) el.classList.add('is-phone');

  let loaded = null;
  function ensureLoaded() {
    if (!loaded) {
      for (const img of imgs) if (!img.src) img.src = resolveArt(img.dataset.src);
      for (const b of bgEls) b.el.style.setProperty('--tex', `url("${resolveArt(b.file)}")`);
      const pimgs = systems.flatMap((s) => s.load());
      loaded = Promise.all([...imgs, ...pimgs].map((i) => decodeImg(i)));
    }
    return loaded;
  }

  let W = 1, H = 1;
  function resize(w, h) {
    W = w; H = h;
    systems.forEach((s) => s.resize(w, h));
    svgs.forEach((s) => s.resize(w, h));
  }

  let enterAt = -1e9;
  let lastF = -1;
  function enter(now) {
    enterAt = now;
    el.classList.remove('is-in');
    void el.offsetWidth; // restart the paragraph reveal
    el.classList.add('is-in');
  }
  function leave() {
    el.classList.remove('is-in');
  }

  /**
   * frame: {mx, my} cursor displacement from the centre in px (already smoothed),
   * t: scroll progress through this chapter, time: s, now: ms.
   */
  function update({ mx, my, t, time, now }) {
    for (const L of layers) {
      const { px, sy } = L.d;
      let x = reduced ? 0 : px * mx;
      let y = reduced ? 0 : px * my - sy * (t - 0.5) * H;
      let tr = '';
      let o = null;
      if (L.spec.move) {
        const m = L.spec.move(reduced ? 0.5 : t, reduced ? 0 : time);
        const u = m.unit === 'vw' ? W / 100 : H / 100;
        x += (m.x || 0) * u;
        y += (m.y || 0) * u;
        if (m.r) tr = ` rotate(${m.r.toFixed(2)}deg)`;
        if (m.o != null) o = m.o;
      }
      const s = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)${tr}`;
      if (s !== L.last) { L.el.style.transform = s; L.last = s; }
      if (o != null) L.el.style.opacity = o.toFixed(3);
    }
    for (const s of systems) s.update(time, t);

    // Headline: assembles on entry (settle ease, 1.4 s after 0.3 s), breaks as you scroll on.
    const since = (now - enterAt) / 1000;
    const enterF = reduced ? 0 : 1 - ease.settle(clamp01((since - 0.3) / 1.4));
    const last = index === CHAPTERS.length - 1;
    const scrollF = reduced ? 0 : last ? 0.55 * smoothstep(0.55, 1, t) : smoothstep(0.42, 0.98, t);
    const f = Math.max(enterF * 0.85, scrollF);
    if (Math.abs(f - lastF) > 0.0005) { headline.set(f); lastF = f; }
    // Phones show one paragraph at a time, stepping with scroll.
    if (phone && paras.length > 1) {
      const step = Math.min(paras.length - 1, Math.floor(clamp01(t * 1.1) * paras.length));
      if (step !== lastStep) { paras.forEach((p, k) => p.classList.toggle('is-step', k === step)); lastStep = step; }
    }
    // The copy drifts gently with scroll, the way the water column does.
    if (!reduced) copy.style.transform = `translate3d(0, ${(-(t - 0.5) * 0.06 * H).toFixed(1)}px, 0)`;
  }

  return { el, index, chapter: ch, ensureLoaded, resize, update, enter, leave, copy };
}
