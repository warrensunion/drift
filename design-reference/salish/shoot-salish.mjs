// Salish Sea view shots and checks, against a dev-mode build served locally (see
// design-reference/globe/shoot-globe.mjs for the build/preview commands).
//   node design-reference/salish/shoot-salish.mjs [base=http://127.0.0.1:5179]
// 1440x900 and 390x844 (touch): idle; a river-mouth drop at 1 day and 10 days; a tap on land is
// refused; a tap on water drops (touch at 390); fps. Fails on any console error.
import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';

const base = process.argv.find((a) => a.startsWith('http')) || 'http://127.0.0.1:5179';
const out = path.join(import.meta.dirname, 'shots');
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: process.env.CHANNEL || 'chrome', args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const errors = [];
const report = {};
const shot = (page, name) => page.screenshot({ path: path.join(out, `${name}.jpg`), type: 'jpeg', quality: 86 });

for (const [w, h] of [[1440, 900], [390, 844]]) {
  const phone = w < 760;
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: phone ? 2 : 1, ...(phone ? { isMobile: true, hasTouch: true } : {}) });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${w}: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`${w}: pageerror ${e.message}`));
  await page.goto(`${base}/globe.html?mode=salish`, { timeout: 180000, waitUntil: 'commit' });
  await page.waitForFunction(() => window.__drift && window.__drift.mode === 'salish' && window.__drift.ready && window.__drift.fps > 0, null, { timeout: 240000, polling: 500 });
  await page.waitForTimeout(3000);
  await shot(page, `${w}x${h}-idle`);
  const tag = `${w}x${h}`;
  // A tap on land (Richmond) is refused.
  const land = await page.evaluate(() => window.__drift.toScreen(-123.13, 49.165));
  if (phone) await page.touchscreen.tap(land[0], land[1]); else await page.mouse.click(land[0], land[1]);
  await page.waitForTimeout(300);
  report[`${tag} land tap toast`] = await page.evaluate(() => document.querySelector('.globe-toast').textContent);
  report[`${tag} drops after land tap`] = await page.evaluate(() => window.__drift.computed().length);
  // A tap on the water (off Sand Heads) drops.
  const water = await page.evaluate(() => window.__drift.toScreen(-123.34, 49.13));
  if (phone) await page.touchscreen.tap(water[0], water[1]); else await page.mouse.click(water[0], water[1]);
  await page.waitForFunction(() => window.__drift.computed().length === 1, null, { timeout: 60000 }).catch(() => {});
  report[`${tag} drops after water tap`] = await page.evaluate(() => window.__drift.computed().length);
  await page.evaluate(() => window.__drift.clear());
  await page.waitForFunction(() => window.__drift.computed().length === 0, null, { timeout: 60000 });
  // The primary action: drop at the river mouth (a fixed seed for repeatable shots).
  const id = await page.evaluate(() => window.__drift.dropAtMouth(7));
  await page.evaluate((id) => window.__drift.select(id), id);
  await page.waitForFunction((id) => { const c = window.__drift.computed().find((x) => x.dropId === id); return c && c.day >= 720; }, id, { timeout: 600000, polling: 1000 });
  for (const [hours, label] of [[24, '1d'], [240, '10d']]) {
    await page.evaluate(([id, hrs]) => { window.__drift.setDay(hrs); window.__drift.select(id); }, [id, hours]);
    await page.waitForTimeout(1500);
    await shot(page, `${tag}-mouth-${label}`);
    report[`${tag} panel at ${label}`] = await page.evaluate(() => document.querySelector('.globe-panel').innerText.replace(/\s+/g, ' ').slice(0, 260));
  }
  report[`${tag} fates at 10 d (Sand Heads, seed 7)`] = await page.evaluate((id) => { const tr = window.__drift.debug().S.tracks.get(id); const i = tr.snaps.findIndex((s) => s && s.day >= 240); return tr.snaps[i].fragments[0].fates; }, id);
  if (!phone) {
    // Juan de Fuca, mid-channel: the outflow carries copies past the model's open boundary.
    await page.evaluate(() => window.__drift.clear());
    await page.waitForFunction(() => window.__drift.computed().length === 0, null, { timeout: 60000 });
    await page.evaluate(() => window.__drift.centerOn(-124.25, 48.4));
    const jdf = await page.evaluate(() => window.__drift.drop('bottle', -124.0, 48.33, 11));
    await page.evaluate((id) => window.__drift.select(id), jdf);
    await page.waitForFunction((id) => { const c = window.__drift.computed().find((x) => x.dropId === id); return c && c.day >= 240; }, jdf, { timeout: 600000, polling: 1000 });
    report[`${tag} Juan de Fuca drop (-124.0, 48.33, seed 11) fates at 10 d`] = await page.evaluate((id) => { const tr = window.__drift.debug().S.tracks.get(id); const i = tr.snaps.findIndex((s) => s && s.day >= 240); return tr.snaps[i].fragments[0].fates; }, jdf);
    await page.evaluate((id) => { window.__drift.setDay(30); window.__drift.select(id); }, jdf);
    await page.waitForTimeout(1500);
    await shot(page, `${tag}-juan-de-fuca-30h`);
    // A tap outside the model domain is refused with its own message.
    report[`${tag} (-124.85, 48.42) is outside the model`] = await page.evaluate(() => window.__drift.isOutside(-124.85, 48.42));
    await page.evaluate(() => window.__drift.centerOn(-124.85, 48.42));
    await page.waitForTimeout(400);
    const outPt = await page.evaluate(() => window.__drift.toScreen(-124.85, 48.42));
    await page.mouse.click(outPt[0], outPt[1]);
    await page.waitForTimeout(300);
    report[`${tag} outside-model tap toast`] = await page.evaluate(() => document.querySelector('.globe-toast').textContent);
    report[`${tag} drops after outside tap`] = await page.evaluate(() => window.__drift.computed().length);
  }
  report[`${tag} no horizontal scroll`] = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  // fps while playing at 30 h/s from hour 0 with the drops on screen.
  await page.evaluate(() => { const D = window.__drift; D.setDay(0); D.speed(30); D.play(true); D.resetFrames(); });
  await page.waitForTimeout(5000);
  report[`${tag} fps (30x)`] = await page.evaluate(() => window.__drift.frameStats());
  await ctx.close();
}
await browser.close();
console.log(JSON.stringify(report, null, 1));
if (errors.length) { console.error(`console errors (${errors.length}):\n${errors.join('\n')}`); process.exit(1); }
console.log('no console errors');
