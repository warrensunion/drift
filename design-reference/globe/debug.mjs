// Debug runner: open the harness in system Chrome (GPU), run a JS snippet file, screenshot.
// node design-reference/globe/debug.mjs <snippet.js> <out.png> [w] [h] [query]
import { chromium } from 'playwright';
import fs from 'node:fs';
const [snip, out = 'debug.png', w = '1440', h = '900', query = ''] = process.argv.slice(2);
const browser = await chromium.launch({ channel: process.env.CHANNEL || 'chrome', args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('response', (r) => { if (r.status() >= 400) logs.push(`[http ${r.status()}] ${r.url()}`); });
await page.goto(`${process.env.BASE || 'http://127.0.0.1:5179'}/globe.html${query}`, { timeout: 180000, waitUntil: 'commit' });
await page.waitForFunction(() => window.__drift && window.__drift.backend && window.__drift.fps > 0, null, { timeout: 180000 });
if (snip && snip !== '-') {
  const code = fs.readFileSync(snip, 'utf8');
  const r = await page.evaluate(`(async () => { ${code} })()`);
  if (r !== undefined) console.log('result', JSON.stringify(r, null, 1));
}
await page.screenshot({ path: out });
console.log(logs.join('\n'));
await browser.close();
