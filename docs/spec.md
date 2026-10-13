# Drift — design spec

2026-10-13. Written through superpowers:brainstorming. Warren asked for a fully
autonomous build, so every brainstorming question below was answered with the
recommended option instead of asked; each answer is also a line in
`DECISIONS.md`.

## Intent (what was asked, and the assumptions)

**Said:** a website, "Drift": a scroll story about one plastic bottle becoming
fragments, then a 3D ocean globe where you drop an item anywhere, watch it
fragment over simulated time, and watch the fragments drift on real currents,
moved by a small model trained on real drifter-buoy tracks, shown as
uncertainty clouds — never one confident line. A zoomed Salish Sea mode at the
Fraser River mouth. An "About the science" scene with honest numbers. The craft
bar is 2019.makemepulse.com's level (techniques and timings measured, art and
words original). Art from ChatGPT Plus in the browser. Real, cited data only.

**Assumed (my answers to the brainstorming questions):**

| Question | Answer | Why |
|---|---|---|
| Who is it for? | A curious general visitor on desktop or phone; a portfolio-grade piece | The makemepulse bar and the scroll story say "experience", not "tool" |
| What is success? | The story reads in ~2 min, the globe feels alive within 3 s of reaching it, a drop gives a believable, visibly uncertain 10-year picture, every number on the page is traceable to DATA.md / MODEL.md | Matches the brief's verify list |
| Forecast or simulation? | Simulation with uncertainty, labelled so on every screen that shows tracks | Brief rule; a climatology-driven model is not a forecast |
| Current data | OSCAR 1/3° (CoastWatch ERDDAP `jplOscar`, 2011-12..2014-09) averaged into a 12-month climatology on a 1° grid | No account; the brief's first choice; 1° is enough for a globe and keeps 12 months at ~1.4 MB |
| Wind | ICOADS 2° monthly long-term mean 1971–2000 (`esrlIcoads2gec71_LonPM180`, uwnd/vwnd) | No key, monthly, global, same server |
| Drifters | GDP 6-hour interpolated QC (`drifter_6hour_qc`, AOML ERDDAP), 2012-01..2014-09 to overlap OSCAR, one fix per drifter per day | CC-BY 4.0; overlapping years keep the residual honest |
| Windage input | A 0..1 "windage" feature: 0 = drogued drifter (drogue at 15 m), 1 = drogue lost (rides at the surface, catches wind). Fragments map their own windage onto it | The only real signal in the drifter record that behaves like a floating object's windage; documented as a proxy |
| Model | PyTorch MLP, 10 inputs -> mean and log-sigma of next-day east/north displacement (km), Gaussian NLL, split by drifter ID | Small, exports to ONNX cleanly, the sigma gives the ensemble spread directly |
| Baseline | Plain advection: climatological current x 1 day (RK2 on the same field) | The brief's comparison; the same field the model sees |
| Salish Sea data | SalishSeaCast (UBC ERDDAP, no login) hourly near-surface currents regridded to a regular lat/lon grid over the Strait of Georgia, a 25-hour tidal loop | Real, regional, tidal; the brief's preferred case |
| Renderer | three.js `WebGPURenderer` + TSL: WebGPU (compute for the current streamlines) when present, its WebGL2 backend otherwise; a static fallback image when neither | One code path for both; the fallback logs why |
| Simulation home | A Web Worker: onnxruntime-web (wasm) steps every ensemble member one day at a time and streams snapshots | Keeps the main thread at 60 fps |
| Story renderer | DOM + CSS transforms (layered PNG/WebP art), one rAF scroll controller with lerp | Fast first paint; three.js only loads at the globe |
| Framework | None (Vite + vanilla ES modules) | Brief rule |

## Architecture

```
index.html                    preloader markup + story shell (paints with no JS-heavy deps)
src/main.js                   boot: preloader -> story; lazy-imports the globe at chapter 6
src/story/                    scroll controller, scene layers, cursor follow, reduced-motion cross-fades
src/globe/                    three.js renderer (lazy chunk): globe, streamlines, particles, picking, UI
src/sim/                      pure, tested modules shared by worker and tests
  field.js                    tile decoder + bilinear sampling (wrap in lon, NaN = land)
  advect.js                   RK2 advection on a field (baseline + streamlines)
  fragment.js                 fragmentation schedule per item type (cited timescales)
  features.js                 model input vector (identical to scripts/train/features.py)
  fate.js                     gyre / coastline / seafloor classification
  worker.js                   onnxruntime-web ensemble stepping, snapshot stream
src/salish/                   Salish Sea mode (same renderer, a flat map projection)
public/data/                  currents/clim-01..12.bin, wind/clim.bin, salish/*.bin, landmask.png, credits.json
public/model/drift.onnx       the model; drift.meta.json (feature order, version, errors)
scripts/data/                 Python fetch + preprocess (uv venv in scripts/train/.venv)
scripts/train/                training, evaluation, ONNX export, reference I/O for the parity test
scripts/shoot.mjs             Playwright: every scene x 3 sizes, drops, scrubs, fps, console errors
tests/*.test.mjs              node --test
```

### Binary formats (the contract between pipeline, worker and tests)

`*.bin` field tile, little-endian:

| bytes | field |
|---|---|
| 0..3 | magic `DRFT` |
| 4..5 | uint16 version = 1 |
| 6..7 | uint16 nx |
| 8..9 | uint16 ny |
| 10..11 | uint16 nframes (12 for monthly, 25 for the tidal loop) |
| 12..27 | float32 lon0, lat0, dlon, dlat (cell centres, lat0 = southmost row) |
| 28..31 | float32 scale (m/s per int16 unit) |
| 32.. | int16 [frame][y][x][2] (u east, v north); -32768 = land / no data |

### Model I/O

Input `x` float32 [N, 10], in order: `lat/90, sin(lon), cos(lon), u_cur, v_cur
(m/s), u_wind/10, v_wind/10 (m/s), sin(2pi doy/365.25), cos(2pi doy/365.25),
windage (0..1)`. Outputs `mu` [N,2] and `log_sigma` [N,2]: next-day east and
north displacement, km. Normalisation is baked into the graph.

## The experience

1. **Preloader** — a drop of plastic on dark water, a count to 100 % tied to
   real asset progress; timings copied from makemepulse's measured preloader.
2. **Story, six chapters**, each a deep stack of parallax layers (sky, far
   water, surface, under-surface, mid-water life, foreground debris), scroll
   mapped per measured makemepulse numbers:
   1. *One bottle* — a bottle tipping off a river bank into the current.
   2. *It breaks* — sun, salt and waves; bottle -> shards -> fragments.
   3. *The currents carry it* — the open ocean, streamlines drawn over art.
   4. *Gyres collect it* — a slow-spinning accumulation zone.
   5. *The deep and the food chain* — fouled fragments sink; silhouettes of life.
   6. *Drop your own* — hands off to the globe.
3. **The globe** — stylised shaded ocean, animated streamlines, click/tap to
   drop a bottle / bag / fishing line / tyre-wear particles. Timeline 0 d..10 y
   at 1x / 30x / 365x (1x = 1 simulated day per second). Trails glow and are
   coloured by fragment age. A side panel for the selected fragment: size class,
   age, distance travelled, likely end (gyre / coastline / seafloor %).
   "Simulation with uncertainty — not a forecast" is always visible.
4. **Salish Sea** — a flat, detailed map of the Fraser mouth, Richmond and the
   Strait of Georgia, on SalishSeaCast's tidal currents.
5. **About the science** — data, model, limits; the MODEL.md numbers.
6. Credits from `public/data/credits.json` (generated from DATA.md's table).

## Simulation rules

- Each dropped item spawns `E` ensemble members per fragment (default 24) so a
  fragment is a cloud. Each day each member moves by `mu + sigma * z`
  (z ~ N(0,1), its own stream) plus a fraction of the grid-scale random walk
  the model's sigma already contains — nothing else is invented.
- Fragmentation follows `fragment.js`: per item type, a cited onset and rate
  (DATA.md "Fragmentation"), children inherit the parent's member positions.
  Windage falls with size (films/bags keep high windage).
- A member beaches when its next position is land in the 1° mask (with a
  probability per contact, cited), sinks by a size-dependent daily
  biofouling probability (cited), else floats. Gyre = inside one of five
  subtropical accumulation boxes (cited).
- Snapshots: daily to day 60, every 3 days to 1 y, every 15 days to 10 y.
- Budget: <= 20,000 members total; the oldest drop is retired past that.

## Error handling

- No WebGPU -> WebGL2 backend (logged). No WebGL2 -> static globe image +
  `console.info('[drift] static fallback: <reason>')` + a note on screen.
- The model fails to load -> plain advection with an on-screen "model
  unavailable, showing plain advection" label (logged).
- A data tile fails -> the globe shows the stylised ocean only and the drop
  button explains why.

## Testing

- `node --test`: tile decoder, field sampling, RK2 advection (solid-body
  rotation closes its circle), fragmentation timing per item, fate rules,
  feature vector, ONNX-vs-Python parity <= 1e-4.
- Python: held-out evaluation writes `MODEL.md` numbers.
- `scripts/shoot.mjs`: every scene/state at 1440x900, 1920x1080, 390x844;
  drops in three oceans + the Fraser mouth; scrub to 1 y and 10 y; fps with
  20,000 members; fails on any console error.
- `npm run build` clean.

## Out of scope (YAGNI)

Accounts, sharing links, live (non-climatological) data, 3D depth simulation,
sound.
