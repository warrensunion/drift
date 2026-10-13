// Dev verification for the story shell (Task 11): screenshots of the preloader, intro, every
// chapter mid-scroll and mid-transition, and the About scene, at 1440x900, 1920x1080 and 390x844,
// plus a reduced-motion pass. Fails on console errors and on horizontal scroll at 390 px.
//
//   node scripts/dev/shoot-story.mjs [baseUrl] [outDir] [--sizes=1440x900,390x844] [--only=chapters]
//
// The final, full shooter is scripts/shoot.mjs (Task 12).
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const args = process.argv.slice(2);
const flags = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => a.slice(2).split('=')));
const [base = 'http://127.0.0.1:5181/', out = 'design-reference/compare/story/_shots'] = args.filter((a) => !a.startsWith('--'));
const SIZES = (flags.sizes || '1440x900,1920x1080,390x844').split(',').map((s) => s.split('x').map(Number));
const REDUCED = flags.reduced !== 'no';
await mkdir(out, { recursive: true });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const problems = [];

async function waitFor(page, fn, arg, timeout = 30000) {
  return page.waitForFunction(fn, arg, { timeout, polling: 100 });
}

async function shoot(page, name) {
  const file = join(out, `${name}.jpg`);
  const t = Date.now();
  await page.screenshot({ path: file, type: 'jpeg', quality: 82, timeout: 60000 });
  console.log(`  ${name} (${Date.now() - t} ms)`);
}

async function gotoChapter(page, i, t = 0.5) {
  await page.evaluate(({ i, t }) => {
    const e = window.__drift.story.edges;
    window.scrollTo(0, e[i] + (e[i + 1] - e[i]) * t);
  }, { i, t });
  await waitFor(page, (i) => window.__drift.story.current === i && !window.__drift.story.state.trans, i, 40000);
}

async function run([w, h], { reduced = false } = {}) {
  const tag = `${w}x${h}${reduced ? '-reduced' : ''}`;
  console.log(`== ${tag}`);
  const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu-rasterization'] });
  const ctx = await browser.newContext({
    viewport: { width: w, height: h },
    deviceScaleFactor: 1,
    reducedMotion: reduced ? 'reduce' : 'no-preference',
    isMobile: w < 600,
    hasTouch: w < 600,
  });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`[${tag}] console: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`[${tag}] pageerror: ${e.message}`));

  await page.goto(base, { waitUntil: 'commit' });
  if (!reduced) {
    await wait(700);
    await shoot(page, `${tag}-0-preloader`);
  }
  await waitFor(page, () => document.querySelector('.pre.is-intro') && document.querySelector('.pre__intro.is-ready'), null, 60000);
  await wait(1600);
  await shoot(page, `${tag}-0-intro`);
  await page.mouse.move(w * 0.5, h * 0.5);
  await page.evaluate(() => window.scrollTo(0, 6));
  await waitFor(page, () => !document.getElementById('preloader'), null, 30000);

  const N = await page.evaluate(() => window.__drift.CHAPTERS.length);
  for (let i = 0; i < N; i++) {
    if (flags.only === 'about') break;
    await gotoChapter(page, i, 0.5);
    await wait(2600); // entrance: headline settles (0.3 + 1.4 s), copy reveals (~1.85 s)
    if (!reduced && w > 600) { await page.mouse.move(w * 0.85, h * 0.8, { steps: 4 }); await wait(1400); }
    await shoot(page, `${tag}-${i + 1}-mid`);
    if (!reduced && w > 600) await page.mouse.move(w * 0.5, h * 0.5, { steps: 2 });
    if (i < N - 1 && (i < 2 || w >= 1400 || reduced)) {
      // Freeze the transition into the next chapter just after its swap.
      await page.evaluate(() => { window.__driftHold = 0.56; });
      await page.evaluate(({ i }) => {
        const e = window.__drift.story.edges;
        window.scrollTo(0, e[i + 1] + 4);
      }, { i });
      await waitFor(page, (i) => { const s = window.__drift.story.state.trans; return s && s.to === i + 1; }, i, 40000);
      await wait(300);
      await shoot(page, `${tag}-${i + 1}to${i + 2}-transition`);
      await page.evaluate(() => { delete window.__driftHold; });
    }
  }
  // Late chapter scroll: headline breaking apart (chapter 3 at 80 %).
  if (w >= 1400 && !reduced && flags.only !== 'about') {
    await gotoChapter(page, 2, 0.82);
    await wait(1800);
    await shoot(page, `${tag}-3-late`);
  }

  // About
  await page.evaluate(() => document.getElementById('about').scrollIntoView());
  await wait(1500);
  await shoot(page, `${tag}-8-about`);
  await page.evaluate(() => { const m = document.querySelector('[data-about="model"]'); m.scrollIntoView(); window.scrollBy(0, -80); });
  await wait(800);
  await shoot(page, `${tag}-8-about-model`);

  const hscroll = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (hscroll > 0) problems.push(`[${tag}] horizontal scroll ${hscroll}px`);
  console.log(`  horizontal overflow: ${hscroll}px`);
  await browser.close();
}

for (const size of SIZES) await run(size);
if (REDUCED) await run(SIZES[0], { reduced: true });

if (problems.length) {
  console.log('\nPROBLEMS');
  for (const p of problems) console.log(' ', p);
  process.exitCode = 1;
} else {
  console.log('\nno console errors, no horizontal scroll');
}
