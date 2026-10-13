# Model

Drift moves each floating fragment one day at a time with a small neural
network that predicts the next-day displacement of a surface drifter, with
uncertainty. This page says what it is, what it was trained on, and how well it
does against the obvious alternative: plain advection by the current field.
Numbers come from `scripts/train/evaluate.py` (`scripts/train/out/eval.json`) and
are mirrored in `public/model/drift.meta.json`, which the About scene renders.

## What it is

- **Input** (10 features, `src/sim/features.js` = `scripts/train/features.py`):
  `lat/90, sin(lon), cos(lon), u_cur, v_cur (m/s), u_wind/10, v_wind/10 (m/s),
  sin(2pi doy/365.25), cos(2pi doy/365.25), windage (0..1)`.
  Current is the monthly OSCAR climatology at the start point, wind is the
  monthly QuikSCAT climatology, windage is 0 for a drogued drifter and 1 for an
  undrogued one (the browser maps physical windage 0.1 %..1 % onto 0..1).
- **Output**: `mu` (east, north km over the next day) and `log_sigma` (log of
  the 1-sigma spread, km, east and north independently).
- **Network**: MLP 10 -> 128 -> 128 -> 4, SiLU, 18,436 parameters; Gaussian
  negative log-likelihood; Adam (lr 2e-3, halved on plateau), batch 2048.
  Train-set input and target standardisation is baked into the graph, so the
  ONNX file (`public/model/drift.onnx`, 77 KB, opset 17) takes raw features
  and returns raw km.
- **Data**: NOAA Global Drifter Program 6-hourly QC drifters, 2012-01-01 to
  2014-09-25, one fix per drifter-day, 878,086 consecutive-day pairs from 4,079
  drifters (see DATA.md).
- **Split**: by drifter, 80/10/10 with a fixed seed (20261013): 3,263 / 408 /
  408 drifters, 700,519 / 88,773 / 88,794 pairs. No drifter appears in two sets,
  so test scores are on tracks the model never saw.
- **Training**: early stopping on validation NLL (patience 8); best epoch 31 of
  35. Validation NLL (per pair, km units, log 2pi dropped) went 6.276 (epoch 1)
  -> 6.204 (10) -> 6.189 (20) -> 6.185 (31, best); training NLL ended at 6.151,
  so the train/validation gap is small.

## Baseline

"Advection" is what the browser does without the model: move by the sampled
current for 86,400 s. Here it is one Euler step (`current x 86.4` km); the
browser's fallback uses RK2, which differs only where the current changes
within a day's travel. Advection has no wind and no windage term.

## One-day error on held-out test drifters

Error = length of the vector between predicted and observed next-day
displacement, km/day. "Model closer" is the share of pairs where the model's
mean lands nearer the truth than advection. "In 1/2 sigma" is the share of
observed displacements inside the model's 1-sigma / 2-sigma ellipse (ideal for
a 2-D Gaussian: 39 % / 86 %). Regions overlap; boxes: the five gyre boxes from
`src/sim/constants.js`, Gulf Stream 30-45N 80-50W, Kuroshio 25-40N 120-160E,
Agulhas 45-25S 10-40E; "near coast" = start within about 2 degrees (two 1-degree
cells) of a land cell of that month's current tile.

| Region | test drifters | test pairs | RMSE model | RMSE advection | median model | median advection | model closer | in 1 sigma | in 2 sigma |
|---|---|---|---|---|---|---|---|---|---|
| **All test pairs** | 408 | 88794 | 21.05 | 21.78 | 13.34 | 13.90 | 54% | 45% | 86% |
| North Pacific gyre | 6 | 642 | 14.66 | 14.95 | 12.21 | 12.43 | 57% | 47% | 92% |
| South Pacific gyre | 7 | 1484 | 16.01 | 17.00 | 12.37 | 14.11 | 56% | 40% | 89% |
| North Atlantic gyre | 43 | 8064 | 19.27 | 19.56 | 11.24 | 11.46 | 53% | 45% | 86% |
| South Atlantic gyre | 6 | 1207 | 14.39 | 14.64 | 10.39 | 10.49 | 51% | 49% | 89% |
| Indian Ocean gyre | 7 | 838 | 22.31 | 23.31 | 17.85 | 19.20 | 55% | 41% | 86% |
| Equatorial band 10S-10N | 100 | 10870 | 24.07 | 25.11 | 15.69 | 16.74 | 56% | 44% | 87% |
| Gulf Stream | 29 | 3658 | 30.88 | 31.24 | 18.05 | 18.05 | 51% | 51% | 87% |
| Kuroshio | 12 | 816 | 30.57 | 30.64 | 22.32 | 22.02 | 48% | 41% | 84% |
| Agulhas | 10 | 1298 | 35.35 | 36.02 | 24.08 | 24.86 | 52% | 45% | 85% |
| Southern Ocean (south of 45S) | 55 | 9832 | 23.52 | 24.79 | 16.69 | 17.51 | 54% | 47% | 86% |
| Near coast (within ~2 deg of land) | 139 | 4926 | 23.91 | 25.92 | 14.04 | 14.70 | 56% | 51% | 87% |
| Drogued (windage 0) | 333 | 51361 | 20.27 | 20.52 | 11.93 | 11.92 | 51% | 46% | 86% |
| Undrogued (windage 1) | 208 | 37433 | 22.08 | 23.39 | 15.40 | 16.76 | 59% | 44% | 87% |

For scale: the observed daily displacement itself has an RMS of 24.6 km/day.

## Ten days

Starting from the true position, both methods were iterated for 10 days along
8,670 non-overlapping 10-day windows of consecutive daily fixes (399 test
drifters), re-sampling current and wind at each predicted position and using
the drifter's known drogue state each day. Distance from the true day-10
position:

| Method | median km | mean km |
|---|---|---|
| Model mean | 89.5 | 109.4 |
| Advection | 94.9 | 116.6 |
| Staying put | 114.4 | 140.1 |

The model ends closer than advection in 55 % of windows.

## Where it wins, where it does not

- **The gain is small.** Overall RMSE improves 3 % (21.05 vs 21.78 km/day),
  median 4 %; after 10 days the median separation is 6 % smaller (89.5 vs
  94.9 km). Both are far from the truth: most daily motion of a drifter is
  eddies, inertial oscillations and weather that a monthly climatology cannot
  know. The model's job in Drift is mostly to supply a *calibrated spread*, not
  a sharper mean.
- **Wins most for undrogued drifters** (RMSE 22.08 vs 23.39, median 15.40 vs
  16.76, model closer 59 %): the model learns the wind-driven slip that plain
  advection ignores. That is exactly the case that matters for floating
  plastic. It also helps near coasts (23.91 vs 25.92), in the equatorial band,
  the Southern Ocean and the South Pacific and Indian Ocean gyres.
- **No real gain for drogued drifters** (median 11.93 vs 11.92, closer in 51 %):
  a drogued drifter follows the current, which advection already does.
- **Boundary currents are a draw.** Gulf Stream median is identical (18.05),
  Kuroshio is slightly *worse* than advection by median (22.32 vs 22.02, model
  closer in only 48 %), Agulhas marginally better. The 1-degree climatology
  smears these narrow, meandering jets; the model cannot recover what the
  input does not hold, and errors there are the largest anywhere (30-35 km/day).
- **Small samples.** The North Pacific, South Pacific, South Atlantic and Indian
  Ocean gyre rows rest on 6-7 test drifters each; treat their differences as
  noise-level.
- **Calibration.** 86 % of observed displacements fall inside the 2-sigma
  ellipse (ideal 86 %), but 45 % fall inside 1 sigma (ideal 39 %): the error
  distribution is heavier-tailed than a Gaussian, so the predicted sigma is a
  little too wide for typical days and right for the 2-sigma envelope. The
  ensemble spread in the browser is therefore about right on the outer edge and
  slightly generous in the core.

## Limits

- Trained on drifters (drogued at 15 m, or undrogued surface floats), not on
  plastic. Windage beyond an undrogued drifter's (about 1 %) is clamped to 1.
- Climatological forcing: no storms, no eddies, no interannual variability.
- Three years of drifters (2012-2014); coverage is uneven (many more in the
  North Atlantic and equatorial Pacific than the South Pacific gyre).
- Wind grid covers 75S-75N; gaps (coasts, sea ice) were filled by
  nearest-neighbour extrapolation (DATA.md), so wind near coasts is an
  extrapolated open-ocean value.
- A 1-day Gaussian step iterated for 10 years compounds its errors; Drift
  shows an ensemble so that the spread, not a single track, carries the message.

## Reproduce

```
scripts/train/.venv/Scripts/python.exe scripts/data/fetch_wind.py
scripts/train/.venv/Scripts/python.exe scripts/data/build_pairs.py
cd scripts/train
.venv/Scripts/python.exe train.py      # out/drift.pt, split.json, history.json
.venv/Scripts/python.exe evaluate.py   # out/eval.json, eval.md, public/model/drift.meta.json
.venv/Scripts/python.exe export.py     # public/model/drift.onnx, tests/fixtures/onnx-ref.json
```

`npm test` checks the JS features and field sampler against Python
(`tests/features.test.mjs`, 1e-6) and onnxruntime-web against PyTorch
(`tests/onnx-parity.test.mjs`, 1e-4).
