// The globe section: lazy-imports the three.js globe (a separate chunk) when the section nears
// the viewport, and offers the Global ocean / Salish Sea switch. Falls back to a static image.
// The globe is paused (no drawing, no GPU compute) while the section is fully out of view.

const BASE = (import.meta.env && import.meta.env.BASE_URL) || '/';

const FALLBACKS = {
  global: { file: 'globe-fallback.webp', alt: 'A painted globe of the ocean currents.', what: 'interactive globe' },
  salish: { file: 'salish-fallback.webp', alt: 'A chart of the Fraser River mouth and the Strait of Georgia, with the tidal currents drawn as fine strokes.', what: 'Salish Sea chart' },
};
const SWITCH_HINT = 'Switching clears your drops.';

export function initGlobeSection(section) {
  const mount = section.querySelector('.globe__mount');
  const note = section.querySelector('.globe__note');
  const buttons = [...section.querySelectorAll('[data-mode]')];
  let mod = null;
  let instance = null;
  let mode = 'global';
  let loading = null;
  let visible = false;

  function say(text) {
    note.textContent = text;
    note.hidden = !text;
  }

  async function fallback(reason) {
    console.info(`[drift] static fallback: ${reason}`);
    const fb = FALLBACKS[mode] || FALLBACKS.global;
    const url = `${BASE}art/${fb.file}`;
    let ok = false;
    try { ok = (await fetch(url, { method: 'HEAD' })).ok; } catch { ok = false; }
    mount.textContent = '';
    if (ok) {
      const img = document.createElement('img');
      img.className = 'globe__fallback';
      img.src = url;
      img.alt = fb.alt;
      mount.append(img);
    }
    say(`The ${fb.what} could not start in this browser, so this is a still picture of it.`);
  }

  const pressed = () => buttons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));

  function mountMode(m) {
    if (!mod) return;
    if (instance && instance.dispose) instance.dispose();
    mount.textContent = '';
    mode = m;
    instance = mod.mountGlobe(mount, { mode: m });
    if (!visible && instance && instance.pause) instance.pause();
    pressed();
  }

  /** Load the globe chunk and mount the requested mode directly (no global-then-switch). */
  async function load() {
    if (loading) return loading;
    loading = (async () => {
      section.classList.add('is-loading');
      try {
        mod = await import('../globe/index.js');
        if (!mod || typeof mod.mountGlobe !== 'function') throw new Error('mountGlobe missing');
        mountMode(mode);
      } catch (err) {
        await fallback(err && err.message ? err.message : String(err));
      } finally {
        section.classList.remove('is-loading');
      }
    })();
    return loading;
  }

  buttons.forEach((b) => {
    b.title = SWITCH_HINT;
    b.addEventListener('click', async () => {
      const want = b.dataset.mode;
      if (!mod) { // not loaded yet: the requested view is the one that mounts
        mode = want;
        pressed();
        await load();
        return;
      }
      if (want === mode) return;
      const hadDrops = instance && instance.dropCount > 0;
      mountMode(want);
      say(hadDrops ? 'Switching cleared your drops.' : '');
    });
  });

  if ('IntersectionObserver' in window) {
    // Load when the section is near; pause the globe while it is fully out of view.
    const near = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { near.disconnect(); load(); }
    }, { rootMargin: '100% 0px' });
    near.observe(section);
    const seen = new IntersectionObserver((entries) => {
      visible = entries.some((e) => e.isIntersecting);
      if (instance && instance.pause) {
        if (visible) instance.resume(); else instance.pause();
      }
    }, { threshold: 0 });
    seen.observe(section);
  } else {
    visible = true;
    load();
  }
  return { load, get mode() { return mode; }, get instance() { return instance; } };
}
