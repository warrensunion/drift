/**
 * Rebuilds public/art/ (and design-reference/comps, design-reference/art-check)
 * from art-src/gen/*.png, deterministically.
 *
 *   node art-src/tools/build-art.mjs [--only <regex>] [--no-check] [--jobs 3]
 *
 *  - starts a tiny static file server on a free port (--port to pin) so that
 *    cutout.mjs / sheet-boxes.mjs (headless Chromium via Playwright) can load
 *    <base>/package.json and <base>/art-src/gen/x.png same-origin
 *  - opaque plates      -> sharp, WebP (+ -1280 variant for scene plates)
 *  - alpha layers/items -> cutout.mjs (trim or full canvas, erode, decontaminate)
 *  - frag-* / s2-shards -> sheet-boxes.mjs + cutout.mjs --crop per piece,
 *                          then one 256px-cell sprite atlas per kind
 *  - comp-*             -> design-reference/comps/*.jpg (q82), not shipped
 *  - public/art/manifest.json lists every file with pixel + byte size
 *  - contact sheets of every cut-out on #0E2F36 and #E6EEE9 for halo checks
 *
 * Working files (cut-out PNGs, the source of truth for the atlases) go to
 * art-src/gen/_raw/cut/ which is git-ignored.
 */
import http from 'node:http';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const GEN = path.join(ROOT, 'art-src/gen');
const CUT = path.join(GEN, '_raw/cut');
const OUT = path.join(ROOT, 'public/art');
const argv = process.argv.slice(2);
const flag = (k) => argv.includes(`--${k}`);
const val = (k, d) => { const i = argv.indexOf(`--${k}`); return i < 0 ? d : argv[i + 1]; };
const only = val('only') ? new RegExp(val('only')) : null;
const JOBS = Number(val('jobs', 3));
const want = (n) => !only || only.test(n);
const Q = 88; // webp quality for sharp-encoded files

// ---- the inventory ------------------------------------------------------
const PLATES = { 's1-sky': 2560, 's2-surface': 2560, 's3-ocean': 2560, 's5-deep': 2560, 'ui-paper': 1024, 'ui-water': 1024 };
const TILES = new Set(['ui-paper', 'ui-water']);
// alpha layers: erode for cutout.mjs; full = keep the whole canvas (scene
// layers are composed by the page at the frame size), otherwise trim to alpha.
const LAYERS = {
  's1-hills': { erode: 1, full: 1 }, 's1-river': { erode: 0, full: 1 }, 's1-bank': { erode: 1, full: 1 }, 's1-reeds': { erode: 2, full: 1 },
  's2-wave': { erode: 1, full: 1 }, 's2-shards': { erode: 2, full: 1 },
  's3-clouds': { erode: 0, full: 1 }, 's3-rays': { erode: 0, full: 1 }, 's4-gyre': { erode: 0, full: 1 }, 's5-snow': { erode: 0, full: 1 },
  'life-fish': { erode: 2 }, 'life-turtle': { erode: 2 }, 'life-jelly': { erode: 1 }, 'life-albatross': { erode: 2 }, 'life-whale': { erode: 2 },
  'item-bag': { erode: 2 }, 'item-line': { erode: 2 }, 'item-tyre': { erode: 2 }, 'item-buoy': { erode: 2 }, 'asset-bottle': { erode: 2 },
};
const SHEETS = { film: 'frag-film', fibres: 'frag-fibres', nurdles: 'frag-nurdles', tyre: 'frag-tyre', shard: 's2-shards' };
const COMPS = fs.readdirSync(GEN).filter((f) => /^comp-.*\.png$/.test(f)).map((f) => f.slice(0, -4));

// ---- helpers ------------------------------------------------------------
const mkdir = (d) => fs.mkdirSync(d, { recursive: true });
const png = (n) => path.join(GEN, `${n}.png`);
const exists = (n) => fs.existsSync(png(n));
const log = (...a) => console.log(...a);
function run(script, args) {
  return new Promise((res, rej) => {
    const p = spawn(process.execPath, [path.join(ROOT, 'art-src/tools', script), ...args], { cwd: ROOT });
    let o = ''; p.stdout.on('data', (d) => (o += d)); p.stderr.on('data', (d) => (o += d));
    p.on('close', (c) => (c === 0 ? res(o.trim()) : rej(new Error(`${script} ${args.join(' ')} -> ${c}\n${o}`))));
  });
}
async function pool(tasks, n) {
  let i = 0; const errs = [];
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < tasks.length) { const t = tasks[i++]; try { await t(); } catch (e) { errs.push(e); console.error(String(e.message)); } }
  }));
  if (errs.length) throw new Error(`${errs.length} task(s) failed`);
}

// per-box isolated copies of a sheet: only the blob that fills the box most
async function isolate(file, boxes) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, lab = new Int32Array(W * H), st = [];
  let nl = 0;
  for (let i = 0; i < W * H; i++) {
    if (lab[i] || data[i * 4 + 3] <= 24) continue;
    const id = ++nl; lab[i] = id; st.push(i);
    while (st.length) {
      const j = st.pop(), x = j % W, y = (j / W) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        const k = yy * W + xx; if (!lab[k] && data[k * 4 + 3] > 24) { lab[k] = id; st.push(k); }
      }
    }
  }
  const out = [];
  for (const b of boxes) {
    const [bx, by, bw, bh] = b.split(',').map(Number); const cnt = new Map();
    for (let y = by; y < by + bh; y++) for (let x = bx; x < bx + bw; x++) { const l = lab[y * W + x]; if (l) cnt.set(l, (cnt.get(l) || 0) + 1); }
    const own = [...cnt.entries()].sort((a, c) => c[1] - a[1])[0][0];
    // dilate own mask by R px (separable max) so the soft halo survives for cutout.mjs to clean
    const R = 8; let m = new Uint8Array(W * H); for (let i = 0; i < W * H; i++) m[i] = lab[i] === own ? 1 : 0;
    for (const horiz of [true, false]) {
      const n = new Uint8Array(W * H);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        if (!m[y * W + x]) continue;
        for (let d = -R; d <= R; d++) { const xx = horiz ? x + d : x, yy = horiz ? y : y + d; if (xx >= 0 && yy >= 0 && xx < W && yy < H) n[yy * W + xx] = 1; }
      }
      m = n;
    }
    const buf = Buffer.from(data);
    for (let i = 0; i < W * H; i++) if (!m[i]) buf[i * 4 + 3] = 0;
    out.push(buf);
  }
  out.W = W; out.H = H; return out;
}

// ---- server -------------------------------------------------------------
// A tiny static server is used instead of a Vite dev server: Vite took 10-35 s
// per request on the shared machine, this answers instantly and cutout.mjs only
// needs same-origin /package.json and /art-src/gen/*.png.
const MIME = { '.json': 'application/json', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || !fs.statSync(p).isFile()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(Number(val('port', 0)), r));
const BASE = `http://localhost:${server.address().port}`;
log('static server at', BASE);
const rel = (n) => `art-src/gen/${n}.png`;
const cutout = (name, out, extra) => run('cutout.mjs', [BASE, rel(name), out, ...extra]);

try {
  mkdir(CUT); mkdir(OUT); mkdir(path.join(OUT, 'frag'));
  const tasks = [];

  // opaque plates (sharp)
  for (const [n, maxW] of Object.entries(PLATES)) {
    if (!want(n)) continue;
    if (!exists(n)) { log('PENDING (missing source):', n); continue; }
    tasks.push(async () => {
      const m = await sharp(png(n)).metadata();
      const w = Math.min(maxW, m.width);
      await sharp(png(n)).removeAlpha().resize({ width: w }).webp({ quality: Q }).toFile(path.join(OUT, `${n}.webp`));
      if (!TILES.has(n) && w > 1280) await sharp(png(n)).removeAlpha().resize({ width: 1280 }).webp({ quality: Q }).toFile(path.join(OUT, `${n}-1280.webp`));
      log('plate', n, w);
    });
  }

  // alpha layers / items
  for (const [n, o] of Object.entries(LAYERS)) {
    if (!want(n)) continue;
    if (!exists(n)) { log('PENDING (missing source):', n); continue; }
    tasks.push(async () => {
      const m = await sharp(png(n)).metadata();
      const a = ['--erode', String(o.erode), '--margin', '4', '--max', '2048', '--q', '0.88'];
      if (o.full) a.push('--box', `0,0,${m.width},${m.height}`);
      log(await cutout(n, path.join(CUT, n), a));
      fs.copyFileSync(path.join(CUT, `${n}.webp`), path.join(OUT, `${n}.webp`));
    });
  }

  // fragment sheets
  for (const [kind, sheet] of Object.entries(SHEETS)) {
    if (!want(sheet) && !want(`frag-${kind}`)) continue;
    if (!exists(sheet)) { log('PENDING (missing source):', sheet); continue; }
    tasks.push(async () => {
      const txt = await run('sheet-boxes.mjs', [BASE, rel(sheet), '--alpha', '24', '--pad', '10']);
      const boxes = [...txt.matchAll(/--crop (\d+,\d+,\d+,\d+)/g)].map((m) => m[1]);
      log(kind, boxes.length, 'pieces');
      // drop stale outputs for this kind
      for (const f of fs.readdirSync(path.join(OUT, 'frag'))) if (new RegExp(`^${kind}-(\\d+|atlas)\\.`).test(f)) fs.unlinkSync(path.join(OUT, 'frag', f));
      // Boxes of neighbouring pieces overlap, so a crop can contain slivers of
      // the next piece. Isolate each piece: keep only its own connected blob
      // (plus a dilated halo band) in a temp sheet, then crop that.
      const iso = await isolate(png(sheet), boxes);
      for (let i = 0; i < boxes.length; i++) {
        const base = path.join(CUT, `${kind}-${i + 1}`);
        const tmpName = `_raw/iso-${kind}-${i + 1}`;
        await sharp(iso[i], { raw: { width: iso.W, height: iso.H, channels: 4 } }).png().toFile(path.join(GEN, `${tmpName}.png`));
        log(await cutout(tmpName, base, ['--crop', boxes[i], '--erode', '2', '--margin', '4', '--max', '1024', '--q', '0.88']));
        fs.copyFileSync(`${base}.webp`, path.join(OUT, 'frag', `${kind}-${i + 1}.webp`));
      }
      // atlas: 256px cells, each piece contained and centred
      const CELL = 256, PAD = 8, count = boxes.length, cols = Math.ceil(Math.sqrt(count)), rows = Math.ceil(count / cols);
      const comps = [];
      for (let i = 0; i < count; i++) {
        const buf = await sharp(`${path.join(CUT, `${kind}-${i + 1}`)}.png`).resize(CELL - 2 * PAD, CELL - 2 * PAD, { fit: 'inside' }).png().toBuffer();
        const m = await sharp(buf).metadata();
        comps.push({ input: buf, left: (i % cols) * CELL + Math.round((CELL - m.width) / 2), top: Math.floor(i / cols) * CELL + Math.round((CELL - m.height) / 2) });
      }
      await sharp({ create: { width: cols * CELL, height: rows * CELL, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
        .composite(comps).webp({ quality: 90, alphaQuality: 100 }).toFile(path.join(OUT, 'frag', `${kind}-atlas.webp`));
      fs.writeFileSync(path.join(OUT, 'frag', `${kind}-atlas.json`), JSON.stringify({ cell: CELL, cols, rows, count }) + '\n');
    });
  }

  await pool(tasks, JOBS);

  // comps -> JPEG reference
  const compDir = path.join(ROOT, 'design-reference/comps'); mkdir(compDir);
  for (const n of COMPS) if (want(n)) await sharp(png(n)).jpeg({ quality: 82 }).toFile(path.join(compDir, `${n}.jpg`));

  // manifest
  const files = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); e.isDirectory() ? walk(p) : files.push(p); } };
  walk(OUT);
  const items = [];
  for (const p of files.sort()) {
    const r = path.relative(OUT, p).split(path.sep).join('/');
    if (r === 'manifest.json') continue;
    const bytes = fs.statSync(p).size;
    if (p.endsWith('.webp')) { const m = await sharp(p).metadata(); items.push({ file: r, w: m.width, h: m.height, bytes }); }
    else items.push({ file: r, bytes });
  }
  const totalBytes = items.reduce((s, i) => s + i.bytes, 0);
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify({ totalBytes, count: items.length, files: items }, null, 1) + '\n');
  log('manifest:', items.length, 'files,', (totalBytes / 1048576).toFixed(2), 'MB');

  // contact sheets (every shipped cut-out on dark and light)
  if (!flag('no-check')) {
    const cutouts = items.filter((i) => i.w && !/(-1280|atlas)\.webp$/.test(i.file) && !/^(s1-sky|s2-surface|s3-ocean|s5-deep|ui-)/.test(i.file));
    const T = 320, COLS = 8, rowsN = Math.ceil(cutouts.length / COLS);
    const checkDir = path.join(ROOT, 'design-reference/art-check'); mkdir(checkDir);
    const thumbs = [];
    for (const c of cutouts) thumbs.push(await sharp(path.join(OUT, c.file)).resize(T - 16, T - 28, { fit: 'inside' }).png().toBuffer());
    for (const [name, bg, fg] of [['dark', '#0E2F36', '#E6EEE9'], ['light', '#E6EEE9', '#0E2F36']]) {
      const comps = [];
      for (let i = 0; i < cutouts.length; i++) {
        const m = await sharp(thumbs[i]).metadata(); const x = (i % COLS) * T, y = Math.floor(i / COLS) * T;
        comps.push({ input: thumbs[i], left: x + Math.round((T - m.width) / 2), top: y + 4 + Math.round((T - 28 - m.height) / 2) });
        const label = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${T}" height="22"><text x="6" y="16" font-family="Arial, sans-serif" font-size="14" fill="${fg}">${cutouts[i].file.replace('.webp', '')}</text></svg>`);
        comps.push({ input: label, left: x, top: y + T - 24 });
      }
      await sharp({ create: { width: COLS * T, height: rowsN * T, channels: 3, background: bg } }).composite(comps).jpeg({ quality: 85 }).toFile(path.join(checkDir, `contact-${name}.jpg`));
    }
    log('contact sheets:', cutouts.length, 'cut-outs');
  }
} finally {
  server.close();
}
