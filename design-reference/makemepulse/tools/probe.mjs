// Probe: load the reference site, save every JS/CSS/JSON response for timing-constant inspection.
import { chromium } from 'playwright';
import fs from 'node:fs'; import path from 'node:path';
const out = process.argv[2];
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--enable-webgl'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const log = [];
const t0 = Date.now();
page.on('response', async r => {
  const u = r.url(); const ct = r.headers()['content-type'] || '';
  log.push(`${Date.now()-t0}\t${r.status()}\t${ct}\t${u}`);
  if (/javascript|css|json|text\/html|glsl|text\/plain/.test(ct) || /\.(js|css|json|glsl|frag|vert)(\?|$)/.test(u)) {
    try { const b = await r.body(); const name = u.replace(/^https?:\/\//,'').replace(/[^\w.-]+/g,'_').slice(0,150); fs.writeFileSync(path.join(out, name), b); } catch {}
  }
});
page.on('console', m => log.push(`console ${m.type()}: ${m.text()}`));
await page.goto('https://2019.makemepulse.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(15000);
await page.screenshot({ path: path.join(out, '_shot.png') });
const info = await page.evaluate(() => ({ title: document.title, html: document.documentElement.outerHTML.slice(0, 20000), gl: (()=>{const c=document.createElement('canvas');const g=c.getContext('webgl');return g?g.getParameter(g.RENDERER):'none'})(), globals: Object.keys(window).filter(k=>!/^on|^webkit/.test(k)).slice(-80) }));
fs.writeFileSync(path.join(out, '_info.json'), JSON.stringify(info, null, 2));
fs.writeFileSync(path.join(out, '_log.txt'), log.join('\n'));
await browser.close();
