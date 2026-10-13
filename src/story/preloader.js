// Preloader and hand-off, on makemepulse's measured timeline with our own art:
//  - one hand-painted stroke (the wake of a sinking drop of plastic) slides up into place, 0.8 s
//  - a full copy fills it from the bottom inside a mask over a 20 % copy, tied to real progress
//    (bytes of chapter 1's art from the manifest + the fonts), each step smoothed over 0.5 s
//  - done + 0.5 s: it slides out upward through its own mask, 0.8 s
//  - done + 1.1 s: a disc opens onto chapter 1 (0.9 s), the title settles 1.3 -> 1 over 1.4 s
//    after 0.3 s. No percentage anywhere.
//  - the first scroll, key or click opens the disc to the whole frame (1.2 s) and the story starts.

import { ease, tween } from './ease.js';
import { preloadFiles } from './assets.js';

const FONT_WEIGHT = 140_000; // fonts count as roughly their transfer size in the progress bar
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function fontsLoaded(timeout = 5000) {
  const link = document.getElementById('fonts');
  const sheet = link && !link.sheet ? new Promise((r) => { link.addEventListener('load', r, { once: true }); link.addEventListener('error', r, { once: true }); }) : Promise.resolve();
  const faces = sheet.then(() => Promise.all([
    document.fonts.load("300 1em 'Anybody'"),
    document.fonts.load("600 1em 'Anybody'"),
    document.fonts.load("400 1em 'Literata'"),
    document.fonts.load("italic 400 1em 'Literata'"),
  ])).catch(() => {});
  return Promise.race([faces, wait(timeout)]);
}

/** Disc radius at full size: makemepulse's size 0.35 (378 px at 1440 x 900), never tiny on phones. */
const discRadius = (w, h) => Math.max(0.2625 * w, 0.34 * Math.min(w, h));

export async function runPreloader({ files, reduced = false, onReveal, onBegin }) {
  const root = document.getElementById('preloader');
  if (!root) return;
  const bar = root.querySelector('.pre__bar');
  const fill = root.querySelector('.pre__fill');
  const fillInner = root.querySelector('.pre__fill-inner');
  const water = root.querySelector('.pre__water');
  const ring = root.querySelector('.pre__ring');
  const title = root.querySelector('.pre__title');
  const intro = root.querySelector('.pre__intro');
  const hint = root.querySelector('.pre__hint');

  root.classList.add('is-js');
  // In: slide up into place through its own mask.
  requestAnimationFrame(() => root.classList.add('is-in'));
  const inDone = wait(reduced ? 400 : 800);

  let bytes = 0, total = 1, fontsDone = false;
  const setP = () => {
    const p = Math.min(1, (bytes + (fontsDone ? FONT_WEIGHT : 0)) / (total + FONT_WEIGHT));
    fill.style.transform = `translate3d(0, ${((1 - p) * 100).toFixed(2)}%, 0)`;
    fillInner.style.transform = `translate3d(0, ${(-(1 - p) * 100).toFixed(2)}%, 0)`;
    root.style.setProperty('--p', p.toFixed(3));
  };
  setP();
  await Promise.all([
    preloadFiles(files, (l, t) => { bytes = l; total = t; setP(); }),
    fontsLoaded().then(() => { fontsDone = true; setP(); }),
    inDone,
  ]);
  bytes = total; fontsDone = true; setP();

  // The 0.5 s smoothing finishes, then out (upward, through its own mask).
  await wait(500);
  root.classList.add('is-out');
  await wait(600);

  // Hand-off: the disc opens onto chapter 1, the title settles.
  onReveal && onReveal();
  document.documentElement.classList.remove('is-loading');
  root.classList.add('is-intro');
  const W = () => window.innerWidth, H = () => window.innerHeight;
  let r = 0;
  const setDisc = (rad) => {
    r = rad;
    const m = `radial-gradient(circle at 50% 50%, transparent ${rad.toFixed(1)}px, #000 ${(rad + 1).toFixed(1)}px)`;
    water.style.webkitMaskImage = m;
    water.style.maskImage = m;
    ring.style.width = ring.style.height = `${(rad * 2).toFixed(1)}px`;
    ring.style.opacity = rad > 2 ? '1' : '0';
  };
  const R = discRadius(W(), H());
  if (reduced) {
    setDisc(R);
    title.style.opacity = '1';
  } else {
    tween(900, (e) => setDisc(R * e), ease.reveal);
    tween(1400, (e, p) => {
      title.style.opacity = String(Math.min(1, p * 2.2));
      title.style.transform = `scale(${(1.3 - 0.3 * e).toFixed(4)})`;
    }, ease.settle, 300);
  }
  await wait(reduced ? 0 : 1000);
  intro.classList.add('is-ready');
  const status = document.getElementById('pre-status');
  if (status) status.textContent = 'Drift is ready. Scroll, or press the button, to begin.';

  // Wait for the visitor: scroll, wheel, swipe, a key, or the button.
  await new Promise((resolve) => {
    const go = () => { cleanup(); resolve(); };
    const onKey = (e) => { if (['ArrowDown', 'PageDown', ' ', 'Enter', 'End'].includes(e.key)) go(); };
    const onScroll = () => { if (window.scrollY > 4) go(); };
    const opts = { passive: true };
    window.addEventListener('wheel', go, opts);
    window.addEventListener('touchmove', go, opts);
    window.addEventListener('scroll', onScroll, opts);
    window.addEventListener('keydown', onKey);
    hint.addEventListener('click', go);
    if (window.scrollY > 4) go();
    function cleanup() {
      window.removeEventListener('wheel', go, opts);
      window.removeEventListener('touchmove', go, opts);
      window.removeEventListener('scroll', onScroll, opts);
      window.removeEventListener('keydown', onKey);
      hint.removeEventListener('click', go);
    }
  });

  // Open the disc to the whole frame; the title lifts away.
  root.classList.add('is-leaving');
  onBegin && onBegin();
  const full = Math.hypot(W(), H()) / 2 + 4;
  if (reduced) {
    root.style.transition = 'opacity 400ms linear';
    root.style.opacity = '0';
    await wait(400);
  } else {
    const r0 = r;
    await tween(1200, (e) => setDisc(r0 + (full - r0) * e), ease.quart);
  }
  root.remove();
}
