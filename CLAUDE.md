# Drift

A website about where a piece of plastic goes. **One look**: the page
descends through the water column - light sea glass and foam at the surface,
petrol teal in the deep - and the only artificial colour is plastic, whose
colour is its age the way real plastic weathers: fresh dye magenta
(`--fresh` #FF4D8D), photo-oxidised amber (`--oxidised` #F2B544, day 730),
sun-bleached bone (`--bleached` #F1E9D2, day 3650), mixed in OKLab. Land is
chart paper (`--foam`). Every token is in `src/styles/tokens.css`; the rules
(type scale, layout, motion numbers, copy rules) are `docs/design.md`, the
spec is `docs/spec.md`, every choice made on the way is a line in
`DECISIONS.md`. Type: **Anybody** (variable width - display wide and light,
labels 13 px sentence case, never all caps) and **Literata** (body; place
names in italic, as on nautical charts). The one memorable thing is the
chapter headlines breaking into shards and drifting apart as you scroll on
(`src/story/headline.js`); everything else stays quiet.

The craft bar is 2019.makemepulse.com - its **techniques and timings**,
measured in `design-reference/makemepulse/NOTES.md` (record and analysis
tools in `tools/`; the 568 MB of frames are gitignored, the JSON measurements
are not) - never its art, words or brand. It is a click-through site; Drift is
scroll-driven by brief, so crossing a chapter boundary fires their measured
1.75 s scene transition (`src/story/sweeps.js`: a full-frame painted
foreground - reeds, a wave, cloud, bubbles, marine snow - sweeps across, the
chapter swaps at 50 % behind it; the exact easeInOutQuart, of which their
(.77,0,.175,1) bezier is the CSS approximation, so the swap lands at full
cover). Mouse parallax per depth +2 % / 0 / -3 % / -11 % of cursor travel,
follow `k = 1 - 0.96^(dt/16.67)`; the cursor dot 18 / 75 / 11 px; the
preloader is one painted stroke filling inside a mask over a 20 % copy of
itself, driven by the real bytes of chapter 1's art and the fonts
(`src/story/assets.js` reads `public/art/manifest.json`), no percentage; a
40 px chrome margin (20 under 600 px); paper grain multiplied over everything.
`prefers-reduced-motion`: no parallax, sweeps, follow or breaking headlines -
every move a 400 ms cross-fade. Contrast is measured on the screenshots, not
assumed: `scripts/dev/aa.mjs` (5th-percentile pixel behind each text box,
4.5:1 body, 3:1 large) and the local soft scrims behind `.copy`, `.hl` and the
chrome.

**The page** (`index.html`, `src/main.js`): the preloader, then six chapters
on one sticky stage driven by native scroll and one rAF controller
(`src/story/scroll.js`; `progressFor(scrollY, starts)` is pure and tested):
one bottle (a river bank) -> it breaks (set at the **shoreline** - the
evidence says PET bottles stay whole at sea for ~15 years, so the copy says
the timing is uncertain) -> the currents carry it -> gyres collect it -> the
deep and the food chain -> drop your own. Every chapter is 5+ layers of the
ChatGPT art plus DOM particles of fragment pieces. Every number in the copy is
cited inline to `src/story/sources.js` (in order of first appearance) and
traced to `docs/science.md`, `MODEL.md` or `DATA.md` - never invent one. All
six chapters' copy stays in the accessibility tree (only inactive art is
hidden); there is one persistent h1. Then the **globe section**
(`src/story/globe-section.js`): near the viewport it `import()`s
`src/globe/index.js` - three.js and onnxruntime-web are never in the entry
chunk - with a Global / Salish Sea switch (`MODES`). Then **About the
science** (`src/about.js`), which renders `public/model/drift.meta.json` (the
model against plain advection, region by region, losses included) and
`public/data/credits.json`.

**The globe** (`src/globe/`, `globe.html` is a full-screen dev harness that
mounts it with `embedded:false`): three.js `WebGPURenderer` + TSL - WebGPU
when present, its WebGL2 backend otherwise (`console.info('[drift] renderer:
webgpu|webgl2')`); neither -> `public/art/globe-fallback.webp` and
`[drift] static fallback: <reason>` (`?gl=none` forces it). Ocean and
chart-paper land from `public/data/landmask.png`; 16,384 streamline seeds
advected on the month's current field by TSL compute; particles are one
instanced draw whose positions come from a shared ring `DataArrayTexture` of
snapshots, interpolated on the GPU, with 12-snapshot trails coloured by age;
uploads are budgeted per frame (`particles.js`). `tracks.js` gives members
stable identities across the worker's compactions and traces a fragment's
lineage for the panel (size class, age, mean distance, where it ends up as %
of `endMembers`). Embedded in the page it never traps scroll: `touch-action:
pan-y` (vertical swipes scroll, horizontal drags rotate, pinch zooms, a tap -
< 8 px and < 300 ms, `pick.js isTap` - drops), the wheel zooms only with
Ctrl/Meta or while the globe has focus, keys are scoped to its root. A tap on
land says "Drop it in the water". "Simulation with uncertainty, not a
forecast." is always on screen. Timeline 0 -> 10 years at 1x / 30x / 365x
(1x = a simulated day per second). `window.__drift` exists only in dev or
with `?debug`.

**The simulation** (`src/sim/`, pure modules shared by the worker and the
tests). `worker.js` runs it off the main thread: **each drop is its own
simulation from its own day 0**, stepped round-robin newest first, one day
per drop per turn, yielding every ~16 ms; drops and clears that arrive mid-
step are queued; the 20,000-member budget is shared and retires the oldest
drop (`retired` / `done` messages). Each fragment is an ensemble of 24
members; each day a floating member moves by the model's `mu + sigma * z`
(km east/north, `ensemble.js`). The model: `public/model/drift.onnx` (an MLP
10 -> 128 -> 128 -> 4 predicting next-day displacement mean and log-sigma of
GDP drifters from position, the monthly current and wind, season and a 0..1
windage feature; normalisation baked in) run by onnxruntime-web (wasm, one
thread). If it fails to load, plain RK2 advection with an on-screen label.
`fragment.js` / `fate.js` hold the cited rules - fragmentation onsets and
half-lives per item (bottle, bag, fishing line, tyre wear particles), windage
by size, biofouling sinking (whole floating items ~33 years, Lebreton 2019;
small pieces 30-66 days; 3x slower inside the five gyre boxes), beaching
0.095 per contact day and resuspension 0.0144 per day (Onink 2021), a beached
bottle's fragmentation clock running 21.5x faster (255 d vs 5475 d onset) -
all from `src/sim/constants.js`, a faithful copy of the JSON block at the
bottom of `docs/science.md` (plus `childrenPerSplit: 4`, an assumption). Edit
the doc and the copy together; the tests derive their expectations from it.
Snapshots: daily to day 60, every 3 days to a year, every 15 to ten years
(`snapshots.js`, Int16 lon*90 / lat*180).

**Salish Sea mode** (`src/sim/salish.js`, `src/globe/salish.js`): a flat
chart of 48.2-49.9 N, 125.2-122.7 W (Juan de Fuca to Comox, read from the
tile header) on SalishSeaCast's hourly near-surface currents - one 25-hour
window repeated, and the note on screen says so. The drift model is not used
here (it knows no tides): RK2 on the hourly field plus a random walk with
K = 0.6 m^2/s (Okubo, an assumption) and a 3-day grounding timescale in
coastal cells (Pawlowicz 2019); 64 members per drop, 1x = an hour per second,
0 -> 30 days; fates "On a beach", "Left the strait", "Still floating". Place
names are checked against `public/data/salish/land.png`.

**Data** (`scripts/data/`, Python from uv: `scripts/train/.venv/Scripts/
python.exe`; raw downloads cached in `scripts/data/cache/`, gitignored): every
dataset is a row in `DATA.md` - name, source, licence, date fetched,
processing - and `scripts/data/make_credits.py` generates
`public/data/credits.json` from that table, which the site shows. OSCAR
currents (CoastWatch ERDDAP `jplOscar`) -> 12 monthly 1° `DRFT` tiles
`public/data/currents/clim-MM.bin`; QuikSCAT winds (`erdQSwindmday`; ICOADS
is gone from the server) -> one 12-frame 2° tile with coastal/ice gaps filled
from the nearest cells; GDP drifters (AOML ERDDAP, CC-BY 4.0) -> training
pairs; Natural Earth land -> `landmask.png`; SalishSeaCast (UBC ERDDAP,
Apache-2.0) -> `public/data/salish/tide.bin` + `land.png`. The `DRFT` tile
format is in `docs/spec.md`; `src/sim/field.js` and `scripts/data/common.py`
sample it with the same rule (bilinear, lon wraps on global grids, any land
corner -> no value), checked against each other by the parity fixture.

**The model** (`scripts/train/`): `train.py` (split by drifter 80/10/10,
seed 20261013; Gaussian NLL; early stopping on validation only),
`evaluate.py` (held-out drifters, model vs advection overall, by region, by
drogue, sigma calibration, 10-day separation) and `export.py` (ONNX opset 17 +
`tests/fixtures/onnx-ref.json`). `MODEL.md` is the honest write-up: the model
is a little better than advection overall (RMSE 21.05 vs 21.78 km/day,
10-day median separation 89.5 vs 94.9 km), best near coasts and for
undrogued drifters, no better for drogued ones or in the Gulf Stream, slightly
worse in the Kuroshio. Keep it honest when anything changes.

**Art** (`art-src/`): every image was made by ChatGPT (Warren's Plus account)
through the codex CLI's image tool - `bash art-src/tools/gen.sh [n]
[regex]` makes whatever in `art-src/jobs.tsv` is missing from `art-src/gen/`,
each prompt prefixed with `art-src/header.txt` (the fixed art direction);
every prompt is in `art-src/PROMPTS.md`. `node art-src/tools/build-art.mjs
[--only regex]` rebuilds `public/art/` from the sources: plates as WebP
(1536 + 1280), cut-outs through `cutout.mjs` (copied from BTTRURSLF-v2: trims,
erodes and decontaminates the model's glow halo), fragment sheets split by
`sheet-boxes.mjs` into `public/art/frag/<kind>-<n>.webp` and atlases, design
comps to `design-reference/comps/`, contact sheets to
`design-reference/art-check/`, and `manifest.json` (sizes and bytes, read by
the preloader).

**Checks.** `npm test` (`node --test "tests/**/*.test.mjs"`): the tile
decoder and sampler, RK2 advection, fragmentation timing, fates, the ensemble
and worker (with a fake model and a real async race), snapshots, features
and sampler parity with Python (1e-6), ONNX in onnxruntime-web vs PyTorch
(1e-4), scroll mapping, picking, tracks, Salish tracking. `node
scripts/shoot.mjs [tag] [sizes]` shoots every scene and state at 1440x900,
1920x1080 and 390x844 (preloader, six chapters mid-scroll and mid-transition,
About, reduced motion, the static fallback, drops in three oceans and at the
Fraser mouth scrubbed to 1 and 10 years), measures fps with ~20,000 members,
checks no horizontal scroll and that the entry chunk has no three.js, and
fails on any console error or 404; shots go to `design-reference/shots/<tag>/`,
side-by-sides with the comps and makemepulse to `design-reference/compare/`.
`npm run build` must be clean. The dev server is slow on this machine; the
checks build and `vite preview` instead.

BTTRURSLF-v2 (`../BTTRURSLF-v2`) is **read-only reference** - copy tools from
it, never edit it. Work happens on `build/drift`; `main` gets it only when
everything above passes.
