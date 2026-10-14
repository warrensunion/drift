# Drift

A website about where a piece of plastic goes: a scroll story down the water column, then a globe where
you drop plastic and a small model trained on real drifter-buoy tracks moves its fragments for ten years.

**Live demo: https://warrensunion.github.io/drift/**

Every fragment is a cloud of possible paths: this is a simulation with uncertainty, not a forecast.

## What it does

- **A scroll story in six chapters**: one bottle on a river bank, it breaks at the shoreline, the
  currents carry it, gyres collect it, the deep and the food chain, then "drop your own". Every
  number in the copy is cited inline and traced to `docs/science.md`, `MODEL.md` or `DATA.md`.
- **A 3D globe** (three.js `WebGPURenderer`, WebGPU when present, WebGL2 otherwise): drop a bottle,
  a bag, fishing line or tyre dust anywhere in the ocean and scrub or play a timeline from 0 to 10
  years. 16,384 streamlines show the month's currents; fragments are coloured by age, and the side
  panel traces a fragment's size, age, distance from the drop and where its copies end up (floating,
  in a gyre, on a coast, on the seafloor).
- **A Salish Sea chart** at the Fraser River mouth, on SalishSeaCast's hourly near-surface currents
  (one 25-hour window repeated, and the page says so), over 30 days.
- **About the science**: the model against plain advection, region by region, losses included.

## How it works

- **The drift model** (`MODEL.md`): an MLP (10 -> 128 -> 128 -> 4, 18,436 parameters) predicts the
  next-day displacement of a surface drifter and its 1-sigma spread from position, the monthly
  current and wind, season and a windage feature. It was trained with a Gaussian negative
  log-likelihood on 878,086 consecutive-day pairs from 4,079 NOAA Global Drifter Program drifters
  (2012 to 2014), split by drifter 80/10/10, and exported to ONNX (77 KB, opset 17).
- **Honest numbers** (held-out test drifters, `MODEL.md`): the model is a little better than plain
  advection overall, RMSE 21.05 vs 21.78 km/day, and after 10 days the median separation from the
  true position is 89.5 vs 94.9 km. The gain is largest for undrogued drifters (RMSE 22.08 vs
  23.39), the case that matters for floating plastic; there is no real gain for drogued drifters or
  in the Gulf Stream, and it is slightly worse in the Kuroshio. Its main job in Drift is a
  calibrated spread: 86 % of observed displacements fall inside the 2-sigma ellipse (ideal 86 %).
- **The simulation** runs in a Web Worker with onnxruntime-web (wasm, one thread). Each drop is its
  own simulation; each fragment is an ensemble of 24 members, and each day a floating member moves
  by the model's `mu + sigma * z`. Fragmentation, windage by size, biofouling sinking, beaching and
  resuspension follow cited rates (`docs/science.md`, `src/sim/constants.js`). Up to 20,000 members
  share one budget. Drops start at once on plain advection (labelled on screen) while the model
  loads.
- **Salish Sea mode** does not use the model (it was trained on open-ocean daily steps and knows no
  tides): RK2 advection on the hourly field plus a random walk (K = 0.6 m^2/s, an assumption) and a
  3-day grounding timescale near coasts (Pawlowicz 2019).
- **Rendering**: particles are one instanced draw whose positions come from a ring of snapshots
  interpolated on the GPU. The verification run measured a median of 72.5 fps with 19,992 members
  playing at 30x on an RTX 3060 at 1440x900 (`design-reference/shots/final/run.json`).

## Stack

JavaScript (ES modules), Vite, three.js (WebGPU / WebGL2, TSL), onnxruntime-web, Web Workers,
Python 3.12 with PyTorch for the data pipeline and training, Playwright and `node --test` for checks.

## Run it locally

Node 22 or newer.

```bash
npm install
npm run dev
```

Open the address Vite prints. `globe.html` mounts the globe on its own full screen (handy when working
on it); `?debug` exposes `window.__drift`.

```bash
npm run build
npm run preview
```

The GitHub Pages build sets `GITHUB_PAGES=1`, which serves the site under `/drift/`
(`.github/workflows/pages.yml`).

## Check it

```bash
npm test
node scripts/shoot.mjs latest
```

`npm test` covers the tile decoder, advection, fragmentation timing, fates, the simulation worker,
the Salish tracker and the ONNX-vs-Python parity (within 1e-4). `scripts/shoot.mjs` drives a real
browser through every scene at 1440x900, 1920x1080 and 390x844, drops items in three oceans and at
the Fraser mouth, scrubs to 1 and 10 years, measures fps with 20,000 particles and fails on any
console error. Shots land in `design-reference/shots/`.

## Where things are

- `docs/spec.md`, `docs/design.md`, `DECISIONS.md` - what was built and why.
- `DATA.md` - every dataset, its source, licence, fetch date and processing.
- `MODEL.md` - the model and how it compares with plain advection.
- `docs/science.md` - every cited number the simulation and the copy use.
- `art-src/PROMPTS.md` - every image prompt (art made with ChatGPT).
- `CLAUDE.md` - the working notes for the codebase.

Data pipeline and training (Python 3.12 via uv) are in `scripts/data/` and `scripts/train/`; see
`DATA.md` and `MODEL.md` for the exact commands.

## Data and credits

Full details, fetch dates and processing in `DATA.md` (the site shows the same table).

- OSCAR surface currents (NASA/JPL PO.DAAC via NOAA CoastWatch ERDDAP; Bonjean and Lagerloef 2002),
  free to use and redistribute.
- QuikSCAT SeaWinds monthly 10 m winds (Remote Sensing Systems via NOAA CoastWatch ERDDAP), free to
  use and redistribute.
- NOAA Global Drifter Program 6-hourly QC drifters (Lumpkin and Centurioni 2019,
  doi:10.25921/7ntx-z961), CC BY 4.0. Used for training only; not shipped.
- Natural Earth 1:50m land, public domain.
- SalishSeaCast near-surface currents and land mask, Apache License 2.0, (c) SalishSeaCast Project
  Contributors and The University of British Columbia.
- All illustrations were generated with ChatGPT; every prompt is in `art-src/PROMPTS.md`.
