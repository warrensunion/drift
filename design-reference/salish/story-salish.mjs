// The story page's mode switch mounts the Salish view (MODES); on a phone with touch, a vertical
// swipe over the chart scrolls the page and a tap on the water drops.
//   node design-reference/salish/story-salish.mjs [base=http://127.0.0.1:5179]
import { chromium } from 'playwright';
import path from 'node:path';
const base = process.argv[2] || 'http://127.0.0.1:5179';
const browser = await chromium.launch({ channel: process.env.CHANNEL || 'chrome', args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(`pageerror ${e.message}`));
await page.goto(`${base}/index.html`, { timeout: 180000, waitUntil: 'load' });
await page.waitForSelector('.globe__mount', { timeout: 60000 });
await page.evaluate(() => document.querySelector('.globe__mount').scrollIntoView({ block: 'center' }));
await page.waitForFunction(() => window.__drift && window.__drift.ready, null, { timeout: 240000, polling: 500 });
await page.evaluate(() => document.querySelector('[data-mode="salish"]').click());
await page.waitForFunction(() => window.__drift && window.__drift.mode === 'salish' && window.__drift.ready, null, { timeout: 240000, polling: 500 });
await page.evaluate(() => document.querySelector('.drift-salish .drift-globe__canvas').scrollIntoView({ block: 'center' }));
await page.waitForTimeout(1000);
const report = {};
const box = await page.evaluate(() => { const r = document.querySelector('.drift-salish .drift-globe__canvas').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
const cdp = await ctx.newCDPSession(page);
const swipe = async (x0, y0, x1, y1) => {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] });
  for (let i = 1; i <= 12; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + (x1 - x0) * i / 12, y: y0 + (y1 - y0) * i / 12 }] }); await page.waitForTimeout(16); }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(600);
};
const y0 = await page.evaluate(() => window.scrollY);
const cx = box.x + box.w / 2, cy = Math.min(box.y + box.h * 0.35, 600);
await swipe(cx, cy + 100, cx, cy - 100);
const y1 = await page.evaluate(() => window.scrollY);
report['vertical swipe scrolls the page'] = `${y1 > y0 + 40 ? 'ok' : 'FAIL'} (${y0} -> ${y1})`;
await page.evaluate(() => document.querySelector('.drift-salish .drift-globe__canvas').scrollIntoView({ block: 'center' }));
await page.waitForTimeout(800);
const pt = await page.evaluate(() => { const r = document.querySelector('.drift-salish .drift-globe__canvas').getBoundingClientRect(); const [x, y] = window.__drift.toScreen(-123.34, 49.13); return { x: r.left + x, y: r.top + y }; });
await page.touchscreen.tap(pt.x, pt.y);
await page.waitForFunction(() => window.__drift.computed().length === 1, null, { timeout: 60000 }).catch(() => {});
report['tap on the water drops'] = (await page.evaluate(() => window.__drift.computed().length)) === 1 ? 'ok' : 'FAIL';
await page.waitForTimeout(4000);
await page.screenshot({ path: path.join(import.meta.dirname, 'shots', '390x844-story-salish-tap.jpg'), type: 'jpeg', quality: 86 });
await browser.close();
console.log(JSON.stringify(report, null, 1));
if (errors.length) console.error(`console errors (${errors.length}):\n${errors.join('\n')}`);
process.exit(Object.values(report).some((v) => v.startsWith('FAIL')) ? 1 : 0);
