// Quick a11y probe for the story shell: h1 after the intro, every chapter heading and the drop
// button exposed to assistive tech, no focusable control hidden, focus after "Scroll to begin".
//   node scripts/dev/a11y-probe.mjs [baseUrl]
import { chromium } from 'playwright';
const base = process.argv[2] || 'http://127.0.0.1:5287/';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(`${base}?debug`, { timeout: 120000 });
await page.waitForFunction(() => document.querySelector('.pre__intro.is-ready'), null, { timeout: 60000 });
const before = await page.evaluate(() => ({ chromeVisibility: getComputedStyle(document.querySelector('.chrome')).visibility, navVisibility: getComputedStyle(document.querySelector('.chapters')).visibility }));
await page.focus('.pre__hint');
await page.keyboard.press('Enter');
await page.waitForFunction(() => !document.getElementById('preloader'), null, { timeout: 30000 });
const after = await page.evaluate(() => ({
  h1: [...document.querySelectorAll('h1')].map((h) => h.textContent.trim()),
  focused: document.activeElement && (document.activeElement.id || document.activeElement.tagName),
}));
const ax = await page.locator('body').ariaSnapshot();
const headings = [...ax.matchAll(/heading "([^"]+)" \[level=2\]/g)].map((m) => m[1]);
const hasCta = /link "Drop your own"/.test(ax);
await page.evaluate(() => document.getElementById('about').scrollIntoView());
await page.waitForTimeout(1500);
const past = await page.evaluate(() => ({ chromeVisibility: getComputedStyle(document.querySelector('.chrome')).visibility, navVisibility: getComputedStyle(document.querySelector('.chapters')).visibility }));
console.log(JSON.stringify({ before, after, headings, hasCta, past }, null, 1));
await browser.close();
