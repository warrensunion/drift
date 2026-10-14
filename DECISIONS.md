# Decisions

One line each: the decision and why. Newest at the bottom.

- Answered the brainstorming questions myself and logged them in docs/spec.md — Warren asked for a fully autonomous build.
- Audience: curious general visitor, desktop and phone, portfolio-grade — the makemepulse bar implies an experience, not a tool.
- Currents: OSCAR 1/3° from CoastWatch ERDDAP (`jplOscar`, 2011-12..2014-09) averaged to a 12-month climatology on a 1° grid — no account, the brief's first choice, and 1° keeps all 12 months near 1.4 MB.
- Wind: ICOADS 2° monthly long-term mean 1971–2000 from the same ERDDAP — no key, monthly, global.
- Drifters: GDP 6-hour QC (AOML ERDDAP), 2012-01..2014-09, one fix per drifter per day — CC-BY 4.0 and overlaps the current climatology's years.
- Windage feature: drogued (0) vs drogue-lost (1) drifters — the only real windage-like signal in the record; fragments map their windage onto it, documented as a proxy.
- Model: small PyTorch MLP predicting mean + log-sigma of next-day displacement with Gaussian NLL — sigma drives the ensemble spread directly and it exports cleanly to ONNX.
- Salish Sea: SalishSeaCast near-surface currents (UBC ERDDAP, no login), regridded to lat/lon, 25-hour tidal loop — real regional data, so no "low resolution" fallback is needed.
- Renderer: three.js WebGPURenderer + TSL (WebGPU compute when present, its WebGL2 backend otherwise) — one code path covers both.
- Simulation runs in a Web Worker with onnxruntime-web (wasm) — keeps the main thread free for 60 fps.
- Story is DOM + CSS transforms with layered art, not WebGL — fastest first paint; three.js only loads for the globe.
- Python comes from uv (`uv python install 3.12`, venv in scripts/train/.venv) — no system Python on this machine, uv is installed.
- Skills `design-taste-frontend`, `image-to-code` and `web-design-guidelines` are not installed here — used `frontend-design` for art direction, generated one design image per section in ChatGPT before building, and audited against Vercel's published Web Interface Guidelines by hand.
- Denied protobufjs's postinstall script (onnxruntime-web dep) — it only prints a version notice; nothing needs it.
- Art is generated with ChatGPT through the codex CLI's image tool (gpt-image-bridge, same ChatGPT Plus sign-in), not the chatgpt.com tab — in Chrome the tab loaded signed in but froze on every input (screenshot, click and script calls all timed out three times), and the brief says not to stop.
- Asked the image model for alpha PNGs; it returns real alpha with a soft glow halo, which cutout.mjs (copied from BTTRURSLF-v2) cleans.
- The build runs on branch `build/drift`; `main` holds only the spec and plan until the final merge — implementation stays off main until it is verified.
- PET bottles at sea keep the cited ~15-year onset before fragmenting; on a beach they switch to the 255-day beached-plastic onset and can wash back out — science.md found no faster open-ocean PET evidence, so breakup inside 10 years only happens via beaches.
- Story chapter 2 ("It breaks") is set at the shoreline and says the timing is uncertain — same evidence.
- Each drop runs as its own simulation from its own day 0, and the timeline shows every drop at the same age — drops made at different moments otherwise had no well-defined shared clock.
- makemepulse is a click-through, not a scroll site (measured: no wheel listeners) — Drift stays scroll-driven as briefed, and crossing a chapter boundary fires their measured 1.75 s scene transition (a full-frame foreground layer sweeps across, the scene swaps at its midpoint).
- Motion numbers copied from design-reference/makemepulse/NOTES.md: camera/cursor follow 1-0.96^(dt/16.67), parallax +2 % / 0 / -3 % / -11 % of cursor travel per depth, eases settle (0.04,1,0.31,0.98), scene (.77,0,.175,1), slide (.645,.045,.355,1), reveal (.215,.61,.355,1), hide (.755,.05,.855,.06); 40 px chrome margin; paper grain multiplied over everything.
- Preloader is one hand-painted stroke filling inside a mask, no percentage text — their measured technique; our art and shape.
- Reference frames (568 MB of JPGs) are gitignored; only their JSON measurements are committed.
- Wind: QuikSCAT monthly winds (CoastWatch `erdQSwindmday`, 1999–2009) replace ICOADS, which the ERDDAP server no longer serves (404) — the closest open, no-key monthly global wind on the same server.
- QuikSCAT has no data near coasts and sea ice; ocean gaps are filled from the nearest valid cells and monthly means capped at 20 m/s — otherwise 7 % of drifter pairs (mostly coastal and polar) were dropped and the browser had no wind near any coast.
- Whole floating items (capped bottles, bags) sink on a ~33-year timescale, not 1 year — Lebreton 2018/2019 dated garbage-patch objects back to 1977 and bound total removal at ~3 %/yr; the 1-year assumption sank every simulated bottle.
- Salish Sea mode: plain RK2 advection on SalishSeaCast's hourly currents plus a random walk with K = 0.6 m²/s (Okubo's diffusion law at ~1 km, assumption) and a 3-day grounding timescale (Pawlowicz 2019) — the drift model was trained on open-ocean drifters at daily steps and does not know tides.
- The Salish Sea chart covers 48.2–49.9 N, 125.2–122.7 W (Juan de Fuca's east end to the northern Strait of Georgia) — the first, tighter box put the chart edge 22 km south of the river mouth and almost every particle ran off it in 3 days.
- Salish chart: ocean outside SalishSeaCast's model domain is its own mask value (drawn hatched, "outside the model"), and a particle that crosses into it has left the strait; currents near the coast are sampled from the water corners only.
- The fragment panel shows distance from where you dropped it (mean and spread across the ensemble), not path length — the random-walk part of each step inflates path length into meaningless numbers.
- Web interface audit (docs/audit/AUDIT.md, against Vercel's Web Interface Guidelines): the globe and Salish canvases are tab stops with key equivalents for every gesture (arrows turn / pan, + and - zoom, Enter drops at a ring shown on focus) — dragging and tapping were the only way to drop on the globe.
- Sunk markers: one member column in 24 keeps a ghost ring, drawn at half gain — copies of a fragment sink together and the glow is additive, so a ring per copy piled into white dots after a split.
- The custom cursor dot steps aside over the whole globe section (it sat on the switch's labels); scroll restoration stays manual because every visit starts at the preloader.
