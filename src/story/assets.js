// Art URLs, the manifest, and byte-accurate preloading.
// Preloaded files are kept as blob URLs so the story never downloads them twice.

const BASE = (import.meta.env && import.meta.env.BASE_URL) || '/';
export const artUrl = (file) => `${BASE}art/${file}`;

const blobs = new Map(); // file -> blob URL
const PRELOAD_CAP_MS = 12000;
let manifest = null;

/** The art manifest ({files:[{file,w,h,bytes}]}) as a Map file -> entry. */
export async function loadManifest() {
  if (manifest) return manifest;
  try {
    const res = await fetch(`${BASE}art/manifest.json`);
    const json = await res.json();
    manifest = new Map(json.files.map((f) => [f.file, f]));
  } catch (err) {
    console.warn('[drift] art manifest unavailable', err);
    manifest = new Map();
  }
  return manifest;
}

/** The URL to put in an <img>: a preloaded blob when we have one, else the static path. */
export const resolveArt = (file) => blobs.get(file) || artUrl(file);

/** Whether a smaller -1280 variant should be used on this screen. */
export function preferSmall() {
  const w = Math.max(window.innerWidth, window.innerHeight) * Math.min(window.devicePixelRatio || 1, 2);
  return w <= 1400;
}

/**
 * Fetch files and report real progress in bytes.
 * onProgress(loaded, total) is called as chunks arrive. Expected sizes come from the manifest,
 * so progress is meaningful before any response headers arrive.
 * Resolves when every file is in, or after capMs (default 12 s) in total: a stalled fetch never
 * holds the preloader. Late files keep loading; their images fill in from the static path.
 */
export async function preloadFiles(files, onProgress, capMs = PRELOAD_CAP_MS) {
  const man = await loadManifest();
  const expected = files.map((f) => (man.get(f) && man.get(f).bytes) || 60_000);
  const got = files.map(() => 0);
  const total = expected.reduce((a, b) => a + b, 0);
  const report = () => onProgress && onProgress(got.reduce((a, b) => a + b, 0), total);

  let timer;
  const cap = new Promise((resolve) => { timer = setTimeout(() => {
    console.warn(`[drift] preload capped at ${capMs / 1000} s; continuing with what has loaded`);
    for (let i = 0; i < got.length; i++) got[i] = expected[i];
    report();
    resolve();
  }, capMs); });
  const all = Promise.all(files.map(async (file, i) => {
    if (blobs.has(file)) { got[i] = expected[i]; report(); return; }
    try {
      const res = await fetch(artUrl(file));
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader();
      const chunks = [];
      let n = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        n += value.byteLength;
        got[i] = Math.min(n, expected[i]);
        report();
      }
      const type = res.headers.get('content-type') || 'image/webp';
      blobs.set(file, URL.createObjectURL(new Blob(chunks, { type })));
    } catch (err) {
      console.warn(`[drift] preload failed for ${file}`, err);
    }
    got[i] = expected[i];
    report();
  }));
  await Promise.race([all, cap]);
  clearTimeout(timer);
}

/** Resolve when an <img> has decoded (or failed), with a time cap so a transition never hangs. */
export function decodeImg(img, capMs = 2500) {
  const done = img.decode ? img.decode().catch(() => {}) : new Promise((r) => {
    if (img.complete) r(); else { img.onload = r; img.onerror = r; }
  });
  return Promise.race([done, new Promise((r) => setTimeout(r, capMs))]);
}
