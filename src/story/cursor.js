// The measured makemepulse cursor: a dot that follows the pointer with zero lag (its transform is
// written on the next frame), whose size eases at 12 % per 60 Hz frame: 18 px idle, 75 px with a
// label (elements with data-cursor="Label"), 11 px over other UI. The label fades in 0.25 s after
// 0.15 s (CSS). Only for fine pointers; never on touch. The native cursor stays everywhere except
// over the scenic stage and labelled targets, and keyboard focus is untouched.

const SIZE = { idle: 18, label: 75, ui: 11 };
const PER_FRAME = 0.12;
const UI = 'a, button, input, select, textarea, label, summary, [role="button"], [tabindex]:not([tabindex="-1"])';

export function createCursor({ reduced = false } = {}) {
  const fine = window.matchMedia('(hover: hover) and (pointer: fine)');
  if (!fine.matches) return { destroy() {} };

  const el = document.createElement('div');
  el.className = 'cursor';
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = '<span class="cursor__dot"></span><span class="cursor__label"></span>';
  document.body.append(el);
  document.documentElement.classList.add('has-cursor');
  const dot = el.firstChild;
  const label = el.lastChild;

  let x = -100, y = -100, size = SIZE.idle, target = SIZE.idle, visible = false;
  let last = performance.now();
  let raf = 0;

  function classify(node) {
    const labelled = node && node.closest && node.closest('[data-cursor]');
    if (labelled) return { size: SIZE.label, text: labelled.dataset.cursor };
    if (node && node.closest && node.closest(UI)) return { size: SIZE.ui, text: '' };
    return { size: SIZE.idle, text: '' };
  }

  function onMove(e) {
    if (e.pointerType && e.pointerType !== 'mouse') return;
    x = e.clientX; y = e.clientY;
    if (!visible) { visible = true; el.classList.add('is-visible'); }
    const c = classify(e.target);
    target = c.size;
    if (c.text) { label.textContent = c.text; el.classList.add('has-label'); }
    else el.classList.remove('has-label');
    // Over the globe's own canvas the globe owns the pointer.
    el.classList.toggle('is-off', !!(e.target.closest && e.target.closest('.drift-globe')));
  }
  function onLeave() { visible = false; el.classList.remove('is-visible'); }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(Math.max(now - last, 0), 200);
    last = now;
    const k = reduced ? 1 : 1 - (1 - PER_FRAME) ** (dt / 16.67);
    size += (target - size) * k;
    el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    dot.style.transform = `translate(-50%, -50%) scale(${(size / SIZE.label).toFixed(4)})`;
  }

  const opts = { passive: true };
  window.addEventListener('pointermove', onMove, opts);
  document.addEventListener('pointerleave', onLeave);
  document.documentElement.addEventListener('mouseleave', onLeave);
  raf = requestAnimationFrame(frame);

  return {
    el,
    destroy() {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onMove, opts);
      document.removeEventListener('pointerleave', onLeave);
      document.documentElement.removeEventListener('mouseleave', onLeave);
      el.remove();
      document.documentElement.classList.remove('has-cursor');
    },
  };
}
