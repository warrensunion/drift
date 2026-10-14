// Numeric analysis of frames + rAF samples written by record.mjs.
// Usage: node design-reference/makemepulse/tools/analyze.mjs [1440x900 1920x1080]
// Writes frames/<size>/analysis.json and contact sheets into design-reference/compare/.
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const COMPARE = path.resolve(ROOT, '..', 'compare');
const sizes = process.argv.slice(2).length ? process.argv.slice(2) : ['1440x900', '1920x1080'];

const DS = 4; // downsample factor for shift search
async function gray(file, ds = DS) {
  const img = sharp(file);
  const { width, height } = await img.metadata();
  const w = Math.round(width / ds), h = Math.round(height / ds);
  const data = await img.resize(w, h, { kernel: 'cubic' }).greyscale().raw().toBuffer();
  return { data, w, h };
}
// Best integer shift (dx,dy) of region [y0,y1) of A that matches B (B(x+dx,y+dy) ~ A(x,y)), SAD, at downsampled res.
function bestShift(A, B, y0f, y1f, x0f = 0.08, x1f = 0.92, R = 40) {
  const { w, h } = A;
  const y0 = Math.floor(h * y0f), y1 = Math.floor(h * y1f), x0 = Math.floor(w * x0f), x1 = Math.floor(w * x1f);
  let best = { dx: 0, dy: 0, sad: Infinity }; let zero = 0;
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    let s = 0, c = 0;
    for (let y = y0; y < y1; y += 2) {
      const yb = y + dy; if (yb < 0 || yb >= h) continue;
      for (let x = x0; x < x1; x += 2) {
        const xb = x + dx; if (xb < 0 || xb >= w) continue;
        s += Math.abs(A.data[y * w + x] - B.data[yb * w + xb]); c++;
      }
    }
    if (c < 50) continue;
    s /= c;
    if (dx === 0 && dy === 0) zero = s;
    if (s < best.sad) best = { dx, dy, sad: s };
  }
  return { dx: best.dx * DS, dy: best.dy * DS, sad: +best.sad.toFixed(2), sad0: +zero.toFixed(2) };
}
function meanAbsDiff(A, B) { let s = 0; for (let i = 0; i < A.data.length; i++) s += Math.abs(A.data[i] - B.data[i]); return s / A.data.length; }

async function palette(file, k = 6) {
  const { data, info } = await sharp(file).resize(240).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const buckets = new Map();
  for (let i = 0; i < data.length; i += 3) {
    const key = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
    const b = buckets.get(key) || { n: 0, r: 0, g: 0, b: 0 }; b.n++; b.r += data[i]; b.g += data[i + 1]; b.b += data[i + 2]; buckets.set(key, b);
  }
  const total = data.length / 3;
  const hex = (v) => Math.round(v).toString(16).padStart(2, '0');
  return [...buckets.values()].sort((a, b) => b.n - a.n).slice(0, k).map((b) => ({ hex: `#${hex(b.r / b.n)}${hex(b.g / b.n)}${hex(b.b / b.n)}`, pct: +(100 * b.n / total).toFixed(1) }));
}
// Vignette: mean luminance of the 4 corner patches vs centre patch. Grain: std of (pixel - 3x3 box blur).
async function vignetteGrain(file) {
  const { data, info } = await sharp(file).greyscale().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const patch = (cx, cy, s) => { let t = 0, c = 0; for (let y = cy; y < cy + s; y++) for (let x = cx; x < cx + s; x++) { t += data[y * w + x]; c++; } return t / c; };
  const s = Math.round(h * 0.08);
  const corners = (patch(0, 0, s) + patch(w - s, 0, s) + patch(0, h - s, s) + patch(w - s, h - s, s)) / 4;
  const centre = patch(Math.round(w / 2 - s / 2), Math.round(h / 2 - s / 2), s);
  let acc = 0, n = 0;
  for (let y = 1; y < h - 1; y += 3) for (let x = 1; x < w - 1; x += 3) {
    let m = 0; for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) m += data[(y + j) * w + x + i];
    const d = data[y * w + x] - m / 9; acc += d * d; n++;
  }
  return { cornerLum: +corners.toFixed(1), centreLum: +centre.toFixed(1), hfStd: +Math.sqrt(acc / n).toFixed(2) };
}

// Fit exponential approach x(t) -> target. Returns per-frame factor, time constant, t50/t90.
function fitApproach(samples, key, axis, tStart) {
  const pts = samples.filter((s) => s[key] && s.t >= tStart);
  if (pts.length < 10) return null;
  const v = (s) => s[key][axis];
  const x0 = v(pts[0]), xf = v(pts[pts.length - 1]);
  const span = xf - x0; if (Math.abs(span) < 1e-6) return { span: 0 };
  const rows = pts.map((s, i) => ({ t: s.t - tStart, i, p: (v(s) - x0) / span }));
  // first frame with motion
  const first = rows.findIndex((r) => r.p > 0.002);
  const t50 = rows.find((r) => r.p >= 0.5); const t90 = rows.find((r) => r.p >= 0.9); const t99 = rows.find((r) => r.p >= 0.99);
  // regression of ln(1-p) vs frame index over 5%..90%
  const fit = rows.filter((r) => r.p > 0.05 && r.p < 0.9);
  const reg = (xs, ys) => { const n = xs.length; const mx = xs.reduce((a, b) => a + b, 0) / n; const my = ys.reduce((a, b) => a + b, 0) / n; let num = 0, den = 0; for (let j = 0; j < n; j++) { num += (xs[j] - mx) * (ys[j] - my); den += (xs[j] - mx) ** 2; } return num / den; };
  const slopeFrame = fit.length > 3 ? reg(fit.map((r) => r.i), fit.map((r) => Math.log(1 - r.p))) : NaN;
  const slopeMs = fit.length > 3 ? reg(fit.map((r) => r.t), fit.map((r) => Math.log(1 - r.p))) : NaN;
  const dts = []; for (let j = 1; j < pts.length; j++) dts.push(pts[j].t - pts[j - 1].t);
  dts.sort((a, b) => a - b);
  return {
    span: +span.toFixed(4), framesMedianMs: +dts[Math.floor(dts.length / 2)].toFixed(2),
    firstMotionMs: first >= 0 ? +rows[first].t.toFixed(1) : null,
    perFrameFactor: +(1 - Math.exp(slopeFrame)).toFixed(4), timeConstantMs: +(-1 / slopeMs).toFixed(1),
    t50ms: t50 ? +t50.t.toFixed(0) : null, t90ms: t90 ? +t90.t.toFixed(0) : null, t99ms: t99 ? +t99.t.toFixed(0) : null,
  };
}


// GSAP Power3.easeInOut == easeInOutQuart
const inOutQuart = (p) => (p < 0.5 ? 8 * p ** 4 : 1 - 8 * (p - 1) ** 4);

async function analyzeSize(size) {
  const dir = path.join(ROOT, 'frames', size);
  const log = JSON.parse(fs.readFileSync(path.join(dir, 'log.json'), 'utf8'));
  const samples = JSON.parse(fs.readFileSync(path.join(dir, 'samples.json'), 'utf8'));
  const [W, H] = size.split('x').map(Number);
  const out = { size, fps: log.fps, renderer: log.renderer, marks: log.marks.map((m) => ({ ...m, t: m.t - log.tGoto })) };
  const S = (phase, label) => log.frames.find((f) => f.phase === phase && f.label === label && f.still);
  const N = (phase, label, off) => { const c = log.frames.filter((f) => f.phase === phase && f.label === label && !f.still); if (!c.length) return null; return c.reduce((a, b) => (Math.abs(b.off - off) < Math.abs(a.off - off) ? b : a)); };
  const fp = (f) => path.join(dir, f.file);
  const exists = (f) => f && fs.existsSync(fp(f));

  // 1. preloader timeline from 100 ms DOM polls
  const ty = (tf) => { const m = /translateY\((-?[\d.]+)%\)/.exec(tf || ''); if (m) return +m[1]; const mm = /matrix\(([^)]+)\)/.exec(tf || ''); return mm ? +(+mm[1].split(',')[5]).toFixed(1) + 'px' : tf; };
  const polls = log.polls.filter((p) => p.phase === '01_preloader' && p.t);
  const timeline = polls.map((p) => ({ t: Math.round(p.t - log.tGoto), loader: p.loader && p.loader.cls, fgY: p.loaderFg && ty(p.loaderFg.tf), bar: p.loaderBar && ty(p.loaderBar.tf), logo: p.logo && `${p.logo.cls.includes('hide') ? 'hidden' : 'shown'} op=${(+p.logo.op).toFixed(2)} ${p.logo.tf}`, audioText: p.audioText && (+p.audioText.op).toFixed(2), canvas: p.canvas && p.canvas.op }));
  out.preloader = timeline.filter((r, i, a) => i === 0 || JSON.stringify({ ...r, t: 0 }) !== JSON.stringify({ ...a[i - 1], t: 0 }));
  const pre = log.frames.filter((f) => f.phase === '01_preloader');
  out.preloaderFrames = pre.length;
  out.preloaderMotion = [];
  for (let i = 1; i < pre.length; i++) { const a = await gray(fp(pre[i - 1]), 8), b = await gray(fp(pre[i]), 8); out.preloaderMotion.push({ off: pre[i].off, mad: +meanAbsDiff(a, b).toFixed(2) }); }
  out.resources = (log.resources || []).filter((r) => !/google/.test(r.n)).reduce((acc, r) => { acc.count++; acc.bytes += r.b; acc.lastEnd = Math.max(acc.lastEnd, r.e); return acc; }, { count: 0, bytes: 0, lastEnd: 0 });

  // 2. mouse lag fits from rAF samples (camera node position; cursor DOM transform)
  out.lag = {};
  for (const [name, s] of Object.entries(samples)) {
    if (!/_(tl|tr|br|bl)(_back)?$/.test(name)) continue;
    const ev = s.events.find((e) => e.type === 'mousemove');
    if (!ev) continue;
    const r = { x: ev.x, y: ev.y, samples: s.samples.length };
    r.camX = fitApproach(s.samples, 'cam', 0, ev.t);
    r.camY = fitApproach(s.samples, 'cam', 1, ev.t);
    const cs = s.samples.map((q) => { const m = /translate3d\(([-\d.]+)px, ([-\d.]+)px/.exec(q.cursor || ''); return m ? { t: q.t, cur: [+m[1] + 75, +m[2] + 75] } : null; }).filter(Boolean);
    const hit = cs.find((q) => q.t >= ev.t && Math.abs(q.cur[0] - ev.x) < 2 && Math.abs(q.cur[1] - ev.y) < 2);
    r.cursorLatencyMs = hit ? +(hit.t - ev.t).toFixed(1) : null;
    out.lag[name] = r;
  }

  // 3. parallax per depth band from stills: centre_settled vs corner settled
  out.parallax = {};
  const bands = [[0.0, 0.2], [0.2, 0.4], [0.4, 0.6], [0.6, 0.8], [0.8, 1.0]];
  for (const ph of [...new Set(log.frames.filter((f) => /_mouse$/.test(f.phase)).map((f) => f.phase))]) {
    const c = S(ph, 'center_settled'); if (!exists(c)) continue;
    const A = await gray(fp(c));
    const res = {};
    for (const k of ['tl', 'br']) {
      const f = S(ph, `${k}_settled`); if (!exists(f)) continue;
      const B = await gray(fp(f));
      const mouseDx = (k === 'tl' ? 2 : W - 2) - W / 2, mouseDy = (k === 'tl' ? 2 : H - 2) - H / 2;
      res[k] = { mouseDx, mouseDy, global: +meanAbsDiff(A, B).toFixed(2), bands: bands.map(([a, b]) => { const s = bestShift(A, B, a, b); return { band: `${a * 100}-${b * 100}%`, ...s, ratioX: +(s.dx / mouseDx).toFixed(4), ratioY: +(s.dy / mouseDy).toFixed(4) }; }) };
      const series = [];
      for (const d of [0, 50, 100, 150, 200, 300, 400, 500, 700, 1000, 1500, 2000, 2900]) {
        const g = N(ph, `to_${k}`, d); if (!g || series.find((x) => x.off === g.off)) continue;
        const s = bestShift(A, await gray(fp(g)), 0.4, 0.8, 0.08, 0.92, 30);
        series.push({ off: g.off, dx: s.dx, dy: s.dy });
      }
      res[k].shotSeries = series;
    }
    out.parallax[ph] = res;
  }

  // 4. scroll / wheel response
  out.wheel = {};
  for (const ph of [...new Set(log.frames.filter((f) => /_wheel$/.test(f.phase)).map((f) => f.phase))]) {
    const b0 = S(ph, 'wheel_before'), b1 = S(ph, 'wheel_after');
    const s = samples[`${ph}_wheel`];
    const cams = s ? s.samples.filter((q) => q.cam).map((q) => q.cam) : [];
    const pp = log.polls.filter((p) => p.phase === ph);
    out.wheel[ph] = {
      wheelEvents: s ? s.events.filter((e) => e.type === 'wheel').length : 0,
      madBeforeAfter: exists(b0) && exists(b1) ? +meanAbsDiff(await gray(fp(b0), 8), await gray(fp(b1), 8)).toFixed(2) : null,
      scrollY: [...new Set(pp.map((p) => p.scrollY))], chapter: [...new Set(pp.map((p) => p.ch))],
      camRange: cams.length ? [0, 1, 2].map((a) => +(Math.max(...cams.map((c) => c[a])) - Math.min(...cams.map((c) => c[a]))).toFixed(4)) : null,
    };
  }
  // ambient reference: same-scene stills ~6 s apart without net input (centre -> TL -> centre)
  out.ambient = {};
  for (const ph of [...new Set(log.frames.filter((f) => /_mouse$/.test(f.phase)).map((f) => f.phase))]) {
    const a = S(ph, 'center_settled'), b = log.frames.filter((f) => f.phase === ph && f.label.startsWith('back_from_tl')).pop();
    if (exists(a) && exists(b)) out.ambient[ph] = +meanAbsDiff(await gray(fp(a), 8), await gray(fp(b), 8)).toFixed(2);
  }

  // 5. transitions: motion energy + offsetProgress curve vs easeInOutQuart(1.75 s)
  out.transitions = {};
  for (const ph of [...new Set(log.frames.filter((f) => /transition$|^05_reveal$|^07_enter_scene1$/.test(f.phase)).map((f) => f.phase))]) {
    const fr = log.frames.filter((f) => f.phase === ph && !f.still);
    const rows = [];
    for (let i = 1; i < fr.length; i++) { const a = await gray(fp(fr[i - 1]), 8), b = await gray(fp(fr[i]), 8); rows.push({ off: fr[i].off, mad: +(meanAbsDiff(a, b) / Math.max(1, (fr[i].off - fr[i - 1].off) / 16.7)).toFixed(2) }); }
    const moving = rows.filter((r) => r.mad > 1.0);
    const r = { framesCaptured: fr.length, motionStartMs: moving.length ? moving[0].off : null, motionEndMs: moving.length ? moving[moving.length - 1].off : null, energy: rows.filter((_, i) => i % 3 === 0) };
    const s = samples[ph] || samples[`${ph.replace(/_transition$/, '')}_transition`];
    if (s) {
      const op = s.samples.filter((q) => q.offsetProgress !== undefined);
      if (op.length > 5) {
        const startT = op[0].t;
        const dur = op[op.length - 1].t - startT;
        let err = 0; for (const q of op) err = Math.max(err, Math.abs(q.offsetProgress - inOutQuart(Math.min(1, (q.t - startT) / 1750))));
        r.offsetProgress = { activeForMs: Math.round(dur), maxErrVsInOutQuart1750: +err.toFixed(3), curve: op.filter((_, i) => i % 10 === 0).map((q) => ({ t: Math.round(q.t - startT), p: +q.offsetProgress.toFixed(3) })) };
      }
      const cy = s.samples.filter((q) => q.camW);
      if (cy.length) r.camWorldY = cy.filter((_, i) => i % 10 === 0).map((q) => ({ t: Math.round(q.t - s.samples[0].t), ch: q.ch, y: +q.camW[1].toFixed(2) }));
    }
    const pp = log.polls.filter((p) => p.phase === ph);
    if (pp.length) r.dom = pp.filter((_, i) => i % 3 === 0).map((p) => ({ t: Math.round(p.t - pp[0].t), ch: p.ch, trans: p.trans, canvas: p.canvas && p.canvas.tf, landing: p.landing && p.landing.tf, logo: p.logo && `${(+p.logo.op).toFixed(2)} ${p.logo.tf}` }));
    out.transitions[ph] = r;
  }

  // 6. palettes / vignette / grain on stills
  out.look = {};
  const keyFrames = [['loader', pre[Math.min(10, pre.length - 1)]], ['landing', S('02_landing_mouse', 'center_settled')], ['landing_hover', S('03_landing_hover', 'enter_settled')], ['revealed', S('05_reveal', 'revealed_settled')],
    ['s1', S('08_s1_eclosion', 'title')], ['s2', S('09_s2_adieu', 'title')], ['s3', S('10_s3_voyage', 'title')], ['s4', S('11_s4_premiere', 'title')], ['ending', S('12_ending', 'end_settled')]];
  for (const [k, f] of keyFrames) if (exists(f)) out.look[k] = { file: f.file, palette: await palette(fp(f)), ...(await vignetteGrain(fp(f))) };
  out.type = log.type;

  // 7. contact sheets
  fs.mkdirSync(COMPARE, { recursive: true });
  const sheet = async (name, items, cols = 4, tw = 400) => {
    items = items.filter(([, f]) => exists(f));
    const th = Math.round(tw * H / W), lab = 22, rows = Math.ceil(items.length / cols);
    const comps = [];
    for (let i = 0; i < items.length; i++) {
      const [label0, f] = items[i];
      // screencast frames arrive irregularly on a loaded machine: always print the real offset
      const label = f.still ? `${label0} (still)` : `${label0.replace(/ \+\d+ms$/, '')} [frame +${f.off}ms]`;
      const x = (i % cols) * tw, y = Math.floor(i / cols) * (th + lab);
      comps.push({ input: await sharp(fp(f)).resize(tw, th).toBuffer(), left: x, top: y + lab });
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${tw}" height="${lab}"><rect width="100%" height="100%" fill="#111"/><text x="6" y="16" font-family="Arial" font-size="13" fill="#eee">${label.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</text></svg>`;
      comps.push({ input: Buffer.from(svg), left: x, top: y });
    }
    const file = path.join(COMPARE, `makemepulse_${size}_${name}.jpg`);
    await sharp({ create: { width: cols * tw, height: rows * (th + lab), channels: 3, background: '#000' } }).composite(comps).jpeg({ quality: 80 }).toFile(file);
    return path.relative(path.resolve(ROOT, '..', '..'), file);
  };
  const pick = (arr, n) => (arr.length ? Array.from({ length: n }, (_, i) => arr[Math.round(i * (arr.length - 1) / (n - 1))]) : []);
  out.sheets = [];
  out.sheets.push(await sheet('keyframes', [
    ...pick(pre, 4).map((f) => [`preloader +${f.off}ms`, f]),
    ['landing idle', S('02_landing_mouse', 'center_settled')], ['landing hover Enter', S('03_landing_hover', 'enter_settled')],
    ['reveal +600ms', N('05_reveal', 'rv', 600)], ['reveal +1500ms', N('05_reveal', 'rv', 1500)], ['start button hover', S('06_start_button', 'hover_settled')],
    ['start -> scene1 +500ms', N('07_enter_scene1', 'in', 500)], ['scene1', S('08_s1_eclosion', 'title')], ['scene2', S('09_s2_adieu', 'title')],
    ['scene3', S('10_s3_voyage', 'title')], ['scene4', S('11_s4_premiere', 'title')], ['ending +1s', N('12_ending', 'end', 1000)], ['ending settled', S('12_ending', 'end_settled')],
  ]));
  const mp = '08_s1_eclosion_mouse';
  out.sheets.push(await sheet('motion', [
    ...[0, 300, 600, 900, 1100, 1300, 1600, 2200].map((o) => [`transition s1->s2 +${o}ms`, N('08_s1_eclosion_transition', 'tr', o)]),
    ['s1 mouse centre (settled)', S(mp, 'center_settled')], ['s1 mouse -> TL +200ms', N(mp, 'to_tl', 200)], ['s1 mouse -> TL +800ms', N(mp, 'to_tl', 800)], ['s1 mouse TL settled', S(mp, 'tl_settled')],
  ]));
  fs.writeFileSync(path.join(dir, 'analysis.json'), JSON.stringify(out, null, 1));
  console.log(size, 'done', out.sheets);
}

for (const s of sizes) await analyzeSize(s);
