// DOM controls over the globe canvas: item picker, timeline (0 -> 10 years, play/pause, speeds),
// the selected fragment's panel, status/toast lines and the always-visible disclaimer.
// Plain DOM; every callback goes through `on`.

export const MAX_DAY = 3650;
export const SPEEDS = [1, 30, 365]; // simulated days per second
export const DISCLAIMER = 'Simulation with uncertainty, not a forecast.';

export const ITEM_COPY = {
  bottle: { button: 'Drop a bottle', name: 'A plastic bottle', short: 'bottle', img: 'asset-bottle.webp' },
  bag: { button: 'Drop a bag', name: 'A plastic bag', short: 'bag', img: 'item-bag.webp' },
  line: { button: 'Drop fishing line', name: 'Fishing line', short: 'fishing line', img: 'item-line.webp' },
  tyre: { button: 'Drop tyre dust', name: 'Tyre wear particles', short: 'tyre dust', img: 'item-tyre.webp' },
};
const ITEMS = ['bottle', 'bag', 'line', 'tyre'];

export const SIZE_COPY = {
  macro: 'Large piece, over 25 mm',
  meso: 'Fragment, 5 to 25 mm',
  micro: 'Microplastic, 1 to 5 mm',
  small: 'Fine microplastic, under 1 mm',
};

// Timeline scale: log-like so the first month is not a sliver. pos 0..1 <-> day 0..3650.
const K = 10;
const LN = Math.log(1 + MAX_DAY / K);
export const dayToPos = (d) => Math.log(1 + Math.max(0, Math.min(MAX_DAY, d)) / K) / LN;
export const posToDay = (p) => K * (Math.exp(Math.max(0, Math.min(1, p)) * LN) - 1);

export function formatAge(day) {
  const d = Math.floor(day);
  if (d < 1) return 'Just dropped';
  if (d < 60) return d === 1 ? '1 day' : `${d} days`;
  if (d < 365) return `${Math.min(11, Math.max(2, Math.round(d / 30.44)))} months`;
  const y = Math.floor(d / 365);
  const m = Math.min(11, Math.round((d - y * 365) / 30.44));
  const ys = y === 1 ? '1 year' : `${y} years`;
  return m > 0 && y < 5 ? `${ys} ${m} ${m === 1 ? 'month' : 'months'}` : ys;
}

const fmtKm = (km) => (km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km).toLocaleString('en')} km`);
const pct = (f) => `${Math.round(f * 100)}%`;

const BOTTLE_SVG = `<svg viewBox="0 0 40 64" aria-hidden="true"><path d="M15 3h10v8c0 3 7 7 7 15v31c0 3-2 5-5 5H13c-3 0-5-2-5-5V26c0-8 7-12 7-15z" fill="#FF4D8D" fill-opacity=".85"/><path d="M13 30h14v14H13z" fill="#E6EEE9" fill-opacity=".7"/><path d="M15 3h10v4H15z" fill="#F2B544"/></svg>`;

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

export function createUI(root, { base = '/', touch = false, reducedMotion = false } = {}) {
  const handlers = {};
  const on = (name, fn) => { handlers[name] = fn; };
  const emit = (name, ...a) => handlers[name] && handlers[name](...a);

  // ---- side column ----
  const side = el('aside', 'globe-ui');
  side.setAttribute('aria-label', 'Drop controls');
  const head = el('header', 'globe-ui__head');
  head.append(el('h2', 'globe-ui__title', 'Drop your own'));
  head.append(el('p', 'globe-ui__lede', `Pick something, then ${touch ? 'tap' : 'click'} the ocean. Each piece becomes a cloud of possible paths, one for each simulated copy.`));
  side.append(head);

  const items = el('div', 'globe-items');
  items.setAttribute('role', 'group');
  items.setAttribute('aria-label', 'What to drop');
  const itemButtons = {};
  let current = 'bottle';
  for (const it of ITEMS) {
    const b = el('button', 'globe-item');
    b.type = 'button';
    b.dataset.item = it;
    b.setAttribute('aria-pressed', it === current ? 'true' : 'false');
    const pic = el('span', 'globe-item__pic');
    const img = new Image();
    img.alt = '';
    img.decoding = 'async';
    img.onerror = () => { if (it === 'bottle') pic.innerHTML = BOTTLE_SVG; else img.remove(); };
    img.src = `${base}art/${ITEM_COPY[it].img}`;
    pic.append(img);
    b.append(pic, el('span', 'globe-item__label', ITEM_COPY[it].button));
    b.addEventListener('click', () => { setItem(it); emit('item', it); });
    items.append(b);
    itemButtons[it] = b;
  }
  side.append(items);

  const hint = el('p', 'globe-ui__hint');
  hint.setAttribute('aria-live', 'polite');
  side.append(hint);

  // ---- fragment panel ----
  const panel = el('section', 'globe-panel');
  panel.hidden = true;
  panel.setAttribute('aria-live', 'polite');
  panel.setAttribute('aria-label', 'Selected fragment');
  const pTop = el('div', 'globe-panel__top');
  const pTitle = el('h3', 'globe-panel__title');
  const pClose = el('button', 'globe-panel__close', '×');
  pClose.type = 'button';
  pClose.setAttribute('aria-label', 'Close the fragment panel');
  pClose.addEventListener('click', () => emit('deselect'));
  pTop.append(pTitle, pClose);
  const dl = el('dl', 'globe-panel__facts');
  const fact = (label) => {
    const w = el('div', 'globe-fact');
    const dt = el('dt', null, label), dd = el('dd');
    w.append(dt, dd);
    dl.append(w);
    return dd;
  };
  const fSize = fact('Size'), fAge = fact('Age'), fDist = fact('Distance travelled');
  const endTitle = el('h4', 'globe-panel__sub', 'Where it likely ends up');
  const endNote = el('p', 'globe-panel__note');
  const bars = el('ul', 'globe-fates');
  const FATES = [['gyre', 'In a gyre'], ['coast', 'On a coastline'], ['seafloor', 'On the seafloor'], ['floating', 'Still floating']];
  const fateRows = {};
  for (const [k, label] of FATES) {
    const li = el('li', `globe-fate globe-fate--${k}`);
    const name = el('span', 'globe-fate__name', label);
    const val = el('span', 'globe-fate__val');
    const bar = el('span', 'globe-fate__bar');
    const fill = el('span', 'globe-fate__fill');
    bar.append(fill);
    li.append(name, val, bar);
    bars.append(li);
    fateRows[k] = { val, fill };
  }
  panel.append(pTop, dl, endTitle, bars, endNote);
  side.append(panel);

  const status = el('p', 'globe-ui__status');
  status.setAttribute('role', 'status');
  side.append(status);

  // ---- timeline ----
  const tl = el('div', 'globe-timeline');
  const play = el('button', 'globe-play');
  play.type = 'button';
  const playIcon = el('span', 'globe-play__icon');
  play.append(playIcon);
  play.addEventListener('click', () => emit('play'));
  const scrub = el('div', 'globe-scrub');
  const track = el('div', 'globe-scrub__track');
  const computed = el('div', 'globe-scrub__computed');
  const fill = el('div', 'globe-scrub__fill');
  track.append(computed, fill);
  const range = document.createElement('input');
  range.type = 'range';
  range.className = 'globe-scrub__input';
  range.min = '0'; range.max = '1000'; range.step = '1'; range.value = '0';
  range.setAttribute('aria-label', 'Age of the drops');
  const ticks = el('div', 'globe-scrub__ticks');
  for (const [d, label, key] of [[0, '0', '0'], [30, '1 mo', '1mo'], [365, '1 y', '1y'], [1826, '5 y', '5y'], [3650, '10 y', '10y']]) {
    const t = el('span', `globe-tick globe-tick--${key}`, label);
    t.style.left = `${dayToPos(d) * 100}%`;
    ticks.append(t);
  }
  scrub.append(track, range, ticks);
  let scrubbing = false;
  range.addEventListener('input', () => { scrubbing = true; emit('scrub', posToDay(+range.value / 1000)); });
  range.addEventListener('change', () => { scrubbing = false; });
  range.addEventListener('pointerup', () => { scrubbing = false; });

  const speeds = el('div', 'globe-speeds');
  speeds.setAttribute('role', 'radiogroup');
  speeds.setAttribute('aria-label', 'Playback speed');
  const speedButtons = SPEEDS.map((s) => {
    const b = el('button', 'globe-speed', String(s));
    const x = el('span', 'globe-speed__x', '×');
    x.setAttribute('aria-hidden', 'true');
    b.append(x);
    b.setAttribute('aria-label', `${s} times`);
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.title = s === 1 ? '1 simulated day per second' : `${s} simulated days per second`;
    b.addEventListener('click', () => emit('speed', s));
    speeds.append(b);
    return b;
  });
  const readout = el('output', 'globe-readout');
  tl.append(play, scrub, speeds, readout);

  const disclaimer = el('p', 'globe-disclaimer', DISCLAIMER);
  const toast = el('p', 'globe-toast');
  toast.setAttribute('role', 'status');

  root.append(side, tl, disclaimer, toast);

  // On a phone the timeline lives in the bottom sheet, under the item picker.
  const phoneQuery = window.matchMedia ? window.matchMedia('(max-width: 759px)') : null;
  const placeTimeline = () => {
    if (phoneQuery && phoneQuery.matches) side.insertBefore(tl, status);
    else root.insertBefore(tl, disclaimer);
  };
  placeTimeline();
  if (phoneQuery) phoneQuery.addEventListener('change', placeTimeline);

  // ---- state setters ----
  function setItem(it) {
    current = it;
    for (const [k, b] of Object.entries(itemButtons)) b.setAttribute('aria-pressed', k === it ? 'true' : 'false');
    hint.textContent = `${touch ? 'Tap' : 'Click'} the ocean to drop ${it === 'line' ? 'fishing line' : it === 'tyre' ? 'tyre dust' : `a ${ITEM_COPY[it].short}`}.`;
  }
  setItem(current);

  let toastTimer = 0;
  function showToast(text, x, y) {
    toast.textContent = text;
    const r = root.getBoundingClientRect();
    if (x != null) {
      toast.style.left = `${Math.max(90, Math.min(r.width - 90, x))}px`;
      toast.style.top = `${Math.max(40, y - 18)}px`;
    } else {
      toast.style.left = '50%';
      toast.style.top = '20%';
    }
    toast.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('is-on'), 1800);
  }

  function setTime(day, { playing, speed, computedDay }) {
    if (!scrubbing) range.value = String(Math.round(dayToPos(day) * 1000));
    fill.style.width = `${dayToPos(day) * 100}%`;
    computed.style.width = `${dayToPos(computedDay) * 100}%`;
    range.setAttribute('aria-valuetext', formatAge(day));
    readout.textContent = day < 1 ? 'Day 0' : formatAge(day);
    play.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    play.classList.toggle('is-playing', playing);
    speedButtons.forEach((b, i) => {
      const onIt = SPEEDS[i] === speed;
      b.setAttribute('aria-checked', onIt ? 'true' : 'false');
      b.classList.toggle('is-on', onIt);
    });
  }

  function setPanel(stats) {
    const was = !panel.hidden;
    if (!stats) { panel.hidden = true; root.classList.remove('has-panel'); if (was) emit('panel', false); return; }
    panel.hidden = false;
    root.classList.add('has-panel');
    if (!was) emit('panel', true);
    const copy = ITEM_COPY[stats.item] || { name: stats.item };
    pTitle.textContent = stats.pieces > 1 ? `${copy.name}, now ${stats.pieces} pieces` : copy.name;
    fSize.textContent = stats.sizeClasses.length ? stats.sizeClasses.map((c) => SIZE_COPY[c] || c).join('; ') : 'Gone from the surface';
    fAge.textContent = formatAge(stats.day);
    fDist.textContent = `${fmtKm(stats.distanceKm)} on average`;
    for (const [k] of FATES) {
      const f = stats.fates[k] || 0;
      fateRows[k].val.textContent = pct(f);
      fateRows[k].fill.style.width = `${Math.round(f * 100)}%`;
    }
    const when = stats.fatesDay >= MAX_DAY ? 'after 10 years' : `after ${formatAge(stats.fatesDay).toLowerCase()} (still computing)`;
    endNote.textContent = `Probability across ${stats.members || 'its'} simulated copies, ${when}.`;
  }

  return {
    on,
    get item() { return current; },
    setItem,
    setTime,
    setPanel,
    setStatus(text, kind = '') { status.textContent = text || ''; status.dataset.kind = kind; },
    setHint(text) { hint.textContent = text; },
    showToast,
    setDropEnabled(ok, why = '') {
      for (const b of Object.values(itemButtons)) { b.disabled = !ok; b.title = ok ? '' : why; }
      if (!ok && why) hint.textContent = why;
    },
    contains: (node) => side.contains(node) || tl.contains(node),
    dispose() { clearTimeout(toastTimer); if (phoneQuery) phoneQuery.removeEventListener('change', placeTimeline); side.remove(); tl.remove(); disclaimer.remove(); toast.remove(); },
  };
}
