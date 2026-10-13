// The globe section: lazy-imports the three.js globe (a separate chunk) when the section nears
// the viewport, and offers the Global ocean / Salish Sea switch. Falls back to a static image.

const BASE = (import.meta.env && import.meta.env.BASE_URL) || '/';

export function initGlobeSection(section) {
  const mount = section.querySelector('.globe__mount');
  const note = section.querySelector('.globe__note');
  const buttons = [...section.querySelectorAll('[data-mode]')];
  let mod = null;
  let instance = null;
  let mode = 'global';
  let loading = null;

  function say(text) {
    note.textContent = text;
    note.hidden = !text;
  }

  async function fallback(reason) {
    console.info(`[drift] static fallback: ${reason}`);
    const url = `${BASE}art/globe-fallback.webp`;
    let ok = false;
    try { ok = (await fetch(url, { method: 'HEAD' })).ok; } catch { ok = false; }
    mount.textContent = '';
    if (ok) {
      const img = document.createElement('img');
      img.className = 'globe__fallback';
      img.src = url;
      img.alt = 'A painted globe of the ocean currents.';
      mount.append(img);
    }
    say('The interactive globe could not start in this browser, so this is a still picture of it.');
  }

  function supports(m) {
    if (m === 'global') return true;
    if (!mod) return false;
    if (typeof mod.supportsMode === 'function') return !!mod.supportsMode(m);
    if (Array.isArray(mod.MODES)) return mod.MODES.includes(m);
    return false;
  }

  function mountMode(m) {
    if (!mod) return;
    if (instance && instance.dispose) instance.dispose();
    mount.textContent = '';
    instance = mod.mountGlobe(mount, { mode: m });
    mode = m;
    buttons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === m)));
  }

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

  buttons.forEach((b) => b.addEventListener('click', async () => {
    const want = b.dataset.mode;
    await load();
    if (!mod) return;
    if (want === mode) return;
    if (!supports(want)) {
      say('The Salish Sea view is still being built. You are looking at the global ocean.');
      buttons.forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.mode === mode)));
      return;
    }
    say('');
    mountMode(want);
  }));

  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { io.disconnect(); load(); }
    }, { rootMargin: '100% 0px' });
    io.observe(section);
  } else {
    load();
  }
  return { load, get mode() { return mode; } };
}
