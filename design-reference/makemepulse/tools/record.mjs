// Measurement recorder for the makemepulse 2019 reference ("Nomadic Tribe").
// Screenshots are for measurement / side-by-side comparison only - never trace them.
//
// Usage (from the drift project root):
//   node design-reference/makemepulse/tools/record.mjs                    # measure, both sizes
//   node design-reference/makemepulse/tools/record.mjs 1440x900           # measure, one size
//   MODE=video node design-reference/makemepulse/tools/record.mjs         # same scripted run, recordVideo only
//   GL=swiftshader ...                                                    # software GL (~2 fps here: timings useless)
//
// Why two modes: on this machine page.screenshot() costs 1.2-8.6 s per call (tools/shot-speed.mjs),
// so timed frames come from a CDP screencast (frames pushed as the compositor produces them, with
// epoch timestamps). Playwright's recordVideo also drives the screencast, so video is a separate pass.
//
// Output:
//   video/makemepulse_<size>.webm           (gitignored by design-reference/**/video/*.webm)
//   frames/<size>/<phase>/<label>_+<ms>.jpg (ms = offset from the action that started the window)
//   frames/<size>/log.json                  (frames, marks, DOM state polls, type snapshots)
//   frames/<size>/samples.json              (per-rAF GL camera + cursor samples for lag fits)
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const URL = 'https://2019.makemepulse.com/';
const SIZES = { '1440x900': [1440, 900], '1920x1080': [1920, 1080] };
const MODE = process.env.MODE === 'video' ? 'video' : 'measure';
const want = process.argv[2] ? [process.argv[2]] : Object.keys(SIZES);
const GL_ARGS = process.env.GL === 'swiftshader'
  ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
  : ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Injected before site scripts. All times are epoch ms (timeOrigin + now) so they line up with
// screencast metadata timestamps and Node's Date.now().
const INIT = () => {
  const now = () => performance.timeOrigin + performance.now();
  window.__rec = { samples: [], sampling: false, events: [], frames: 0, now };
  const R = window.__rec;
  const loop = () => {
    R.frames++;
    if (R.sampling) {
      const s = { t: now() };
      try {
        const G = window.GLXP;
        if (G && G.chapters) {
          const i = G.chapters._currentChapter; const ch = G.chapters.chapters[i];
          s.ch = i;
          const n = ch.homeIsEnabled && ch.cameraHomeNode ? ch.cameraHomeNode : ch.cameraNode;
          if (n) s.cam = Array.from(n.position);
          if (ch.camera && ch.camera._wmatrix) s.camW = Array.from(ch.camera._wmatrix).slice(12, 15);
          // active transition layer camera y = 200 * (offsetProgress - 0.5)  -> recover offsetProgress
          const tr = G.chapters.transitions.find((x) => x.active);
          if (tr) s.offsetProgress = tr.chapter.camera.position[1] / 200 + 0.5;
        }
        const c = document.querySelector('.cursor');
        if (c) s.cursor = c.style.transform;
      } catch (e) { s.err = String(e); }
      R.samples.push(s);
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  for (const type of ['mousemove', 'mousedown', 'mouseup', 'wheel', 'click']) {
    window.addEventListener(type, (e) => { if (R.sampling || type !== 'mousemove') R.events.push({ type, t: now(), x: e.clientX, y: e.clientY, dy: e.deltaY }); }, true);
  }
};

async function state(page) {
  return page.evaluate(() => {
    const q = (s) => document.querySelector(s);
    const st = (el) => (el ? { cls: typeof el.className === 'string' ? el.className : '', tf: el.style.transform || getComputedStyle(el).transform, op: getComputedStyle(el).opacity } : null);
    const G = window.GLXP;
    return {
      t: window.__rec.now(), frames: window.__rec.frames,
      loader: st(q('.loader')), loaderFg: st(q('.loader__bar__foreground')), loaderBar: st(q('.loader__bar')),
      landing: st(q('.landing')), logo: st(q('.landing__logo')), startBtn: st(q('.landing__button')), nextBtn: st(q('.next-btn')),
      canvas: st(q('#gl-canvas')), audioText: st(q('.audio-text')),
      ch: G && G.chapters ? G.chapters._currentChapter : null,
      trans: G && G.chapters ? G.chapters.transitions.findIndex((t) => t.active) : null,
      bodyCls: document.body.className, scrollY: window.scrollY,
    };
  });
}

async function typeSnapshot(page) {
  return page.evaluate(() => {
    const out = [];
    const sel = ['.subtitles', '.button__text', '.cursor .text', '.audio-text__text', '.text__content'];
    for (const s of sel) for (const el of document.querySelectorAll(s)) {
      const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
      out.push({ sel: s, text: (el.textContent || '').trim().slice(0, 30), fontFamily: cs.fontFamily, fontSize: cs.fontSize, fontWeight: cs.fontWeight, letterSpacing: cs.letterSpacing, lineHeight: cs.lineHeight, color: cs.color, textTransform: cs.textTransform, padding: cs.padding, opacity: cs.opacity, rect: [r.x, r.y, r.width, r.height].map(Math.round) });
    }
    return out;
  });
}

async function run(sizeKey) {
  const [W, H] = SIZES[sizeKey];
  const frameDir = path.join(ROOT, 'frames', sizeKey);
  const videoDir = path.join(ROOT, 'video', '_tmp_' + sizeKey);
  if (MODE === 'measure') { fs.rmSync(frameDir, { recursive: true, force: true }); fs.mkdirSync(frameDir, { recursive: true }); }
  else fs.mkdirSync(videoDir, { recursive: true });

  const browser = await chromium.launch({ headless: true, args: [...GL_ARGS, '--autoplay-policy=no-user-gesture-required'] });
  const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, ...(MODE === 'video' ? { recordVideo: { dir: videoDir, size: { width: W, height: H } } } : {}) });
  await context.addInitScript(INIT);
  const page = await context.newPage();
  const log = { size: sizeKey, url: URL, gl: GL_ARGS, mode: MODE, started: new Date().toISOString(), frames: [], marks: [], polls: [], type: [] };
  const samples = {};
  const T0 = Date.now();
  const mark = (label, extra = {}) => { log.marks.push({ label, t: Date.now(), ...extra }); console.log(`[${sizeKey} ${MODE}] ${((Date.now() - T0) / 1000).toFixed(1)}s ${label}`); };

  // ---- screencast capture (measure mode) ----
  let cdp = null; let buf = null;
  async function startCast() {
    if (MODE !== 'measure') return;
    cdp = await context.newCDPSession(page);
    cdp.on('Page.screencastFrame', (f) => {
      if (buf) buf.push({ ts: f.metadata.timestamp * 1000, data: f.data });
      cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
    });
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 75, everyNthFrame: 1 });
  }
  // Capture a window of `ms` after running `action`; frames named by offset from the action.
  async function win(phase, label, ms, action = async () => {}, { minGap = 33, poll = false } = {}) {
    if (MODE !== 'measure') { await action(); await sleep(ms); return; }
    buf = [];
    const tA = Date.now();
    await action();
    const end = tA + ms;
    while (Date.now() < end) {
      if (poll) log.polls.push({ phase, ...(await state(page).catch(() => ({}))) });
      await sleep(poll ? 100 : Math.min(200, end - Date.now()));
    }
    const got = buf.sort((a, b) => a.ts - b.ts); buf = null;
    const dir = path.join(frameDir, phase); fs.mkdirSync(dir, { recursive: true });
    let last = -1e9;
    for (const f of got) {
      const off = Math.round(f.ts - tA);
      if (off - last < minGap) continue; last = off;
      const file = `${label}_+${String(off).padStart(5, '0')}ms.jpg`;
      fs.writeFileSync(path.join(dir, file), Buffer.from(f.data, 'base64'));
      log.frames.push({ phase, label, off, t: f.ts, tAction: tA, file: `${phase}/${file}` });
    }
    return got.length;
  }
  // A guaranteed still (slow path) for settled states.
  async function still(phase, label) {
    if (MODE !== 'measure') return;
    const dir = path.join(frameDir, phase); fs.mkdirSync(dir, { recursive: true });
    const t = Date.now();
    await page.screenshot({ path: path.join(dir, `${label}.jpg`), type: 'jpeg', quality: 80, timeout: 60000 }).catch((e) => console.log('still failed', e.message));
    log.frames.push({ phase, label, off: null, t, file: `${phase}/${label}.jpg`, still: true, state: await state(page).catch(() => null) });
  }
  async function sampled(name, fn) {
    await page.evaluate(() => { window.__rec.samples = []; window.__rec.events = []; window.__rec.sampling = true; });
    await fn();
    samples[name] = await page.evaluate(() => { window.__rec.sampling = false; return { samples: window.__rec.samples, events: window.__rec.events }; });
  }
  const visible = (sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e) return false; const cs = getComputedStyle(e); return !e.classList.contains('is-hidden') && !e.classList.contains('hide') && cs.display !== 'none' && +cs.opacity > 0.5; }, sel);

  // Corner sweep: centre -> corner (3 s window, rAF samples) -> centre (3 s window). Stills at centre and at each corner.
  async function corners(phase) {
    const pts = { tl: [2, 2], tr: [W - 2, 2], br: [W - 2, H - 2], bl: [2, H - 2] };
    await page.mouse.move(W / 2, H / 2, { steps: 4 });
    await sleep(3000);
    await still(phase, 'center_settled');
    for (const k of Object.keys(pts)) {
      await sampled(`${phase}_${k}`, () => win(phase, `to_${k}`, 3000, () => page.mouse.move(pts[k][0], pts[k][1], { steps: 1 })));
      await still(phase, `${k}_settled`);
      await sampled(`${phase}_${k}_back`, () => win(phase, `back_from_${k}`, 3000, () => page.mouse.move(W / 2, H / 2, { steps: 1 })));
    }
  }
  async function wheel(phase, steps = 10, dy = 120) {
    await page.mouse.move(W / 2, H / 2);
    await sleep(400);
    await still(phase, 'wheel_before');
    await sampled(`${phase}_wheel`, () => win(phase, 'wheel', steps * 300 + 600, async () => {
      (async () => { for (let i = 0; i < steps; i++) { await page.mouse.wheel(0, dy); await sleep(300); } })();
    }, { minGap: 150, poll: true }));
    await still(phase, 'wheel_after');
  }
  async function goNext(phase, waitMs) {
    const until = Date.now() + waitMs;
    while (Date.now() < until && !(await visible('.next-btn'))) await sleep(500);
    if (await visible('.next-btn')) {
      mark(`${phase}: next button visible`);
      const box = await page.locator('.next-btn').boundingBox();
      await win(phase, 'next_hover', 1200, () => page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 2 }));
      log.type.push({ at: `${phase} next hover`, items: await typeSnapshot(page) });
      await sampled(`${phase}_transition`, () => win(`${phase}_transition`, 'tr', 3500, () => page.mouse.click(box.x + box.width / 2, box.y + box.height / 2), { poll: true }));
      log.marks.push({ label: `${phase}: next clicked (natural)` });
    } else {
      mark(`${phase}: next button not shown in ${waitMs}ms -> GLXP.chapters.next()`);
      await sampled(`${phase}_transition`, () => win(`${phase}_transition`, 'tr', 3500, () => page.evaluate(() => window.GLXP.chapters.next()), { poll: true }));
    }
  }

  // ---------- 1. preloader ----------
  mark('goto');
  await page.goto(URL, { waitUntil: 'commit', timeout: 90000 });
  await startCast();
  buf = MODE === 'measure' ? [] : null;
  const tGoto = Date.now();
  let landingSeenAt = null;
  while (Date.now() - tGoto < 120000) {
    const s = await state(page).catch(() => null);
    if (s) log.polls.push({ phase: '01_preloader', ...s });
    if (s && s.logo && s.logo.cls.indexOf('hide') === -1 && +s.logo.op > 0.99 && landingSeenAt === null) { landingSeenAt = Date.now(); mark('landing logo fully visible'); }
    if (landingSeenAt && Date.now() - landingSeenAt > 2000) break;
    await sleep(100);
  }
  if (MODE === 'measure') {
    const got = buf.sort((a, b) => a.ts - b.ts); buf = null;
    const dir = path.join(frameDir, '01_preloader'); fs.mkdirSync(dir, { recursive: true });
    let last = -1e9;
    for (const f of got) { const off = Math.round(f.ts - tGoto); if (off - last < 90) continue; last = off; const file = `p_+${String(off).padStart(6, '0')}ms.jpg`; fs.writeFileSync(path.join(dir, file), Buffer.from(f.data, 'base64')); log.frames.push({ phase: '01_preloader', label: 'p', off, t: f.ts, tAction: tGoto, file: `01_preloader/${file}` }); }
  }
  log.tGoto = tGoto;
  log.nav = await page.evaluate(() => performance.getEntriesByType('navigation').map((e) => ({ timeOrigin: performance.timeOrigin, dcl: e.domContentLoadedEventEnd, load: e.loadEventEnd })));
  log.resources = await page.evaluate(() => performance.getEntriesByType('resource').map((r) => ({ n: r.name.replace(location.origin, ''), s: Math.round(r.startTime), e: Math.round(r.responseEnd), b: r.transferSize })));
  log.type.push({ at: 'landing', items: await typeSnapshot(page) });

  // ---------- 2. landing: corners, hover "Enter" circle, wheel ----------
  await corners('02_landing_mouse');
  await page.mouse.move(40, 40, { steps: 3 });
  await sleep(1500);
  await win('03_landing_hover', 'enter', 1800, () => page.mouse.move(W / 2, H / 2, { steps: 2 }));
  await still('03_landing_hover', 'enter_settled');
  log.type.push({ at: 'landing hover', items: await typeSnapshot(page) });
  await win('03_landing_hover', 'leave', 1500, () => page.mouse.move(40, 40, { steps: 2 }));
  await wheel('04_landing_wheel', 8);

  // ---------- 3. reveal (click) ----------
  await page.mouse.move(W / 2, H / 2, { steps: 3 });
  await sleep(1200);
  mark('click reveal');
  await win('05_reveal', 'rv', 3500, () => page.mouse.click(W / 2, H / 2), { poll: true });
  await still('05_reveal', 'revealed_settled');
  await win('06_start_button', 'wait', 12000, async () => {}, { minGap: 250 });
  const tBtn = Date.now();
  while (!(await visible('.landing__button')) && Date.now() - tBtn < 20000) await sleep(200);
  mark('start button visible');
  await corners('06_revealed_mouse');
  const sb = await page.locator('.landing__button').boundingBox();
  await win('06_start_button', 'hover', 1500, () => page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2, { steps: 2 }));
  await still('06_start_button', 'hover_settled');
  log.type.push({ at: 'start hover', items: await typeSnapshot(page) });
  mark('click start');
  await sampled('07_enter_scene1', () => win('07_enter_scene1', 'in', 4500, () => page.mouse.click(sb.x + sb.width / 2, sb.y + sb.height / 2), { poll: true }));

  // ---------- 4. chapters ----------
  const scenes = [
    { id: '08_s1_eclosion', interact: 'drag' },
    { id: '09_s2_adieu', interact: 'click' },
    { id: '10_s3_voyage', interact: 'hold' },
    { id: '11_s4_premiere', interact: 'drag' },
  ];
  for (const sc of scenes) {
    mark(`${sc.id} enter`);
    await win(sc.id, 'intro', 9000, async () => {}, { minGap: 500 });
    await still(sc.id, 'title');
    log.type.push({ at: sc.id, items: await typeSnapshot(page) });
    await corners(`${sc.id}_mouse`);
    await wheel(`${sc.id}_wheel`, 10);
    if (sc.interact === 'drag') {
      for (let k = 0; k < 5; k++) {
        const y = H * (0.62 + 0.05 * (k % 3)); const x0 = W * (0.25 + 0.1 * k);
        await page.mouse.move(x0, y); await page.mouse.down();
        await win(sc.id, `drag${k}`, 1600, () => page.mouse.move(x0 + 40, y - H * 0.25, { steps: 20 }), { minGap: 200 });
        await page.mouse.up(); await sleep(800);
      }
    } else if (sc.interact === 'click') {
      for (const [fx, fy] of [[0.3, 0.5], [0.5, 0.45], [0.7, 0.5], [0.4, 0.6], [0.6, 0.6]]) { await page.mouse.click(W * fx, H * fy); await sleep(1200); }
      await still(sc.id, 'clicked');
    } else if (sc.interact === 'hold') {
      await page.mouse.move(W / 2, H / 2); await sleep(500);
      await sampled(`${sc.id}_hold`, () => win(sc.id, 'hold', 4500, () => page.mouse.down(), { minGap: 100 }));
      await win(sc.id, 'release', 2500, () => page.mouse.up(), { minGap: 100 });
    }
    await goNext(sc.id, 30000);
  }

  // ---------- 5. ending ----------
  mark('ending');
  await win('12_ending', 'end', 6000, async () => {}, { minGap: 100, poll: true });
  await still('12_ending', 'end_settled');
  log.type.push({ at: 'ending', items: await typeSnapshot(page) });
  await corners('12_ending_mouse');
  const soc = page.locator('.ending__social__link').first();
  if (await soc.count()) { const b = await soc.boundingBox(); if (b) await win('12_ending', 'social_hover', 1200, () => page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 2 })); }
  log.fps = await page.evaluate(() => new Promise((res) => { let k = 0; const a = performance.now(); const f = () => { k++; if (performance.now() - a < 2000) requestAnimationFrame(f); else res(k / ((performance.now() - a) / 1000)); }; requestAnimationFrame(f); }));
  log.renderer = await page.evaluate(() => { const g = document.createElement('canvas').getContext('webgl'); const e = g && g.getExtension('WEBGL_debug_renderer_info'); return e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : null; });
  mark('done');

  if (MODE === 'measure') {
    fs.writeFileSync(path.join(frameDir, 'log.json'), JSON.stringify(log, null, 1));
    fs.writeFileSync(path.join(frameDir, 'samples.json'), JSON.stringify(samples));
  }
  const vid = MODE === 'video' ? page.video() : null;
  await context.close();
  if (vid) { const p = await vid.path(); const dest = path.join(ROOT, 'video', `makemepulse_${sizeKey}.webm`); fs.renameSync(p, dest); fs.rmSync(videoDir, { recursive: true, force: true }); console.log('video ->', dest); }
  await browser.close();
}

for (const s of want) await run(s);
