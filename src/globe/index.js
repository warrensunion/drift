// The interactive ocean globe (a lazy chunk): mountGlobe(el, {mode}) -> {dispose()}.
// Wires renderer, ocean, streamlines, particles, the simulation worker and the DOM controls.
import './globe.css';
import * as THREE from 'three/webgpu';
import { createRenderer, mountStaticFallback } from './renderer.js';
import { loadLandmask, loadTile, createOcean } from './ocean.js';
import { fieldTextures, createStreamlines } from './streamlines.js';
import { createParticles } from './particles.js';
import { createUI, MAX_DAY } from './ui.js';
import { createDropTrack, addSnapshot, fragmentStats, frameFor, lineageLocalsAt } from './tracks.js';
import { isTap, dropTarget, isLandAt, lonLatToVec3 } from './pick.js';
import { decodeTile, sample } from '../sim/field.js';
import { monthOfDoy } from '../sim/ensemble.js';
import { mountSalish } from './salish.js';

/** Views mountGlobe can show (the story page enables its mode switch from this). */
export const MODES = Object.freeze(['global', 'salish']);

const FOV = 32;
const PICK_PX = 16;
const AUTO_ROTATE_DEG_S = 2.2;
const KEY_HELP = 'With the keyboard: arrow keys turn it, plus and minus zoom, Enter drops at the ring in the middle.';

const dayOfYear = (d = new Date()) => {
  const start = Date.UTC(d.getUTCFullYear(), 0, 1);
  return Math.floor((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - start) / 86400000) + 1;
};

function starfield(w = 900, h = 900) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  let s = 12345;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let i = 0; i < 420; i++) {
    const r = rnd() < 0.92 ? 0.5 + rnd() * 0.5 : 1 + rnd() * 0.7;
    g.fillStyle = `rgba(214, 236, 230, ${0.12 + rnd() * 0.45})`;
    g.beginPath();
    g.arc(rnd() * w, rnd() * h, r, 0, Math.PI * 2);
    g.fill();
  }
  // A blob URL (revoked on dispose) rather than a long data URL in a CSS variable.
  return new Promise((resolve) => c.toBlob((b) => resolve(b ? URL.createObjectURL(b) : null), 'image/png'));
}

/**
 * Mount the globe into `el`. mode: 'global' (the Salish Sea view is Task 9 and currently shows
 * the global globe). embedded (default true): the globe sits inside a scrolling page, so a
 * one-finger vertical swipe scrolls the page (horizontal drags rotate, pinch zooms), the wheel
 * zooms only with Ctrl/Cmd held or while the globe has focus, and keys are scoped to the globe.
 * embedded:false is the full-screen harness: every drag rotates, the wheel always zooms.
 * Returns {dispose()} at once; loading continues in the background.
 */
export function mountGlobe(el, { mode = 'global', embedded = true } = {}) {
  if (mode === 'salish') return mountSalish(el, { embedded });
  const base = (import.meta.env && import.meta.env.BASE_URL) || '/';
  const params = new URLSearchParams(location.search);
  const reducedMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const touch = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);

  const root = document.createElement('div');
  root.className = 'drift-globe';
  root.dataset.mode = mode;
  if (reducedMotion) root.classList.add('is-reduced');
  if (embedded) root.classList.add('is-embedded');
  root.tabIndex = -1; // focusable by script (a click on the globe), not a tab stop
  let starsUrl = null;
  starfield().then((u) => {
    if (disposed) { if (u) URL.revokeObjectURL(u); return; }
    starsUrl = u;
    if (u) root.style.setProperty('--globe-stars', `url(${u})`);
  });
  const canvas = document.createElement('canvas');
  canvas.className = 'drift-globe__canvas';
  canvas.setAttribute('aria-label', `${embedded
    ? 'Ocean globe. Drag sideways to turn it, pinch or hold Ctrl and scroll to zoom, click or tap the ocean to drop the selected item.'
    : 'Ocean globe. Drag to turn it, scroll or pinch to zoom, click or tap the ocean to drop the selected item.'} ${KEY_HELP}`);
  canvas.setAttribute('role', 'img');
  canvas.tabIndex = 0; // the keyboard alternative to dragging and tapping
  const aim = document.createElement('span');
  aim.className = 'globe-aim';
  aim.setAttribute('aria-hidden', 'true');
  const grain = document.createElement('div');
  grain.className = 'drift-globe__grain';
  grain.style.setProperty('--globe-paper', `url(${base}art/ui-paper.webp)`);
  const zoomHint = document.createElement('p');
  zoomHint.className = 'globe-zoomhint';
  zoomHint.setAttribute('aria-hidden', 'true');
  zoomHint.textContent = 'Hold Ctrl to zoom';
  root.append(canvas, aim, grain, zoomHint);
  el.append(root);

  const ui = createUI(root, { base, touch, reducedMotion });
  ui.setStatus('Loading the ocean…');
  ui.setDropEnabled(false);

  let disposed = false;
  const cleanups = [];
  const listen = (target, type, fn, opts) => { target.addEventListener(type, fn, opts); cleanups.push(() => target.removeEventListener(type, fn, opts)); };

  // ---- shared state ----
  const S = {
    t: 0, playing: false, speed: 30,
    tracks: new Map(), // dropId -> track
    newest: null,
    selected: null, // {dropId, fragId}
    fps: 0, frameMs: 0, members: 0,
    ready: false, modelFallback: false, simOk: true,
    cpu: { particles: 0, streamlines: 0, render: 0 },
  };
  let renderer = null, worker = null, landMask = null, tiles = null, fieldTex = null, landTex = null, waterTex = null, paperTex = null;
  let camera, scene, ocean, lines, parts;
  const pendingDrops = [];
  const dropWaiters = [];
  const startDoy = dayOfYear();

  // Camera orbit (view centre lon/lat, distance) with the measured follow factor.
  const view = { lon: -170, lat: 22, dist: 4, tLon: -170, tLat: 22, tDist: 4, defDist: 4, minDist: 1.3, maxDist: 7 };
  let interacted = false;
  let size = { w: 1, h: 1, cx: 0, cy: 0, r: 1 };

  function layout() {
    const r = root.getBoundingClientRect();
    const w = Math.max(1, r.width), h = Math.max(1, r.height);
    const phone = w < 760;
    // Desktop: globe in the right two-thirds; phone: centred, above the bottom sheet.
    const cx = phone ? w * 0.5 : w * 0.64;
    // With the fragment sheet open on a phone, the globe moves up and shrinks above it.
    const sheet = phone && root.classList.contains('has-panel') && !root.classList.contains('is-collapsed');
    const cy = phone ? h * (sheet ? 0.25 : 0.4) : h * 0.47;
    const rPx = phone ? Math.min(w * (sheet ? 0.4 : 0.47), h * (sheet ? 0.21 : 0.33)) : Math.min(h * 0.46, w * 0.34);
    const tanHalf = Math.tan((FOV * Math.PI) / 360);
    const alpha = Math.atan((rPx / (h / 2)) * tanHalf);
    const def = 1 / Math.sin(alpha);
    if (view.defDist !== def) {
      const ratio = view.tDist / view.defDist;
      view.defDist = def;
      view.minDist = Math.max(1.25, def * 0.42);
      view.maxDist = def * 1.6;
      view.tDist = Math.min(view.maxDist, Math.max(view.minDist, def * ratio));
      if (!S.started) view.dist = view.tDist;
    }
    size = { w, h, cx, cy, phone };
    aim.style.transform = `translate(${cx.toFixed(1)}px, ${cy.toFixed(1)}px)`;
    if (renderer && camera) {
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.setViewOffset(w, h, w / 2 - cx, h / 2 - cy, w, h);
      camera.updateProjectionMatrix();
    }
  }

  const ro = new ResizeObserver(() => layout());
  ro.observe(root);
  cleanups.push(() => ro.disconnect());
  layout();

  // ---- loading ----
  async function loadFields() {
    const urls = Array.from({ length: 12 }, (_, i) => `${base}data/currents/clim-${String(i + 1).padStart(2, '0')}.bin`);
    const bufs = await Promise.all(urls.map(async (u) => {
      const r = await fetch(u);
      if (!r.ok) throw new Error(`${u}: HTTP ${r.status}`);
      return r.arrayBuffer();
    }));
    return { tiles: bufs.map(decodeTile), urls };
  }

  async function start() {
    let r;
    try {
      r = await createRenderer(canvas, { force: params.get('gl') });
    } catch (e) {
      if (disposed) return;
      canvas.remove();
      root.classList.add('is-static');
      mountStaticFallback(root, String((e && e.message) || e), base);
      ui.setStatus('');
      ui.setHint('');
      return;
    }
    if (disposed) { r.renderer.dispose(); return; }
    renderer = r.renderer;
    S.backend = r.backend;

    const [land, fields, water, paper] = await Promise.all([
      loadLandmask(`${base}data/landmask.png`).catch((e) => { console.warn('[drift] land mask:', e.message); return null; }),
      loadFields().catch((e) => { console.warn('[drift] current tiles:', e.message); return null; }),
      loadTile(`${base}art/ui-water.webp`),
      loadTile(`${base}art/ui-paper.webp`),
    ]);
    if (disposed) return;
    landMask = land && land.mask;
    landTex = land && land.texture;
    waterTex = water;
    paperTex = paper;
    tiles = fields && fields.tiles;

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 50);
    if (tiles) {
      fieldTex = fieldTextures(tiles);
      lines = createStreamlines(renderer, { fieldTex: fieldTex[monthOfDoy(startDoy)], reducedMotion });
    }
    ocean = createOcean({ landTex: land && land.texture, trailTex: lines ? lines.texture : null, waterTex: water, paperTex: paper });
    if (!lines) ocean.uniforms.uTrail.value = 0;
    scene.add(ocean.group);
    parts = createParticles();
    scene.add(parts.group);
    layout();

    if (tiles) startWorker(fields.urls);
    else {
      S.simOk = false;
      ui.setStatus('');
      ui.setDropEnabled(false, 'The ocean current data did not load, so nothing can be dropped right now. Try reloading the page.');
    }
    bindInput();
    S.started = true;
    renderer.setAnimationLoop(frame);
  }

  // ---- worker ----
  function startWorker(currentUrls) {
    ui.setStatus('Model loading…');
    ui.setDropEnabled(true);
    try {
      worker = new Worker(new URL('../sim/worker.js', import.meta.url), { type: 'module' });
    } catch (e) {
      simFailed(e.message);
      return;
    }
    worker.onerror = (ev) => {
      ev.preventDefault();
      simFailed(ev.message || 'the simulation could not start');
    };
    worker.onmessage = (ev) => onWorker(ev.data);
    worker.postMessage({
      type: 'init',
      currentUrls: currentUrls.map((u) => new URL(u, location.href).href),
      windUrl: new URL(`${base}data/wind/clim.bin`, location.href).href,
      modelUrl: new URL(`${base}model/drift.onnx`, location.href).href,
    });
    worker.postMessage({ type: 'mode', mode: 'global' });
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
        S.modelFallback = !!msg.fallback;
        ui.setStatus(msg.fallback ? 'Model unavailable, showing plain advection.' : '', msg.fallback ? 'warn' : '');
        if (msg.fallback) console.info('[drift] model unavailable, showing plain advection');
        while (pendingDrops.length) worker.postMessage(pendingDrops.shift());
        break;
      case 'status':
        if (msg.fallback) {
          S.modelFallback = true;
          ui.setStatus('Model unavailable, showing plain advection.', 'warn');
          console.info(`[drift] ${msg.reason}`);
        }
        break;
      case 'dropped': {
        const tr = createDropTrack(msg);
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
      case 'snapshot': {
        const tr = S.tracks.get(msg.dropId);
        if (tr) addSnapshot(tr, msg);
        break;
      }
      case 'progress': {
        const tr = S.tracks.get(msg.dropId);
        if (tr) tr.computedDay = Math.max(tr.computedDay, msg.day);
        break;
      }
      case 'done': {
        const tr = S.tracks.get(msg.dropId);
        if (tr) tr.done = true;
        break;
      }
      case 'retired':
        S.tracks.delete(msg.dropId);
        parts.removeDrop(msg.dropId);
        if (S.selected && S.selected.dropId === msg.dropId) select(null);
        break;
      case 'cleared':
        S.tracks.clear();
        parts.clear();
        select(null);
        break;
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
    const m = { type: 'drop', item, lon, lat, startDoy, seed };
    if (S.ready) worker.postMessage(m); else pendingDrops.push(m);
    S.t = 0;
    S.playing = true;
    return true;
  }

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

  // ---- input ----
  const pointers = new Map();
  let down = null, pinch = null;
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();

  function rayAt(x, y) {
    ndc.set((x / size.w) * 2 - 1, -(y / size.h) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    return raycaster.ray;
  }

  function pxPerRadian() {
    const tanHalf = Math.tan((FOV * Math.PI) / 360);
    const a = Math.asin(1 / Math.max(1.0001, view.dist));
    return (size.h / 2) * (Math.tan(a) / tanHalf); // globe radius in px
  }

  function pickMember(x, y) {
    let best = null, bd = PICK_PX * PICK_PX;
    const v = new THREE.Vector3();
    const cam = camera.position;
    parts.forEachMember((p, tr, fragLocal) => {
      if (p.dot(v.copy(cam).sub(p)) <= 0) return; // far side
      v.copy(p).project(camera);
      const sx = (v.x + 1) / 2 * size.w, sy = (1 - v.y) / 2 * size.h;
      const d = (sx - x) ** 2 + (sy - y) ** 2;
      if (d < bd) { bd = d; best = { dropId: tr.dropId, fragId: tr.dropId * 256 + fragLocal }; }
    });
    return best;
  }

  const isLand = (lon, lat) => (landMask ? isLandAt(landMask, lon, lat) : false)
    || (tiles ? sample(tiles[monthOfDoy(startDoy)], lon, lat, 0) === null : false);

  function tap(x, y) {
    const hit = pickMember(x, y);
    if (hit) { select(hit); return; }
    const target = dropTarget(rayAt(x, y), isLand);
    if (!target.ok) {
      if (target.reason === 'land') ui.showToast(target.message, x, y);
      else if (S.selected) select(null);
      return;
    }
    if (!S.simOk) { ui.showToast('Drops are off: the simulation could not start.', x, y); return; }
    drop(ui.item, target.lon, target.lat);
  }

  function dropAtAim() {
    const target = dropTarget(rayAt(size.cx, size.cy), isLand);
    if (!target.ok) { if (target.reason === 'land') ui.showToast(target.message, size.cx, size.cy); return; }
    if (!S.simOk) { ui.showToast('Drops are off: the simulation could not start.', size.cx, size.cy); return; }
    drop(ui.item, target.lon, target.lat);
  }

  let hintTimer = 0;
  function showZoomHint() {
    if (zoomHint.classList.contains('is-on')) return;
    zoomHint.classList.add('is-on');
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => zoomHint.classList.remove('is-on'), 1500);
  }
  cleanups.push(() => clearTimeout(hintTimer));
  const globeHasFocus = () => root.contains(document.activeElement);

  function bindInput() {
    listen(canvas, 'pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      if (document.activeElement !== root) root.focus({ preventScroll: true });
      pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
      interacted = true;
      if (pointers.size === 1) down = { x: e.offsetX, y: e.offsetY, t: performance.now(), lon: view.tLon, lat: view.tLat };
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), dist: view.tDist };
        down = null;
      }
    });
    listen(canvas, 'pointermove', (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
      if (pinch && pointers.size >= 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        view.tDist = Math.min(view.maxDist, Math.max(view.minDist, pinch.dist * (pinch.d / Math.max(1, d))));
        return;
      }
      if (!down) return;
      const k = (180 / Math.PI) / pxPerRadian();
      view.tLon = down.lon - (e.offsetX - down.x) * k;
      view.tLat = Math.max(-70, Math.min(70, down.lat + (e.offsetY - down.y) * k));
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
      // Embedded in a page, a plain wheel scrolls the page; Ctrl/Cmd (or a focused globe) zooms.
      if (embedded && !(e.ctrlKey || e.metaKey) && !globeHasFocus()) { showZoomHint(); return; }
      e.preventDefault();
      interacted = true;
      view.tDist = Math.min(view.maxDist, Math.max(view.minDist, view.tDist * Math.exp(e.deltaY * 0.0012)));
    }, { passive: false });
    // Keys only act while focus is inside the globe (or, full screen, on the bare page).
    const onKey = (e) => {
      // Escape closes the panel from anywhere in the globe, the slider and buttons included.
      if (e.key === 'Escape' && S.selected) { select(null); return; }
      const t = e.target;
      if (t && /^(input|textarea|select|button)$/i.test(t.tagName)) return;
      if (e.key === ' ') { e.preventDefault(); togglePlay(); }
    };
    // Keyboard alternative to the gestures: arrows turn, + / - zoom, Enter drops at the aim.
    listen(canvas, 'keydown', (e) => {
      const step = 10 * Math.min(1, view.tDist / view.defDist);
      const turn = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key];
      if (turn) {
        interacted = true;
        view.tLon += turn[0];
        view.tLat = Math.max(-70, Math.min(70, view.tLat + turn[1]));
      } else if (e.key === '+' || e.key === '=') {
        view.tDist = Math.max(view.minDist, view.tDist * 0.85);
      } else if (e.key === '-' || e.key === '_') {
        view.tDist = Math.min(view.maxDist, view.tDist / 0.85);
      } else if (e.key === 'Enter') {
        dropAtAim();
      } else return;
      e.preventDefault();
    });
    listen(root, 'keydown', onKey);
    if (!embedded) listen(window, 'keydown', (e) => { if (e.target === document.body) onKey(e); });

    ui.on('item', () => {});
    ui.on('play', togglePlay);
    ui.on('speed', (s) => { S.speed = s; });
    ui.on('scrub', (d) => { S.t = Math.min(d, maxComputed()); S.playing = false; });
    ui.on('deselect', () => select(null));
    ui.on('panel', () => layout());
  }

  function togglePlay() {
    if (!S.playing && S.t >= MAX_DAY - 0.5) S.t = 0;
    S.playing = !S.playing;
  }

  function maxComputed() {
    let m = 0;
    for (const tr of S.tracks.values()) m = Math.max(m, tr.lastDay);
    return m;
  }
  function newestComputed() {
    const tr = S.newest != null ? S.tracks.get(S.newest) : null;
    return tr ? Math.max(0, tr.lastDay) : maxComputed();
  }

  // ---- frame ----
  let last = performance.now();
  let frameNo = 0;
  let lastDpr = window.devicePixelRatio || 1;
  let month = -1;
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

    // Camera follow: k = 1 - 0.96^(dt/16.67) (instant under reduced motion).
    if (!interacted && !reducedMotion) view.tLon += AUTO_ROTATE_DEG_S * dt;
    const k = reducedMotion ? 1 : 1 - Math.pow(0.96, dtMs / 16.67);
    view.lon += (view.tLon - view.lon) * k;
    view.lat += (view.tLat - view.lat) * k;
    view.dist += (view.tDist - view.dist) * k;
    const p = lonLatToVec3(view.lon, view.lat, view.dist);
    camera.position.set(p[0], p[1], p[2]);
    camera.up.set(0, 1, 0);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    const tanHalf = Math.tan((FOV * Math.PI) / 360);
    parts.setPxWorld((2 * tanHalf * Math.max(0.05, view.dist - 1)) / size.h);

    // Timeline.
    const cap = maxComputed();
    if (S.playing) {
      S.t = Math.min(S.t + dt * S.speed, MAX_DAY);
      if (S.t >= MAX_DAY) S.playing = false;
      // Wait at the computed edge until the worker catches up.
      if (S.t > cap && S.tracks.size) S.t = cap;
    }
    ui.setTime(S.t, { playing: S.playing, speed: S.speed, computedDay: newestComputed() });

    // Streamline month follows the newest drop's calendar.
    if (lines) {
      const tr = S.newest != null ? S.tracks.get(S.newest) : null;
      const m = monthOfDoy((tr ? tr.startDoy : startDoy) + Math.floor(tr ? S.t : 0));
      if (m !== month) { month = m; lines.setField(fieldTex[m]); }
    }

    let c0 = performance.now();
    S.members = parts.update(S.t);
    let c1 = performance.now();
    S.cpu.particles = S.cpu.particles * 0.9 + (c1 - c0) * 0.1;
    if (lines) {
      lines.update(dt);
      ocean.setTrail(lines.texture);
    }
    c0 = performance.now();
    S.cpu.streamlines = S.cpu.streamlines * 0.9 + (c0 - c1) * 0.1;
    renderer.render(scene, camera);
    c1 = performance.now();
    S.cpu.render = S.cpu.render * 0.9 + (c1 - c0) * 0.1;
    if (S.selected && frameNo % 6 === 0) refreshPanel();
  }

  start().catch((e) => {
    console.warn('[drift] globe failed to start:', e);
    if (!root.classList.contains('is-static')) {
      canvas.remove();
      root.classList.add('is-static');
      mountStaticFallback(root, String((e && e.message) || e), base);
    }
  });

  // ---- dev hook ----
  let hook = null;
  if (import.meta.env && (import.meta.env.DEV || import.meta.env.MODE === 'development')) {
    hook = window.__drift = {
      get fps() { return S.fps; },
      get members() { return S.members; },
      get backend() { return S.backend; },
      get ready() { return S.ready; },
      get t() { return S.t; },
      drop(item, lon, lat, seed) {
        return new Promise((resolve) => {
          if (!drop(item, lon, lat, seed)) { resolve(null); return; }
          dropWaiters.push(resolve);
        });
      },
      setDay(d) { S.t = Math.max(0, Math.min(MAX_DAY, d)); S.playing = false; },
      play(on = true) { S.playing = on; },
      speed(s) { S.speed = s; },
      view(lon, lat, dist) { interacted = true; view.tLon = view.lon = lon; view.tLat = view.lat = lat; if (dist) view.tDist = view.dist = dist; },
      tap(x, y) { tap(x, y); },
      isLand(lon, lat) { return isLand(lon, lat); },
      clear() { if (worker) worker.postMessage({ type: 'clear' }); },
      stopSim() { if (worker) worker.terminate(); worker = null; }, // measurement only: frees the CPU
      trailBudget(n) { parts.setTrailWriteBudget(n); },
      computed() { return [...S.tracks.values()].map((t) => ({ dropId: t.dropId, day: t.lastDay, done: t.done })); },
      select(dropId, fragId = dropId * 256) { select(dropId == null ? null : { dropId, fragId }); },
      cpu() { return { ...S.cpu }; },
      frameStats() {
        const a = [...frameTimes].sort((x, y) => x - y);
        const mean = a.reduce((s, v) => s + v, 0) / (a.length || 1);
        return { frames: a.length, meanMs: mean, fps: 1000 / mean, p50: a[a.length >> 1], p95: a[Math.floor(a.length * 0.95)] };
      },
      resetFrames() { frameTimes.length = 0; },
      debug() { return { scene, camera, renderer, ocean, parts, lines, THREE, S }; },
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
      if (ocean) ocean.dispose();
      if (fieldTex) fieldTex.forEach((t) => t.dispose());
      for (const t of [landTex, waterTex, paperTex]) if (t) t.dispose();
      if (renderer) renderer.dispose();
      ui.dispose();
      root.remove();
      if (starsUrl) URL.revokeObjectURL(starsUrl);
      if (hook && window.__drift === hook) delete window.__drift;
    },
  };
}

export default mountGlobe;
