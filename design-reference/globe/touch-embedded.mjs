// Embedded-globe input checks on the story page (index.html mounts the globe in a scrolling page).
//   node design-reference/globe/touch-embedded.mjs [base=http://127.0.0.1:5179]
// Phone (390x844, touch): a one-finger vertical swipe over the globe scrolls the page, a
// horizontal drag rotates the globe, a tap drops. Desktop (1440x900): a plain wheel over the
// globe scrolls the page and shows "Hold Ctrl to zoom"; Ctrl+wheel zooms without scrolling;
// Space outside the globe does not toggle play. Fails on any console error.
import { chromium } from 'playwright';
import path from 'node:path';

const base = process.argv[2] || 'http://127.0.0.1:5179';
const out = path.join(import.meta.dirname, 'shots');
const browser = await chromium.launch({ channel: process.env.CHANNEL || 'chrome', args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const errors = [];
const report = {};
const ok = (name, cond, detail) => { report[name] = cond ? 'ok' : `FAIL ${detail ?? ''}`; };

async function openStory(opts) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(`pageerror ${e.message}`));
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`http ${r.status()} ${r.url()}`); });
  await page.goto(`${base}/index.html`, { timeout: 180000, waitUntil: 'load' });
  // Bring the globe section into view and wait for the globe and the worker.
  await page.waitForSelector('.globe__mount', { timeout: 60000 });
  await page.evaluate(() => document.querySelector('.globe__mount').scrollIntoView({ block: 'center' }));
  await page.waitForFunction(() => window.__drift && window.__drift.backend && window.__drift.ready, null, { timeout: 240000, polling: 500 });
  await page.evaluate(() => document.querySelector('.drift-globe__canvas').scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(800);
  return { ctx, page };
}

const canvasBox = (page) => page.evaluate(() => {
  const r = document.querySelector('.drift-globe__canvas').getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
});
const cameraLon = (page) => page.evaluate(() => {
  const p = window.__drift.debug().camera.position;
  return Math.atan2(p.x, p.z) * 180 / Math.PI;
});

// ---- phone ----
{
  const { ctx, page } = await openStory({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const cdp = await ctx.newCDPSession(page);
  const swipe = async (x0, y0, x1, y1, steps = 12) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] });
    for (let i = 1; i <= steps; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + (x1 - x0) * i / steps, y: y0 + (y1 - y0) * i / steps }] });
      await page.waitForTimeout(16);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(600);
  };
  const b = await canvasBox(page);
  const cx = b.x + b.w / 2, cy = Math.max(b.y + 60, Math.min(b.y + b.h * 0.4, 700));
  // Vertical swipe up over the globe: the page scrolls.
  const y0 = await page.evaluate(() => window.scrollY);
  await swipe(cx, cy + 120, cx, cy - 120);
  const y1 = await page.evaluate(() => window.scrollY);
  ok('phone: vertical swipe over the globe scrolls the page', y1 > y0 + 50, `scrollY ${y0} -> ${y1}`);
  report['phone scrollY'] = `${y0} -> ${y1}`;
  // Back into view; a horizontal drag rotates.
  await page.evaluate(() => document.querySelector('.drift-globe__canvas').scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(800);
  const b2 = await canvasBox(page);
  await page.evaluate(() => window.__drift.view(-160, 25));
  const lon0 = await cameraLon(page);
  const ys = await page.evaluate(() => window.scrollY);
  const gy = b2.y + b2.h * 0.4;
  await swipe(b2.x + b2.w * 0.75, gy, b2.x + b2.w * 0.25, gy);
  await page.waitForTimeout(800);
  const lon1 = await cameraLon(page);
  const dLon = ((lon1 - lon0 + 540) % 360) - 180;
  ok('phone: horizontal drag rotates the globe', Math.abs(dLon) > 5, `dLon ${dLon.toFixed(1)}`);
  ok('phone: horizontal drag does not scroll', Math.abs((await page.evaluate(() => window.scrollY)) - ys) < 5);
  // A tap on the ocean at the globe's centre drops a bottle.
  const before = await page.evaluate(() => window.__drift.computed().length);
  const tapPt = await page.evaluate(() => {
    const { camera, THREE } = window.__drift.debug();
    const la = 25 * Math.PI / 180, lo = -160 * Math.PI / 180;
    const v = new THREE.Vector3(Math.cos(la) * Math.sin(lo), Math.sin(la), Math.cos(la) * Math.cos(lo)).project(camera);
    const r = document.querySelector('.drift-globe__canvas').getBoundingClientRect();
    return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height };
  });
  await page.touchscreen.tap(tapPt.x, tapPt.y);
  await page.waitForFunction((n) => window.__drift.computed().length > n, before, { timeout: 60000 }).catch(() => {});
  const after = await page.evaluate(() => window.__drift.computed().length);
  ok('phone: a tap on the ocean drops', after === before + 1, `${before} -> ${after}`);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(out, '390x844-embedded-tap-drop.jpg'), type: 'jpeg', quality: 86 });
  // The sheet does not trap the scroll: no overscroll containment.
  ok('phone: sheet lets scroll chain to the page', await page.evaluate(() => getComputedStyle(document.querySelector('.globe-ui')).overscrollBehaviorY !== 'contain'));
  ok('phone: canvas touch-action is pan-y', await page.evaluate(() => getComputedStyle(document.querySelector('.drift-globe__canvas')).touchAction === 'pan-y'));
  ok('phone: no horizontal page scroll', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await ctx.close();
}

// ---- desktop ----
{
  const { ctx, page } = await openStory({ viewport: { width: 1440, height: 900 } });
  const b = await canvasBox(page);
  const mx = b.x + b.w * 0.64, my = b.y + b.h * 0.47;
  await page.mouse.move(mx, my);
  const dist = () => page.evaluate(() => window.__drift.debug().camera.position.length());
  const d0 = await dist();
  const y0 = await page.evaluate(() => window.scrollY);
  await page.mouse.wheel(0, 300);
  const hint = await page.waitForFunction(() => document.querySelector('.globe-zoomhint').classList.contains('is-on'), null, { timeout: 1000, polling: 30 }).then(() => true, () => false);
  await page.waitForTimeout(700);
  const y1 = await page.evaluate(() => window.scrollY);
  ok('desktop: plain wheel over the globe scrolls the page', y1 > y0 + 50, `scrollY ${y0} -> ${y1}`);
  ok('desktop: plain wheel shows "Hold Ctrl to zoom"', hint);
  await page.waitForTimeout(1800);
  ok('desktop: the hint fades after 1.5 s', !(await page.evaluate(() => document.querySelector('.globe-zoomhint').classList.contains('is-on'))));
  ok('desktop: plain wheel does not zoom', Math.abs((await dist()) - d0) < 0.01);
  // Ctrl+wheel zooms and does not scroll.
  await page.evaluate(() => document.querySelector('.drift-globe__canvas').scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(600);
  const b2 = await canvasBox(page);
  await page.mouse.move(b2.x + b2.w * 0.64, b2.y + b2.h * 0.47);
  const y2 = await page.evaluate(() => window.scrollY);
  const d1 = await dist();
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -400);
  await page.keyboard.up('Control');
  await page.waitForTimeout(1200);
  ok('desktop: Ctrl+wheel zooms', (await dist()) < d1 - 0.05, `${d1} -> ${await dist()}`);
  ok('desktop: Ctrl+wheel does not scroll', Math.abs((await page.evaluate(() => window.scrollY)) - y2) < 5);
  // Off screen the globe pauses (no frames drawn); back in view it resumes.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(1200);
  const fA = await page.evaluate(() => { window.__drift.resetFrames(); return 0; });
  await page.waitForTimeout(1500);
  const framesOff = await page.evaluate(() => window.__drift.frameStats().frames);
  await page.evaluate(() => document.querySelector('.drift-globe__canvas').scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(1500);
  const framesOn = await page.evaluate(() => window.__drift.frameStats().frames);
  ok('desktop: off screen the globe pauses (no frames)', framesOff <= 1 + fA, `${framesOff} frames in 1.5 s off screen`);
  ok('desktop: back in view it resumes', framesOn > framesOff + 20, `${framesOn - framesOff} frames in 1.5 s`);
  // A click on the globe does not make the plain wheel zoom (it still scrolls the page).
  const bc = await canvasBox(page);
  await page.mouse.click(bc.x + 30, bc.y + bc.h - 30);
  const yC = await page.evaluate(() => window.scrollY);
  const dC = await dist();
  await page.mouse.move(bc.x + bc.w * 0.64, bc.y + bc.h * 0.47);
  await page.mouse.wheel(0, 300);
  await page.waitForTimeout(800);
  ok('desktop: after a click, a plain wheel still scrolls the page', (await page.evaluate(() => window.scrollY)) > yC + 50 && Math.abs((await dist()) - dC) < 0.01);
  await page.evaluate(() => document.querySelector('.drift-globe__canvas').scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(800);
  // Space on the bare page is the page's, not the globe's.
  await page.evaluate(() => { document.activeElement && document.activeElement.blur(); window.__drift.play(false); });
  await page.keyboard.press('Space');
  await page.waitForTimeout(300);
  ok('desktop: Space outside the globe does not toggle play', !(await page.evaluate(() => document.querySelector('.globe-play').classList.contains('is-playing'))));
  // After a click on the globe, Space toggles play and the wheel zooms.
  await page.evaluate(() => document.querySelector('.drift-globe__canvas').scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(600);
  const b3 = await canvasBox(page);
  await page.mouse.click(b3.x + 30, b3.y + b3.h - 30); // empty sky: focuses the globe, drops nothing
  await page.keyboard.press('Space');
  await page.waitForTimeout(300);
  ok('desktop: Space with the globe focused toggles play', await page.evaluate(() => document.querySelector('.globe-play').classList.contains('is-playing')));
  await ctx.close();
}

await browser.close();
console.log(JSON.stringify(report, null, 1));
const failed = Object.values(report).some((v) => String(v).startsWith('FAIL'));
if (errors.length) console.error(`console errors (${errors.length}):\n${errors.join('\n')}`);
else console.log('no console errors');
process.exit(failed || errors.length ? 1 : 0);
