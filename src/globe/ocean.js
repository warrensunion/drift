// The ocean globe: a petrol-teal sphere with chart-paper land from landmask.png, a glass coast
// hairline, shelf light near coasts, the streamline trail texture painted in, a soft rim, and a
// halo sphere. All shading in TSL (runs on the WebGPU and WebGL2 backends).
import * as THREE from 'three/webgpu';
import {
  Fn, uniform, texture, uv, vec2, vec3, vec4, float, color, mix, smoothstep, clamp, dot, normalize,
  normalView, positionView, positionWorld, cameraPosition, fwidth, abs, exp, max, pow, length, screenCoordinate, hash,
} from 'three/tsl';

export const PALETTE = {
  petrol: '#0E2F36',
  deep: '#1F5A5E',
  glass: '#7FB7AE',
  foam: '#E6EEE9',
  fresh: '#FF4D8D',
  oxidised: '#F2B544',
  bleached: '#F1E9D2',
};

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`could not load ${url}`));
    img.src = url;
  });
}

/**
 * Load landmask.png (2048 x 1024 equirect, row 0 = 90 N, 255 = land). Returns
 * {mask: {width, height, data} (north-first bytes, for isLandAt), texture} where the texture is
 * RGBA8, rows south-first (v = (lat + 90) / 180): R = mask, G = mask blurred ~2 px (coast line,
 * anti-aliased land edge), B = blurred ~16 px (shelf light near coasts).
 */
export async function loadLandmask(url) {
  const img = await loadImage(url);
  const w = img.naturalWidth, h = img.naturalHeight;
  const pad = 48;
  const c = document.createElement('canvas');
  c.width = w + 2 * pad; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const draw = (blur) => {
    ctx.filter = blur ? `blur(${blur}px)` : 'none';
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, c.width, c.height);
    // Wrap copies either side so blurs cross the date line.
    ctx.drawImage(img, pad, 0);
    ctx.drawImage(img, pad - w, 0);
    ctx.drawImage(img, pad + w, 0);
    return ctx.getImageData(pad, 0, w, h).data;
  };
  const r = draw(0);
  const g = draw(2);
  const b = draw(16);
  const mask = new Uint8Array(w * h);
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const dst = (h - 1 - y) * w; // south-first rows for the texture
    for (let x = 0; x < w; x++) {
      const i = y * w + x, o = (dst + x) * 4;
      mask[i] = r[i * 4];
      rgba[o] = r[i * 4]; rgba[o + 1] = g[i * 4]; rgba[o + 2] = b[i * 4]; rgba[o + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(rgba, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return { mask: { width: w, height: h, data: mask }, texture: tex };
}

/** A tiling art texture (ui-water / ui-paper), or null when it is missing. */
export async function loadTile(url) {
  try {
    const img = await loadImage(url);
    const tex = new THREE.Texture(img);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.anisotropy = 4;
    tex.needsUpdate = true;
    return tex;
  } catch {
    return null;
  }
}

const lum = (c) => dot(c, vec3(0.2126, 0.7152, 0.0722));

/**
 * Build the ocean sphere and halo. landTex from loadLandmask (or null: all ocean), trailNode a
 * texture node (streamlines, equirect, R = intensity) or null, waterTex/paperTex art tiles or null.
 * Returns {group, uniforms, setTrail(tex)}.
 */
export function createOcean({ landTex, trailTex, waterTex, paperTex }) {
  const group = new THREE.Group();
  const geo = new THREE.SphereGeometry(1, 192, 96);
  // SphereGeometry puts u = 0 at lon -90 in our convention (lon 0 at +z): turn it so u = 0 is
  // lon -180 and u = (lon + 180) / 360, v = (lat + 90) / 180.
  geo.rotateY(-Math.PI / 2);

  const uLight = uniform(new THREE.Vector3(-0.45, 0.55, 0.7).normalize());
  const uTrail = uniform(1); // streamline strength (0 hides them)
  const trailNode = texture(trailTex || new THREE.DataTexture(new Uint8Array(4), 1, 1));
  const landNode = texture(landTex || new THREE.DataTexture(new Uint8Array(4), 1, 1));

  const cPetrol = color(PALETTE.petrol), cDeep = color(PALETTE.deep), cGlass = color(PALETTE.glass), cFoam = color(PALETTE.foam);
  const cAbyss = color('#08222A');
  const cShelf = color('#3E8C86');
  const cSheen = color('#2E7775');

  const mat = new THREE.MeshBasicNodeMaterial();
  mat.colorNode = Fn(() => {
    const st = uv();
    const N = normalize(normalView);
    const V = normalize(positionView.negate());
    const ndl = clamp(dot(N, uLight), 0, 1);
    const ndv = clamp(dot(N, V), 0, 1);
    const fres = pow(float(1).sub(ndv), 2.6);

    const lm = landNode.sample(st);
    const edge = lm.g; // ~2 px blurred mask
    const fw = max(fwidth(edge), 0.004);
    const land = smoothstep(float(0.5).sub(fw), float(0.5).add(fw), edge);
    const coast = float(1).sub(smoothstep(fw.mul(0.6), fw.mul(1.6), abs(edge.sub(0.5))));
    const shelf = smoothstep(0.02, 0.5, lm.b).mul(float(1).sub(land));

    // Water: abyss on the limb, petrol to deep teal toward the light, mottled by the water tile.
    const light = pow(ndl, 0.85);
    let water = mix(cAbyss, cPetrol, smoothstep(0.0, 0.3, light));
    water = mix(water, cDeep, smoothstep(0.2, 0.85, light).mul(0.9));
    water = mix(water, cSheen, smoothstep(0.7, 1.0, light).mul(0.35));
    if (waterTex) {
      const w = lum(texture(waterTex, st.mul(vec2(6, 3))).rgb);
      const w2 = lum(texture(waterTex, st.mul(vec2(2.2, 1.1)).add(vec2(0.37, 0.11))).rgb);
      water = water.mul(float(0.8).add(w.mul(0.28)).add(w2.mul(0.22)));
    }
    water = mix(water, cShelf, shelf.mul(0.5).mul(float(0.35).add(light.mul(0.65))));
    // Streamlines (glass), brighter on the lit side.
    const tr = clamp(trailNode.sample(st).r, 0, 1).mul(uTrail).mul(float(1).sub(land));
    water = mix(water, cGlass, pow(tr, 0.7).mul(float(0.5).add(light.mul(0.4))));

    // Land: matte chart paper, a touch darker toward its coasts and on the limb.
    let paper = cFoam.mul(float(0.5).add(light.mul(0.46)));
    paper = paper.mul(float(0.86).add(smoothstep(0.5, 1.0, lm.b).mul(0.14)));
    if (paperTex) {
      const p = lum(texture(paperTex, st.mul(vec2(9, 4.5))).rgb);
      const p2 = lum(texture(paperTex, st.mul(vec2(3, 1.5)).add(vec2(0.5, 0.25))).rgb);
      paper = paper.mul(float(0.72).add(p.mul(0.14)).add(p2.mul(0.18)));
    }
    if (waterTex) {
      const wl = lum(texture(waterTex, st.mul(vec2(4, 2)).add(vec2(0.21, 0.6))).rgb);
      paper = mix(paper, cDeep, smoothstep(0.35, 0.15, wl).mul(0.12));
    }
    paper = mix(paper, cDeep, fres.mul(0.55));

    let col = mix(water, paper, land);
    col = mix(col, cGlass, coast.mul(0.7));
    // Soft rim and a whisper of grain.
    col = col.add(cGlass.mul(fres).mul(0.5));
    const g = hash(screenCoordinate.x.add(screenCoordinate.y.mul(4099.0))).sub(0.5).mul(0.012);
    return col.add(g);
  })();
  const sphere = new THREE.Mesh(geo, mat);
  sphere.renderOrder = 0;
  group.add(sphere);

  // Halo: back faces of a larger sphere, intensity from the view ray's closest approach to the
  // centre (1 = the planet's limb), fading out to the halo's edge.
  const R_HALO = 1.12;
  // Normal 'over' blending with alpha = intensity: the canvas is transparent over the page, and
  // additive blending would write alpha 1 and turn the faint outer halo into an opaque dark ring.
  const haloMat = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, transparent: true, depthWrite: false });
  haloMat.colorNode = Fn(() => {
    const P = positionWorld;
    const D = normalize(P.sub(cameraPosition));
    const C = cameraPosition.negate(); // centre (origin) relative to the camera
    const d = length(C.sub(D.mul(dot(C, D))));
    const outside = max(d.sub(1), 0);
    const k = exp(outside.mul(-26)).mul(float(1).sub(smoothstep(1.0, R_HALO, d)));
    return vec4(cGlass, k.mul(0.62));
  })();
  const halo = new THREE.Mesh(new THREE.SphereGeometry(R_HALO, 96, 48), haloMat);
  halo.renderOrder = 1;
  group.add(halo);

  return {
    group,
    uniforms: { uLight, uTrail },
    setTrail(tex) { trailNode.value = tex; },
    dispose() {
      geo.dispose(); mat.dispose(); halo.geometry.dispose(); haloMat.dispose();
    },
  };
}
