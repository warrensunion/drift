// The Salish Sea view: a flat, detailed chart of the Fraser River mouth and the Strait of Georgia
// on SalishSeaCast's hourly tidal currents. Shares the particles, tracks, UI and streamline code
// with the globe; the simulation is the worker's 'salish' mode (src/sim/salish.js).
//
// Time here is hours: 1x = 1 simulated hour per second, the timeline runs 0 -> 30 days, the age
// ramp (fresh -> oxidised -> bleached) is stretched over those 30 days.
import './globe.css';
import * as THREE from 'three/webgpu';
import { Fn, texture, uv, vec2, vec3, vec4, float, color, mix, smoothstep, clamp, fwidth, abs, max, pow, dot, fract, min, screenCoordinate, hash, uniform } from 'three/tsl';
import { createRenderer, mountStaticFallback } from './renderer.js';
import { loadTile, PALETTE } from './ocean.js';
import { fieldTextures, createStreamlines } from './streamlines.js';
import { createParticles } from './particles.js';
import { createUI } from './ui.js';
import { createDropTrack, addSnapshot, fragmentStats, frameFor, lineageLocalsAt } from './tracks.js';
import { isTap, LAND_MESSAGE } from './pick.js';
import { decodeTile } from '../sim/field.js';
import { salishSnapshotHours, SALISH } from '../sim/salish.js';

const MAX_H = SALISH.maxHours;
export const OUTSIDE_MESSAGE = 'Outside the current model';
/** Main arm of the Fraser at Sand Heads, off Steveston (water in land.png). */
export const RIVER_MOUTH = Object.freeze({ lon: -123.30, lat: 49.10 });

export function formatHours(h) {
  const n = Math.floor(h);
  if (n < 1) return 'Just dropped';
  if (n < 48) return n === 1 ? '1 hour' : `${n} hours`;
  const d = Math.floor(n / 24), r = n % 24;
  if (d < 10 && r) return `${d} days ${r} h`;
  return `${d} days`;
}

export const SALISH_PROFILE = {
  title: 'The Fraser River mouth',
  lede: (touch) => `Most floating plastic in the Strait of Georgia comes down the Fraser. Drop something at the river mouth, or ${touch ? 'tap' : 'click'} any water, and follow the tide.`,
  target: 'the water',
  maxT: MAX_H,
  scaleK: 3,
  ticks: [[0, '0'], [24, '1 d'], [72, '3 d'], [240, '10 d'], [720, '30 d']],
  tickOrder: [0, 4, 2, 1, 3],
  speedText: (s) => [String(s), ' h'],
  speedLabel: (s) => `${s} simulated ${s === 1 ? 'hour' : 'hours'} per second`,
  speedTitle: (s) => `${s} simulated ${s === 1 ? 'hour' : 'hours'} per second`,
  speedGroup: 'Simulated hours per second',
  formatAge: formatHours,
  zero: 'Hour 0',
  fates: [['coast', 'On a beach'], ['left', 'Left the strait'], ['floating', 'Still floating']],
  when: (t) => (t >= MAX_H ? 'after 30 days' : `after ${formatHours(t).toLowerCase()} (still computing)`),
  primary: 'Drop at the river mouth',
  notes: ['Tidal currents from SalishSeaCast, one 25-hour cycle repeated.', 'No wind or breaking up at this scale.'],
};

// Chart labels, each checked against land.png (water names on water, land names on land).
const PLACES = [
  { name: 'Strait of Georgia', lon: -123.56, lat: 49.29, kind: 'sea' },
  { name: 'Fraser River', lon: -123.06, lat: 49.12, kind: 'river' },
  { name: 'Sturgeon Bank', lon: -123.26, lat: 49.17, kind: 'water' },
  { name: 'Burrard Inlet', lon: -123.17, lat: 49.305, kind: 'water' },
  { name: 'Boundary Bay', lon: -122.97, lat: 49.02, kind: 'water' },
  { name: 'Howe Sound', lon: -123.30, lat: 49.50, kind: 'water' },
  { name: 'Vancouver', lon: -123.10, lat: 49.265, kind: 'land' },
  { name: 'Richmond', lon: -123.13, lat: 49.165, kind: 'land' },
  { name: 'Delta', lon: -123.00, lat: 49.08, kind: 'land' },
  { name: 'Point Grey', lon: -123.24, lat: 49.262, kind: 'land' },
  { name: 'Tsawwassen', lon: -123.08, lat: 49.02, kind: 'land' },
  { name: 'Point Roberts', lon: -123.065, lat: 48.98, kind: 'land' },
  { name: 'Bowen Island', lon: -123.37, lat: 49.38, kind: 'land' },
  { name: 'Gabriola Island', lon: -123.78, lat: 49.165, kind: 'land' },
  { name: 'Galiano Island', lon: -123.45, lat: 48.92, kind: 'land' },
  { name: 'Nanaimo', lon: -123.95, lat: 49.17, kind: 'land' },
  { name: 'Haro Strait', lon: -123.20, lat: 48.57, kind: 'water' },
  { name: 'Juan de Fuca Strait', lon: -123.70, lat: 48.30, kind: 'sea' },
  { name: 'Boundary Pass', lon: -123.08, lat: 48.765, kind: 'water' },
  { name: 'Victoria', lon: -123.37, lat: 48.43, kind: 'land' },
  { name: 'San Juan Islands', lon: -123.08, lat: 48.53, kind: 'land' },
  { name: 'Saturna Island', lon: -123.20, lat: 48.79, kind: 'land' },
  { name: 'Salt Spring Island', lon: -123.50, lat: 48.80, kind: 'land' },
  { name: 'Outside the current model', lon: -124.97, lat: 48.5, kind: 'outside' },
  { name: 'Outside the current model', lon: -122.86, lat: 49.76, kind: 'outside' },
];

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`could not load ${url}`));
    img.src = url;
  });
}

/**
 * land.png (0 water, 255 land, 128 outside the model domain) -> {mask (north-first bytes, for the
 * worker and taps), texture}. The texture is 2x the mask, rows south-first: R = outside the
 * model (1.2 px blur), G = land, 3 px blur (coast line), B = land, 16 px blur (inland shading),
 * A = land, 48 px blur (water depth feel: near the coast is shallow).
 */
async function loadSalishLand(url) {
  const img = await loadImage(url);
  const w = img.naturalWidth, h = img.naturalHeight;
  const raw = document.createElement('canvas');
  raw.width = w; raw.height = h;
  const rc = raw.getContext('2d', { willReadFrequently: true });
  rc.drawImage(img, 0, 0);
  const rd = rc.getImageData(0, 0, w, h).data;
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) mask[i] = rd[i * 4];
  // Two binary layers: land, and outside the model.
  const layer = (test) => {
    const lc = document.createElement('canvas');
    lc.width = w; lc.height = h;
    const lx = lc.getContext('2d');
    const id = lx.createImageData(w, h);
    for (let i = 0; i < w * h; i++) { const v = test(mask[i]) ? 255 : 0; id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = v; id.data[i * 4 + 3] = 255; }
    lx.putImageData(id, 0, 0);
    return lc;
  };
  const landLayer = layer((v) => v >= 192), outLayer = layer((v) => v >= 64 && v < 192);
  const W = w * 2, H = h * 2;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  const draw = (src, blur) => {
    ctx.filter = blur ? `blur(${blur}px)` : 'none';
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    ctx.drawImage(src, 0, 0, W, H);
    return ctx.getImageData(0, 0, W, H).data;
  };
  const r = draw(outLayer, 1.2), g = draw(landLayer, 3), b = draw(landLayer, 16), a = draw(landLayer, 48);
  const rgba = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    const dst = (H - 1 - y) * W;
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4, o = (dst + x) * 4;
      rgba[o] = r[i]; rgba[o + 1] = g[i]; rgba[o + 2] = b[i]; rgba[o + 3] = a[i];
    }
  }
  const tex = new THREE.DataTexture(rgba, W, H, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return { mask: { width: w, height: h, data: mask }, texture: tex };
}

/** The map: chart-paper land, petrol-to-glass water by distance from the coast, tidal streamlines. */
function createMap({ extent, cosC, landTex, trailTex, waterTex, paperTex }) {
  const width = (extent.east - extent.west) * cosC, height = extent.north - extent.south;
  const geo = new THREE.PlaneGeometry(width, height);
  const landNode = texture(landTex);
  const trailNode = texture(trailTex);
  const uTrail = uniform(1);
  const cPetrol = color(PALETTE.petrol), cDeep = color(PALETTE.deep), cGlass = color(PALETTE.glass), cFoam = color(PALETTE.foam);
  const cAbyss = color('#0A2930'), cShallow = color('#3D8681'), cOutside = color('#284448');
  const mat = new THREE.MeshBasicNodeMaterial();
  mat.colorNode = Fn(() => {
    const st = uv();
    const lm = landNode.sample(st);
    const edge = lm.g;
    const fw = max(fwidth(edge), 0.003);
    const land = smoothstep(float(0.5).sub(fw), float(0.5).add(fw), edge);
    const coast = float(1).sub(smoothstep(fw.mul(0.6), fw.mul(1.8), abs(edge.sub(0.5))));
    // Water: deep petrol offshore, lighter toward the coast ("depth" from the 48 px blur).
    const shallow = smoothstep(0.02, 0.55, lm.a);
    let water = mix(cAbyss, cPetrol, smoothstep(0.0, 0.12, lm.a));
    water = mix(water, cDeep, shallow.mul(0.85));
    water = mix(water, cShallow, pow(smoothstep(0.25, 0.75, lm.a), 1.5).mul(0.55));
    if (waterTex) {
      const w1 = dot(texture(waterTex, st.mul(vec2(3.2, 2.6))).rgb, vec3(0.333, 0.333, 0.333));
      water = water.mul(float(0.84).add(w1.mul(0.3)));
    }
    // Chart graticule every 0.1 degree, very faint, on the water.
    const lon = st.x.mul(extent.east - extent.west).add(extent.west), lat = st.y.mul(extent.north - extent.south).add(extent.south);
    const gx = abs(fract(lon.mul(10).add(0.5)).sub(0.5)), gy = abs(fract(lat.mul(10).add(0.5)).sub(0.5));
    const grid = max(float(1).sub(smoothstep(0, fwidth(lon.mul(10)).mul(1.2), gx)), float(1).sub(smoothstep(0, fwidth(lat.mul(10)).mul(1.2), gy)));
    water = mix(water, cGlass, grid.mul(0.09));
    // Tidal streamlines.
    const tr = clamp(trailNode.sample(st).r, 0, 1).mul(uTrail).mul(float(1).sub(land));
    water = mix(water, cGlass, pow(tr, 0.7).mul(0.48));
    // Land: chart paper, slightly darker toward its coast, a soft inland lift.
    let paper = cFoam.mul(float(0.8).add(smoothstep(0.5, 1.0, lm.b).mul(0.14)));
    if (paperTex) {
      const p = dot(texture(paperTex, st.mul(vec2(4, 4.3))).rgb, vec3(0.333, 0.333, 0.333));
      paper = paper.mul(float(0.76).add(p.mul(0.28)));
    }
    let col = mix(water, paper, land);
    col = mix(col, cGlass, coast.mul(0.8));
    // Outside the model domain (beyond SalishSeaCast's open boundaries): neither sea nor land on
    // this chart, a muted fill with fine diagonal hatching and a soft edge.
    const out = smoothstep(0.3, 0.7, lm.r);
    const hv = lon.mul(cosC).add(lat).mul(45);
    const hatch = float(1).sub(smoothstep(0.0, fwidth(hv).mul(1.2), abs(fract(hv).sub(0.5))));
    const outCol = mix(cOutside, cGlass, hatch.mul(0.2));
    col = mix(col, outCol, out);
    const outEdge = float(1).sub(smoothstep(0, fwidth(lm.r).mul(1.5), abs(lm.r.sub(0.5))));
    col = mix(col, cGlass, outEdge.mul(0.35));
    const g = hash(screenCoordinate.x.add(screenCoordinate.y.mul(4099.0))).sub(0.5).mul(0.014);
    return col.add(g);
  })();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 0;
  return { mesh, width, height, uniforms: { uTrail }, setTrail(t) { trailNode.value = t; }, dispose() { geo.dispose(); mat.dispose(); } };
}

/** Mount the Salish Sea view (mountGlobe(el, {mode:'salish'})). Returns {dispose()}. */
export function mountSalish(el, { embedded = true } = {}) {
  const base = (import.meta.env && import.meta.env.BASE_URL) || '/';
  const params = new URLSearchParams(location.search);
  const reducedMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const touch = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);

  const root = document.createElement('div');
  root.className = 'drift-globe drift-salish';
  root.dataset.mode = 'salish';
  if (reducedMotion) root.classList.add('is-reduced');
  if (embedded) root.classList.add('is-embedded');
  root.tabIndex = -1;
  const canvas = document.createElement('canvas');
  canvas.className = 'drift-globe__canvas';
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'Chart of the Fraser River mouth and the Strait of Georgia. Drag to move, pinch or hold Ctrl and scroll to zoom, click or tap the water to drop the selected item.');
  const labels = document.createElement('div');
  labels.className = 'salish-labels';
  labels.setAttribute('aria-hidden', 'true');
  const grain = document.createElement('div');
  grain.className = 'drift-globe__grain';
  grain.style.setProperty('--globe-paper', `url(${base}art/ui-paper.webp)`);
  const zoomHint = document.createElement('p');
  zoomHint.className = 'globe-zoomhint';
  zoomHint.setAttribute('aria-hidden', 'true');
  zoomHint.textContent = 'Hold Ctrl to zoom';
  root.append(canvas, labels, grain, zoomHint);
  el.append(root);

  const ui = createUI(root, { base, touch, reducedMotion, profile: SALISH_PROFILE });
  ui.setStatus('Loading the tides…');
  ui.setDropEnabled(false);

  let disposed = false;
  const cleanups = [];
  const listen = (target, type, fn, opts) => { target.addEventListener(type, fn, opts); cleanups.push(() => target.removeEventListener(type, fn, opts)); };

  const S = {
    t: 0, playing: false, speed: 30, tracks: new Map(), newest: null, selected: null,
    fps: 0, frameMs: 0, members: 0, ready: false, simOk: true, cpu: { particles: 0, streamlines: 0, render: 0 },
  };
  let renderer = null, worker = null, scene, camera, map, lines, parts, landMask = null, tile = null, extent = null, cosC = 1, lonC = 0, latC = 0;
  let landTex = null, waterTex = null, paperTex = null, fieldTex = null;
  const pendingDrops = [];
  const dropWaiters = [];
  const hours = salishSnapshotHours();
  const view = { cx: 0, cy: 0, s: 0.001, tcx: 0, tcy: 0, ts: 0.001, cover: 0.001 };
  let size = { w: 1, h: 1, phone: false };
  let viewDirty = true;
  const labelEls = [];
  let marker = null;

  // ---- geometry: world <-> lon/lat <-> screen ----
  const toWorld = (lon, lat) => [(lon - lonC) * cosC, lat - latC];
  const fromWorld = (x, y) => [x / cosC + lonC, y + latC];
  const toScreen = (lon, lat) => {
    const [x, y] = toWorld(lon, lat);
    return [(x - view.cx) / view.s + size.w / 2, (view.cy - y) / view.s + size.h / 2];
  };
  const fromScreen = (sx, sy) => fromWorld(view.cx + (sx - size.w / 2) * view.s, view.cy - (sy - size.h / 2) * view.s);

  function clampView() {
    if (!map) return;
    view.ts = Math.min(view.cover, Math.max(view.cover / 14, view.ts));
    const hw = (size.w / 2) * view.ts, hh = (size.h / 2) * view.ts;
    const mx = Math.max(0, map.width / 2 - hw), my = Math.max(0, map.height / 2 - hh);
    view.tcx = Math.min(mx, Math.max(-mx, view.tcx));
    // With the phone sheet open, allow the map to slide up by the sheet's height.
    const sheet = size.phone && root.classList.contains('has-panel') && !root.classList.contains('is-collapsed') ? size.h * 0.56 * view.ts : 0;
    view.tcy = Math.min(my, Math.max(-my - sheet, view.tcy));
  }

  function layout() {
    const r = root.getBoundingClientRect();
    const w = Math.max(1, r.width), h = Math.max(1, r.height);
    const phone = w < 760;
    const first = size.w === 1;
    size = { w, h, phone };
    if (map) {
      const cover = Math.min(map.width / w, map.height / h);
      const ratio = view.ts / view.cover;
      view.cover = cover;
      // First frame: the Fraser mouth and the central Strait of Georgia (about 0.9 degrees of
      // latitude tall on desktop, 0.7 degrees of longitude wide on a phone), whatever the extent;
      // pan and zoom then reach the whole chart.
      const framed = phone ? (0.7 * cosC) / w : 0.9 / h;
      view.ts = first ? Math.min(cover, framed) : cover * ratio;
      if (first) {
        // River mouth right of centre on desktop (the left column is the UI), above the bottom
        // sheet on a phone.
        const [mx, my] = toWorld(RIVER_MOUTH.lon + (phone ? 0.02 : -0.1), RIVER_MOUTH.lat + (phone ? -0.04 : 0.05));
        view.tcx = mx - (phone ? 0 : w * 0.12 * view.ts);
        view.tcy = my;
      }
      clampView();
      if (first) { view.cx = view.tcx; view.cy = view.tcy; view.s = view.ts; }
    }
    if (renderer && camera) {
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      renderer.setSize(w, h, false);
    }
    viewDirty = true;
  }
  const ro = new ResizeObserver(() => layout());
  ro.observe(root);
  cleanups.push(() => ro.disconnect());

  // land.png: 0 water, 255 land, 128 outside the model domain (null off the chart).
  const maskAt = (lon, lat) => {
    if (!landMask || !extent) return null;
    if (lon < extent.west || lon >= extent.east || lat < extent.south || lat >= extent.north) return null;
    const x = Math.floor((lon - extent.west) / (extent.east - extent.west) * landMask.width);
    const y = Math.floor((extent.north - lat) / (extent.north - extent.south) * landMask.height);
    return landMask.data[y * landMask.width + x];
  };
  const isLand = (lon, lat) => { const v = maskAt(lon, lat); return v === null || v >= 192; };
  const isOutside = (lon, lat) => { const v = maskAt(lon, lat); return v !== null && v >= 64 && v < 192; };

  // ---- loading ----
  async function start() {
    let r;
    try {
      r = await createRenderer(canvas, { force: params.get('gl') });
    } catch (e) {
      if (disposed) return;
      canvas.remove();
      root.classList.add('is-static');
      mountStaticFallback(root, String((e && e.message) || e), base);
      return;
    }
    if (disposed) { r.renderer.dispose(); return; }
    renderer = r.renderer;
    S.backend = r.backend;
    let land, tideBuf;
    [land, tideBuf, waterTex, paperTex] = await Promise.all([
      loadSalishLand(`${base}data/salish/land.png`).catch((e) => { console.warn('[drift] salish land:', e.message); return null; }),
      fetch(`${base}data/salish/tide.bin`).then((x) => (x.ok ? x.arrayBuffer() : Promise.reject(new Error(`tide.bin: HTTP ${x.status}`)))).catch((e) => { console.warn('[drift] salish tide:', e.message); return null; }),
      loadTile(`${base}art/ui-water.webp`),
      loadTile(`${base}art/ui-paper.webp`),
    ]);
    if (disposed) return;
    if (!land || !tideBuf) {
      ui.setStatus('The Salish Sea data did not load, so this chart cannot be shown. Try reloading the page.', 'error');
      return;
    }
    tile = decodeTile(tideBuf);
    landMask = land.mask;
    landTex = land.texture;
    extent = {
      west: tile.lon0 - tile.dlon / 2, east: tile.lon0 + (tile.nx - 0.5) * tile.dlon,
      south: tile.lat0 - tile.dlat / 2, north: tile.lat0 + (tile.ny - 0.5) * tile.dlat,
    };
    lonC = (extent.west + extent.east) / 2; latC = (extent.south + extent.north) / 2;
    cosC = Math.cos(latC * Math.PI / 180);

    // One field texture per hourly frame.
    const n = tile.nx * tile.ny * 2;
    fieldTex = fieldTextures(Array.from({ length: tile.nframes }, (_, f) => ({ ...tile, nframes: 1, data: tile.data.subarray(f * n, (f + 1) * n) })));
    lines = createStreamlines(renderer, {
      fieldTex: fieldTex[0], reducedMotion, seeds: 14000, region: extent, renormalize: true,
      gain: 0.0007, dotScale: 0.0017, trailSize: [2048, 1400],
    });
    scene = new THREE.Scene();
    map = createMap({ extent, cosC, landTex, trailTex: lines.texture, waterTex, paperTex });
    scene.add(map.mesh);
    parts = createParticles({ flat: { lonC, latC }, days: hours, ageScale: 3650 / MAX_H, fadeSpan: 12, ghost: 0, jump: 12 });
    scene.add(parts.group);
    camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -10, 10);
    camera.position.set(0, 0, 5);
    buildLabels();
    size = { w: 1, h: 1 };
    layout();
    startWorker();
    bindInput();
    renderer.setAnimationLoop(frame);
  }

  function buildLabels() {
    for (const p of PLACES) {
      const e = document.createElement('span');
      e.className = `salish-label salish-label--${p.kind}`;
      e.textContent = p.name;
      labels.append(e);
      labelEls.push({ e, p });
    }
    marker = document.createElement('button');
    marker.type = 'button';
    marker.className = 'salish-marker';
    marker.setAttribute('aria-label', 'Drop at the Fraser River mouth');
    const ring = document.createElement('span');
    ring.className = 'salish-marker__ring';
    const txt = document.createElement('span');
    txt.className = 'salish-marker__label';
    txt.textContent = 'Fraser River mouth';
    marker.append(ring, txt);
    marker.addEventListener('click', () => dropAtMouth());
    root.append(marker);
  }

  function placeLabels() {
    // Zoom-dependent label sizes: chart labels grow a little as you zoom in.
    const zoomKey = (Math.round(Math.min(1.5, Math.max(0.85, Math.sqrt(view.cover / view.s) * 0.9)) * 50) / 50).toFixed(2);
    if (labels.style.getPropertyValue('--salish-zoom') !== zoomKey) labels.style.setProperty('--salish-zoom', zoomKey);
    // Labels in list order (sea and water names first); one that would touch a label already
    // placed, or the river-mouth marker, is hidden at this zoom.
    const kept = [];
    if (marker) {
      const [x, y] = toScreen(RIVER_MOUTH.lon, RIVER_MOUTH.lat);
      marker.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      kept.push({ l: x - 18, r: x + 160, t: y - 18, b: y + 18 });
    }
    for (const { e, p } of labelEls) {
      const [x, y] = toScreen(p.lon, p.lat);
      e.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%)`;
      // Sizes depend only on the zoom-scaled font: measure once per zoom step.
      if (e._zoom !== zoomKey) { e._w = e.offsetWidth; e._h = e.offsetHeight; e._zoom = zoomKey; }
      const w = e._w, h = e._h;
      const box = { l: x - w / 2 - 6, r: x + w / 2 + 6, t: y - h / 2 - 3, b: y + h / 2 + 3 };
      const clash = kept.some((k) => box.l < k.r && box.r > k.l && box.t < k.b && box.b > k.t);
      e.style.visibility = clash ? 'hidden' : '';
      if (!clash) kept.push(box);
    }
  }

  // ---- worker ----
  function startWorker() {
    ui.setStatus('Loading the tides…');
    try {
      worker = new Worker(new URL('../sim/worker.js', import.meta.url), { type: 'module' });
    } catch (e) { simFailed(e.message); return; }
    worker.onerror = (ev) => { ev.preventDefault(); simFailed(ev.message || 'the simulation could not start'); };
    worker.onmessage = (ev) => onWorker(ev.data);
    worker.postMessage({
      type: 'mode', mode: 'salish',
      tideUrl: new URL(`${base}data/salish/tide.bin`, location.href).href,
      landMask: { width: landMask.width, height: landMask.height, data: landMask.data.slice() },
    });
  }

  function simFailed(reason) {
    S.simOk = false;
    console.info(`[drift] simulation unavailable: ${reason}`);
    ui.setStatus('The simulation could not start in this browser, so drops are off.', 'error');
    ui.setDropEnabled(false, 'The simulation could not start, so nothing can be dropped right now.');
    pendingDrops.length = 0;
  }

  function onWorker(msg) {
    switch (msg.type) {
      case 'ready':
        S.ready = true;
        ui.setStatus('');
        ui.setDropEnabled(true);
        ui.setItem(ui.item);
        while (pendingDrops.length) worker.postMessage(pendingDrops.shift());
        break;
      case 'dropped': {
        const tr = createDropTrack({ ...msg, schedule: hours });
        S.tracks.set(msg.dropId, tr);
        S.newest = msg.dropId;
        parts.addDrop(tr);
        // Follow the new drop: select it (its panel), and on a phone collapse the sheet to the
        // one-line summary so the map keeps most of the screen.
        select({ dropId: msg.dropId, fragId: msg.dropId * 256 });
        if (size.phone) ui.setCollapsed(true);
        const w = dropWaiters.shift();
        if (w) w(msg.dropId);
        break;
      }
      case 'snapshot': { const tr = S.tracks.get(msg.dropId); if (tr) addSnapshot(tr, msg); break; }
      case 'progress': { const tr = S.tracks.get(msg.dropId); if (tr) tr.computedDay = Math.max(tr.computedDay, msg.day); break; }
      case 'done': { const tr = S.tracks.get(msg.dropId); if (tr) tr.done = true; break; }
      case 'retired':
        S.tracks.delete(msg.dropId);
        parts.removeDrop(msg.dropId);
        if (S.selected && S.selected.dropId === msg.dropId) select(null);
        break;
      case 'cleared': S.tracks.clear(); parts.clear(); select(null); break;
      case 'error':
        console.warn(`[drift] simulation ${msg.stage}: ${msg.reason}`);
        if (msg.stage === 'init') simFailed(msg.reason);
        else if (msg.stage === 'drop') {
          ui.showToast('That drop did not work. Try another spot.');
          const w = dropWaiters.shift();
          if (w) w(null);
        }
        break;
      default:
    }
  }

  function drop(item, lon, lat, seed = (Math.random() * 4294967296) >>> 0) {
    if (!worker || !S.simOk) return false;
    const m = { type: 'drop', item, lon, lat, startDoy: 1, seed };
    if (S.ready) worker.postMessage(m); else pendingDrops.push(m);
    S.t = 0;
    S.playing = true;
    return true;
  }
  const dropAtMouth = () => drop(ui.item, RIVER_MOUTH.lon, RIVER_MOUTH.lat);

  // ---- selection ----
  function select(sel) {
    S.selected = sel;
    if (!parts) return;
    if (!sel) { parts.setSelection(null); ui.setPanel(null); return; }
    refreshPanel();
  }
  function refreshPanel() {
    if (!S.selected) return;
    const tr = S.tracks.get(S.selected.dropId);
    if (!tr) { select(null); return; }
    ui.setPanel(fragmentStats(tr, S.selected.fragId, S.t));
    const fr = frameFor(tr, S.t);
    parts.setSelection(S.selected.dropId, fr ? [...lineageLocalsAt(tr, S.selected.fragId, fr.index)] : []);
  }

  function pickMember(x, y) {
    let best = null, bd = 16 * 16;
    parts.forEachMember((v, tr, fragLocal) => {
      const sx = (v.x - view.cx) / view.s + size.w / 2, sy = (view.cy - v.y) / view.s + size.h / 2;
      const d = (sx - x) ** 2 + (sy - y) ** 2;
      if (d < bd) { bd = d; best = { dropId: tr.dropId, fragId: tr.dropId * 256 + fragLocal }; }
    });
    return best;
  }

  function tap(x, y) {
    const hit = pickMember(x, y);
    if (hit) { select(hit); return; }
    const [lon, lat] = fromScreen(x, y);
    if (isOutside(lon, lat)) { ui.showToast(OUTSIDE_MESSAGE, x, y); return; }
    if (isLand(lon, lat)) { ui.showToast(LAND_MESSAGE, x, y); return; }
    if (!S.simOk) { ui.showToast('Drops are off: the simulation could not start.', x, y); return; }
    drop(ui.item, lon, lat);
  }

  // ---- input: drag pans, pinch / Ctrl-wheel zooms ----
  const pointers = new Map();
  let down = null, pinch = null;
  let hintTimer = 0;
  cleanups.push(() => clearTimeout(hintTimer));
  const showZoomHint = () => {
    if (zoomHint.classList.contains('is-on')) return;
    zoomHint.classList.add('is-on');
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => zoomHint.classList.remove('is-on'), 1500);
  };
  const zoomAt = (sx, sy, factor) => {
    const [wx, wy] = [view.tcx + (sx - size.w / 2) * view.ts, view.tcy - (sy - size.h / 2) * view.ts];
    const ns = Math.min(view.cover, Math.max(view.cover / 14, view.ts * factor));
    view.tcx = wx - (sx - size.w / 2) * ns;
    view.tcy = wy + (sy - size.h / 2) * ns;
    view.ts = ns;
    clampView();
  };

  function bindInput() {
    listen(canvas, 'pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      if (document.activeElement !== root) root.focus({ preventScroll: true });
      pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
      if (pointers.size === 1) down = { x: e.offsetX, y: e.offsetY, t: performance.now(), cx: view.tcx, cy: view.tcy };
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), s: view.ts, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, cx: view.tcx, cy: view.tcy };
        down = null;
      }
    });
    listen(canvas, 'pointermove', (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
      if (pinch && pointers.size >= 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        view.tcx = pinch.cx - (mx - pinch.mx) * view.ts;
        view.tcy = pinch.cy + (my - pinch.my) * view.ts;
        view.ts = pinch.s;
        zoomAt(mx, my, pinch.d / Math.max(1, d));
        return;
      }
      if (!down) return;
      view.tcx = down.cx - (e.offsetX - down.x) * view.ts;
      view.tcy = down.cy + (e.offsetY - down.y) * view.ts;
      clampView();
    });
    const up = (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      if (down && e.type === 'pointerup' && isTap(down, { x: e.offsetX, y: e.offsetY, t: performance.now() })) tap(e.offsetX, e.offsetY);
      if (pointers.size === 0) down = null;
    };
    listen(canvas, 'pointerup', up);
    listen(canvas, 'pointercancel', up);
    listen(canvas, 'wheel', (e) => {
      if (embedded && !(e.ctrlKey || e.metaKey) && !root.contains(document.activeElement)) { showZoomHint(); return; }
      e.preventDefault();
      zoomAt(e.offsetX, e.offsetY, Math.exp(e.deltaY * 0.0015));
    }, { passive: false });
    const onKey = (e) => {
      const t = e.target;
      if (t && /^(input|textarea|select|button)$/i.test(t.tagName)) return;
      if (e.key === ' ') { e.preventDefault(); togglePlay(); }
      if (e.key === 'Escape') select(null);
    };
    listen(root, 'keydown', onKey);
    if (!embedded) listen(window, 'keydown', (e) => { if (e.target === document.body) onKey(e); });
    ui.on('play', togglePlay);
    ui.on('speed', (s) => { S.speed = s; });
    ui.on('scrub', (d) => { S.t = Math.min(d, maxComputed()); S.playing = false; });
    ui.on('deselect', () => select(null));
    ui.on('primary', () => dropAtMouth());
    ui.on('panel', (open) => {
      layout();
      // On a phone the sheet covers the lower half: lift the river mouth into view.
      if (size.phone && open && !ui.collapsed) {
        // Mouth at 16% of the height (the plume runs south of it, into the visible band).
        const [, my] = toWorld(RIVER_MOUTH.lon, RIVER_MOUTH.lat);
        view.tcy = my - (0.5 - 0.16) * size.h * view.ts;
        clampView();
      }
    });
  }

  function togglePlay() {
    if (!S.playing && S.t >= MAX_H - 0.5) S.t = 0;
    S.playing = !S.playing;
  }
  const maxComputed = () => { let m = 0; for (const tr of S.tracks.values()) m = Math.max(m, tr.lastDay); return m; };
  const newestComputed = () => { const tr = S.newest != null ? S.tracks.get(S.newest) : null; return tr ? Math.max(0, tr.lastDay) : maxComputed(); };

  // ---- frame ----
  let last = performance.now();
  let frameNo = 0;
  let frameIdx = -1;
  let lastDpr = window.devicePixelRatio || 1;
  const frameTimes = [];
  function frame() {
    const now = performance.now();
    const dtMs = Math.min(250, now - last);
    last = now;
    const dt = dtMs / 1000;
    frameNo++;
    if ((window.devicePixelRatio || 1) !== lastDpr) { lastDpr = window.devicePixelRatio || 1; layout(); }
    S.frameMs = S.frameMs ? S.frameMs * 0.95 + dtMs * 0.05 : dtMs;
    S.fps = 1000 / S.frameMs;
    frameTimes.push(dtMs);
    if (frameTimes.length > 600) frameTimes.shift();

    const k = reducedMotion ? 1 : 1 - Math.pow(0.96, dtMs / 16.67);
    const moving = Math.abs(view.tcx - view.cx) + Math.abs(view.tcy - view.cy) > view.s * 0.05 || Math.abs(view.ts - view.s) > view.s * 0.0005;
    view.cx += (view.tcx - view.cx) * k;
    view.cy += (view.tcy - view.cy) * k;
    view.s += (view.ts - view.s) * k;
    camera.left = view.cx - (size.w / 2) * view.s; camera.right = view.cx + (size.w / 2) * view.s;
    camera.top = view.cy + (size.h / 2) * view.s; camera.bottom = view.cy - (size.h / 2) * view.s;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    parts.setPxWorld(view.s);
    if (moving || viewDirty) { placeLabels(); viewDirty = false; }

    const cap = maxComputed();
    if (S.playing) {
      S.t = Math.min(S.t + dt * S.speed, MAX_H);
      if (S.t >= MAX_H) S.playing = false;
      if (S.t > cap && S.tracks.size) S.t = cap;
    }
    ui.setTime(S.t, { playing: S.playing, speed: S.speed, computedDay: newestComputed() });

    // Tidal frame: the newest drop's hour (drops start at frame 0 of the 25-hour cycle).
    const fIdx = Math.floor(S.t) % fieldTex.length;
    if (fIdx !== frameIdx) { frameIdx = fIdx; lines.setField(fieldTex[fIdx]); }

    let c0 = performance.now();
    S.members = parts.update(S.t);
    let c1 = performance.now();
    S.cpu.particles = S.cpu.particles * 0.9 + (c1 - c0) * 0.1;
    lines.update(dt);
    map.setTrail(lines.texture);
    c0 = performance.now();
    S.cpu.streamlines = S.cpu.streamlines * 0.9 + (c0 - c1) * 0.1;
    renderer.render(scene, camera);
    c1 = performance.now();
    S.cpu.render = S.cpu.render * 0.9 + (c1 - c0) * 0.1;
    if (S.selected && frameNo % 6 === 0) refreshPanel();
  }

  start().catch((e) => {
    console.warn('[drift] salish view failed to start:', e);
    ui.setStatus('The Salish Sea chart could not start in this browser.', 'error');
  });

  let hook = null;
  if (import.meta.env && (import.meta.env.DEV || import.meta.env.MODE === 'development')) {
    hook = window.__drift = {
      mode: 'salish',
      get fps() { return S.fps; },
      get members() { return S.members; },
      get backend() { return S.backend; },
      get ready() { return S.ready; },
      get t() { return S.t; },
      drop(item, lon, lat, seed) {
        return new Promise((resolve) => { if (!drop(item, lon, lat, seed)) { resolve(null); return; } dropWaiters.push(resolve); });
      },
      dropAtMouth(seed) { return hook.drop(ui.item, RIVER_MOUTH.lon, RIVER_MOUTH.lat, seed); },
      setDay(h) { S.t = Math.max(0, Math.min(MAX_H, h)); S.playing = false; },
      play(on = true) { S.playing = on; },
      speed(s) { S.speed = s; },
      tap(x, y) { tap(x, y); },
      clear() { if (worker) worker.postMessage({ type: 'clear' }); },
      isLand(lon, lat) { return isLand(lon, lat); },
      isOutside(lon, lat) { return isOutside(lon, lat); },
      toScreen(lon, lat) { return toScreen(lon, lat); },
      centerOn(lon, lat) { const [x, y] = toWorld(lon, lat); view.tcx = view.cx = x; view.tcy = view.cy = y; clampView(); view.cx = view.tcx; view.cy = view.tcy; viewDirty = true; },
      computed() { return [...S.tracks.values()].map((t) => ({ dropId: t.dropId, day: t.lastDay, done: t.done })); },
      select(dropId, fragId = dropId * 256) { select({ dropId, fragId }); },
      cpu() { return { ...S.cpu }; },
      frameStats() {
        const a = [...frameTimes].sort((x, y) => x - y);
        const mean = a.reduce((s, v) => s + v, 0) / (a.length || 1);
        return { frames: a.length, meanMs: mean, fps: 1000 / mean, p50: a[a.length >> 1], p95: a[Math.floor(a.length * 0.95)] };
      },
      resetFrames() { frameTimes.length = 0; },
      debug() { return { scene, camera, renderer, parts, lines, map, THREE, S, view }; },
    };
  }

  return {
    dispose() {
      disposed = true;
      if (renderer) renderer.setAnimationLoop(null);
      for (const c of cleanups) c();
      if (worker) worker.terminate();
      if (lines) lines.dispose();
      if (parts) parts.dispose();
      if (map) map.dispose();
      if (fieldTex) fieldTex.forEach((t) => t.dispose());
      for (const t of [landTex, waterTex, paperTex]) if (t) t.dispose();
      if (renderer) renderer.dispose();
      ui.dispose();
      root.remove();
      if (hook && window.__drift === hook) delete window.__drift;
    },
  };
}
