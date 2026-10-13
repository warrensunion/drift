// Full-frame foreground layers that sweep across a chapter boundary (makemepulse's transition:
// 1.75 s, scene ease, the scenes swap at 50 % while the frame is fully covered).
// Each sweep is 200 % of the viewport tall: a ragged leading edge, an opaque core exactly one
// viewport tall, and a trailing edge. At progress 0.5 the core covers the frame.

import { resolveArt } from './assets.js';
import { rng } from './particles.js';

function img(file, cls, style) {
  const i = document.createElement('img');
  i.alt = '';
  i.decoding = 'async';
  i.draggable = false;
  i.className = cls;
  i.dataset.src = file;
  Object.assign(i.style, style);
  return i;
}

const CORE_TEXTURE = { reeds: 's1-reeds.webp', wave: 'ui-water.webp', cloud: 's3-clouds.webp', bubbles: 'ui-water.webp', snow: 's5-snow.webp' };

const BUILD = {
  reeds(edgeTop, edgeBot, r) {
    for (let k = 0; k < 9; k++) {
      const h = 70 + r() * 45;
      edgeTop.append(img('s1-reeds.webp', 'sw-art', { left: `${-12 + k * 13 + r() * 6}%`, bottom: `${-10 - r() * 8}%`, height: `${h}%`, transform: `scaleX(${r() < 0.5 ? -1 : 1})` }));
      edgeBot.append(img('s1-reeds.webp', 'sw-art', { left: `${-8 + k * 13 + r() * 6}%`, top: `${-12 - r() * 8}%`, height: `${h * 0.8}%`, transform: `scale(${r() < 0.5 ? -1 : 1}, -1)` }));
    }
  },
  wave(edgeTop, edgeBot, r) {
    for (let k = 0; k < 3; k++) {
      edgeTop.append(img('s2-wave.webp', 'sw-art', { left: `${-20 + k * 46 + r() * 6}%`, bottom: '-14%', width: '62%', transform: `scaleX(${k % 2 ? -1 : 1})` }));
      edgeBot.append(img('s2-wave.webp', 'sw-art', { left: `${-6 + k * 44}%`, top: '-14%', width: '58%', transform: `scale(${k % 2 ? 1 : -1}, -1)` }));
    }
  },
  cloud(edgeTop, edgeBot, r) {
    for (let k = 0; k < 4; k++) {
      edgeTop.append(img('s3-clouds.webp', 'sw-art', { left: `${-25 + k * 33 + r() * 8}%`, bottom: `${-30 - r() * 10}%`, width: '62%', transform: `scaleX(${k % 2 ? -1 : 1})` }));
      edgeBot.append(img('s3-clouds.webp', 'sw-art', { left: `${-20 + k * 33}%`, top: `${-30 - r() * 10}%`, width: '60%', transform: `scale(${k % 2 ? 1 : -1}, -1)` }));
    }
  },
  bubbles(edgeTop, edgeBot, r) {
    for (const edge of [edgeTop, edgeBot]) {
      for (let k = 0; k < 70; k++) {
        const b = document.createElement('i');
        b.className = 'sw-bubble';
        const s = 0.6 + r() ** 2.4 * 9;
        const top = edge === edgeTop ? 30 + r() * 72 : -2 + r() * 70;
        Object.assign(b.style, { left: `${r() * 100}%`, top: `${top}%`, width: `${s}vmin`, height: `${s}vmin` });
        edge.append(b);
      }
    }
  },
  snow(edgeTop, edgeBot) {
    edgeTop.classList.add('sw-snowfield');
    edgeBot.classList.add('sw-snowfield');
    edgeTop.dataset.bg = 's5-snow.webp';
    edgeBot.dataset.bg = 's5-snow.webp';
  },
};

/** createSweep(kind) -> {el, load(), set(progress, direction)} */
export function createSweep(kind) {
  const el = document.createElement('div');
  el.className = `sweep sweep--${kind}`;
  el.setAttribute('aria-hidden', 'true');
  const top = document.createElement('div');
  top.className = 'sweep__edge sweep__edge--top';
  const core = document.createElement('div');
  core.className = 'sweep__core';
  const bot = document.createElement('div');
  bot.className = 'sweep__edge sweep__edge--bottom';
  el.append(top, core, bot);
  BUILD[kind](top, bot, rng(kind.length * 977));
  core.dataset.bg = CORE_TEXTURE[kind];

  let loaded = null;
  return {
    el,
    load() {
      if (!loaded) {
        const imgs = [...el.querySelectorAll('img')];
        imgs.forEach((i) => { i.src = resolveArt(i.dataset.src); });
        el.querySelectorAll('[data-bg]').forEach((n) => { n.style.setProperty('--tex', `url("${resolveArt(n.dataset.bg)}")`); });
        loaded = Promise.all(imgs.map((i) => (i.decode ? i.decode().catch(() => {}) : null)));
      }
      return loaded;
    },
    /** e: eased progress 0..1; dir 1 = scrolling down (sweep rises), -1 = up (sweep falls). */
    set(e, dir, H) {
      // Element is 2H tall. Start fully below (y = H) and end fully above (y = -2H), or reverse.
      const y = dir > 0 ? H - e * 3 * H : -2 * H + e * 3 * H;
      el.style.transform = `translate3d(0, ${y.toFixed(1)}px, 0)`;
    },
  };
}
