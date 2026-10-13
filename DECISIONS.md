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
