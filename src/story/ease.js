// Easing curves measured from 2019.makemepulse.com (design-reference/makemepulse/NOTES.md),
// as CSS cubic-bezier control points, plus a small solver so JS tweens use the same curves.

export const EASE = {
  settle: [0.04, 1, 0.31, 0.98], // their CustomEase: fast attack, long soft tail
  scene: [0.77, 0, 0.175, 1], // Power3.easeInOut: chapter transition
  slide: [0.645, 0.045, 0.355, 1], // Power2.easeInOut: big DOM slides
  reveal: [0.215, 0.61, 0.355, 1], // Power2.easeOut: hovers, reveals, loader bar, disc
  hide: [0.755, 0.05, 0.855, 0.06], // Power4.easeIn: hide / collapse
  quart: [0.77, 0, 0.175, 1], // disc covers the viewport
};

/** cubicBezier(x1, y1, x2, y2) -> f(x) on 0..1, like CSS cubic-bezier(). */
export function cubicBezier(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = (t) => ((ax * t + bx) * t + cx) * t;
  const sy = (t) => ((ay * t + by) * t + cy) * t;
  const dx = (t) => (3 * ax * t + 2 * bx) * t + cx;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const e = sx(t) - x;
      if (Math.abs(e) < 1e-7) return sy(t);
      const d = dx(t);
      if (Math.abs(d) < 1e-6) break;
      t -= e / d;
    }
    let lo = 0, hi = 1;
    t = x;
    for (let i = 0; i < 40; i++) {
      const v = sx(t);
      if (Math.abs(v - x) < 1e-7) break;
      if (v < x) lo = t; else hi = t;
      t = (lo + hi) / 2;
    }
    return sy(t);
  };
}

export const ease = Object.fromEntries(Object.entries(EASE).map(([k, v]) => [k, cubicBezier(...v)]));
// GSAP's Power3.easeInOut is the exact, symmetric quartic; the CSS bezier above only approximates it
// (it reaches 0.596 at x = 0.5). JS-driven transitions use the exact curve so the swap at 50 % is
// also the moment the sweep's core is centred on the frame.
export const easeInOutQuart = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x < 0.5 ? 8 * x ** 4 : 1 - (-2 * x + 2) ** 4 / 2);
ease.scene = easeInOutQuart;
ease.quart = easeInOutQuart;

export const css = (name) => `cubic-bezier(${EASE[name].join(',')})`;

export const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const smoothstep = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/**
 * tween(ms, fn, easing) -> Promise. Calls fn(easedProgress) every frame. Resolves at the end.
 */
export function tween(ms, fn, easing = (x) => x, delay = 0) {
  return new Promise((resolve) => {
    let start = null;
    const step = (now) => {
      if (start === null) start = now + delay;
      const p = clamp01((now - start) / ms);
      if (now >= start) fn(easing(p), p);
      if (p < 1) requestAnimationFrame(step);
      else resolve();
    };
    requestAnimationFrame(step);
  });
}
