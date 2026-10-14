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
  cameraPosition, cameraProjectionMatrix, cameraViewMatrix, positionGeometry, varying, pow, attribute,
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
// Additive light that leaves the canvas alpha alone: the canvas is transparent over the page, and
// plain additive blending would also add alpha, turning each glow quad at the limb into an opaque
// square. Colours are premultiplied (rgb * intensity) in the shaders.
const GLOW = {
  blending: THREE.CustomBlending,
  blendEquation: THREE.AddEquation,
  blendSrc: THREE.OneFactor,
  blendDst: THREE.OneFactor,
  blendSrcAlpha: THREE.ZeroFactor,
  blendDstAlpha: THREE.OneFactor,
};

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
/** Linear RGB of plastic aged `day` days, on the CPU (the same OKLab ramp as ageColor). */
export function ageColorJS(day) {
  const a = Math.min(1, Math.max(0, day / 730)), b = Math.min(1, Math.max(0, (day - 730) / (3650 - 730)));
  const m = (x, y, t) => x + (y - x) * t;
  const L = m(m(LAB_FRESH.x, LAB_OX.x, a), LAB_BONE.x, b);
  const A = m(m(LAB_FRESH.y, LAB_OX.y, a), LAB_BONE.y, b);
  const B = m(m(LAB_FRESH.z, LAB_OX.z, a), LAB_BONE.z, b);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const mm = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const q = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [
    Math.max(0, 4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * q),
    Math.max(0, -1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * q),
    Math.max(0, -0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * q),
  ];
}
/** Linear RGB of plastic aged `day` days. */
export const ageColor = (day) => {
  const a = clamp(day.div(730), 0, 1);
  const b = clamp(day.sub(730).div(3650 - 730), 0, 1);
  const lab = mix(mix(vec3(LAB_FRESH), vec3(LAB_OX), a), vec3(LAB_BONE), b);
  return oklabToLinear(lab);
};

// ---- GPU state --------------------------------------------------------------------------------
/**
 * Options (all optional; defaults are the globe):
 *  flat: {lonC, latC} draws on a flat map instead of the sphere: world x = (lon - lonC) cos(latC),
 *        y = lat - latC, z = 0 (degrees of latitude as the unit).
 *  days: the snapshot schedule (Salish: hours); ageScale maps schedule units onto the age ramp's
 *        days; fadeSpan / ghost: how long (schedule units) fate-3 members take to fade, and to what.
 *  jump: schedule units per frame above which a frame counts as a fast scrub.
 */
export function createParticles({ flat = null, days = snapshotDays(), ageScale = 1, fadeSpan = 150, ghost = 0.16, jump = 20 } = {}) {
  const cosC = flat ? Math.cos(flat.latC * Math.PI / 180) : 1;
  const nrm = flat ? (v) => v : normalize;
  const age = (d) => ageColor(d.mul(ageScale));
  const layerData = new Float32Array(CAP * LAYERS * 4);
  const layers = new THREE.DataArrayTexture(layerData, COLS_W, COLS_H, LAYERS);
  layers.format = THREE.RGBAFormat; layers.type = THREE.FloatType;
  layers.minFilter = layers.magFilter = THREE.NearestFilter;
  layers.generateMipmaps = false;
  layers.needsUpdate = true;

  const colData = new Float32Array(CAP * 4).fill(INVALID);
  const colTex = new THREE.DataTexture(colData, COLS_W, COLS_H, THREE.RGBAFormat, THREE.FloatType);
  colTex.minFilter = colTex.magFilter = THREE.NearestFilter; colTex.generateMipmaps = false; colTex.needsUpdate = true;

  // Per drop: (snapshot index, frac, age, 1 + current trail segments).
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
  const toWorld = flat
    ? (ll) => vec3(ll.x.sub(flat.lonC).mul(cosC), ll.y.sub(flat.latC), 0)
    : (ll, r = 1) => {
      const la = radians(ll.y), lo = radians(ll.x);
      return vec3(cos(la).mul(sin(lo)), sin(la), cos(la).mul(cos(lo))).mul(r);
    };
  // 1 when the surface point n faces the camera, fading out at the limb (always 1 on a flat map).
  const facing = (n) => (flat ? float(1) : smoothstep(-0.02, 0.12, dot(n, normalize(cameraPosition.sub(n)))));
  const decode = (code) => {
    const size = mod(code, 4);
    const fate = mod(floor(code.div(4)), 4);
    const frag = floor(code.div(16));
    return { size, fate, frag };
  };
  // Alpha from fate: beached dim; sunk fades over 150 days after it sank, to a faint ghost that
  // marks where it went down.
  const fateAlpha = (fate, sunkDay, tDay) => {
    const sunkFade = mix(float(1), float(ghost), smoothstep(0, fadeSpan, tDay.sub(sunkDay)));
    return select(fate.equal(3), sunkFade, select(fate.equal(2), float(0.38), float(1)));
  };
  const sinkDepth = (fate, sunkDay, tDay) => (flat ? float(0) : select(fate.equal(3), smoothstep(0, fadeSpan, tDay.sub(sunkDay)).mul(0.035), float(0)));

  // ---- heads ----
  const anySel = uSelSlot.greaterThanEqual(0);
  // Built afresh for each use (position, scale, colour varying); see buildTrail below.
  const buildHead = () => {
    const hC = colOf(instanceIndex);
    const hSlot = textureLoad(colTex, hC).x;
    const hDs = textureLoad(dropTex, ivec2(int(max(hSlot, 0)), 0));
    const hIdx = hDs.x, hFrac = hDs.y, hDay = hDs.z, hAlive = hDs.w;
    const hA = texel(hC, hIdx), hB = texel(hC, hIdx.add(1));
    const hN = nrm(select(hB.z.greaterThanEqual(0).and(hFrac.greaterThan(0)), mix(toWorld(hA.xy), toWorld(hB.xy), hFrac), toWorld(hA.xy)));
    const hDec = decode(hA.z);
    const hValid = hSlot.greaterThanEqual(0).and(hAlive.greaterThan(0.5)).and(hA.z.greaterThanEqual(0));
    const hSel = hSlot.equal(uSelSlot).and(isSelFrag(hDec.frag));
    const hAlpha = select(hValid,
      fateAlpha(hDec.fate, hA.w, hDay).mul(facing(hN)).mul(select(anySel.and(hSel.not()), float(0.5), float(1))),
      float(0));
    // CSS px by size class: macro, meso, micro, small.
    const hPx = select(hDec.size.equal(0), float(9), select(hDec.size.equal(1), float(6.5), select(hDec.size.equal(2), float(4.5), float(3.4))));
    const hScale = hPx.mul(3).mul(select(hSel, float(1.45), float(1))).mul(uPxWorld).mul(select(hAlpha.greaterThan(0.001), float(1), float(0)));
    // Shape: x = how far into its sinking fade (drawn as a small dim ring where it went down),
    // y = 1 on a beach (a small solid mark on the shore).
    const sunkP = select(hDec.fate.equal(3), smoothstep(0, fadeSpan, hDay.sub(hA.w)), float(0));
    const shape = vec2(sunkP, select(hDec.fate.equal(2), float(1), float(0)));
    return { pos: flat ? hN : hN.mul(float(1.004).sub(sinkDepth(hDec.fate, hA.w, hDay))), scale: hScale, col: vec4(age(hDay), hAlpha), shape };
  };
  const headCol = varying(buildHead().col, 'vHeadCol');
  const headShape = varying(buildHead().shape, 'vHeadShape');

  const headMat = new THREE.SpriteNodeMaterial({ transparent: true, depthTest: false, depthWrite: false, ...GLOW });
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
    const glow = core.add(halo);
    const ring = exp(dc.sub(1.1).mul(dc.sub(1.1)).mul(-14)).mul(0.9);
    const mark = smoothstep(0.8, 0.45, dc).mul(1.6);
    const shape = mix(mix(glow, ring, headShape.x), mark, headShape.y);
    const k = shape.mul(headCol.w);
    const hot = core.mul(headCol.w).mul(float(1).sub(headShape.x)).mul(float(1).sub(headShape.y));
    return vec4(headCol.xyz.mul(k).mul(1.2).add(vec3(hot).mul(0.2)), 1);
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
    const headLL = nrm(select(hn.z.greaterThanEqual(0).and(tFrac.greaterThan(0)), mix(toWorld(h0.xy), toWorld(hn.xy), tFrac), toWorld(h0.xy)));
    const p0 = select(isHeadSeg, headLL, toWorld(e0raw.xy));
    const p1 = toWorld(e1.xy);
    const code0 = select(isHeadSeg, h0.z, e0raw.z);
    // tAlive = 1 + segments whose layers are current (see update()).
    const tValid = tSlot.greaterThanEqual(0).and(tAlive.greaterThan(0.5)).and(segF.lessThan(tAlive.sub(1))).and(i1.greaterThanEqual(0))
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
      pow(tFade, 1.6).mul(0.42).mul(fateAlpha(tDec.fate, sunkW, tDay)).mul(facing(nrm(pEnd)))
        .mul(select(anySel.and(tSel.not()), float(0.4), select(tSel, float(1.6), float(1)))),
      float(0));
    // Ribbon ~1.2 CSS px wide, built in world space: offset across the segment, tangent to the
    // sphere. A zero-length segment gets no width and so draws nothing.
    const segV = p1.sub(p0);
    const across = cross(segV, flat ? vec3(0, 0, 1) : normalize(pEnd));
    const aLen = length(across);
    const acrossN = select(aLen.greaterThan(1e-7), across.div(max(aLen, 1e-7)), vec3(0, 0, 0));
    const ribbon = (flat ? pEnd : pEnd.mul(1.003)).add(acrossN.mul(side).mul(uPxWorld).mul(0.6));
    const clipPos = cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(ribbon, 1));
    return { clip: select(tValid, clipPos, vec4(2, 2, 2, 1)), col: vec4(age(select(end, day1, day0)), tAlpha) };
  };
  const trailCol = varying(buildTrail().col, 'vTrailCol');
  const trailMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthTest: false, depthWrite: false, ...GLOW, side: THREE.DoubleSide });
  // Cull per instance (never per vertex: one culled end would stretch the quad off screen).
  trailMat.vertexNode = buildTrail().clip;
  trailMat.colorNode = vec4(trailCol.xyz.mul(trailCol.w), 1);
  const trails = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), trailMat);
  trails.count = 0;
  trails.frustumCulled = false;
  trails.renderOrder = 3;

  // ---- the selected drop's whole history (0 -> its latest computed snapshot) ----
  // One soft ribbon per copy along its sampled snapshots, coloured by the age ramp, so a selected
  // drop reads as a plume. Built on the CPU (rebuilt at most every 400 ms while the worker is
  // still computing) and ordered by time, so drawing up to age t is a prefix of the index buffer.
  const HIST_SEG = 60000;
  const histA = new Float32Array(HIST_SEG * 4 * 3), histB = new Float32Array(HIST_SEG * 4 * 3);
  const histC = new Float32Array(HIST_SEG * 4 * 4), histE = new Float32Array(HIST_SEG * 4 * 2);
  const histI = new Uint32Array(HIST_SEG * 6);
  for (let s = 0; s < HIST_SEG; s++) {
    const v = 4 * s;
    histI.set([v, v + 1, v + 2, v + 2, v + 1, v + 3], 6 * s);
    for (let k = 0; k < 4; k++) { histE[2 * (v + k)] = k & 1; histE[2 * (v + k) + 1] = k >> 1 ? 1 : -1; }
  }
  const histGeo = new THREE.BufferGeometry();
  const attrA = new THREE.BufferAttribute(histA, 3); // static usage: three re-uploads DynamicDraw buffers every frame
  const attrB = new THREE.BufferAttribute(histB, 3);
  const attrC = new THREE.BufferAttribute(histC, 4);
  histGeo.setAttribute('position', attrA);
  histGeo.setAttribute('hB', attrB);
  histGeo.setAttribute('hC', attrC);
  histGeo.setAttribute('hE', new THREE.BufferAttribute(histE, 2));
  histGeo.setIndex(new THREE.BufferAttribute(histI, 1));
  histGeo.setDrawRange(0, 0);
  const buildHist = () => {
    const ha = positionGeometry, hb = attribute('hB', 'vec3'), hc = attribute('hC', 'vec4'), he = attribute('hE', 'vec2');
    const pEnd = select(he.x.greaterThan(0.5), hb, ha);
    const across = cross(hb.sub(ha), flat ? vec3(0, 0, 1) : normalize(pEnd));
    const aLen = length(across);
    const acrossN = select(aLen.greaterThan(1e-9), across.div(max(aLen, 1e-9)), vec3(0, 0, 0));
    const ribbon = (flat ? pEnd : pEnd.mul(1.002)).add(acrossN.mul(he.y).mul(uPxWorld).mul(0.7));
    const clip = cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(ribbon, 1));
    return { clip, col: vec4(hc.xyz.mul(hc.w).mul(facing(nrm(pEnd))), 1) };
  };
  const histCol = varying(buildHist().col, 'vHistCol');
  const histMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthTest: false, depthWrite: false, ...GLOW, side: THREE.DoubleSide });
  histMat.vertexNode = buildHist().clip;
  histMat.colorNode = histCol;
  const history = new THREE.Mesh(histGeo, histMat);
  history.visible = false;
  history.frustumCulled = false;
  history.renderOrder = 2;
  const i365 = days.findIndex((d) => d >= 365);
  const hist = { dropId: null, lastIndex: -1, version: -1, at: 0, samples: [], cum: [], builds: 0 };

  function sampleIndices(L, nIds) {
    const allowed = Math.max(2, Math.floor(HIST_SEG / Math.max(1, nIds)) + 1);
    const all = Array.from({ length: L + 1 }, (_, i) => i);
    if (all.length <= allowed) return all;
    const year = flat || i365 < 0 ? -1 : Math.min(L, i365);
    let out;
    if (year >= 0 && year + 1 < allowed) {
      // Every snapshot to 1 year, then every Nth.
      out = all.slice(0, year + 1);
      const stride = Math.ceil((L - year) / (allowed - out.length));
      for (let s = year + stride; s < L; s += stride) out.push(s);
    } else {
      const stride = Math.ceil((L + 1) / allowed);
      out = [];
      for (let s = 0; s < L; s += stride) out.push(s);
    }
    out.push(L);
    return out;
  }

  function rebuildHistory(d) {
    const tr = d.track;
    const L = tr.lastIndex, nIds = tr.ancestor.length;
    const samples = sampleIndices(L, nIds);
    const cum = [0];
    let seg = 0;
    for (let p = 0; p + 1 < samples.length && seg < HIST_SEG; p++) {
      const sa = samples[p], sb = samples[p + 1];
      const ca = ageColorJS(days[sa] * ageScale), cb = ageColorJS(days[sb] * ageScale);
      for (let id = 0; id < nIds && seg < HIST_SEG; id++) {
        const a = stateOf(tr, id, sa), b = stateOf(tr, id, sb);
        if (!a || !b) continue;
        const fa = (a.code >> 2) & 3;
        if (fa === 3 || fa === 2) continue; // on the seafloor / a beach: it no longer moves
        const pa = worldOf(a.lon, a.lat), pb = worldOf(b.lon, b.lat);
        if (Math.abs(pa[0] - pb[0]) + Math.abs(pa[1] - pb[1]) + Math.abs(pa[2] - pb[2]) < 1e-7) continue;
        for (let k = 0; k < 4; k++) {
          const v = 4 * seg + k;
          histA.set(pa, 3 * v);
          histB.set(pb, 3 * v);
          const c = k & 1 ? cb : ca;
          histC[4 * v] = c[0]; histC[4 * v + 1] = c[1]; histC[4 * v + 2] = c[2]; histC[4 * v + 3] = 0.24;
        }
        seg++;
      }
      cum.push(seg);
    }
    for (const at of [attrA, attrB, attrC]) {
      at.clearUpdateRanges();
      at.addUpdateRange(0, Math.max(1, seg) * 4 * at.itemSize);
      at.needsUpdate = true;
    }
    Object.assign(hist, { dropId: tr.dropId, lastIndex: L, version: tr.version, at: performance.now(), samples, cum, builds: hist.builds + 1, segs: seg });
  }

  function updateHistory(selId) {
    const d = selId == null ? null : drops.get(selId);
    const fr = d && frames.get(selId);
    if (!d || !fr) { history.visible = false; hist.dropId = null; return; }
    const tr = d.track;
    const stale = hist.dropId !== tr.dropId || hist.version !== tr.version || hist.lastIndex !== tr.lastIndex;
    if (stale && (hist.dropId !== tr.dropId || performance.now() - hist.at > 400)) rebuildHistory(d);
    // Draw every sample pair that ends at or before the current snapshot.
    let p = 0;
    while (p + 1 < hist.samples.length && hist.samples[p + 1] <= fr.index) p++;
    const n = 6 * (hist.cum[p] || 0);
    if (histGeo.drawRange.count !== n) histGeo.setDrawRange(0, n);
    history.visible = n > 0;
  }

  const group = new THREE.Group();
  group.add(history, trails, heads);
  let selDropId = null;

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
      // An identity born after this snapshot (a later fragment) is not drawn here: drawing its
      // ancestor's position would stack every future child on its parent (64 copies of a glow
      // per spot after a few splits). Its trail starts where it was born.
      if (tr.born[i] > s) i = -1;
      if (!snap || i < 0 || i >= snap.n || snap.code[i] === ABSENT) {
        layerData[o + 2] = -1;
        continue;
      }
      layerData[o] = snap.pos[2 * i] / tr.sx;
      layerData[o + 1] = snap.pos[2 * i + 1] / tr.sy;
      layerData[o + 2] = snap.code[i];
      const sd = tr.sunkDay[i];
      layerData[o + 3] = sd === Infinity ? 1e9 : sd;
    }
    d.loaded[layer] = s;
    d.ver[layer] = tr.version;
    dirtyLayers.add(layer);
  }

  const frames = new Map(); // dropId -> {index, frac, day}

  // Identity writes per frame for trail layers. Head layers (index, index+1) are always written;
  // trail layers catch up over a few frames during a fast scrub, and the shader draws only the
  // segments whose layers are current (dropData.w = 1 + current segments).
  let trailWriteBudget = 48000;
  let rr = 0; // round-robin start so no drop starves
  let lastT = 0;

  const stale = (d, s) => d.loaded[s % LAYERS] !== s || d.ver[s % LAYERS] !== d.track.version;

  /** Write the snapshots age t needs and the per-drop frame data. Returns members drawn. */
  function update(t) {
    let members = 0;
    const list = [...drops.values()];
    // Pass 1: frames and head layers.
    for (const d of list) {
      const tr = d.track;
      const fr = frameFor(tr, t);
      d.fr = fr;
      if (!fr) { dropData[4 * d.slot + 3] = 0; continue; }
      if (tr.ancestor.length > d.blocks.length * BLOCK) ensureColumns(d);
      for (let s = fr.index; s <= Math.min(tr.lastIndex, fr.index + 1); s++) if (stale(d, s)) writeLayer(d, s);
      frames.set(tr.dropId, fr);
      const o = 4 * d.slot;
      dropData[o] = fr.index; dropData[o + 1] = fr.frac; dropData[o + 2] = fr.day;
      const snap = tr.snaps[fr.index];
      if (snap) members += snap.members;
    }
    // Pass 2: trail layers, newest first, within the budget. While the age jumps by more than
    // 20 days a frame (a fast scrub), only the heads are drawn; the trails catch up when it settles.
    const jumping = Math.abs(t - lastT) > jump;
    lastT = t;
    let budget = jumping ? 0 : trailWriteBudget;
    const n = list.length;
    for (let k = 0; k < n; k++) {
      const d = list[(rr + k) % n];
      const fr = d.fr;
      if (!fr) continue;
      let segs = 1; // seg 0 (head -> index) needs only the head layers
      for (let j = 1; j <= TRAIL - 1 && fr.index - j >= 0; j++) {
        const s = fr.index - j;
        if (stale(d, s)) {
          if (budget <= 0) break;
          writeLayer(d, s);
          budget -= d.track.ancestor.length;
        }
        segs++;
      }
      dropData[4 * d.slot + 3] = 1 + segs;
    }
    if (n) rr = (rr + 1) % n;
    dropTex.needsUpdate = true;
    updateHistory(selDropId);
    if (colDirty) { colTex.needsUpdate = true; colDirty = false; }
    if (dirtyLayers.size) {
      // Always per-layer uploads (a whole-texture upload is 6.3 MB).
      if (layers.addLayerUpdate) for (const l of dirtyLayers) layers.addLayerUpdate(l);
      layers.needsUpdate = true;
      dirtyLayers.clear();
    }
    heads.count = maxCol;
    trails.count = maxCol * TRAIL;
    uUsed.value = Math.max(1, maxCol);
    return members;
  }

  /** Interpolated world positions of drop d's identities at its current frame (for picking). */
  const worldOf = (lon, lat) => (flat ? [(lon - flat.lonC) * cosC, lat - flat.latC, 0] : lonLatToVec3(lon, lat));
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
        let p = worldOf(a.lon, a.lat);
        if (fr.frac > 0) {
          const b = stateOf(tr, id, fr.index + 1);
          if (b) {
            const q = worldOf(b.lon, b.lat);
            p = p.map((x, k) => x + (q[k] - x) * fr.frac);
          }
        }
        v.set(p[0], p[1], p[2]);
        if (!flat) v.normalize();
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
    worldOf,
    _debug: () => ({ layerData, colData, dropData, drops, LAYERS, CAP, BLOCK, hist }),
    slotOf: (id) => (drops.has(id) ? drops.get(id).slot : -1),
    /** Highlight fragments (local ids) of one drop; null clears. */
    setSelection(dropId, locals = []) {
      selDropId = dropId == null ? null : dropId;
      const d = dropId == null ? null : drops.get(dropId);
      uSelSlot.value = d ? d.slot : -1;
      selData.fill(0);
      if (d) for (const l of locals) selData[4 * (l & 255)] = 1;
      selTex.needsUpdate = true;
    },
    setPxWorld(v) { uPxWorld.value = v; },
    setTrailWriteBudget(n) { trailWriteBudget = n; },
    clear() { for (const id of [...drops.keys()]) removeDrop(id); },
    dispose() {
      layers.dispose(); colTex.dispose(); selTex.dispose(); dropTex.dispose(); dayTex.dispose();
      headMat.dispose(); trailMat.dispose(); histMat.dispose(); histGeo.dispose(); trails.geometry.dispose();
    },
  };
}

function stateOf(tr, id, index) {
  const snap = tr.snaps[index];
  if (!snap) return null;
  let i = id;
  if (tr.born[i] > index) return null; // not born yet (see writeLayer)
  if (i < 0 || i >= snap.n || snap.code[i] === ABSENT) return null;
  return { lon: snap.pos[2 * i] / tr.sx, lat: snap.pos[2 * i + 1] / tr.sy, code: snap.code[i] };
}
