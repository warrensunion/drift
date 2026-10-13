// Animated current streamlines. N seeds live in a storage buffer (lon, lat, age, life) advected by
// a TSL compute pass on the month's current field (a half-float data texture). Each frame the
// seeds are stamped as small additive dots into an equirectangular trail texture whose previous
// frame is faded, so trails wrap the sphere exactly; the ocean shader paints that texture in glass.
// Seeds respawn on land, near the poles, or when old.
import * as THREE from 'three/webgpu';
import {
  Fn, If, uniform, texture, instancedArray, instanceIndex, vec2, vec3, vec4, float, uint, hash, uv,
  cos, radians, abs, length, max, pow, sin, asin, smoothstep, clamp, select, PI, mix,
} from 'three/tsl';

export const SEEDS = 16384;
const TRAIL_W = 2048, TRAIL_H = 1024;

/** Build the 12 monthly current textures: RGBA half float (u, v m/s; water flag; 0). */
export function fieldTextures(tiles) {
  return tiles.map((t) => {
    const { nx, ny, data, scale } = t;
    const out = new Uint16Array(nx * ny * 4);
    const h = THREE.DataUtils.toHalfFloat;
    const zero = h(0), one = h(1);
    for (let i = 0; i < nx * ny; i++) {
      const u = data[2 * i], v = data[2 * i + 1];
      const land = u === -32768 || v === -32768;
      out[4 * i] = land ? zero : h(u * scale);
      out[4 * i + 1] = land ? zero : h(v * scale);
      out[4 * i + 2] = land ? zero : one;
      out[4 * i + 3] = one;
    }
    const tex = new THREE.DataTexture(out, nx, ny, THREE.RGBAFormat, THREE.HalfFloatType);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.NoColorSpace;
    tex.needsUpdate = true;
    tex.userData.grid = { lon0: t.lon0, lat0: t.lat0, dlon: t.dlon, dlat: t.dlat, nx, ny };
    return tex;
  });
}

export function createStreamlines(renderer, { fieldTex, reducedMotion = false, seeds = SEEDS }) {
  const grid = fieldTex.userData.grid;
  // Texture coordinates of (lon, lat) in the field: cell centres at lon0 + i*dlon.
  const lonSpan = grid.nx * grid.dlon, latSpan = grid.ny * grid.dlat;
  const lonStart = grid.lon0 - grid.dlon / 2, latStart = grid.lat0 - grid.dlat / 2;
  const latLimit = Math.min(Math.abs(latStart), Math.abs(latStart + latSpan)) - 1.5;

  const state = instancedArray(seeds, 'vec4');
  const fieldNode = texture(fieldTex);
  const uDt = uniform(1 / 60);
  const uSeed = uniform(1, 'uint');
  const uGain = uniform(0.17); // degrees per frame at 1 m/s (60 fps), before the speed curve
  const uLife = uniform(1); // 0 during the reduced-motion bake: seeds never age out

  const rand = (k) => hash(instanceIndex.add(uSeed.mul(uint(16411))).add(uint(k * 7919)));

  const respawn = (s) => {
    const r1 = rand(1), r2 = rand(2), r3 = rand(3);
    const lat = asin(r1.mul(2).sub(1).mul(Math.sin(latLimit * Math.PI / 180))).mul(180 / Math.PI);
    s.assign(vec4(r2.mul(360).sub(180), lat, r3.mul(-2), r3.mul(4).add(3.5)));
  };

  const init = Fn(() => {
    const s = state.element(instanceIndex);
    const r1 = rand(1), r2 = rand(2), r3 = rand(3);
    const lat = asin(r1.mul(2).sub(1).mul(Math.sin(latLimit * Math.PI / 180))).mul(180 / Math.PI);
    const life = r3.mul(4).add(3.5);
    // Spread initial ages so the field does not pulse in unison.
    s.assign(vec4(r2.mul(360).sub(180), lat, rand(4).mul(life), life));
  })().compute(seeds);

  const update = Fn(() => {
    const s = state.element(instanceIndex);
    const lon = s.x.toVar(), lat = s.y.toVar(), age = s.z.toVar(), life = s.w.toVar();
    const st = vec2(lon.sub(lonStart).div(lonSpan), lat.sub(latStart).div(latSpan));
    const f = fieldNode.sample(st).level(0);
    const speed = length(f.xy);
    // A gentle speed curve so slow basins still draw: displayed speed ~ speed^0.55.
    const gain = pow(max(speed, 0.002), -0.45).mul(uGain).mul(uDt.mul(60));
    lon.addAssign(f.x.mul(gain).div(max(cos(radians(lat)), 0.2)));
    lat.addAssign(f.y.mul(gain));
    age.addAssign(uDt.mul(uLife));
    If(lon.greaterThan(180), () => { lon.subAssign(360); });
    If(lon.lessThan(-180), () => { lon.addAssign(360); });
    If(f.z.lessThan(0.5).or(age.greaterThan(life)).or(abs(lat).greaterThan(latLimit)), () => {
      respawn(s);
    }).Else(() => {
      s.assign(vec4(lon, lat, age, life));
    });
  })().compute(seeds);

  // Trail texture ping-pong.
  const rtOpts = { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false, generateMipmaps: false, magFilter: THREE.LinearFilter, minFilter: THREE.LinearFilter, wrapS: THREE.RepeatWrapping };
  let rtA = new THREE.RenderTarget(TRAIL_W, TRAIL_H, rtOpts);
  let rtB = new THREE.RenderTarget(TRAIL_W, TRAIL_H, rtOpts);
  rtA.texture.wrapS = rtB.texture.wrapS = THREE.RepeatWrapping;

  const uFade = uniform(0.986);
  const prevNode = texture(rtA.texture);
  const fadeMat = new THREE.MeshBasicNodeMaterial();
  fadeMat.colorNode = Fn(() => {
    const p = prevNode.sample(uv()).r;
    const v = max(p.mul(uFade).sub(0.0015), 0);
    return vec4(v, v, v, 1);
  })();
  const fadeQuad = new THREE.QuadMesh(fadeMat);

  // Dots, in lon/lat units under an orthographic camera spanning the whole map.
  const dotMat = new THREE.SpriteNodeMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false });
  const sAttr = state.toAttribute();
  dotMat.positionNode = vec3(sAttr.x, sAttr.y, 0);
  dotMat.scaleNode = float(0.5);
  const uDot = uniform(0.11);
  dotMat.colorNode = Fn(() => {
    const age = sAttr.z, life = sAttr.w;
    const t = clamp(age.div(life), 0, 1);
    const env = sin(t.mul(PI)).mul(smoothstep(0.0, 0.02, age));
    // Fast currents draw brighter than slow basins, so the structure reads.
    const sp = length(fieldNode.sample(vec2(sAttr.x.sub(lonStart).div(lonSpan), sAttr.y.sub(latStart).div(latSpan))).level(0).xy);
    const bright = mix(float(0.22), float(1), smoothstep(0.03, 0.35, sp));
    const d = length(uv().sub(0.5)).mul(2);
    const a = clamp(float(1).sub(d), 0, 1);
    const v = a.mul(env).mul(bright).mul(uDot);
    return vec4(v, v, v, 1);
  })();
  const dots = new THREE.Sprite(dotMat);
  dots.count = seeds;
  dots.frustumCulled = false;
  const dotScene = new THREE.Scene();
  dotScene.add(dots);
  const ortho = new THREE.OrthographicCamera(-180, 180, 90, -90, -1, 1);

  let initialised = false;
  let frozen = false;
  let frame = 0;

  function stamp() {
    // fade(prev) -> next, dots -> next, swap
    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    prevNode.value = rtA.texture;
    renderer.setRenderTarget(rtB);
    renderer.clear();
    fadeQuad.render(renderer);
    renderer.render(dotScene, ortho);
    renderer.setRenderTarget(null);
    renderer.autoClear = prevAutoClear;
    const t = rtA; rtA = rtB; rtB = t;
  }

  function step(dt) {
    uDt.value = Math.min(dt, 1 / 20);
    uSeed.value = (++frame * 2654435761) >>> 0;
    renderer.compute(update);
    stamp();
  }

  return {
    get texture() { return rtA.texture; },
    setField(tex) {
      if (fieldNode.value === tex) return;
      fieldNode.value = tex;
      // Reduced motion: the strokes are static, so re-bake them on the new month's field.
      if (frozen) {
        for (const rt of [rtA, rtB]) { renderer.setRenderTarget(rt); renderer.clear(); }
        renderer.setRenderTarget(null);
        initialised = false;
        frozen = false;
      }
    },
    /** Advance and draw one frame. Reduced motion: bake once into static short strokes. */
    update(dt) {
      if (!initialised) {
        renderer.compute(init);
        initialised = true;
        if (reducedMotion) {
          uFade.value = 1; uLife.value = 0; uDot.value = 0.22;
          for (let i = 0; i < 36; i++) step(1 / 60);
          frozen = true;
        }
      }
      if (frozen) return;
      step(dt);
    },
    dispose() {
      rtA.dispose(); rtB.dispose(); fadeMat.dispose(); dotMat.dispose();
      // Free the seed storage buffer. three has no public BufferAttribute.dispose() yet, so this
      // reaches the renderer's attribute cache (guarded; renderer.dispose() frees it otherwise).
      try { if (renderer._attributes) renderer._attributes.delete(state.value); } catch { /* already gone */ }
    },
  };
}
