// Globe verification shots + fps, against a dev-mode build of globe.html served locally.
//   DRIFT_PAGES=globe.html npx vite build --mode development --outDir <dir> --emptyOutDir
//   npx vite preview --outDir <dir> --port 5179
//   node design-reference/globe/shoot-globe.mjs [base=http://127.0.0.1:5179] [--fps] [--gl=webgl2]
// Uses the system Chrome (channel 'chrome') so headless runs on the real GPU; CHANNEL=chromium
// falls back to Playwright's bundled browser (SwiftShader, slow). Fails on any console error.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const base = args.find((a) => a.startsWith('http')) || 'http://127.0.0.1:5179';
const doFps = args.includes('--fps');
const gl = (args.find((a) => a.startsWith('--gl=')) || '').slice(5);
const only = (args.find((a) => a.startsWith('--only=')) || '').slice(7);
const outDir = path.join(import.meta.dirname, 'shots');
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  channel: process.env.CHANNEL === 'chromium' ? undefined : process.env.CHANNEL || 'chrome',
  args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist'],
});
const errors = [];
const report = {};

async function open(w, h, query = '', opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, ...opts });
  const page = await ctx.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`${w}x${h}${query}: ${m.text()}`);
    if (m.type() === 'info' && m.text().startsWith('[drift]')) console.log(`  ${w}x${h}${query} ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`${w}x${h}${query}: pageerror ${e.message}`));
  const q = [query, gl ? `gl=${gl}` : ''].filter(Boolean).join('&');
  await page.goto(`${base}/globe.html${q ? `?${q.replace(/^\?/, '')}` : ''}`, { timeout: 180000, waitUntil: 'commit' });
  if (opts.static) return { ctx, page };
  await page.waitForFunction(() => window.__drift && window.__drift.backend && window.__drift.fps > 0, null, { timeout: 180000 });
  await page.waitForFunction(() => window.__drift.ready, null, { timeout: 180000 });
  return { ctx, page };
}

const shot = (page, name) => page.screenshot({ path: path.join(outDir, `${name}.jpg`), type: 'jpeg', quality: 86 });

async function dropAndScrub(page, prefix, w) {
  // North Pacific: a bottle off Japan, as in the comp.
  await page.evaluate(() => { window.__drift.view(-170, 26); });
  const id = await page.evaluate(() => window.__drift.drop('bottle', 150, 33));
  await page.waitForFunction((id) => {
    const c = window.__drift.computed().find((x) => x.dropId === id);
    return c && c.day >= 3650;
  }, id, { timeout: 600000, polling: 1000 });
  for (const [day, label] of [[365, '1y'], [3650, '10y']]) {
    await page.evaluate(([id, day]) => { window.__drift.setDay(day); window.__drift.select(id); }, [id, day]);
    await page.waitForTimeout(1500);
    await shot(page, `${prefix}-drop-${label}`);
  }
  const noScroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  report[`${prefix} no horizontal scroll`] = noScroll;
}

for (const [w, h] of [[1440, 900], [390, 844]]) {
  if (only && only !== `${w}`) continue;
  const tag = `${w}x${h}${gl ? `-${gl}` : ''}`;
  const mobile = w < 760 ? { isMobile: true, hasTouch: true } : {};
  const { ctx, page } = await open(w, h, '', mobile);
  await page.evaluate(() => window.__drift.view(-165, 24));
  await page.waitForTimeout(2500);
  await shot(page, `${tag}-idle`);
  report[`${tag} backend`] = await page.evaluate(() => window.__drift.backend);
  // A tap on land is refused.
  await page.evaluate(() => window.__drift.view(-110, 35));
  await page.waitForTimeout(800);
  const landPt = await page.evaluate(() => {
    const { camera, THREE } = window.__drift.debug();
    const la = 40 * Math.PI / 180, lo = -100 * Math.PI / 180;
    const v = new THREE.Vector3(Math.cos(la) * Math.sin(lo), Math.sin(la), Math.cos(la) * Math.cos(lo)).project(camera);
    return { x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight };
  });
  if (w < 760) await page.touchscreen.tap(landPt.x, landPt.y);
  else await page.mouse.click(landPt.x, landPt.y);
  await page.waitForTimeout(300);
  report[`${tag} land toast`] = await page.evaluate(() => document.querySelector('.globe-toast').textContent);
  report[`${tag} drops after land tap`] = await page.evaluate(() => window.__drift.computed().length);
  await shot(page, `${tag}-land-refused`);
  await dropAndScrub(page, tag, w);
  await ctx.close();
}

if (!only || only === 'reduced') {
  const { ctx, page } = await open(1440, 900, '', { reducedMotion: 'reduce' });
  await page.waitForTimeout(2500);
  await shot(page, `1440x900${gl ? `-${gl}` : ''}-reduced-motion`);
  await ctx.close();
}

if (!only || only === 'static') {
  const { ctx, page } = await open(1440, 900, '?gl=none', { static: true });
  await page.waitForSelector('.globe-static img', { timeout: 120000 });
  await page.waitForTimeout(1500);
  await shot(page, '1440x900-static-fallback');
  await ctx.close();
}

if (doFps) {
  const { ctx, page } = await open(1440, 900);
  const r = await page.evaluate(async () => {
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
    while (performance.now() - t1 < 900000) {
      if (Math.min(...D.computed().map((x) => x.day)) >= 60) break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    const simMs = performance.now() - t1;
    D.setDay(45);
    await new Promise((r) => setTimeout(r, 1500));
    D.resetFrames();
    await new Promise((r) => setTimeout(r, 5000));
    const paused = D.frameStats(), cpuPaused = D.cpu(), members = D.members;
    D.setDay(0); D.speed(30); D.play(true);
    await new Promise((r) => setTimeout(r, 500));
    D.resetFrames();
    await new Promise((r) => setTimeout(r, 5000));
    const playing = D.frameStats(), cpuPlaying = D.cpu();
    D.play(false); D.setDay(45);
    return { members, simMs, paused, cpuPaused, playing, cpuPlaying, backend: D.backend };
  });
  await page.waitForTimeout(1500);
  await shot(page, `1440x900${gl ? `-${gl}` : ''}-20k-members`);
  report.fps = r;
  await ctx.close();
}

await browser.close();
console.log(JSON.stringify(report, null, 1));
if (errors.length) {
  console.error(`console errors (${errors.length}):\n${errors.join('\n')}`);
  process.exit(1);
}
console.log('no console errors');
