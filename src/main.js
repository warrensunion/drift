// Boot: preloader -> intro disc -> the scroll story; the globe chunk loads only near its section.
import './styles/tokens.css';
import './styles/base.css';
import './styles/story.css';

import { runPreloader } from './story/preloader.js';
import { CHAPTERS, buildScene, chapterFiles } from './story/scenes.js';
import { createSweep } from './story/sweeps.js';
import { createStory } from './story/scroll.js';
import { createCursor } from './story/cursor.js';
import { initGlobeSection } from './story/globe-section.js';
import { cite } from './story/sources.js';
import { artUrl } from './story/assets.js';
import { initAbout } from './about.js';

const html = document.documentElement;
const reducedQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
const reduced = reducedQuery.matches;
const phone = window.matchMedia('(max-width: 700px)').matches;
if (reduced) html.classList.add('is-reduced');
html.style.setProperty('--paper', `url("${artUrl('ui-paper.webp')}")`);
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
// Verification hooks (window.__drift, window.__driftHold) only in dev or with ?debug.
const debug = !!(import.meta.env && import.meta.env.DEV) || new URLSearchParams(location.search).has('debug');

// Inline citations written in the HTML as <span data-cite="Key,Key">.
document.querySelectorAll('[data-cite]').forEach((el) => { el.outerHTML = cite(...el.dataset.cite.split(',')); });

// ---- the story ----
const stage = document.getElementById('stage');
const storyEl = document.getElementById('story');
const scenes = CHAPTERS.map((ch, i) => buildScene(ch, i, { reduced, phone }));
scenes.forEach((s) => stage.append(s.el));
const sweeps = CHAPTERS.map((ch) => (ch.sweep ? createSweep(ch.sweep) : null));
sweeps.forEach((s) => s && stage.append(s.el));

// ---- chapter indicator ----
const nav = document.querySelector('.chapters');
const list = nav.querySelector('.chapters__list');
const navTitle = nav.querySelector('.chapters__title');
const navButtons = CHAPTERS.map((ch, i) => {
  const li = document.createElement('li');
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'chapters__btn';
  b.setAttribute('aria-label', `Chapter ${i + 1}: ${ch.title}`);
  b.innerHTML = `<span class="chapters__n">${i + 1}</span><i class="chapters__bar"><i></i></i>`;
  b.addEventListener('click', () => {
    const edges = story.edges;
    window.scrollTo({ top: edges[i] + 2, behavior: reduced ? 'auto' : 'smooth' });
  });
  li.append(b);
  list.append(li);
  return b;
});
let shownScene = -1;
function setScene(i) {
  if (i === shownScene) return;
  shownScene = i;
  navButtons.forEach((b, k) => {
    b.classList.toggle('is-current', k === i);
    if (k === i) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current');
  });
  navTitle.textContent = CHAPTERS[i].title;
}

const story = createStory({
  root: storyEl,
  stage,
  scenes,
  sweeps,
  reduced,
  chapterVh: phone ? 1.8 : 2,
  debug,
  onScene: setScene,
  onFrame: ({ shown, scrollScene, t }) => {
    const bar = navButtons[shown] && navButtons[shown].querySelector('.chapters__bar > i');
    if (bar) bar.style.transform = `scaleX(${scrollScene === shown ? t.toFixed(3) : scrollScene > shown ? 1 : 0})`;
  },
});

// Chrome: hide the chapter indicator and quiet the header once the story is behind us.
const storyIO = new IntersectionObserver(([e]) => html.classList.toggle('past-story', !e.isIntersecting), { threshold: 0 });
storyIO.observe(storyEl);
const globeEl = document.getElementById('globe');
const globeIO = new IntersectionObserver(([e]) => html.classList.toggle('in-globe', e.isIntersecting && e.intersectionRatio > 0.5), { threshold: [0, 0.5, 0.75] });
globeIO.observe(globeEl);

// The drop button scrolls into the globe (native smooth scroll; the anchor works without JS too).
document.addEventListener('click', (e) => {
  const a = e.target.closest && e.target.closest('a.cta');
  if (!a) return;
  e.preventDefault();
  globeEl.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' });
});

// Every chapter's copy stays in the reading order for assistive tech. When keyboard focus lands
// in a chapter that is not on screen (a citation, the drop button), scroll that chapter into view.
scenes.forEach((s, i) => s.copy.addEventListener('focusin', () => {
  const e = story.edges;
  const p = window.scrollY;
  if (p < e[i] || p >= e[i + 1]) window.scrollTo({ top: e[i] + (e[i + 1] - e[i]) * 0.5, behavior: 'auto' });
}));

createCursor({ reduced });
initGlobeSection(globeEl);
initAbout(document.getElementById('about'));

// ---- preloader: real progress over chapter 1's art and the fonts ----
const first = [...new Set([...chapterFiles(CHAPTERS[0]), 'ui-paper.webp'])];
runPreloader({
  files: first,
  reduced,
  onReveal: () => {
    scenes[0].ensureLoaded();
    html.classList.add('is-ready');
  },
  onBegin: () => {
    html.classList.add('is-started');
    // The begin button is about to disappear: hand focus to the first chapter's heading.
    const pre = document.getElementById('preloader');
    if (pre && pre.contains(document.activeElement)) scenes[0].el.querySelector('.hl').focus({ preventScroll: true });
    story.start();
    // Warm the next chapter and its sweep while the visitor reads.
    const idle = window.requestIdleCallback || ((f) => setTimeout(f, 300));
    idle(() => { scenes[1].ensureLoaded(); sweeps[0] && sweeps[0].load(); });
  },
}).catch((err) => {
  console.error('[drift] preloader failed', err);
  document.getElementById('preloader')?.remove();
  html.classList.remove('is-loading');
  story.start();
});

// Debug/verification hook (used by scripts/dev/shoot-story.mjs with ?debug).
if (debug) window.__drift = { story, scenes, CHAPTERS };
