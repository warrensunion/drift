// One rAF controller for the story: reads native scroll (no hijacking), maps it to a chapter and
// a progress t, eases the cursor parallax, and runs makemepulse's chapter transition whenever
// the scroll position crosses a chapter boundary.

import { ease, clamp01 } from './ease.js';

/** makemepulse's measured camera follow: 0.04 of the gap per 60 Hz frame (tau ~ 408 ms). */
export const FOLLOW_PER_FRAME = 0.04;
/** Transition timing (measured): 1.75 s, scene ease, swap at 50 %. */
export const TRANSITION_MS = 1750;
export const REDUCED_FADE_MS = 400;

export const lerp = (a, b, k) => a + (b - a) * k;

/** dt-corrected follow factor: k = 1 - 0.96^(dt / 16.67). */
export const followK = (dtMs) => 1 - (1 - FOLLOW_PER_FRAME) ** (dtMs / 16.67);

/** Scene edges for n equal scenes of `len` px starting at `offset`: [s0, s1, ..., sn]. */
export const sceneEdges = (n, len, offset = 0) => Array.from({ length: n + 1 }, (_, i) => offset + i * len);

/**
 * progressFor(scrollY, sceneStarts) -> {scene, t}
 * sceneStarts are the scene edges [s0, s1, ..., sN]: scene i spans [s_i, s_(i+1)); the last
 * value is the end of the last scene. Before s0 -> scene 0, t 0. At or past the end -> last
 * scene, t 1 (the last scene clamps). A boundary belongs to the scene that starts there.
 */
export function progressFor(scrollY, sceneStarts) {
  const n = sceneStarts.length - 1;
  if (n < 1) throw new Error('progressFor needs at least two edges');
  if (scrollY <= sceneStarts[0]) return { scene: 0, t: 0 };
  if (scrollY >= sceneStarts[n]) return { scene: n - 1, t: 1 };
  let i = 0;
  while (i < n - 1 && scrollY >= sceneStarts[i + 1]) i++;
  const a = sceneStarts[i], b = sceneStarts[i + 1];
  return { scene: i, t: b > a ? (scrollY - a) / (b - a) : 0 };
}

/**
 * createStory({root, stage, scenes, sweeps, reduced, onScene, onFrame})
 *  root:   the tall scrolling element (its height gives each chapter its scroll length)
 *  stage:  the sticky full-viewport element holding scene DOM
 *  scenes: from buildScene()
 *  sweeps: sweeps[i] carries you from scene i to i+1 (or null)
 */
export function createStory({ root, stage, scenes, sweeps, reduced, chapterVh = 2, onScene, onFrame }) {
  const N = scenes.length;
  let edges = sceneEdges(N, 1000, 0);
  let W = window.innerWidth, H = window.innerHeight;
  let current = 0; // the scene on screen
  let trans = null; // {from, to, dir, start, swapped, sweep}
  let pending = false;
  let started = false;
  let mouse = { tx: 0, ty: 0, x: 0, y: 0 };
  let lastNow = performance.now();
  const t0 = lastNow;
  let raf = 0;
  let lastScroll = { scene: 0, t: 0 };

  function measure() {
    W = window.innerWidth;
    H = window.innerHeight;
    const len = Math.round(H * chapterVh);
    root.style.setProperty('--story-h', `${len * N + H}px`);
    const top = root.getBoundingClientRect().top + window.scrollY;
    edges = sceneEdges(N, len, top);
    scenes.forEach((s) => s.resize(W, H));
  }

  let lastW = W, lastH = H;
  function onResize() {
    // Phones resize the viewport as the address bar shows and hides; ignore small height-only changes.
    const w = window.innerWidth, h = window.innerHeight;
    if (w === lastW && Math.abs(h - lastH) < 140) return;
    lastW = w; lastH = h;
    measure();
  }

  function onPointer(e) {
    if (e.pointerType && e.pointerType !== 'mouse') return;
    mouse.tx = (e.clientX / W) * 2 - 1;
    mouse.ty = (e.clientY / H) * 2 - 1;
  }

  function show(i, on) {
    scenes[i].el.classList.toggle('is-active', on);
  }

  async function begin(to) {
    if (pending || trans) return;
    pending = true;
    const from = current;
    const dir = to > from ? 1 : -1;
    // The sweep belongs to the boundary being crossed nearest the target.
    const sweep = reduced ? null : sweeps[dir > 0 ? to - 1 : to] || null;
    // Pre-render the incoming chapter (decode its art) before the transition starts.
    await Promise.race([
      Promise.all([scenes[to].ensureLoaded(), sweep ? sweep.load() : null]),
      new Promise((r) => setTimeout(r, 1800)),
    ]);
    pending = false;
    trans = { from, to, dir, start: performance.now(), swapped: false, sweep };
    if (sweep) { sweep.el.classList.add('is-on'); sweep.set(0, dir, H); }
    if (reduced) {
      // Reduced motion: a plain 400 ms cross-fade, nothing moves.
      show(to, true);
      scenes[to].el.style.opacity = '0';
      scenes[to].el.classList.add('is-top');
      scenes[to].enter(performance.now());
      onScene && onScene(to);
    }
  }

  function finish() {
    const { from, to, sweep } = trans;
    if (sweep) { sweep.el.classList.remove('is-on'); sweep.el.style.transform = ''; }
    scenes[from].el.style.transform = '';
    scenes[to].el.style.transform = '';
    scenes[from].el.style.opacity = '';
    scenes[to].el.style.opacity = '';
    scenes[to].el.classList.remove('is-top');
    show(from, false);
    scenes[from].leave();
    current = to;
    trans = null;
    // Warm the neighbours of the new chapter.
    const idle = window.requestIdleCallback || ((f) => setTimeout(f, 200));
    idle(() => {
      if (scenes[to + 1]) scenes[to + 1].ensureLoaded();
      if (sweeps[to]) sweeps[to].load();
      if (scenes[to - 1]) scenes[to - 1].ensureLoaded();
    });
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    let dt = now - lastNow;
    lastNow = now;
    if (dt > 200 || dt < 0) dt = 1000 / 60; // clamp hitches (makemepulse clamps to 1/60)
    const time = (now - t0) / 1000;

    const p = progressFor(window.scrollY, edges);
    lastScroll = p;
    if (started && !trans && !pending && p.scene !== current) begin(p.scene);

    if (!reduced) {
      const k = followK(dt);
      mouse.x = lerp(mouse.x, mouse.tx, k);
      mouse.y = lerp(mouse.y, mouse.ty, k);
    }
    const mx = mouse.x * W / 2, my = mouse.y * H / 2;

    if (trans) {
      const dur = reduced ? REDUCED_FADE_MS : TRANSITION_MS;
      // Verification hook: window.__driftHold = p freezes a running transition at progress p.
      if (typeof window.__driftHold === 'number') trans.start = now - window.__driftHold * dur;
      const raw = clamp01((now - trans.start) / dur);
      const { from, to, dir, sweep } = trans;
      if (reduced) {
        scenes[to].el.style.opacity = raw.toFixed(3);
      } else {
        const e = ease.scene(raw);
        if (sweep) sweep.set(e, dir, H);
        // Both scenes crane the same way: the old one rises out, the new one rises in.
        const crane = 0.16 * H;
        if (!trans.swapped && raw >= 0.5) {
          trans.swapped = true;
          show(to, true);
          show(from, false);
          scenes[to].enter(now);
          onScene && onScene(to);
        }
        if (!trans.swapped) scenes[from].el.style.transform = `translate3d(0, ${(-dir * crane * e).toFixed(1)}px, 0)`;
        else scenes[to].el.style.transform = `translate3d(0, ${(dir * crane * (1 - e)).toFixed(1)}px, 0)`;
      }
      const tFrom = dir > 0 ? 1 : 0;
      if (!trans.swapped || reduced) scenes[from].update({ mx, my, t: p.scene === from ? p.t : tFrom, time, now });
      if (trans.swapped || reduced) scenes[to].update({ mx, my, t: p.scene === to ? p.t : 1 - tFrom, time, now });
      if (raw >= 1) finish();
    } else {
      const s = scenes[current];
      s.update({ mx, my, t: p.scene === current ? p.t : (p.scene > current ? 1 : 0), time, now });
    }
    onFrame && onFrame({ scene: trans ? trans.to : current, shown: current, t: p.t, scrollScene: p.scene, mouse });
  }

  measure();
  show(0, true);
  window.addEventListener('resize', onResize, { passive: true });
  window.addEventListener('pointermove', onPointer, { passive: true });
  raf = requestAnimationFrame(frame);

  return {
    /** Start reacting to scroll (after the intro) and play chapter 1's entrance. */
    start() {
      started = true;
      scenes[current].enter(performance.now());
      onScene && onScene(current);
    },
    get edges() { return edges; },
    get current() { return current; },
    get state() { return { current, trans: trans && { from: trans.from, to: trans.to }, scroll: lastScroll }; },
    measure,
    destroy() { cancelAnimationFrame(raf); window.removeEventListener('resize', onResize); window.removeEventListener('pointermove', onPointer); },
  };
}
