// Particle fields made of real fragment art (public/art/frag/*) or soft dots.
// One JS-driven transform per sprite per frame; counts are halved on phones.
// Modes:
//   cascade - pieces stream from an origin toward a target, spreading out (the bottle breaking)
//   stream  - pieces ride a Catmull-Rom current line (chapter 3)
//   spiral  - pieces wind inward around a centre (the gyre)
//   sink    - pieces fall slowly and sway (the deep)
//   rise    - bubbles rise inside a box
//   float   - pieces bob around fixed homes

import { resolveArt } from './assets.js';
import { clamp01, smoothstep } from './ease.js';

export function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

/** Catmull-Rom through points [[x,y],...] (stage fractions); returns u (0..1) -> [x, y]. */
export function spline(points) {
  const n = points.length - 1;
  return (u) => {
    const f = clamp01(u) * n;
    const i = Math.min(Math.floor(f), n - 1);
    const t = f - i;
    const p0 = points[Math.max(i - 1, 0)], p1 = points[i], p2 = points[i + 1], p3 = points[Math.min(i + 2, n)];
    const t2 = t * t, t3 = t2 * t;
    const c = (a, b, cc, d) => 0.5 * (2 * b + (-a + cc) * t + (2 * a - 5 * b + 4 * cc - d) * t2 + (-a + 3 * b - 3 * cc + d) * t3);
    return [c(p0[0], p1[0], p2[0], p3[0]), c(p0[1], p1[1], p2[1], p3[1])];
  };
}

/** SVG path data for the same spline, sampled finely, in a w x h box. */
export function splinePath(points, w, h, offset = [0, 0], steps = 80) {
  const s = spline(points);
  let d = '';
  for (let i = 0; i <= steps; i++) {
    const [x, y] = s(i / steps);
    d += `${i ? 'L' : 'M'}${((x + offset[0]) * w).toFixed(1)} ${((y + offset[1]) * h).toFixed(1)}`;
  }
  return d;
}

export function createParticles(container, spec, { phone = false, reduced = false, seed = 1 } = {}) {
  const r = rng(seed);
  const count = Math.max(4, Math.round(spec.count * (phone ? spec.phoneScale ?? 0.5 : 1)));
  const items = [];
  const path = spec.points ? spline(spec.points) : null;
  for (let i = 0; i < count; i++) {
    let el;
    if (spec.srcs) {
      el = document.createElement('img');
      el.alt = '';
      el.decoding = 'async';
      el.draggable = false;
      el.dataset.src = spec.srcs[Math.floor(r() * spec.srcs.length)];
    } else {
      el = document.createElement('span');
    }
    el.className = `pt ${spec.cls || ''}`;
    container.append(el);
    const sizeT = r() ** (spec.sizeBias ?? 2); // most pieces small, a few large
    items.push({
      el,
      i,
      u0: r(),
      speed: (spec.speed ?? 0.05) * (0.6 + r() * 0.8),
      size: spec.size[0] + (spec.size[1] - spec.size[0]) * sizeT,
      spread: (r() - 0.5) * 2,
      spread2: (r() - 0.5) * 2,
      rot0: r() * 360,
      spin: (r() - 0.5) * (spec.spin ?? 120),
      phase: r() * Math.PI * 2,
      home: [r(), r()],
      alpha: spec.opacity ? spec.opacity[0] + (spec.opacity[1] - spec.opacity[0]) * r() : 1,
    });
  }

  let px = 1; // vmin in px, set on resize
  let W = 1, H = 1;
  function resize(w, h) {
    W = w; H = h; px = Math.min(w, h) / 100;
    for (const it of items) {
      const s = it.size * px;
      it.el.style.width = `${s.toFixed(1)}px`;
      if (!spec.srcs) it.el.style.height = `${s.toFixed(1)}px`;
      it.half = s / 2;
    }
  }

  function load() {
    return items.filter((it) => it.el.dataset.src).map((it) => {
      if (!it.el.src) it.el.src = resolveArt(it.el.dataset.src);
      return it.el;
    });
  }

  /** time in s, t = chapter scroll progress 0..1 */
  function update(time, t) {
    const tm = reduced ? 0 : time;
    const reveal = spec.reveal ? spec.reveal(t) : 1;
    for (const it of items) {
      let x, y, rot, a = it.alpha, sc = 1;
      const u = (it.u0 + tm * it.speed) % 1;
      if (it.i / count > reveal) { if (it.vis !== false) { it.el.style.opacity = '0'; it.vis = false; } continue; }
      it.vis = true;
      switch (spec.mode) {
        case 'cascade': {
          const [ox, oy] = spec.from, [tx, ty] = spec.to;
          const k = u ** 0.85;
          const spread = (spec.spreadAt ?? 0.25) * k;
          x = ox + (tx - ox) * k + it.spread * spread * 0.6 + Math.sin(tm * 0.9 + it.phase) * 0.008;
          y = oy + (ty - oy) * k + it.spread2 * spread + k * k * 0.06;
          rot = it.rot0 + it.spin * tm * 0.4;
          sc = 1 - k * 0.55;
          a *= smoothstep(0, 0.06, u) * (1 - smoothstep(0.82, 1, u));
          break;
        }
        case 'stream': {
          const [bx, by] = path(u);
          const wob = Math.sin(tm * 0.7 + it.phase) * 0.004;
          x = bx + it.spread * (spec.width ?? 0.03) + wob;
          y = by + it.spread2 * (spec.width ?? 0.03) * 0.6;
          rot = it.rot0 + it.spin * tm * 0.2;
          sc = 0.55 + 0.45 * u; // nearer the viewer at the bottom of the frame
          a *= smoothstep(0, 0.08, u) * (1 - smoothstep(0.9, 1, u));
          break;
        }
        case 'spiral': {
          const [cx, cy] = spec.center;
          const rad = spec.radius * (1 - u) ** 0.9 + 0.01;
          const ang = it.phase + u * (spec.turns ?? 2.2) * Math.PI * 2;
          const asp = W / H;
          x = cx + Math.cos(ang) * rad / asp * (spec.squash ?? 1) + it.spread * 0.012;
          y = cy + Math.sin(ang) * rad * 0.82 + it.spread2 * 0.012;
          rot = it.rot0 + ang * 57.3 * 0.5;
          sc = 0.35 + 0.65 * (1 - u) ** 0.6;
          a *= smoothstep(0, 0.1, u) * (1 - smoothstep(0.85, 1, u));
          break;
        }
        case 'sink': {
          x = it.home[0] * (spec.box?.[2] ?? 1) + (spec.box?.[0] ?? 0) + Math.sin(tm * 0.5 + it.phase) * 0.012;
          y = (spec.box?.[1] ?? -0.1) + u * (spec.box?.[3] ?? 1.2);
          rot = it.rot0 + Math.sin(tm * 0.6 + it.phase) * 40;
          a *= smoothstep(0, 0.1, u) * (1 - smoothstep(0.85, 1, u));
          break;
        }
        case 'rise': {
          const [bx, by, bw, bh] = spec.box;
          x = bx + it.home[0] * bw + Math.sin(tm * 2 + it.phase) * 0.004;
          y = by + bh - u * bh;
          rot = 0;
          a *= smoothstep(0, 0.15, u) * (1 - smoothstep(0.7, 1, u));
          break;
        }
        default: { // float
          const [bx, by, bw, bh] = spec.box || [0, 0, 1, 1];
          x = bx + it.home[0] * bw + Math.sin(tm * 0.35 + it.phase) * 0.01;
          y = by + it.home[1] * bh + Math.cos(tm * 0.45 + it.phase) * 0.012;
          rot = it.rot0 + Math.sin(tm * 0.3 + it.phase) * 25;
        }
      }
      const s = sc.toFixed(3);
      it.el.style.transform = `translate3d(${(x * W - it.half).toFixed(1)}px, ${(y * H - it.half).toFixed(1)}px, 0) rotate(${rot.toFixed(1)}deg) scale(${s})`;
      it.el.style.opacity = a.toFixed(3);
    }
  }

  return { resize, load, update, items };
}
