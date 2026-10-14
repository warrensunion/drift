# Drift

Drop a piece of plastic anywhere in the ocean and watch it break into
fragments that drift on real currents. A small model trained on real
drifter-buoy tracks moves each fragment, and every fragment is a cloud of
possible paths: this is a simulation with uncertainty, not a forecast.

The page is a scroll story in six chapters (one bottle, it breaks, the
currents carry it, gyres collect it, the deep and the food chain, drop your
own), then a 3D globe, a zoomed Salish Sea chart at the Fraser River mouth,
and "About the science", with the model's honest error numbers.

## Run it

```bash
npm install
```

```bash
npm run dev
```

Open the address Vite prints. `globe.html` mounts the globe on its own
full screen (handy when working on it); `?debug` exposes `window.__drift`.

## Build

```bash
npm run build
```

```bash
npm run preview
```

## Check it

```bash
npm test
```

```bash
node scripts/shoot.mjs latest
```

`npm test` covers the tile decoder, advection, fragmentation timing, fates,
the simulation worker, the Salish tracker and the ONNX-vs-Python parity
(within 1e-4). `scripts/shoot.mjs` drives a real browser through every scene
at 1440x900, 1920x1080 and 390x844, drops items in three oceans and at the
Fraser mouth, scrubs to 1 and 10 years, measures fps with 20,000 particles
and fails on any console error. Shots land in `design-reference/shots/`.

## Where things are

- `docs/spec.md`, `docs/design.md`, `DECISIONS.md` - what was built and why.
- `DATA.md` - every dataset, its source, licence, fetch date and processing.
- `MODEL.md` - the model and how it compares with plain advection.
- `docs/science.md` - every cited number the simulation and the copy use.
- `art-src/PROMPTS.md` - every image prompt (art made with ChatGPT).
- `CLAUDE.md` - the working notes for the codebase.

Data pipeline and training (Python 3.12 via uv) are in `scripts/data/` and
`scripts/train/`; see `DATA.md` and `MODEL.md` for the exact commands.
