// Copied from BTTRURSLF-v2/art-src/tools/cutout.mjs (read-only reference project).
/**
 * Cleans a ChatGPT "transparent" PNG into a menu cut-out.
 *
 * Why: ChatGPT paints a dark glow behind the subject and then cuts it out,
 * so the edge pixels keep that glow's colour. Laid over the night sky they
 * read as a dark rim, and the thing looks pasted on - the floating look. So:
 *   1. trim to the alpha bounds (plus `margin` px),
 *   2. snap near-solid alpha to solid and erode the edge by `erode` px,
 *   3. decontaminate: every pixel in the edge band takes its colour from the
 *      nearest solid interior pixels instead of its own glow-tinted colour.
 * Writes the cleaned PNG (source of truth) and a WebP for public/.
 *
 * Runs in headless Chromium through Playwright (already a devDependency), so
 * no image library is added to the project.
 *
 * usage: node art-src/tools/cutout.mjs <dev-server-url> <in.png> <out-base> [--erode 1] [--margin 6] [--q 0.9] [--max 1600]
 *        [--crop x,y,w,h]  work on one region first (frame 1 of a strip)
 *        [--islands]       drop specks not connected to the subject (old keying debris)
 *        [--opaque]        no alpha work at all - just resize and encode (the mountain plate)
 *        [--box x,y,w,h]   trim to this box instead of the alpha bounds, so a
 *                          variant (the day ledge) lands on the original's pixel grid
 *        [--shift dx,dy]   move the art by whole px first, to line a variant up
 *                          with the original by a measured offset
 *        writes <out-base>.png and <out-base>.webp
 */
import { chromium } from 'playwright';
import fs from 'node:fs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i < 0 ? d : Number(args[i + 1]); };
const [base, src, out] = args;
const ci = args.indexOf('--crop'); const crop = ci < 0 ? null : args[ci + 1].split(',').map(Number);
const islands = args.includes('--islands');
const opaque = args.includes('--opaque');
const bi = args.indexOf('--box'); const box = bi < 0 ? null : args[bi + 1].split(',').map(Number);
const si = args.indexOf('--shift'); const shift = si < 0 ? [0, 0] : args[si + 1].split(',').map(Number);
const erode = opt('erode', 1), margin = opt('margin', 6), q = opt('q', 0.9), max = opt('max', 1600);

const b = await chromium.launch();
const p = await b.newPage();
await p.goto(`${base}/package.json`); // any tiny same-origin page: the app itself is slow to load and not needed
const res = await p.evaluate(async ({ src, erode, margin, q, max, crop, islands, opaque, box, shift }) => {
  const img = new Image(); img.src = src; await img.decode();
  const [cx, cy, W, H] = crop || [0, 0, img.width, img.height];
  const c0 = new OffscreenCanvas(W, H); const x0 = c0.getContext('2d', { willReadFrequently: true });
  x0.drawImage(img, shift[0] - cx, shift[1] - cy);
  const d = x0.getImageData(0, 0, W, H).data;
  if (islands) {
    // label 8-connected blobs of visible pixels; keep any blob at least 2% the size of the biggest
    const lab = new Int32Array(W * H); const sizes = [0]; const st = [];
    for (let i = 0; i < W * H; i++) {
      if (lab[i] || d[i * 4 + 3] <= 12) continue;
      const id = sizes.length; let n = 0; st.push(i); lab[i] = id;
      while (st.length) {
        const j = st.pop(); n++; const x = j % W, y = (j / W) | 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
          const k = yy * W + xx; if (!lab[k] && d[k * 4 + 3] > 12) { lab[k] = id; st.push(k); }
        }
      }
      sizes.push(n);
    }
    const big = Math.max(...sizes);
    for (let i = 0; i < W * H; i++) if (lab[i] && sizes[lab[i]] < big * 0.02) d[i * 4 + 3] = 0;
  }

  if (opaque) {
    const s = Math.min(1, max / Math.max(W, H)); const c = new OffscreenCanvas(Math.round(W * s), Math.round(H * s));
    const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(c0, 0, 0, c.width, c.height);
    const b64 = async (blob) => { const buf = new Uint8Array(await blob.arrayBuffer()); let t = ''; for (let i = 0; i < buf.length; i += 0x8000) t += String.fromCharCode(...buf.subarray(i, i + 0x8000)); return btoa(t); };
    return { png: null, webp: await b64(await c.convertToBlob({ type: 'image/webp', quality: q })), trim: [0, 0, W, H], out: [c.width, c.height], fixed: 0 };
  }
  // 1. bounds
  let L = W, T = H, R = -1, B = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (d[(y * W + x) * 4 + 3] > 8) {
    if (x < L) L = x; if (x > R) R = x; if (y < T) T = y; if (y > B) B = y;
  }
  L = Math.max(0, L - margin); T = Math.max(0, T - margin);
  R = Math.min(W - 1, R + margin); B = Math.min(H - 1, B + margin);
  if (box) { L = box[0]; T = box[1]; R = box[0] + box[2] - 1; B = box[1] + box[3] - 1; }
  const w = R - L + 1, h = B - T + 1;
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) px.set(d.subarray(((y + T) * W + L) * 4, ((y + T) * W + L + w) * 4), y * w * 4);

  // 2. alpha: snap, then erode (min filter) `erode` times
  let a = new Uint8ClampedArray(w * h);
  for (let i = 0; i < w * h; i++) { const v = px[i * 4 + 3]; a[i] = v >= 236 ? 255 : v <= 12 ? 0 : v; }
  for (let k = 0; k < erode; k++) {
    const n = new Uint8ClampedArray(a);
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x; if (!a[i]) continue;
      n[i] = Math.min(a[i], a[i - 1], a[i + 1], a[i - w], a[i + w]);
    }
    a = n;
  }

  // 3. decontaminate: the edge band is every visible pixel within 3 px of a
  //    non-solid one; it borrows colour from solid pixels outside the band.
  const BAND = 3;
  const edge = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; if (!a[i]) continue;
    if (a[i] < 255) { edge[i] = 1; continue; }
    search: for (let dy = -BAND; dy <= BAND; dy++) for (let dx = -BAND; dx <= BAND; dx++) {
      const yy = y + dy, xx = x + dx;
      if (yy < 0 || xx < 0 || yy >= h || xx >= w || a[yy * w + xx] < 255) { edge[i] = 1; break search; }
    }
  }
  let fixed = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; if (!edge[i]) continue;
    let r = 0, g = 0, bl = 0, n = 0;
    for (let rad = BAND + 1; rad <= BAND + 6 && !n; rad += 2)
      for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) {
        const yy = y + dy, xx = x + dx; if (yy < 0 || xx < 0 || yy >= h || xx >= w) continue;
        const j = yy * w + xx; if (a[j] < 255 || edge[j]) continue;
        r += px[j * 4]; g += px[j * 4 + 1]; bl += px[j * 4 + 2]; n++;
      }
    if (n) {
      // keep a little of the pixel's own detail (60/40) so line art survives
      px[i * 4] = px[i * 4] * 0.4 + (r / n) * 0.6;
      px[i * 4 + 1] = px[i * 4 + 1] * 0.4 + (g / n) * 0.6;
      px[i * 4 + 2] = px[i * 4 + 2] * 0.4 + (bl / n) * 0.6;
      fixed++;
    }
  }
  for (let i = 0; i < w * h; i++) {
    px[i * 4 + 3] = a[i];
    if (!a[i]) { px[i * 4] = px[i * 4 + 1] = px[i * 4 + 2] = 0; }
  }
  const c1 = new OffscreenCanvas(w, h); c1.getContext('2d').putImageData(new ImageData(px, w, h), 0, 0);
  const s = Math.min(1, max / Math.max(w, h));
  const c2 = new OffscreenCanvas(Math.round(w * s), Math.round(h * s));
  const x2 = c2.getContext('2d'); x2.imageSmoothingQuality = 'high'; x2.drawImage(c1, 0, 0, c2.width, c2.height);
  const b64 = async (blob) => { const buf = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000)); return btoa(s); };
  return {
    png: await b64(await c1.convertToBlob({ type: 'image/png' })),
    webp: await b64(await c2.convertToBlob({ type: 'image/webp', quality: q })),
    trim: [L, T, w, h], out: [c2.width, c2.height], fixed,
  };
}, { src: `${base}/${src}`, erode, margin, q, max, crop, islands, opaque, box, shift });
await b.close();
if (res.png) fs.writeFileSync(`${out}.png`, Buffer.from(res.png, 'base64'));
fs.writeFileSync(`${out}.webp`, Buffer.from(res.webp, 'base64'));
console.log(src, 'trim', res.trim.join(','), '-> webp', res.out.join('x'), `${(fs.statSync(`${out}.webp`).size / 1024).toFixed(0)} KB`, 'edge px', res.fixed);
