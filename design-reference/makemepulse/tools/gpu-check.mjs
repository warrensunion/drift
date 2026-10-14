// Quick check: which GL backend and frame rate the reference site gets under a given launch config.
import { chromium } from 'playwright';
const mode = process.argv[2] || 'swiftshader';
const args = mode === 'swiftshader' ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
  : ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'];
const browser = await chromium.launch({ headless: mode !== 'headed', args });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('https://2019.makemepulse.com/', { waitUntil: 'domcontentloaded' });
const r = await page.evaluate(() => { const c = document.createElement('canvas'); const g = c.getContext('webgl'); const e = g.getExtension('WEBGL_debug_renderer_info'); return e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.RENDERER); });
await page.waitForFunction(() => window.GLXP && window.GLXP.glview && window.GLXP.glview._playing, null, { timeout: 90000 });
const fps = await page.evaluate(() => new Promise(res => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else res(n / ((performance.now() - t0) / 1000)); }; requestAnimationFrame(f); }));
console.log(mode, r, 'fps', fps.toFixed(1));
await browser.close();
