// AA of words over art, measured on the real page (approach of BTTRURSLF-v2 scripts/lib/words-aa.mjs):
// shoot the page with the words made transparent (and their shadows off, so it is conservative),
// then compare every pixel under each element's box with the text colour; the worst 5 % of pixels
// are dropped (particles drifting behind). WCAG: large text (>= 24 px, or >= 18.66 px bold) 3:1,
// everything else 4.5:1.
import sharp from 'sharp';

const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const L = (r, g, b) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);

/** groups: {name: selector}. Returns {name: {ratio, need, text, pass}} for the worst element in each group. */
export async function wordsAA(page, groups) {
  const all = Object.values(groups).join(', ');
  const boxes = await page.evaluate((groups) => {
    const out = {};
    for (const [name, q] of Object.entries(groups)) {
      out[name] = [...document.querySelectorAll(q)].filter((n) => {
        for (let e = n; e; e = e.parentElement) { const cs = getComputedStyle(e); if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) < 0.5) return false; }
        return true;
      }).map((n) => {
        const b = n.getBoundingClientRect();
        const cs = getComputedStyle(n);
        const px = parseFloat(cs.fontSize);
        const large = px >= 24 || (px >= 18.66 && Number(cs.fontWeight) >= 700);
        return { text: n.textContent.trim().slice(0, 40), need: large ? 3 : 4.5, color: cs.color, x: Math.max(0, Math.floor(b.left)), y: Math.max(0, Math.floor(b.top)), w: Math.ceil(b.width), h: Math.ceil(b.height) };
      }).filter((t) => t.w > 2 && t.h > 2 && t.y < innerHeight && t.x < innerWidth);
    }
    return out;
  }, groups);
  const style = await page.addStyleTag({ content: `${all}, ${Object.values(groups).map((q) => `${q} *`).join(', ')} { color: transparent !important; text-shadow: none !important; }` });
  await page.waitForTimeout(80);
  const png = await page.screenshot({ timeout: 60000 });
  await style.evaluate((n) => n.remove());
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  const result = {};
  for (const [name, list] of Object.entries(boxes)) {
    let worst = null;
    for (const t of list) {
      const [r, g, b] = t.color.match(/[\d.]+/g).map(Number);
      const lt = L(r, g, b);
      const ratios = [];
      for (let y = t.y; y < Math.min(info.height, t.y + t.h); y++) for (let x = t.x; x < Math.min(info.width, t.x + t.w); x++) {
        const i = (y * info.width + x) * info.channels;
        const lb = L(data[i], data[i + 1], data[i + 2]);
        ratios.push((Math.max(lt, lb) + 0.05) / (Math.min(lt, lb) + 0.05));
      }
      if (!ratios.length) continue;
      ratios.sort((a, c) => a - c);
      const ratio = ratios[Math.floor(ratios.length * 0.05)];
      if (!worst || ratio / t.need < worst.ratio / worst.need) worst = { ratio: +ratio.toFixed(2), need: t.need, text: t.text };
    }
    if (worst) result[name] = { ...worst, pass: worst.ratio >= worst.need };
  }
  return result;
}
