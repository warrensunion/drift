// "About the science": renders the model's held-out numbers from public/model/drift.meta.json,
// the source list (docs/science.md citations used in the copy) and the credits
// (public/data/credits.json). If the model file is missing it says so; it never invents numbers.

import { SOURCES } from './story/sources.js';

const BASE = (import.meta.env && import.meta.env.BASE_URL) || '/';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
// Numbers in the reader's locale; &nbsp; keeps a number with its unit.
const km = (x) => (Number.isFinite(x) ? x.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '–');
const pct = (x) => (Number.isFinite(x) ? `${Math.round(x * 100)}&nbsp;%` : '–');
const int = (x) => (Number.isFinite(x) ? x.toLocaleString() : '–');

async function getJson(path) {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** Regions where plain advection matches or beats the model on some measure. */
const loses = (r) => r.medianModel >= r.medianAdvection || r.model >= r.advection || r.modelCloserFraction < 0.5;
export function losses(meta) {
  return (meta.regions || []).filter(loses);
}

export function renderModel(meta) {
  const overall = {
    name: 'All test drifters',
    drifters: meta.split && meta.split.drifters && meta.split.drifters.test,
    model: meta.rmse && meta.rmse.model,
    advection: meta.rmse && meta.rmse.advection,
    medianModel: meta.medianError && meta.medianError.model,
    medianAdvection: meta.medianError && meta.medianError.advection,
  };
  const closer = (r) => (Number.isFinite(r.modelCloserFraction) ? pct(r.modelCloserFraction) : '–');
  const row = (r, cls = '') => {
    const lose = loses(r);
    return `<tr class="${cls}${lose ? ' is-loss' : ''}">
      <th scope="row">${esc(r.name)}${lose ? '<span class="loss-tag">advection as good or better</span>' : ''}</th>
      <td>${int(r.drifters)}</td>
      <td>${km(r.medianModel)}</td>
      <td>${km(r.medianAdvection)}</td>
      <td>${closer(r)}</td>
    </tr>`;
  };
  const lost = losses(meta);
  const lostNames = lost.map((r) => r.name);
  const ten = meta.tenDay || {};
  const cal = meta.calibration || {};
  const sp = meta.split || {};
  const gain = overall.medianAdvection ? (1 - overall.medianModel / overall.medianAdvection) : NaN;

  return `
    <p>The model was tested on ${int(sp.drifters && sp.drifters.test)} drifters it never saw while training
      (${int(sp.pairs && sp.pairs.test)} day-to-day moves), split by drifter so no track leaks between sets.
      Across all of them its typical one-day miss was <strong>${km(overall.medianModel)}&nbsp;km</strong>, against
      ${km(overall.medianAdvection)}&nbsp;km for plain advection (moving with the current alone). That is a small gain,
      about ${Number.isFinite(gain) ? Math.round(gain * 100) : '–'}&nbsp;%, and we report it as small.</p>
    <p>After ten days, starting from real positions, the median distance from the true track was
      ${km(ten.model)}&nbsp;km for the model, ${km(ten.advection)}&nbsp;km for advection and ${km(ten.stationary)}&nbsp;km for
      simply staying put. Its uncertainty is roughly honest: ${pct(cal.within2sigma)} of real moves fell inside its
      two-sigma spread, where ${pct(cal.ideal2sigma)} would be perfect.</p>
    ${lostNames.length ? `<p>Where it does not win: ${esc(lostNames.join('; '))}. In these, plain advection matched or beat the model on at least one measure (typical miss, average miss, or how often it was closer).</p>` : ''}
    <div class="table-wrap" role="region" aria-label="Model against advection by region" tabindex="0">
      <table class="numbers">
        <caption>One-day error on held-out drifters, median km per day. Lower is better.</caption>
        <thead><tr><th scope="col">Region</th><th scope="col">Drifters</th><th scope="col">Model</th><th scope="col">Advection</th><th scope="col">Model closer</th></tr></thead>
        <tbody>
          ${row({ ...overall, modelCloserFraction: NaN }, 'is-total')}
          ${(meta.regions || []).map((r) => row(r)).join('')}
        </tbody>
      </table>
    </div>
    <p class="fine">“Model closer” is the share of moves where the model’s best guess landed nearer the truth than advection’s. Regions overlap. Model version ${esc(meta.version || 'unknown')}.</p>`;
}

function renderSources() {
  return SOURCES.map((s, i) => `<li id="src-${i + 1}"><span class="src-n">${i + 1}</span> ${esc(s.ref)}${s.url ? ` <a href="${esc(s.url)}" rel="noopener" target="_blank">${esc(s.url.replace('https://', ''))}</a>` : ''}</li>`).join('');
}

function renderCredits(credits) {
  const data = (credits || []).map((c) => `<li><a href="${esc(c.url)}" rel="noopener" target="_blank">${esc(c.name)}</a>. ${esc(c.licence)}.</li>`).join('');
  return `${data}
    <li>Typefaces: Anybody and Literata, from Google Fonts (SIL Open Font License).</li>
    <li>Art generated with ChatGPT; motion techniques studied from 2019.makemepulse.com.</li>`;
}

export async function initAbout(root) {
  const model = root.querySelector('[data-about="model"]');
  const sources = root.querySelector('[data-about="sources"]');
  const credits = root.querySelector('[data-about="credits"]');
  if (sources) sources.innerHTML = renderSources();
  const [meta, cred] = await Promise.allSettled([getJson('model/drift.meta.json'), getJson('data/credits.json')]);
  if (model) {
    if (meta.status === 'fulfilled' && meta.value && meta.value.rmse) model.innerHTML = renderModel(meta.value);
    // A failed fetch is not the same as numbers still being computed (meta present, no rmse yet).
    else if (meta.status === 'rejected') model.innerHTML = '<p class="pending">Model numbers could not be loaded.</p>';
    else model.innerHTML = '<p class="pending">Model numbers are being computed.</p>';
  }
  if (credits) credits.innerHTML = renderCredits(cred.status === 'fulfilled' ? cred.value : []);
}
