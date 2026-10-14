// Renderer setup: WebGPURenderer (WebGPU, falling back to its WebGL2 backend), or a static image.
import * as THREE from 'three/webgpu';

function hasWebGL2() {
  try {
    const c = document.createElement('canvas');
    return !!c.getContext('webgl2');
  } catch {
    return false;
  }
}

/**
 * Create and initialise the renderer. `force`: 'webgl2' forces the WebGL2 backend, 'none' forces
 * the static fallback (dev/testing). Resolves {renderer, backend: 'webgpu'|'webgl2'} or rejects
 * with an Error whose message is the fallback reason.
 */
export async function createRenderer(canvas, { force = null } = {}) {
  if (force === 'none') throw new Error('forced by ?gl=none');
  const gpu = force !== 'webgl2' && typeof navigator !== 'undefined' && !!navigator.gpu;
  if (!gpu && !hasWebGL2()) throw new Error('neither WebGPU nor WebGL2 is available');
  const renderer = new THREE.WebGPURenderer({
    canvas,
    antialias: true,
    alpha: true,
    forceWebGL: force === 'webgl2',
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setClearColor(0x000000, 0);
  await renderer.init();
  const backend = renderer.backend && renderer.backend.isWebGPUBackend ? 'webgpu' : 'webgl2';
  console.info(`[drift] renderer: ${backend}`);
  return { renderer, backend };
}

/** Mount the static globe image and a note in place of the 3D globe. */
export function mountStaticFallback(host, reason, base = '/', { image = 'globe-fallback.webp', alt = 'A still picture of the ocean globe with its currents.', what = 'the 3D globe' } = {}) {
  console.info(`[drift] static fallback: ${reason}`);
  const wrap = document.createElement('div');
  wrap.className = 'globe-static';
  const img = document.createElement('img');
  img.src = `${base}art/${image}`;
  img.alt = alt;
  img.decoding = 'async';
  const note = document.createElement('p');
  note.className = 'globe-static__note';
  note.textContent = `Your browser cannot draw ${what} here, so this is a still picture. Try a recent Chrome, Edge, Firefox or Safari.`;
  wrap.append(img, note);
  host.append(wrap);
  return wrap;
}
