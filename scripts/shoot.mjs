/**
 * The full verification run for Drift: one Playwright pass that shoots and checks every scene and
 * state of the finished site, then builds the side-by-side comparison sheets.
 *
 *   node scripts/shoot.mjs [tag] [sizes] [--only=build,story,reduced,globe,globe-reduced,static,fps,compare]
 *
 *   tag    output folder name (default "latest"): design-reference/shots/<tag>/<size>/
 *   sizes  "all" (default) or a list such as 1440x900,390x844
 *
 * It builds the site twice into temp folders: a production build (to check that the entry chunk
 * carries neither three.js nor onnxruntime-web) and a development-mode build that keeps the
 * verification hooks (window.__drift in the globe, ?debug in the story), served by its own
 * `vite preview` on a spare port. It drives the system Chrome with WebGPU flags when installed
 * (real GPU in headless), else Playwright's bundled Chromium.
 *
 * Shots per size (1440x900, 1920x1080, 390x844), all JPEG q80:
 *   0-preloader-midfill  the stroke half filled (chapter 1's art is held back to freeze it there)
 *   0-handoff            the disc opening onto chapter 1
 *   0-intro              the intro disc, title settled, "Scroll to begin"
 *   0-begin              the disc opening to the whole frame after the first scroll
 *   N-mid                chapter N (1-6) at half its scroll, copy revealed, cursor parked
 *   NtoM-transition      the chapter transition frozen just after its swap (window.__driftHold)
 *   3-late               chapter 3 at 82 %: the headline breaking apart
 *   8-about, 8-about-model, 8-about-sources   About the science
 *   reduced-0-intro, reduced-N-mid, reduced-8-about   prefers-reduced-motion story
 *   globe-idle           the global globe, no drops
 *   globe-pacific-bottle-1y/-10y, globe-atlantic-bag-1y/-10y, globe-indian-line-1y/-10y
 *                        three drops in three oceans, scrubbed to 1 and 10 years, selected
 *   salish-idle          the Salish Sea chart
 *   salish-fraser-1d/-end  a drop at the Fraser River mouth, at 1 day and at the end of its run
 *   reduced-globe-idle   the globe with prefers-reduced-motion
 *   static-fallback      ?gl=none: the still picture (asserts "[drift] static fallback:" logged)
 *   1440x900 only: globe-20k-members (the fps scene)
 *
 * Checks (any failure exits non-zero; the table at the end lists them all):
 *   - no console error, no pageerror, no failed request or HTTP >= 400, on every page
 *   - no horizontal scroll at 390 px in every state (measured at every shot, every size)
 *   - "Simulation with uncertainty, not a forecast." visible and unobscured whenever tracks are
 *   - words over art meet WCAG AA (scripts/dev/aa.mjs) in every chapter
 *   - citation numbers follow their first appearance in the page
 *   - the static fallback logged "[drift] static fallback:"
 *   - the entry chunk (and its static imports) holds no three.js / onnxruntime, and nothing of
 *     either is requested before the globe section is near
 *   - fps with ~20,000 members at 1440x900 over 6 s: median >= 30 (target 60), p95 frame time
 *   - npm-style builds succeed
 * Writes design-reference/shots/<tag>/run.json (every number) and run-log.txt (every console
 * line: renderer backend, fallback reasons, warnings), then design-reference/compare/*.jpg.
 */

import { chromium } from 'playwright';
import { build, preview } from 'vite';
import sharp from 'sharp';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { wordsAA } from './dev/aa.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flags = Object.fromEntries(argv.filter((a) => a.startsWith('--')).map((a) => { const [k, v = '1'] = a.slice(2).split('='); return [k, v]; }));
const [TAG = 'latest', SIZE_ARG = 'all'] = argv.filter((a) => !a.startsWith('--'));
const ALL_SIZES = [[1440, 900], [1920, 1080], [390, 844]];
const SIZES = SIZE_ARG === 'all' ? ALL_SIZES : SIZE_ARG.split(',').map((s) => s.split('x').map(Number));
const ONLY = flags.only ? new Set(flags.only.split(',')) : null;
const want = (k) => !ONLY || ONLY.has(k);
const OUT = resolve(ROOT, 'design-reference/shots', TAG);
mkdirSync(OUT, { recursive: true });
const PORT = 5400 + Math.floor(Math.random() * 500);
const BASE = `http://127.0.0.1:${PORT}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const t0run = Date.now();

// ---------------- bookkeeping ----------------
const checks = []; // {name, size, pass, detail}
const logLines = [];
const numbers = {};
const shots = [];
function log(line) { const s = `[${((Date.now() - t0run) / 1000).toFixed(0).padStart(4)}s] ${line}`; console.log(s); logLines.push(s); }
function check(name, size, pass, detail = '') {
  checks.push({ name, size, pass: !!pass, detail: String(detail) });
  if (!pass) log(`  FAIL ${name} [${size}] ${detail}`);
}

// ---------------- builds ----------------
const PROD_DIR = join(tmpdir(), `drift-shoot-prod-${PORT}`);
const DEV_DIR = join(tmpdir(), `drift-shoot-dev-${PORT}`);

async function buildSite(outDir, mode) {
  const t = Date.now();
  await build({ root: ROOT, mode, logLevel: 'error', build: { outDir, emptyOutDir: true } });
  log(`built (${mode}) in ${((Date.now() - t) / 1000).toFixed(1)} s -> ${outDir}`);
}

/** The entry chunk and everything it statically imports must hold no three.js / onnxruntime. */
function checkEntryChunk(dir) {
  const html = readFileSync(join(dir, 'index.html'), 'utf8');
  const start = [...html.matchAll(/<script[^>]+type="module"[^>]+src="\/?([^"]+)"/g), ...html.matchAll(/<link[^>]+rel="modulepreload"[^>]+href="\/?([^"]+)"/g)].map((m) => m[1]);
  const seen = new Set();
  const queue = [...start];
  let bytes = 0;
  const bad = [];
  while (queue.length) {
    const rel = queue.shift();
    if (seen.has(rel)) continue;
    seen.add(rel);
    const src = readFileSync(join(dir, rel), 'utf8');
    bytes += Buffer.byteLength(src);
    if (/WebGPURenderer|REVISION\s*=\s*["']\d{3}|three\.module|ShaderMaterial/.test(src)) bad.push(`${rel}: three.js`);
    if (/onnxruntime|InferenceSession|ort-wasm/.test(src)) bad.push(`${rel}: onnxruntime`);
    const here = dirname(rel);
    for (const m of src.matchAll(/(?:^|[;}\s])(?:import|export)\s*(?:[\w*{}\s,$]+from\s*)?["'](\.{1,2}\/[^"']+\.js)["']/g)) {
      queue.push(join(here, m[1]).replace(/\\/g, '/'));
    }
  }
  numbers.entryChunk = { files: [...seen], bytes };
  log(`entry chunk: ${[...seen].join(', ')} (${(bytes / 1024).toFixed(0)} KB)`);
  check('entry chunk has no three.js / onnxruntime', 'build', bad.length === 0, bad.join('; ') || `${(bytes / 1024).toFixed(0)} KB in ${seen.size} files`);
}

// ---------------- browser ----------------
let browser;
let browserName;
try {
  browser = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
  browserName = `system Chrome ${browser.version()}`;
} catch (e) {
  browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu-rasterization', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
  browserName = `Playwright Chromium ${browser.version()} (system Chrome unavailable: ${e.message.split('\n')[0]})`;
}

// Keep the story's hook when the globe later assigns its own window.__drift.
const INIT = `(() => { let cur; Object.defineProperty(window, '__drift', { configurable: true, get() { return cur; }, set(v) { cur = v; if (v && v.story) window.__driftStory = v; } }); })();`;

async function openPage(size, label, { reduced = false, query = '', holdArt = false } = {}) {
  const [w, h] = size;
  const key = `${w}x${h}`;
  const ctx = await browser.newContext({
    viewport: { width: w, height: h },
    deviceScaleFactor: 1,
    reducedMotion: reduced ? 'reduce' : 'no-preference',
    isMobile: w < 600,
    hasTouch: w < 600,
  });
  await ctx.addInitScript(INIT);
  const page = await ctx.newPage();
  const tagLabel = `${key} ${label}`;
  const P = { ctx, page, key, w, h, label, requests: [], info: [] };
  page.on('console', (m) => {
    const text = m.text();
    const line = `${tagLabel} console.${m.type()}: ${text}`;
    logLines.push(line);
    if (m.type() === 'info' || m.type() === 'warning' || text.startsWith('[drift]')) P.info.push(text);
    if (m.type() === 'error') check('no console errors', key, false, `${label}: ${text}`);
  });
  page.on('pageerror', (e) => { logLines.push(`${tagLabel} pageerror: ${e.message}`); check('no console errors', key, false, `${label} pageerror: ${e.message}`); });
  page.on('request', (r) => P.requests.push(r.url()));
  page.on('requestfailed', (r) => {
    const err = r.failure() ? r.failure().errorText : '?';
    logLines.push(`${tagLabel} requestfailed: ${r.url()} ${err}`);
    // A request the page itself abandoned (an image unloaded mid-flight) is not a failure.
    if (!/ERR_ABORTED/.test(err)) check('no failed requests', key, false, `${label}: ${r.url()} ${err}`);
  });
  page.on('response', (r) => { if (r.status() >= 400) check('no failed requests', key, false, `${label}: HTTP ${r.status()} ${r.url()}`); });
  if (holdArt) {
    // Freeze the preloader mid-fill: hold back every other piece of chapter 1's art for a while.
    const tStart = Date.now();
    let n = 0;
    await page.route('**/art/**', async (route) => {
      if (Date.now() - tStart < 12000 && (n++ % 2 === 1)) await wait(4500);
      route.continue().catch(() => {});
    });
  }
  await page.goto(`${BASE}/index.html?debug${query}`, { waitUntil: 'commit', timeout: 120000 });
  return P;
}

async function shoot(P, name, { aaGroups = null } = {}) {
  const dir = join(OUT, P.key);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${name}.jpg`);
  await P.page.screenshot({ path: file, type: 'jpeg', quality: 80, timeout: 90000 });
  shots.push(`${P.key}/${name}.jpg`);
  const hs = await P.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  (numbers.hscroll ??= {})[`${P.key}/${name}`] = hs;
  if (P.w < 600) check('no horizontal scroll at 390', P.key, hs <= 0, `${name}: ${hs}px`);
  else if (hs > 0) check('no horizontal scroll', P.key, false, `${name}: ${hs}px`);
  log(`  ${P.key}/${name}.jpg${hs > 0 ? ` (overflow ${hs}px)` : ''}`);
}

const waitFor = (page, fn, arg, timeout = 60000, polling = 100) => page.waitForFunction(fn, arg, { timeout, polling });

async function dismissPreloader(P, { shots: take = false, reduced = false } = {}) {
  const { page } = P;
  if (take) {
    // Mid-fill: wait for the stroke to be partly full.
    const midP = await waitFor(page, () => {
      const r = document.getElementById('preloader');
      const p = r ? parseFloat(r.style.getPropertyValue('--p')) : NaN;
      return p > 0.15 && p < 0.92 && r.classList.contains('is-in') ? p : false;
    }, null, 20000, 50).then((h) => h.jsonValue()).catch(() => null);
    await wait(900);
    const p = await page.evaluate(() => { const r = document.getElementById('preloader'); return r ? parseFloat(r.style.getPropertyValue('--p')) : null; });
    (numbers.preloaderFill ??= {})[P.key] = p;
    check('preloader caught mid-fill', P.key, midP != null && p > 0.1 && p < 0.97, `progress ${p}`);
    await shoot(P, `${reduced ? 'reduced-' : ''}0-preloader-midfill`);
    await waitFor(page, () => document.querySelector('.pre.is-intro'), null, 60000);
    await wait(450);
    await shoot(P, `${reduced ? 'reduced-' : ''}0-handoff`);
  }
  await waitFor(page, () => document.querySelector('.pre.is-intro') && document.querySelector('.pre__intro.is-ready'), null, 90000);
  await wait(1600);
  if (take || reduced) await shoot(P, `${reduced ? 'reduced-' : ''}0-intro`);
  await page.mouse.move(P.w * 0.5, P.h * 0.5);
  await page.evaluate(() => window.scrollTo(0, 6));
  if (take) { await wait(500); await shoot(P, '0-begin'); }
  await waitFor(page, () => !document.getElementById('preloader'), null, 30000);
}

async function gotoChapter(page, i, t = 0.5) {
  await page.evaluate(({ i, t }) => {
    const e = window.__driftStory.story.edges;
    window.scrollTo(0, e[i] + (e[i + 1] - e[i]) * t);
  }, { i, t });
  await waitFor(page, (i) => window.__driftStory.story.current === i && !window.__driftStory.story.state.trans, i, 40000);
}

const LOADS_GLOBE = /three|onnxruntime|ort[-.]|\.onnx|\.wasm/i;

// ---------------- story ----------------
async function storyPass(size, { reduced = false } = {}) {
  const P = await openPage(size, reduced ? 'story-reduced' : 'story', { reduced, holdArt: !reduced });
  const { page, w, h, key } = P;
  const pre = reduced ? 'reduced-' : '';
  await dismissPreloader(P, { shots: !reduced, reduced });

  if (!reduced) {
    // Before the globe section is near, nothing of three.js or onnxruntime may have been fetched.
    const early = P.requests.filter((u) => LOADS_GLOBE.test(u));
    check('no three.js/onnxruntime before the globe', key, early.length === 0, early.join(', ') || `${P.requests.length} requests, none`);
  }

  const N = await page.evaluate(() => window.__driftStory.CHAPTERS.length);
  for (let i = 0; i < N; i++) {
    await gotoChapter(page, i, 0.5);
    await wait(2600); // headline settles (0.3 + 1.4 s), copy reveals (~1.85 s)
    if (!reduced && w > 600) { await page.mouse.move(w * 0.85, h * 0.8, { steps: 4 }); await wait(1400); }
    await shoot(P, `${pre}${i + 1}-mid`);
    if (i === 2 && !reduced) {
      const early = P.requests.filter((u) => LOADS_GLOBE.test(u));
      check('no three.js/onnxruntime before the globe', key, early.length === 0, `by chapter 3: ${early.join(', ') || 'none'}`);
    }
    if (!reduced) {
      const aa = await wordsAA(page, {
        headline: '.scene.is-active .hl .hl-word',
        body: w < 700 ? '.scene.is-active .copy__body p.is-step' : '.scene.is-active .copy__body p',
        cite: '.scene.is-active .cite a',
        chrome: '.chrome a',
        chapter: '.chapters__title',
      });
      (numbers.aa ??= {})[`${key}/ch${i + 1}`] = aa;
      for (const [k, v] of Object.entries(aa)) check('words over art meet AA', key, v.pass, `ch${i + 1} ${k}: ${v.ratio} (need ${v.need}) "${v.text}"`);
      if (w > 600) await page.mouse.move(w * 0.5, h * 0.5, { steps: 2 });
    }
    if (!reduced && i < N - 1) {
      await page.evaluate(() => { window.__driftHold = 0.56; });
      await page.evaluate(({ i }) => { const e = window.__driftStory.story.edges; window.scrollTo(0, e[i + 1] + 4); }, { i });
      await waitFor(page, (i) => { const s = window.__driftStory.story.state.trans; return s && s.to === i + 1; }, i, 40000);
      await wait(300);
      await shoot(P, `${i + 1}to${i + 2}-transition`);
      await page.evaluate(() => { delete window.__driftHold; });
    }
  }
  if (!reduced) {
    await gotoChapter(page, 2, 0.82);
    await wait(1800);
    await shoot(P, '3-late');
  }

  // About
  await page.evaluate(() => document.getElementById('about').scrollIntoView());
  await wait(1800);
  await shoot(P, `${pre}8-about`);
  if (!reduced) {
    await page.evaluate(() => { const m = document.querySelector('[data-about="model"]'); m.scrollIntoView(); window.scrollBy(0, -80); });
    await wait(900);
    await shoot(P, '8-about-model');
    await page.evaluate(() => { document.getElementById('sources').scrollIntoView(); window.scrollBy(0, -40); });
    await wait(700);
    await shoot(P, '8-about-sources');
    // Citation numbers in order of first appearance (document order: chapters, then About).
    const seq = await page.evaluate(() => [...document.querySelectorAll('sup.cite a')].map((a) => Number(a.textContent)));
    const first = [];
    for (const n of seq) if (!first.includes(n)) first.push(n);
    const inOrder = first.every((n, k) => n === k + 1);
    check('citations numbered by first appearance', key, inOrder, first.join(','));
  }
  await P.ctx.close();
}

// ---------------- globe ----------------
async function toGlobe(P, mode = 'global') {
  const { page } = P;
  await page.evaluate(() => document.getElementById('globe').scrollIntoView());
  await waitFor(page, () => window.__drift && !window.__drift.story && window.__drift.backend && window.__drift.ready, null, 240000, 500);
  if (mode === 'salish') {
    await page.click('.globe__switch [data-mode="salish"]');
    await waitFor(page, () => window.__drift && window.__drift.mode === 'salish' && window.__drift.backend && window.__drift.ready, null, 240000, 500);
  }
  await page.evaluate(() => document.getElementById('globe').scrollIntoView());
  await wait(1200);
}

/** The disclaimer must be on screen, opaque and on top wherever tracks are drawn. */
async function disclaimerVisible(P, name) {
  const r = await P.page.evaluate(() => {
    const el = document.querySelector('.globe-disclaimer');
    if (!el) return { ok: false, why: 'missing' };
    const b = el.getBoundingClientRect();
    if (b.width < 2 || b.bottom <= 0 || b.top >= innerHeight || b.right <= 0 || b.left >= innerWidth) return { ok: false, why: `off screen ${Math.round(b.left)},${Math.round(b.top)} ${Math.round(b.width)}x${Math.round(b.height)}` };
    for (let e = el; e; e = e.parentElement) { const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.5) return { ok: false, why: `hidden by ${e.className}` }; }
    // The label has pointer-events: none; switch them on for the hit test, so whatever sits on
    // top of it at its corners and centre is what elementFromPoint returns.
    const pe = el.style.pointerEvents;
    el.style.pointerEvents = 'auto';
    const pts = [[0.5, 0.5], [0.08, 0.3], [0.92, 0.3], [0.08, 0.7], [0.92, 0.7]].map(([fx, fy]) => [Math.min(innerWidth - 1, b.left + b.width * fx), Math.min(innerHeight - 1, b.top + b.height * fy)]);
    const over = pts.map(([x, y]) => document.elementFromPoint(x, y)).filter((n) => n && !el.contains(n));
    el.style.pointerEvents = pe;
    return { ok: over.length === 0, why: over.length ? `covered by ${over.map((n) => n.className || n.tagName).join(', ')}` : `at ${Math.round(b.left)},${Math.round(b.top)}`, text: el.textContent };
  });
  check('disclaimer visible with tracks', P.key, r.ok && /Simulation with uncertainty, not a forecast\./.test(r.text || ''), `${name}: ${r.why}`);
}

const OCEANS = [
  { name: 'pacific', item: 'bottle', lon: 150, lat: 33, view: [-175, 28] },
  { name: 'atlantic', item: 'bag', lon: -45, lat: 34, view: [-42, 32] },
  { name: 'indian', item: 'line', lon: 78, lat: -18, view: [78, -22] },
];

async function globePass(size) {
  const P = await openPage(size, 'globe');
  const { page, key } = P;
  await dismissPreloader(P);
  await toGlobe(P);
  const backend = await page.evaluate(() => window.__drift.backend);
  (numbers.backend ??= {})[key] = backend;
  log(`  ${key} globe backend: ${backend}`);
  await page.evaluate(() => window.__drift.view(-150, 22));
  await wait(2500);
  await shoot(P, 'globe-idle');

  // Three drops, three oceans, three items, computed together.
  const t = Date.now();
  const ids = [];
  for (const o of OCEANS) {
    const land = await page.evaluate(([lon, lat]) => window.__drift.isLand(lon, lat), [o.lon, o.lat]);
    if (land) check('ocean drop points are at sea', key, false, `${o.name} ${o.lon},${o.lat}`);
    ids.push(await page.evaluate((o) => window.__drift.drop(o.item, o.lon, o.lat, 11), o));
  }
  check('three ocean drops accepted', key, ids.every((x) => x != null), ids.join(','));
  await waitFor(page, (ids) => ids.every((id) => { const c = window.__drift.computed().find((x) => x.dropId === id); return c && (c.day >= 3650 || c.done); }), ids, 1200000, 2000);
  (numbers.globeSimSeconds ??= {})[key] = (Date.now() - t) / 1000;
  log(`  ${key} three drops computed to 10 y in ${((Date.now() - t) / 1000).toFixed(0)} s`);
  for (const [k, o] of OCEANS.entries()) {
    for (const [day, label] of [[365, '1y'], [3650, '10y']]) {
      await page.evaluate(([id, day, v]) => { window.__drift.view(v[0], v[1]); window.__drift.setDay(day); window.__drift.select(id); }, [ids[k], day, o.view]);
      await wait(1800);
      await shoot(P, `globe-${o.name}-${o.item}-${label}`);
      await disclaimerVisible(P, `globe-${o.name}-${label}`);
    }
  }

  // Salish Sea: the switch, a drop at the Fraser mouth, scrubbed to 1 day and to the end.
  try {
    await toGlobe(P, 'salish');
    await wait(1500);
    await shoot(P, 'salish-idle');
    const ts = Date.now();
    const id = await page.evaluate(() => window.__drift.dropAtMouth(5));
    check('Fraser mouth drop accepted', key, id != null, String(id));
    await waitFor(page, (id) => { const c = window.__drift.computed().find((x) => x.dropId === id); return c && c.done; }, id, 900000, 1000);
    (numbers.salishSimSeconds ??= {})[key] = (Date.now() - ts) / 1000;
    for (const [hrs, label] of [[24, '1d'], [1e9, 'end']]) {
      await page.evaluate(([id, hrs]) => { window.__drift.setDay(hrs); window.__drift.select(id); }, [id, hrs]);
      await wait(1800);
      await shoot(P, `salish-fraser-${label}`);
      await disclaimerVisible(P, `salish-fraser-${label}`);
    }
    numbers.salishEndHours = await page.evaluate(() => window.__drift.t);
  } catch (e) {
    check('Salish view runs', key, false, e.message.split('\n')[0]);
  }
  await P.ctx.close();
}

async function globeReducedPass(size) {
  const P = await openPage(size, 'globe-reduced', { reduced: true });
  await dismissPreloader(P);
  await toGlobe(P);
  await P.page.evaluate(() => window.__drift.view(-150, 22));
  await wait(2000);
  await shoot(P, 'reduced-globe-idle');
  await P.ctx.close();
}

async function staticPass(size) {
  const P = await openPage(size, 'static', { query: '&gl=none' });
  await dismissPreloader(P);
  await P.page.evaluate(() => document.getElementById('globe').scrollIntoView());
  await waitFor(P.page, () => { const i = document.querySelector('.globe-static img, .globe__fallback'); return i && i.complete && i.naturalWidth > 0; }, null, 120000, 250);
  await wait(1500);
  await shoot(P, 'static-fallback');
  const line = P.info.find((l) => l.startsWith('[drift] static fallback:'));
  numbers.fallbackReason = line || null;
  check('static fallback logged', P.key, !!line, line || 'no "[drift] static fallback:" line');
  await P.ctx.close();
}

// ---------------- fps ----------------
async function fpsPass() {
  const P = await openPage([1440, 900], 'fps');
  const { page } = P;
  await dismissPreloader(P);
  await toGlobe(P);
  const t = Date.now();
  // ~20,000 members: 833 bottle drops at random ocean points, computed to day 120.
  const setup = await page.evaluate(async () => {
    const D = window.__drift;
    D.view(-160, 20);
    let s = 7; const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const ps = [];
    while (ps.length < 833) {
      const lon = rnd() * 360 - 180, lat = rnd() * 110 - 55;
      if (!D.isLand(lon, lat)) ps.push(D.drop('bottle', lon, lat));
    }
    await Promise.all(ps);
    const t1 = performance.now();
    while (performance.now() - t1 < 1500000) {
      if (Math.min(...D.computed().map((x) => x.day)) >= 120) break;
      await new Promise((r) => setTimeout(r, 2000));
    }
    const res = { simMs: performance.now() - t1, minDay: Math.min(...D.computed().map((x) => x.day)), drops: D.computed().length };
    D.stopSim(); // the worker must not compete for the CPU while frames are timed
    return res;
  });
  log(`  fps setup: ${setup.drops} drops to day ${setup.minDay} in ${(setup.simMs / 1000).toFixed(0)} s (${((Date.now() - t) / 1000).toFixed(0)} s total)`);
  const measure = (play) => page.evaluate(async (play) => {
    const D = window.__drift;
    if (play) { D.setDay(0); D.speed(30); D.play(true); } else { D.play(false); D.setDay(60); }
    await new Promise((r) => setTimeout(r, 1500));
    const dts = [];
    let last = performance.now();
    await new Promise((resolve) => {
      const end = last + 6000;
      const tick = (now) => { dts.push(now - last); last = now; if (now < end) requestAnimationFrame(tick); else resolve(); };
      requestAnimationFrame((now) => { last = now; requestAnimationFrame(tick); });
    });
    D.play(false);
    dts.sort((a, b) => a - b);
    const p50 = dts[dts.length >> 1], p95 = dts[Math.floor(dts.length * 0.95)];
    const mean = dts.reduce((s, v) => s + v, 0) / dts.length;
    return { frames: dts.length, seconds: 6, medianFps: +(1000 / p50).toFixed(1), meanFps: +(1000 / mean).toFixed(1), p50Ms: +p50.toFixed(2), p95Ms: +p95.toFixed(2), members: D.members, cpu: D.cpu() };
  }, play);
  const paused = await measure(false);
  const playing = await measure(true);
  await page.evaluate(() => window.__drift.setDay(60));
  await wait(1500);
  await shoot(P, 'globe-20k-members');
  numbers.fps = { target: 60, failBelow: 30, backend: await page.evaluate(() => window.__drift.backend), setup, paused, playing30x: playing };
  log(`  fps (target 60, fail < 30): paused ${paused.medianFps} median / p95 ${paused.p95Ms} ms; playing 30x ${playing.medianFps} median / p95 ${playing.p95Ms} ms; ${paused.members} members`);
  check('fps >= 30 with ~20k members', '1440x900', Math.min(paused.medianFps, playing.medianFps) >= 30, `paused ${paused.medianFps}, playing ${playing.medianFps} fps median (target 60); p95 ${paused.p95Ms}/${playing.p95Ms} ms; ${paused.members} members`);
  check('~20,000 members on the globe', '1440x900', paused.members >= 15000, `${paused.members}`);
  await P.ctx.close();
}

// ---------------- comparison sheets ----------------
// makemepulse keyframe sheet: 4 x 4 tiles of 400 x 250 under a 22 px label.
const MMP = 'design-reference/compare/makemepulse_1440x900_keyframes.jpg';
const mmpTile = (i) => ({ left: (i % 4) * 400, top: Math.floor(i / 4) * 272 + 22, width: 400, height: 250 });
const MMP_NAMES = ['preloader +291ms', 'preloader +10957ms', 'preloader +18507ms', 'preloader +27723ms', 'landing idle', 'landing hover Enter', 'reveal +592ms', 'reveal +1492ms', 'start button hover', 'start -> scene1', 'scene1', 'scene2', 'scene3', 'scene4', 'ending +1s', 'ending settled'];
const SHEETS = [
  ['0-preloader', 'comp-0-preloader', '0-preloader-midfill', 2],
  ['0-handoff', 'comp-0-preloader', '0-intro', 6],
  ['1-bottle', 'comp-1-bottle', '1-mid', 10],
  ['2-breaks', 'comp-2-breaks', '2-mid', 11],
  ['3-currents', 'comp-3-currents', '3-mid', 12],
  ['4-gyre', 'comp-4-gyre', '4-mid', 7],
  ['5-deep', 'comp-5-deep', '5-mid', 4],
  ['6-yours', 'comp-6-globe', '6-mid', 15],
  ['globe', 'comp-6-globe', 'globe-pacific-bottle-10y', 7],
  ['salish', 'comp-7-salish', 'salish-fraser-end', 13],
  ['about', 'comp-8-about', '8-about', 15],
];
async function compareSheets() {
  const dir = join(OUT, '1440x900');
  const out = resolve(ROOT, 'design-reference/compare');
  const W = 720, H = 450, L = 30;
  const label = (t) => Buffer.from(`<svg width="${W}" height="${L}"><text x="8" y="21" fill="#E6EEE9" font-size="16" font-family="Arial">${t.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text></svg>`);
  for (const [name, comp, shot, tile] of SHEETS) {
    const ours = join(dir, `${shot}.jpg`);
    if (!existsSync(ours)) { log(`  compare ${name}: no shot ${shot}`); continue; }
    const parts = [
      [await sharp(resolve(ROOT, `design-reference/comps/${comp}.jpg`)).resize(W, H, { fit: 'cover' }).toBuffer(), `comp: ${comp}`],
      [await sharp(ours).resize(W, H, { fit: 'cover' }).toBuffer(), `ours: ${TAG}/1440x900/${shot}`],
      [await sharp(resolve(ROOT, MMP)).extract(mmpTile(tile)).resize(W, H, { fit: 'cover' }).toBuffer(), `makemepulse: ${MMP_NAMES[tile]}`],
    ];
    const comps = [];
    parts.forEach(([buf, t], i) => { comps.push({ input: buf, left: i * (W + 8), top: L }, { input: label(t), left: i * (W + 8), top: 0 }); });
    const file = join(out, `three-up-${name}.jpg`);
    await sharp({ create: { width: 3 * W + 16, height: H + L, channels: 3, background: '#0E2F36' } }).composite(comps).jpeg({ quality: 80 }).toFile(file);
    log(`  design-reference/compare/three-up-${name}.jpg`);
  }
}

// ---------------- run ----------------
let server;
async function step(name, fn) {
  try { await fn(); } catch (e) { check(`${name} completes`, '-', false, e.message.split('\n')[0]); log(e.stack || e.message); }
}
try {
  log(`drift shoot "${TAG}" sizes ${SIZES.map((s) => s.join('x')).join(', ')} with ${browserName}`);
  numbers.browser = browserName;
  if (want('build')) {
    await step('production build', async () => { await buildSite(PROD_DIR, 'production'); checkEntryChunk(PROD_DIR); check('production build', 'build', true); });
  }
  await buildSite(DEV_DIR, 'development');
  server = await preview({ root: ROOT, logLevel: 'error', build: { outDir: DEV_DIR }, preview: { port: PORT, strictPort: true, host: '127.0.0.1' } });
  log(`serving ${DEV_DIR} at ${BASE}`);
  for (const size of SIZES) {
    const key = size.join('x');
    log(`== ${key}`);
    if (want('story')) await step(`story ${key}`, () => storyPass(size));
    if (want('reduced')) await step(`reduced story ${key}`, () => storyPass(size, { reduced: true }));
    if (want('globe')) await step(`globe ${key}`, () => globePass(size));
    if (want('globe-reduced')) await step(`reduced globe ${key}`, () => globeReducedPass(size));
    if (want('static')) await step(`static ${key}`, () => staticPass(size));
  }
  if (want('fps') && SIZES.some(([w]) => w === 1440)) { log('== fps'); await step('fps', fpsPass); }
  if (want('compare')) { log('== compare'); await step('compare sheets', compareSheets); }
} finally {
  await browser.close();
  if (server) await new Promise((r) => server.httpServer.close(r));
  for (const d of [PROD_DIR, DEV_DIR]) rmSync(d, { recursive: true, force: true });
}

// ---------------- report ----------------
const rows = new Map();
for (const c of checks) {
  const r = rows.get(c.name) || { name: c.name, sizes: {}, fails: [] };
  r.sizes[c.size] = (r.sizes[c.size] ?? true) && c.pass;
  if (!c.pass) r.fails.push(`[${c.size}] ${c.detail}`);
  rows.set(c.name, r);
}
const failed = [...rows.values()].some((r) => r.fails.length);
const summary = {
  tag: TAG, date: new Date().toISOString(), seconds: Math.round((Date.now() - t0run) / 1000), result: failed ? 'FAIL' : 'PASS',
  sizes: SIZES.map((s) => s.join('x')), numbers, checks: [...rows.values()], shots,
};
writeFileSync(join(OUT, 'run.json'), JSON.stringify(summary, null, 1));
writeFileSync(join(OUT, 'run-log.txt'), logLines.join('\n'));

console.log('\n' + '-'.repeat(96));
for (const r of rows.values()) {
  const pass = !r.fails.length;
  const where = Object.entries(r.sizes).map(([s, ok]) => `${s}${ok ? '' : '!'}`).join(' ');
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${r.name.padEnd(46)} ${where}`);
  for (const f of r.fails.slice(0, 6)) console.log(`        ${f}`);
  if (r.fails.length > 6) console.log(`        ... ${r.fails.length - 6} more`);
}
if (numbers.fps) console.log(`\nfps @1440x900, ${numbers.fps.paused.members} members, ${numbers.fps.backend}: target 60, fail < 30 | paused median ${numbers.fps.paused.medianFps} fps, p95 ${numbers.fps.paused.p95Ms} ms | playing 30x median ${numbers.fps.playing30x.medianFps} fps, p95 ${numbers.fps.playing30x.p95Ms} ms`);
console.log(`\n${failed ? 'FAIL' : 'PASS'}  ${shots.length} shots in design-reference/shots/${TAG}/ (${summary.seconds} s)`);
process.exitCode = failed ? 1 : 0;
