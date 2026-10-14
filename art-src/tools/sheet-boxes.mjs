// Copied from BTTRURSLF-v2/art-src/tools/sheet-boxes.mjs (read-only reference project).
/**
 * Finds each thing on a ChatGPT sheet of several cut-outs: the bounding box
 * of every connected blob of visible pixels, largest first, as x,y,w,h ready
 * for cutout.mjs --crop. sheet.py does this for evenly spaced strips, but it
 * needs Python and the lodge's icon sheets are not evenly spaced (a boot runs
 * past its column), so the boxes are measured, not assumed.
 *
 *   node art-src/tools/sheet-boxes.mjs <dev-server-url> <sheet.png> [--alpha 24] [--pad 10]
 */
import { chromium } from 'playwright';
const args = process.argv.slice(2);
const [base, src] = args;
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i < 0 ? d : Number(args[i + 1]); };
const b = await chromium.launch();
const p = await b.newPage();
await p.goto(`${base}/package.json`);
const boxes = await p.evaluate(async ({ src, min, pad }) => {
  const img = new Image(); img.src = src; await img.decode();
  const W = img.width, H = img.height;
  const c = new OffscreenCanvas(W, H); const x = c.getContext('2d'); x.drawImage(img, 0, 0);
  const d = x.getImageData(0, 0, W, H).data;
  const lab = new Int32Array(W * H); const out = []; const st = [];
  for (let i = 0; i < W * H; i++) {
    if (lab[i] || d[i * 4 + 3] <= min) continue;
    let n = 0, L = W, T = H, R = 0, B = 0; st.push(i); lab[i] = 1;
    while (st.length) {
      const j = st.pop(); const px = j % W, py = (j / W) | 0; n++;
      if (px < L) L = px; if (px > R) R = px; if (py < T) T = py; if (py > B) B = py;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = px + dx, yy = py + dy; if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        const k = yy * W + xx; if (!lab[k] && d[k * 4 + 3] > min) { lab[k] = 1; st.push(k); }
      }
    }
    if (n > 2000) out.push({ n, crop: [Math.max(0, L - pad), Math.max(0, T - pad), Math.min(W, R + pad + 1) - Math.max(0, L - pad), Math.min(H, B + pad + 1) - Math.max(0, T - pad)] });
  }
  return out.sort((a, b2) => a.crop[1] - b2.crop[1] > 200 ? 1 : b2.crop[1] - a.crop[1] > 200 ? -1 : a.crop[0] - b2.crop[0]);
}, { src: `${base}/${src}`, min: opt('alpha', 24), pad: opt('pad', 10) });
await b.close();
for (const o of boxes) console.log(`--crop ${o.crop.join(',')}   (${o.n} px)`);
