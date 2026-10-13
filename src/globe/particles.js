// Every ensemble member of every drop in one instanced draw (heads) plus one instanced draw of
// trail segments. Snapshot positions live in a float array texture: column = a stable member
// identity (tracks.js), layer = snapshot index mod LAYERS. Each frame only the snapshots needed
// for age t (index-TRAIL .. index+1 per drop) are written, and the vertex stage interpolates
// between index and index+1 by frac. Colour by age (fresh -> oxidised -> bleached in OKLab),
// size by size class, additive glow; sunk members fade out and sink toward the core, beached ones dim.
import * as THREE from 'three/webgpu';
import {
  Fn, If, uniform, texture, textureLoad, instanceIndex, ivec2, int, float, vec2, vec3, vec4, uv,
  mix, smoothstep, clamp, normalize, dot, length, select, cross, max, min, exp, mod, floor, cos, sin, radians,
  cameraPosition, cameraProjectionMatrix, cameraViewMatrix, positionGeometry, varying, pow,
} from 'three/tsl';
import { snapshotDays } from '../sim/snapshots.js';
import { ABSENT, codeFrag, frameFor } from './tracks.js';
import { lonLatToVec3 } from './pick.js';
import { PALETTE } from './ocean.js';

export const COLS_W = 256, COLS_H = 96, CAP = COLS_W * COLS_H; // 24,576 member columns
export const LAYERS = 16; // snapshot ring per column
export const TRAIL = 12; // trail segments (previous snapshots)
const BLOCK = 8; // columns per allocation block (one bottle drop = 24 members = 3 blocks)
const MAX_DROPS = 1024;
const INVALID = -1;

// ---- colour ramp in OKLab -------------------------------------------------------------------
const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
function hexToOklab(hex) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => srgbToLinear(v / 255));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return new THREE.Vector3(
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  );
}
const LAB_FRESH = hexToOklab(PALETTE.fresh), LAB_OX = hexToOklab(PALETTE.oxidised), LAB_BONE = hexToOklab(PALETTE.bleached);

const oklabToLinear = (lab) => {
  const l_ = lab.x.add(lab.y.mul(0.3963377774)).add(lab.z.mul(0.2158037573));
  const m_ = lab.x.sub(lab.y.mul(0.1055613458)).sub(lab.z.mul(0.0638541728));
  const s_ = lab.x.sub(lab.y.mul(0.0894841775)).sub(lab.z.mul(1.291485548));
  const l = l_.mul(l_).mul(l_), m = m_.mul(m_).mul(m_), s = s_.mul(s_).mul(s_);
  return vec3(
    l.mul(4.0767416621).sub(m.mul(3.3077115913)).add(s.mul(0.2309699292)),
    l.mul(-1.2684380046).add(m.mul(2.6097574011)).sub(s.mul(0.3413193965)),
    l.mul(-0.0041960863).sub(m.mul(0.7034186147)).add(s.mul(1.707614701)),
  ).max(0);
};
/** Linear RGB of plastic aged `day` days. */
export const ageColor = (day) => {
  const a = clamp(day.div(730), 0, 1);
  const b = clamp(day.sub(730).div(3650 - 730), 0, 1);
  const lab = mix(mix(vec3(LAB_FRESH), vec3(LAB_OX), a), vec3(LAB_BONE), b);
  return oklabToLinear(lab);
};

// ---- GPU state --------------------------------------------------------------------------------
export function createParticles() {
  const days = snapshotDays();
  const layerData = new Float32Array(CAP * LAYERS * 4);
  const layers = new THREE.DataArrayTexture(layerData, COLS_W, COLS_H, LAYERS);
  layers.format = THREE.RGBAFormat; layers.type = THREE.FloatType;
  layers.minFilter = layers.magFilter = THREE.NearestFilter;
  layers.generateMipmaps = false;
  layers.needsUpdate = true;

  const colData = new Float32Array(CAP * 4).fill(INVALID);
  const colTex = new THREE.DataTexture(colData, COLS_W, COLS_H, THREE.RGBAFormat, THREE.FloatType);
  colTex.minFilter = colTex.magFilter = THREE.NearestFilter; colTex.generateMipmaps = false; colTex.needsUpdate = true;

  const dropData = new Float32Array(MAX_DROPS * 4);
  const dropTex = new THREE.DataTexture(dropData, MAX_DROPS, 1, THREE.RGBAFormat, THREE.FloatType);
  dropTex.minFilter = dropTex.magFilter = THREE.NearestFilter; dropTex.generateMipmaps = false; dropTex.needsUpdate = true;

  const dayData = new Float32Array(512 * 4);
  days.forEach((d, i) => { dayData[4 * i] = d; });
  const dayTex = new THREE.DataTexture(dayData, 512, 1, THREE.RGBAFormat, THREE.FloatType);
  dayTex.minFilter = dayTex.magFilter = THREE.NearestFilter; dayTex.generateMipmaps = false; dayTex.needsUpdate = true;

  const uPxWorld = uniform(0.003); // world units per CSS px at the globe's front
  const uSelSlot = uniform(-1);
  const selData = new Float32Array(256 * 4);
  const selTex = new THREE.DataTexture(selData, 256, 1, THREE.RGBAFormat, THREE.FloatType);
  selTex.minFilter = selTex.magFilter = THREE.NearestFilter; selTex.generateMipmaps = false; selTex.needsUpdate = true;
  const isSelFrag = (frag) => textureLoad(selTex, ivec2(int(frag), 0)).x.greaterThan(0.5);
  const uUsed = uniform(1); // highest used column + 1 (float: exact for < 2^24)

  const colOf = (i) => ivec2(i.mod(COLS_W), i.div(COLS_W));
  const layerOf = (idx) => int(mod(idx, LAYERS));
  const texel = (c, idx) => textureLoad(layers, c).depth(layerOf(idx));
  const dayAt = (idx) => textureLoad(dayTex, ivec2(int(idx), 0)).x;
  const toWorld = (ll, r = 1) => {
    const la = radians(ll.y), lo = radians(ll.x);
    return vec3(cos(la).mul(sin(lo)), sin(la), cos(la).mul(cos(lo))).mul(r);
  };
  // 1 when the surface point n faces the camera, fading out at the limb.
  const facing = (n) => smoothstep(-0.02, 0.12, dot(n, normalize(cameraPosition.sub(n))));
  const decode = (code) => {
    const size = mod(code, 4);
    const fate = mod(floor(code.div(4)), 4);
    const frag = floor(code.div(16));
    return { size, fate, frag };
  };
  // Alpha from fate: beached dim; sunk fades over 150 days after it sank, to a faint ghost that
  // marks where it went down.
  const fateAlpha = (fate, sunkDay, tDay) => {
    const sunkFade = mix(float(1), float(0.13), smoothstep(0, 150, tDay.sub(sunkDay)));
    return select(fate.equal(3), sunkFade, select(fate.equal(2), float(0.38), float(1)));
  };
  const sinkDepth = (fate, sunkDay, tDay) => select(fate.equal(3), smoothstep(0, 150, tDay.sub(sunkDay)).mul(0.035), float(0));

  // ---- heads ----
  const anySel = uSelSlot.greaterThanEqual(0);
  // Built afresh for each use (position, scale, colour varying); see buildTrail below.
  const buildHead = () => {
    const hC = colOf(instanceIndex);
    const hSlot = textureLoad(colTex, hC).x;
    const hDs = textureLoad(dropTex, ivec2(int(max(hSlot, 0)), 0));
    const hIdx = hDs.x, hFrac = hDs.y, hDay = hDs.z, hAlive = hDs.w;
    const hA = texel(hC, hIdx), hB = texel(hC, hIdx.add(1));
    const hN = normalize(select(hB.z.greaterThanEqual(0).and(hFrac.greaterThan(0)), mix(toWorld(hA.xy), toWorld(hB.xy), hFrac), toWorld(hA.xy)));
    const hDec = decode(hA.z);
    const hValid = hSlot.greaterThanEqual(0).and(hAlive.greaterThan(0.5)).and(hA.z.greaterThanEqual(0));
    const hSel = hSlot.equal(uSelSlot).and(isSelFrag(hDec.frag));
    const hAlpha = select(hValid,
      fateAlpha(hDec.fate, hA.w, hDay).mul(facing(hN)).mul(select(anySel.and(hSel.not()), float(0.5), float(1))),
      float(0));
    // CSS px by size class: macro, meso, micro, small.
    const hPx = select(hDec.size.equal(0), float(9), select(hDec.size.equal(1), float(6.5), select(hDec.size.equal(2), float(4.5), float(3.4))));
    const hScale = hPx.mul(3).mul(select(hSel, float(1.45), float(1))).mul(uPxWorld).mul(select(hAlpha.greaterThan(0.001), float(1), float(0)));
    return { pos: hN.mul(float(1.004).sub(sinkDepth(hDec.fate, hA.w, hDay))), scale: hScale, col: vec4(ageColor(hDay), hAlpha) };
  };
  const headCol = varying(buildHead().col, 'vHeadCol');

  const headMat = new THREE.SpriteNodeMaterial({ transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending });
  headMat.sizeAttenuation = true;
  headMat.positionNode = buildHead().pos;
  const hs = buildHead().scale;
  headMat.scaleNode = vec2(hs, hs);
  headMat.colorNode = Fn(() => {
    // Sprite is 3x the nominal size: a small hot core and a soft glow around it.
    const d = length(uv().sub(0.5)).mul(2);
    const dc = d.mul(3);
    const core = exp(dc.mul(dc).mul(-1.4));
    const halo = exp(d.mul(-4.5)).mul(0.2).mul(clamp(float(1).sub(d), 0, 1));
    const k = core.add(halo).mul(headCol.w);
    return vec4(headCol.xyz.mul(k).mul(1.2).add(vec3(core.mul(headCol.w)).mul(0.2)), 1);
  })();
  const heads = new THREE.Sprite(headMat);
  heads.count = 0;
  heads.frustumCulled = false;
  heads.renderOrder = 4;

  // ---- trails: one ribbon quad per (segment, column) ----
  // The trail graph is built twice (vertex position, colour varying): sharing one node graph
  // between vertexNode and a varying made TSL emit stale shared temporaries, which drew
  // phantom segments.
  const buildTrail = () => {
    const used = max(uUsed, 1);
    const instF = float(instanceIndex);
    const segFl = floor(instF.add(0.5).div(used));
    const seg = int(segFl);
    const tColI = int(instF.sub(segFl.mul(used)));
    const tC = ivec2(tColI.mod(COLS_W), tColI.div(COLS_W));
    const tSlot = textureLoad(colTex, tC).x;
    const tDs = textureLoad(dropTex, ivec2(int(max(tSlot, 0)), 0));
    const tIdx = tDs.x, tFrac = tDs.y, tDay = tDs.z, tAlive = tDs.w;
    const segF = float(seg);
    const i0 = tIdx.sub(segF).add(1), i1 = tIdx.sub(segF);
    // End 0: the head (seg 0) or snapshot idx-seg+1; end 1: snapshot idx-seg.
    const h0 = texel(tC, tIdx), hn = texel(tC, tIdx.add(1));
    const e0raw = texel(tC, i0), e1 = texel(tC, i1);
    const isHeadSeg = seg.equal(0);
    const headLL = normalize(select(hn.z.greaterThanEqual(0).and(tFrac.greaterThan(0)), mix(toWorld(h0.xy), toWorld(hn.xy), tFrac), toWorld(h0.xy)));
    const p0 = select(isHeadSeg, headLL, toWorld(e0raw.xy));
    const p1 = toWorld(e1.xy);
    const code0 = select(isHeadSeg, h0.z, e0raw.z);
    const tValid = tSlot.greaterThanEqual(0).and(tAlive.greaterThan(0.5)).and(i1.greaterThanEqual(0))
      .and(code0.greaterThanEqual(0)).and(e1.z.greaterThanEqual(0));
    const end = positionGeometry.x.greaterThan(0); // true -> end 1
    const side = positionGeometry.y.mul(2); // -1..1
    const day0 = select(isHeadSeg, tDay, dayAt(i0));
    const day1 = dayAt(i1);
    const pEnd = select(end, p1, p0);
    const tDec = decode(select(end, e1.z, code0));
    const sunkW = select(end, e1.w, select(isHeadSeg, h0.w, e0raw.w));
    const tSel = tSlot.equal(uSelSlot).and(isSelFrag(tDec.frag));
    const tFade = float(1).sub(segF.add(select(end, float(1), float(0))).div(TRAIL));
    const tAlpha = select(tValid,
      pow(tFade, 1.6).mul(0.42).mul(fateAlpha(tDec.fate, sunkW, tDay)).mul(facing(normalize(pEnd)))
        .mul(select(anySel.and(tSel.not()), float(0.4), select(tSel, float(1.6), float(1)))),
      float(0));
    // Ribbon ~1.2 CSS px wide, built in world space: offset across the segment, tangent to the
    // sphere. A zero-length segment gets no width and so draws nothing.
    const segV = p1.sub(p0);
    const across = cross(segV, normalize(pEnd));
    const aLen = length(across);
    const acrossN = select(aLen.greaterThan(1e-7), across.div(max(aLen, 1e-7)), vec3(0, 0, 0));
    const ribbon = pEnd.mul(1.003).add(acrossN.mul(side).mul(uPxWorld).mul(0.6));
    const clipPos = cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(ribbon, 1));
    return { clip: select(tValid, clipPos, vec4(2, 2, 2, 1)), col: vec4(ageColor(select(end, day1, day0)), tAlpha) };
  };
  const trailCol = varying(buildTrail().col, 'vTrailCol');
  const trailMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  // Cull per instance (never per vertex: one culled end would stretch the quad off screen).
  trailMat.vertexNode = buildTrail().clip;
  trailMat.colorNode = vec4(trailCol.xyz.mul(trailCol.w), 1);
  const trails = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), trailMat);
  trails.count = 0;
  trails.frustumCulled = false;
  trails.renderOrder = 3;

  const group = new THREE.Group();
  group.add(trails, heads);

  // ---- CPU side: allocation and layer writes ----
  const drops = new Map(); // dropId -> {track, slot, blocks:[], loaded Int32Array(LAYERS), ver Int32Array(LAYERS)}
  const freeSlots = [];
  for (let i = MAX_DROPS - 1; i >= 0; i--) freeSlots.push(i);
  const freeBlocks = []; // kept sorted descending so pop() gives the lowest free block
  for (let i = CAP / BLOCK - 1; i >= 0; i--) freeBlocks.push(i);
  let freeSorted = true;
  const dirtyLayers = new Set();
  let colDirty = false, maxCol = 0, overflowWarned = false;

  function recomputeMaxCol() {
    let m = 0;
    for (const d of drops.values()) for (const b of d.blocks) m = Math.max(m, (b + 1) * BLOCK);
    maxCol = m;
  }

  function ensureColumns(d) {
    const need = Math.ceil(d.track.ancestor.length / BLOCK);
    while (d.blocks.length < need) {
      if (!freeBlocks.length) {
        if (!overflowWarned) { console.warn('[drift] particle columns full; newest fragments are not drawn'); overflowWarned = true; }
        return;
      }
      // Lowest free block keeps the instanced range short.
      if (!freeSorted) { freeBlocks.sort((a, b) => b - a); freeSorted = true; }
      const b = freeBlocks.pop();
      d.blocks.push(b);
      for (let k = 0; k < BLOCK; k++) colData[4 * (b * BLOCK + k)] = d.slot;
      colDirty = true;
    }
    recomputeMaxCol();
  }

  function addDrop(track) {
    if (drops.has(track.dropId) || !freeSlots.length) return;
    const d = { track, slot: freeSlots.pop(), blocks: [], loaded: new Int32Array(LAYERS).fill(-1), ver: new Int32Array(LAYERS).fill(-1) };
    drops.set(track.dropId, d);
  }

  function removeDrop(dropId) {
    const d = drops.get(dropId);
    if (!d) return;
    for (const b of d.blocks) {
      for (let k = 0; k < BLOCK; k++) colData[4 * (b * BLOCK + k)] = INVALID;
      freeBlocks.push(b);
    }
    freeSorted = false;
    colDirty = true;
    dropData[4 * d.slot + 3] = 0;
    freeSlots.push(d.slot);
    drops.delete(dropId);
    recomputeMaxCol();
  }

  function writeLayer(d, s) {
    const tr = d.track, snap = tr.snaps[s];
    const layer = s % LAYERS;
    const base = layer * CAP * 4;
    const nIds = tr.ancestor.length;
    for (let id = 0; id < nIds; id++) {
      const b = d.blocks[(id / BLOCK) | 0];
      if (b === undefined) break;
      const o = base + 4 * (b * BLOCK + (id % BLOCK));
      let i = id;
      while (i >= 0 && tr.born[i] > s) i = tr.ancestor[i];
      if (!snap || i < 0 || i >= snap.n || snap.code[i] === ABSENT) {
        layerData[o + 2] = -1;
        continue;
      }
      layerData[o] = snap.pos[2 * i] / 90;
      layerData[o + 1] = snap.pos[2 * i + 1] / 180;
      layerData[o + 2] = snap.code[i];
      const sd = tr.sunkDay[i];
      layerData[o + 3] = sd === Infinity ? 1e9 : sd;
    }
    d.loaded[layer] = s;
    d.ver[layer] = tr.version;
    dirtyLayers.add(layer);
  }

  const frames = new Map(); // dropId -> {index, frac, day}

  /** Write the snapshots age t needs and the per-drop frame data. Returns members drawn. */
  function update(t) {
    let members = 0;
    for (const d of drops.values()) {
      const tr = d.track;
      const fr = frameFor(tr, t);
      if (!fr) { dropData[4 * d.slot + 3] = 0; continue; }
      if (tr.ancestor.length > d.blocks.length * BLOCK) ensureColumns(d);
      const lo = Math.max(0, fr.index - TRAIL), hi = Math.min(tr.lastIndex, fr.index + 1);
      for (let s = lo; s <= hi; s++) {
        const layer = s % LAYERS;
        if (d.loaded[layer] !== s || d.ver[layer] !== tr.version) writeLayer(d, s);
      }
      frames.set(tr.dropId, fr);
      const o = 4 * d.slot;
      dropData[o] = fr.index; dropData[o + 1] = fr.frac; dropData[o + 2] = fr.day; dropData[o + 3] = 1;
      const snap = tr.snaps[fr.index];
      if (snap) members += snap.members;
    }
    dropTex.needsUpdate = true;
    if (colDirty) { colTex.needsUpdate = true; colDirty = false; }
    if (dirtyLayers.size) {
      if (dirtyLayers.size >= LAYERS / 2 || !layers.addLayerUpdate) {
        layers.clearLayerUpdates?.();
      } else {
        for (const l of dirtyLayers) layers.addLayerUpdate(l);
      }
      layers.needsUpdate = true;
      dirtyLayers.clear();
    }
    heads.count = maxCol;
    trails.count = maxCol * TRAIL;
    uUsed.value = Math.max(1, maxCol);
    return members;
  }

  /** Interpolated world positions of drop d's identities at its current frame (for picking). */
  function forEachMember(fn) {
    const v = new THREE.Vector3();
    for (const d of drops.values()) {
      const fr = frames.get(d.track.dropId);
      if (!fr) continue;
      const tr = d.track;
      const nIds = tr.ancestor.length;
      for (let id = 0; id < nIds; id++) {
        const a = stateOf(tr, id, fr.index);
        if (!a) continue;
        let p = lonLatToVec3(a.lon, a.lat);
        if (fr.frac > 0) {
          const b = stateOf(tr, id, fr.index + 1);
          if (b) {
            const q = lonLatToVec3(b.lon, b.lat);
            p = p.map((x, k) => x + (q[k] - x) * fr.frac);
          }
        }
        v.set(p[0], p[1], p[2]).normalize();
        fn(v, d.track, codeFrag(a.code), a.code);
      }
    }
  }

  return {
    group,
    addDrop,
    removeDrop,
    update,
    forEachMember,
    hasDrop: (id) => drops.has(id),
    _debug: () => ({ layerData, colData, dropData, drops, LAYERS, CAP, BLOCK }),
    slotOf: (id) => (drops.has(id) ? drops.get(id).slot : -1),
    /** Highlight fragments (local ids) of one drop; null clears. */
    setSelection(dropId, locals = []) {
      const d = dropId == null ? null : drops.get(dropId);
      uSelSlot.value = d ? d.slot : -1;
      selData.fill(0);
      if (d) for (const l of locals) selData[4 * (l & 255)] = 1;
      selTex.needsUpdate = true;
    },
    setPxWorld(v) { uPxWorld.value = v; },
    clear() { for (const id of [...drops.keys()]) removeDrop(id); },
    dispose() {
      layers.dispose(); colTex.dispose(); selTex.dispose(); dropTex.dispose(); dayTex.dispose();
      headMat.dispose(); trailMat.dispose(); trails.geometry.dispose();
    },
  };
}

function stateOf(tr, id, index) {
  const snap = tr.snaps[index];
  if (!snap) return null;
  let i = id;
  while (i >= 0 && tr.born[i] > index) i = tr.ancestor[i];
  if (i < 0 || i >= snap.n || snap.code[i] === ABSENT) return null;
  return { lon: snap.pos[2 * i] / 90, lat: snap.pos[2 * i + 1] / 180, code: snap.code[i] };
}
