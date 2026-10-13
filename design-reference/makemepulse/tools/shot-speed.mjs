// Diagnostic: how long a screenshot / a screencast frame takes on this machine (with and without video).
import { chromium } from 'playwright';
const video = process.argv[2] === 'video';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...(video ? { recordVideo: { dir: 'C:/Users/Warren/AppData/Local/Temp/claude/C--Users-Warren-Downloads-Projects/3b7159a5-5bf1-49b7-9d42-f00e46d8674a/scratchpad/v' } } : {}) });
const page = await ctx.newPage();
await page.goto('https://2019.makemepulse.com/', { waitUntil: 'commit' });
await page.waitForTimeout(3000);
for (let i = 0; i < 4; i++) { const a = Date.now(); await page.screenshot({ type: 'jpeg', quality: 70 }); console.log('shot ms', Date.now() - a); }
const cdp = await ctx.newCDPSession(page);
let n = 0; const ts = [];
cdp.on('Page.screencastFrame', async (f) => { n++; ts.push(f.metadata.timestamp); await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {}); });
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 70, everyNthFrame: 1 });
await page.waitForTimeout(4000);
await cdp.send('Page.stopScreencast');
console.log('screencast frames in 4s', n, 'gaps', ts.slice(1).map((t, i) => Math.round((t - ts[i]) * 1000)).join(','));
const fps = await page.evaluate(() => new Promise(r => { let k = 0; const a = performance.now(); const f = () => { k++; performance.now() - a < 2000 ? requestAnimationFrame(f) : r(k / 2); }; requestAnimationFrame(f); }));
console.log('fps', fps);
await ctx.close(); await browser.close();
