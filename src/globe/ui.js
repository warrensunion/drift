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

// Timeline scale: log-like so the first month is not a sliver. pos 0..1 <-> t 0..maxT.
export const timeScale = (maxT, K) => {
  const LN = Math.log(1 + maxT / K);
  return {
    toPos: (d) => Math.log(1 + Math.max(0, Math.min(maxT, d)) / K) / LN,
    fromPos: (p) => K * (Math.exp(Math.max(0, Math.min(1, p)) * LN) - 1),
  };
};
const GLOBAL_SCALE = timeScale(MAX_DAY, 10);
export const dayToPos = GLOBAL_SCALE.toPos;
export const posToDay = GLOBAL_SCALE.fromPos;

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

// Numbers in the reader's locale; a non-breaking space keeps a number with its unit.
const NBSP = String.fromCharCode(160);
const fmtNum = (n, digits = 0) => n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
const glue = (text) => text.replace(/(\d) (?=[a-z%])/g, `$1${NBSP}`); // '30 days' never breaks
const fmtKm = (km) => `${fmtNum(km < 10 ? km : Math.round(km), km < 10 ? 1 : 0)}${NBSP}km`;
const pct = (f) => `${Math.round(f * 100)}%`;

const BOTTLE_SVG = `<svg viewBox="0 0 40 64" aria-hidden="true"><path d="M15 3h10v8c0 3 7 7 7 15v31c0 3-2 5-5 5H13c-3 0-5-2-5-5V26c0-8 7-12 7-15z" fill="#FF4D8D" fill-opacity=".85"/><path d="M13 30h14v14H13z" fill="#E6EEE9" fill-opacity=".7"/><path d="M15 3h10v4H15z" fill="#F2B544"/></svg>`;

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

/** Copy and timeline settings of the global globe; the Salish view passes its own (salish.js). */
export const GLOBAL_PROFILE = {
  title: 'Drop your own',
  lede: (touch) => `Pick something, then ${touch ? 'tap' : 'click'} the ocean. Each piece becomes a cloud of possible paths, one for each simulated copy.`,
  target: 'the ocean',
  maxT: MAX_DAY,
  scaleK: 10,
  ticks: [[0, '0'], [30, '1 mo'], [365, '1 y'], [1826, '5 y'], [3650, '10 y']],
  tickOrder: [0, 4, 2, 1, 3], // label priority when they crowd: 0, 10 y, 1 y, 1 mo, 5 y
  speedText: (s) => [String(s), '×'],
  speedLabel: (s) => (s === 1 ? '1 simulated day per second' : `${s} simulated days per second`),
  speedTitle: (s) => (s === 1 ? '1 simulated day per second' : `${s} simulated days per second`),
  speedGroup: 'Playback speed',
  formatAge,
  zero: 'Day 0',
  // Arrow keys on the timeline move by a readable step: days, then months, then years.
  keyStep: (t, big) => (big ? (t < 365 ? 30.44 : 365) : t < 60 ? 1 : t < 5 * 365 ? 30.44 : 365),
  fates: [['gyre', 'In a gyre'], ['coast', 'On a coastline'], ['seafloor', 'On the seafloor'], ['floating', 'Still floating']],
  when: (t) => (t >= MAX_DAY ? 'after 10 years' : `after ${formatAge(t).toLowerCase()} (still computing)`),
  primary: null,
  notes: [],
  // A plain line when most copies sank within the first week (docs/science.md section 1).
  whyNote: (s) => {
    if (!(s.sankFirstWeek >= 0.5)) return '';
    if (s.item === 'line') return 'Nylon is denser than seawater, so most fishing line sinks within days.';
    if (s.item === 'tyre') return 'Tyre wear particles are denser than seawater and sink.';
    return '';
  },
};

export function createUI(root, { base = '/', touch = false, reducedMotion = false, profile = GLOBAL_PROFILE } = {}) {
  const P = { ...GLOBAL_PROFILE, ...profile };
  const scale = timeScale(P.maxT, P.scaleK);
  const handlers = {};
  const on = (name, fn) => { handlers[name] = fn; };
  const emit = (name, ...a) => handlers[name] && handlers[name](...a);

  // ---- side column ----
  const side = el('aside', 'globe-ui');
  side.setAttribute('aria-label', 'Drop controls');
  const head = el('header', 'globe-ui__head');
  head.append(el('h2', 'globe-ui__title', P.title));
  head.append(el('p', 'globe-ui__lede', P.lede(touch)));
  side.append(head);
  // Phone: a one-line summary of the selected drop; the sheet collapses to it (and the timeline)
  // so the globe gets the screen, and expands again on a tap.
  const summary = el('button', 'globe-summary');
  summary.type = 'button';
  summary.hidden = true;
  summary.setAttribute('aria-expanded', 'true');
  const summaryText = el('span', 'globe-summary__text');
  const summaryMore = el('span', 'globe-summary__more', 'Details');
  summary.append(summaryText, summaryMore);
  summary.addEventListener('click', () => setCollapsed(!root.classList.contains('is-collapsed')));
  side.append(summary);
  function setCollapsed(c) {
    const was = root.classList.contains('is-collapsed');
    root.classList.toggle('is-collapsed', !!c);
    summary.setAttribute('aria-expanded', c ? 'false' : 'true');
    summaryMore.textContent = c ? 'Details' : 'Less';
    if (was !== !!c) emit('panel', !panel.hidden);
  }
  let primaryBtn = null;
  if (P.primary) {
    primaryBtn = el('button', 'globe-primary', P.primary);
    primaryBtn.type = 'button';
    primaryBtn.addEventListener('click', () => emit('primary'));
    side.append(primaryBtn);
  }

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
  const fSize = fact('Size'), fAge = fact('Age'), fDist = fact('Distance from where you dropped it');
  const why = el('p', 'globe-panel__why');
  why.hidden = true;
  const endTitle = el('h4', 'globe-panel__sub', 'Where it likely ends up');
  const endNote = el('p', 'globe-panel__note');
  const bars = el('ul', 'globe-fates');
  const FATES = P.fates;
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
  panel.append(pTop, dl, why, endTitle, bars, endNote);
  side.append(panel);

  const status = el('p', 'globe-ui__status');
  status.setAttribute('role', 'status');
  side.append(status);
  // Screen readers hear the selection and the computing state when they change, not every frame.
  const live = el('p', 'visually-hidden');
  live.setAttribute('role', 'status');
  live.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;margin:0';
  let liveText = '';
  const announce = (text) => { if (text && text !== liveText) { liveText = text; live.textContent = text; } };

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
  for (const [d, label] of P.ticks) {
    const t = el('span', `globe-tick globe-tick--${label.split(' ').join('')}`, label);
    t.style.left = `${scale.toPos(d) * 100}%`;
    ticks.append(t);
  }
  scrub.append(track, range, ticks);
  // Hide any label that would touch its neighbour (keeps 0, 1 y and 10 y first; 5 y and 1 mo give way).
  const tickEls = [...ticks.children];
  const fitTicks = () => {
    for (const t of tickEls) t.classList.remove('is-hidden');
    const order = P.tickOrder;
    const kept = [];
    for (const i of order) {
      const r = tickEls[i].getBoundingClientRect();
      if (!r.width) continue;
      if (kept.some((k) => r.left < k.right + 10 && r.right > k.left - 10)) tickEls[i].classList.add('is-hidden');
      else kept.push(r);
    }
  };
  const tickRO = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(fitTicks) : null;
  if (tickRO) tickRO.observe(scrub);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitTicks);
  let scrubbing = false;
  range.addEventListener('input', () => { scrubbing = true; emit('scrub', scale.fromPos(+range.value / 1000)); });
  range.addEventListener('change', () => { scrubbing = false; });
  range.addEventListener('pointerup', () => { scrubbing = false; });
  // The native step (1/1000 of a log scale) is a fraction of a day near 0: arrows and Page keys
  // move by readable units instead, Home/End to the ends. aria-valuetext says the age in words.
  range.addEventListener('keydown', (e) => {
    const dir = { ArrowRight: 1, ArrowUp: 1, PageUp: 1, ArrowLeft: -1, ArrowDown: -1, PageDown: -1 }[e.key];
    let t = null;
    if (e.key === 'Home') t = 0;
    else if (e.key === 'End') t = P.maxT;
    else if (dir) t = Math.max(0, Math.min(P.maxT, curT + dir * P.keyStep(curT + (dir < 0 ? -1e-6 : 0), e.key.startsWith('Page'))));
    if (t == null) return;
    e.preventDefault();
    emit('scrub', t);
  });

  const speeds = el('div', 'globe-speeds');
  speeds.setAttribute('role', 'radiogroup');
  speeds.setAttribute('aria-label', P.speedGroup);
  const speedButtons = SPEEDS.map((s) => {
    const [num, unit] = P.speedText(s);
    const b = el('button', 'globe-speed', num);
    const x = el('span', 'globe-speed__x', unit);
    x.setAttribute('aria-hidden', 'true');
    b.append(x);
    b.setAttribute('aria-label', P.speedLabel(s));
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.title = P.speedTitle(s);
    b.addEventListener('click', () => emit('speed', s));
    speeds.append(b);
    return b;
  });
  // A radio group (WAI-ARIA pattern): one Tab stop, arrow keys move the choice.
  speeds.addEventListener('keydown', (e) => {
    const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!d) return;
    e.preventDefault();
    const i = speedButtons.indexOf(document.activeElement);
    const next = speedButtons[(Math.max(0, i) + d + SPEEDS.length) % SPEEDS.length];
    next.focus();
    next.click();
  });
  const readout = el('output', 'globe-readout');
  readout.setAttribute('aria-hidden', 'true'); // the slider's aria-valuetext says the same; no per-frame announcements
  tl.append(play, scrub, speeds, readout);

  const disclaimer = el('p', 'globe-disclaimer', DISCLAIMER);
  for (const n of P.notes) disclaimer.append(el('span', 'globe-disclaimer__note', n));
  const toast = el('p', 'globe-toast');
  toast.setAttribute('role', 'status');

  root.append(side, tl, disclaimer, toast, live);

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
    hint.textContent = `${touch ? 'Tap' : 'Click'} ${P.target} to drop ${it === 'line' ? 'fishing line' : it === 'tyre' ? 'tyre dust' : `a ${ITEM_COPY[it].short}`}.`;
  }
  setItem(current);

  let toastTimer = 0;
  function showToast(text, x, y) {
    // Re-set even when unchanged so a repeated message is announced again.
    if (toast.textContent === text) toast.textContent = '';
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
    toastTimer = setTimeout(() => { toast.classList.remove('is-on'); toastTimer = setTimeout(() => { toast.textContent = ''; }, 300); }, 1800);
  }

  let curT = 0;
  function setTime(day, { playing, speed, computedDay }) {
    curT = day;
    if (!scrubbing) range.value = String(Math.round(scale.toPos(day) * 1000));
    fill.style.width = `${scale.toPos(day) * 100}%`;
    computed.style.width = `${scale.toPos(computedDay) * 100}%`;
    const vt = day < 1 ? P.zero : P.formatAge(day);
    if (range.getAttribute('aria-valuetext') !== vt) range.setAttribute('aria-valuetext', vt);
    if (readout.textContent !== vt) readout.textContent = vt;
    const pl = playing ? 'Pause' : 'Play';
    if (play.getAttribute('aria-label') !== pl) play.setAttribute('aria-label', pl);
    play.classList.toggle('is-playing', playing);
    speedButtons.forEach((b, i) => {
      const onIt = SPEEDS[i] === speed;
      if (b.getAttribute('aria-checked') !== String(onIt)) {
        b.setAttribute('aria-checked', String(onIt));
        b.tabIndex = onIt ? 0 : -1;
      }
      b.classList.toggle('is-on', onIt);
    });
  }

  function setPanel(stats) {
    const was = !panel.hidden;
    if (!stats) { liveText = ''; panel.hidden = true; summary.hidden = true; root.classList.remove('has-panel'); setCollapsed(false); if (was) emit('panel', false); return; }
    summary.hidden = false;
    panel.hidden = false;
    root.classList.add('has-panel');
    if (!was) emit('panel', true);
    const copy = ITEM_COPY[stats.item] || { name: stats.item };
    pTitle.textContent = stats.pieces > 1 ? `${copy.name}, now ${stats.pieces} pieces` : copy.name;
    fSize.textContent = stats.sizeClasses.length ? stats.sizeClasses.map((c) => SIZE_COPY[c] || c).join('; ') : 'Gone from the surface';
    fAge.textContent = glue(P.formatAge(stats.day));
    const fd = stats.fromDropKm;
    fDist.textContent = fd ? (fd.n > 4 && fd.p90 - fd.p10 > 1 ? `${fmtKm(fd.mean)} on average (most between ${fmtKm(fd.p10)} and ${fmtKm(fd.p90)})` : `${fmtKm(fd.mean)} on average`) : 'Not known yet';
    const note = P.whyNote(stats);
    why.textContent = note || '';
    why.hidden = !note;
    let top = null;
    for (const [k, label] of FATES) if (!top || (stats.fates[k] || 0) > top[1]) top = [label, stats.fates[k] || 0];
    summaryText.textContent = `${copy.short ? copy.short[0].toUpperCase() + copy.short.slice(1) : copy.name} · ${P.formatAge(stats.day)} · ${pct(top[1])} ${top[0].toLowerCase()}`;
    for (const [k] of FATES) {
      const f = stats.fates[k] || 0;
      fateRows[k].val.textContent = pct(f);
      fateRows[k].fill.style.width = `${Math.round(f * 100)}%`;
    }
    const when = P.when(stats.fatesDay);
    const n = stats.endMembers ? fmtNum(stats.endMembers) : 'its';
    endNote.textContent = glue(`Probability across ${n} simulated copies, ${when}.`);
    announce(`${copy.name}. ${/computing/.test(when) ? 'Still computing…' : `Computed, ${when}.`}`);
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
      for (const b of [...Object.values(itemButtons), primaryBtn].filter(Boolean)) { b.disabled = !ok; b.title = ok ? '' : why; }
      if (!ok && why) hint.textContent = why;
    },
    contains: (node) => side.contains(node) || tl.contains(node),
    setCollapsed,
    get collapsed() { return root.classList.contains('is-collapsed'); },
    dispose() { clearTimeout(toastTimer); if (tickRO) tickRO.disconnect(); if (phoneQuery) phoneQuery.removeEventListener('change', placeTimeline); side.remove(); tl.remove(); disclaimer.remove(); toast.remove(); live.remove(); },
  };
}
