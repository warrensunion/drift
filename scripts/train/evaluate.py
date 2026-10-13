"""Evaluate the trained model against plain advection on the held-out TEST drifters.

Baseline "advection": displacement = sampled current x 86400 s (one Euler day; the
browser's fallback uses RK2, which differs only where the current changes within
a day's travel). Writes public/model/drift.meta.json and scripts/train/out/eval.json
and out/eval.md (tables pasted into MODEL.md).
"""
import json
import re

import numpy as np

from common_train import (CACHE, KM_PER_DEG, MODEL_DIR, OUT, PUBLIC, NAMES, features, load_model,
                          load_pairs, masks, predict, read_tile, sample, save_json)

ROOT_CONST = OUT.parents[2] / "src" / "sim" / "constants.js"
COAST_KM = 200.0  # "coastal": start within 200 km (great circle) of a land pixel of landmask.png
R_EARTH_KM = 6371.0


def gyres():
    """The gyre boxes: just the "gyres" JSON array of src/sim/constants.js."""
    m = re.search(r'"gyres"\s*:\s*(\[[^\[\]]*\])', ROOT_CONST.read_text())
    if not m:
        raise RuntimeError("gyres array not found in src/sim/constants.js")
    g = json.loads(m.group(1))
    assert len(g) == 5 and all({"name", "lonMin", "lonMax", "latMin", "latMax"} <= set(x) for x in g)
    return g


def box(lat, lon, la0, la1, lo0, lo1):
    return (lat >= la0) & (lat <= la1) & (lon >= lo0) & (lon <= lo1)


def _unit(lat, lon):
    la, lo = np.radians(lat), np.radians(lon)
    return np.stack([np.cos(la) * np.cos(lo), np.cos(la) * np.sin(lo), np.sin(la)], -1)


def coast_distance_field():
    """Great-circle km from each landmask.png pixel centre to the nearest land pixel
    centre (0 on land). Computed once (KD-tree on unit vectors over land pixels that
    touch water), cached in scripts/data/cache/coastdist-2048x1024.npy."""
    cache = CACHE / "coastdist-2048x1024.npy"
    if cache.exists():
        return np.load(cache)
    from PIL import Image
    from scipy.spatial import cKDTree
    land = np.asarray(Image.open(PUBLIC / "landmask.png").convert("L")) > 127
    H, W = land.shape
    lat = 90 - (np.arange(H) + 0.5) * 180 / H
    lon = -180 + (np.arange(W) + 0.5) * 360 / W
    water = ~land
    edge = np.zeros_like(land)  # land pixels with a water 4-neighbour (lon wraps)
    edge |= np.roll(water, 1, 1) | np.roll(water, -1, 1)
    edge[1:] |= water[:-1]
    edge[:-1] |= water[1:]
    edge &= land
    jj, ii = np.nonzero(edge)
    tree = cKDTree(_unit(lat[jj], lon[ii]))
    LA, LO = np.meshgrid(lat, lon, indexing="ij")
    wj, wi = np.nonzero(water)
    chord, _ = tree.query(_unit(LA[wj, wi], LO[wj, wi]))
    dist = np.zeros(land.shape, np.float32)
    dist[wj, wi] = 2 * R_EARTH_KM * np.arcsin(np.clip(chord / 2, 0, 1))
    np.save(cache, dist)
    return dist


def coast_km(lat, lon):
    """Distance to land (km) at the landmask pixel containing each point."""
    dist = coast_distance_field()
    H, W = dist.shape
    j = np.clip(np.floor((90 - lat) / 180 * H).astype(int), 0, H - 1)
    i = np.mod(np.floor((lon + 180) / 360 * W).astype(int), W)
    return dist[j, i]


def regions(d):
    lat, lon = d["lat"], d["lon"]
    r = [(f"{g['name']} gyre", box(lat, lon, g["latMin"], g["latMax"], g["lonMin"], g["lonMax"]))
         for g in gyres()]
    r += [
        ("Equatorial band 10S-10N", np.abs(lat) <= 10),
        ("Gulf Stream", box(lat, lon, 30, 45, -80, -50)),
        ("Kuroshio", box(lat, lon, 25, 40, 120, 160)),
        ("Agulhas", box(lat, lon, -45, -25, 10, 40)),
        ("Southern Ocean (south of 45S)", lat < -45),
        ("Coastal (start < 200 km from land)", coast_km(lat, lon) < COAST_KM),
        ("Drogued (windage 0)", d["windage"] == 0),
        ("Undrogued (windage 1)", d["windage"] == 1),
    ]
    return r


def err_stats(pred, obs):
    e = np.hypot(pred[:, 0] - obs[:, 0], pred[:, 1] - obs[:, 1])
    return float(np.sqrt(np.mean(e ** 2))), float(np.median(e)), e


def move(lat, lon, dx, dy):
    """Apply an east/north km displacement the same way build_pairs.py measured it
    (midpoint-latitude equirectangular)."""
    lat1 = np.clip(lat + dy / KM_PER_DEG, -89.9, 89.9)
    latm = np.radians((lat + lat1) / 2)
    lon1 = ((lon + dx / (KM_PER_DEG * np.cos(latm)) + 180) % 360) - 180
    return lat1, lon1


def haversine(lat0, lon0, lat1, lon1):
    p0, p1 = np.radians(lat0), np.radians(lat1)
    a = np.sin((p1 - p0) / 2) ** 2 + np.cos(p0) * np.cos(p1) * np.sin(np.radians(lon1 - lon0) / 2) ** 2
    return 2 * 6371.0 * np.arcsin(np.sqrt(np.clip(a, 0, 1)))


def ten_day(d, te, model, ndays=10):
    """Non-overlapping 10-day windows of consecutive daily pairs on test tracks.
    Both methods are iterated from the true start; a position whose current sample
    is NaN (land in the current tile) stops there for the rest of the window."""
    idx = np.where(te)[0]
    o = np.lexsort((d["day"][idx], d["id"][idx]))
    idx = idx[o]
    ids, days = d["id"][idx], d["day"][idx]
    brk = np.r_[True, (ids[1:] != ids[:-1]) | (days[1:] != days[:-1] + 1)]
    run_start = np.where(brk)[0]
    run_end = np.r_[run_start[1:], len(idx)]
    starts = [s for a, b in zip(run_start, run_end) for s in range(a, b - ndays + 1, ndays)]
    starts = np.array(starts, int)
    W = idx[starts[:, None] + np.arange(ndays)[None]]  # [nw, ndays] pair rows
    lat_t, lon_t = move(d["lat"][W[:, -1]], d["lon"][W[:, -1]], d["dx_km"][W[:, -1]], d["dy_km"][W[:, -1]])
    cur = {m: read_tile(PUBLIC / "currents" / f"clim-{m:02d}.bin") for m in range(1, 13)}
    wind = read_tile(PUBLIC / "wind" / "clim.bin")
    res = {}
    for meth in ("model", "advection"):
        lat, lon = d["lat"][W[:, 0]].copy(), d["lon"][W[:, 0]].copy()
        alive = np.ones(len(W), bool)
        for k in range(ndays):
            rows = W[:, k]
            mon = d["month"][rows]
            uc, vc = np.full(len(W), np.nan), np.full(len(W), np.nan)
            uw, vw = np.zeros(len(W)), np.zeros(len(W))
            for m in range(1, 13):
                s = mon == m
                if s.any():
                    uc[s], vc[s] = sample(cur[m], lon[s], lat[s])
                    a, b = sample(wind, lon[s], lat[s], frame=m - 1)
                    uw[s], vw[s] = np.nan_to_num(a), np.nan_to_num(b)
            alive &= ~np.isnan(uc)
            uc0, vc0 = np.nan_to_num(uc), np.nan_to_num(vc)
            if meth == "advection":
                dx, dy = uc0 * 86.4, vc0 * 86.4
            else:
                X = features(lat, lon, uc0, vc0, uw, vw, d["doy"][rows], d["windage"][rows].astype(float))
                mu, _ = predict(model, X)
                dx, dy = mu[:, 0].astype(np.float64), mu[:, 1].astype(np.float64)
            nl, no = move(lat, lon, dx, dy)
            lat, lon = np.where(alive, nl, lat), np.where(alive, no, lon)
        res[meth] = haversine(lat, lon, lat_t, lon_t)
    res["stationary"] = haversine(d["lat"][W[:, 0]], d["lon"][W[:, 0]], lat_t, lon_t)
    out = dict(windows=int(len(W)), drifters=int(len(np.unique(d["id"][W[:, 0]]))), days=ndays)
    for k, v in res.items():
        out[k] = dict(median_km=float(np.median(v)), mean_km=float(np.mean(v)))
    out["model_closer_fraction"] = float(np.mean(res["model"] < res["advection"]))
    return out


def main():
    d = load_pairs()
    split = {k: np.array(v) for k, v in json.loads((OUT / "split.json").read_text()).items()}
    mk = masks(d, split)
    te = mk["test"]
    model, ck = load_model()
    mu, ls = predict(model, d["X"][te])
    obs = d["Y"][te].astype(np.float64)
    adv = np.stack([d["u_cur"][te], d["v_cur"][te]], 1) * 86.4
    rm, mm, em = err_stats(mu, obs)
    ra, ma, ea = err_stats(adv, obs)
    sig = np.exp(ls)
    z2 = ((obs - mu) / sig) ** 2
    z2 = z2.sum(1)
    calib = dict(within1sigma=float(np.mean(z2 <= 1)), within2sigma=float(np.mean(z2 <= 4)),
                 ideal1sigma=float(1 - np.exp(-0.5)), ideal2sigma=float(1 - np.exp(-2)))
    sub = {k: d[k][te] for k in ("lat", "lon", "month", "windage", "id")}
    reg = []
    for name, m in regions(sub):
        n = int(m.sum())
        if n == 0:
            reg.append(dict(name=name, n=0, drifters=0, model=None, advection=None))
            continue
        r1, m1, e1 = err_stats(mu[m], obs[m])
        r2, m2, e2 = err_stats(adv[m], obs[m])
        c = z2[m]
        reg.append(dict(name=name, n=n, drifters=int(len(np.unique(sub["id"][m]))),
                        model=round(r1, 2), advection=round(r2, 2),
                        medianModel=round(m1, 2), medianAdvection=round(m2, 2),
                        modelCloserFraction=round(float(np.mean(e1 < e2)), 3),
                        within1sigma=round(float(np.mean(c <= 1)), 3),
                        within2sigma=round(float(np.mean(c <= 4)), 3)))
    td = ten_day(d, te, model)
    hist = json.loads((OUT / "history.json").read_text())
    ev = dict(
        test=dict(pairs=int(te.sum()), drifters=int(len(split["test"]))),
        overall=dict(model=dict(rmse=rm, median=mm), advection=dict(rmse=ra, median=ma),
                     model_closer_fraction=float(np.mean(em < ea)),
                     obs_rms_speed_km_day=float(np.sqrt(np.mean((obs ** 2).sum(1))))),
        calibration=calib, regions=reg, tenDay=td,
        mean_sigma_km=[float(v) for v in np.median(sig, 0)],
    )
    save_json(OUT / "eval.json", ev)
    meta = dict(
        version=ck["version"],
        features=NAMES,
        outputs={"mu": "next-day displacement east, north (km)",
                 "log_sigma": "log of 1-sigma east, north (km)"},
        architecture="MLP 10-128-128-4 SiLU, Gaussian NLL, standardisation baked in",
        trainedOn=("NOAA GDP 6-hourly QC drifters 2012-01-01..2014-09-25, daily pairs; "
                   "OSCAR monthly-climatology currents, QuikSCAT monthly-climatology winds"),
        split=dict(by="drifter ID", fractions=[0.8, 0.1, 0.1], seed=ck["seed"],
                   drifters={k: int(len(v)) for k, v in split.items()},
                   pairs={k: int(v.sum()) for k, v in mk.items()}),
        bestEpoch=hist["best_epoch"],
        units="km/day",
        rmse=dict(model=round(rm, 2), advection=round(ra, 2)),
        medianError=dict(model=round(mm, 2), advection=round(ma, 2)),
        regions=reg,
        calibration=dict(within1sigma=round(calib["within1sigma"], 3),
                         within2sigma=round(calib["within2sigma"], 3), ideal1sigma=0.393, ideal2sigma=0.865),
        tenDay=dict(model=round(td["model"]["median_km"], 1), advection=round(td["advection"]["median_km"], 1),
                    stationary=round(td["stationary"]["median_km"], 1),
                    meanModel=round(td["model"]["mean_km"], 1), meanAdvection=round(td["advection"]["mean_km"], 1),
                    windows=td["windows"], drifters=td["drifters"], statistic="median separation after 10 days, km"),
    )
    save_json(MODEL_DIR / "drift.meta.json", meta)
    lines = ["| Region | test drifters | test pairs | RMSE model | RMSE advection | median model | median advection | model closer | in 1 sigma | in 2 sigma |",
             "|---|---|---|---|---|---|---|---|---|---|",
             f"| **All test pairs** | {len(split['test'])} | {int(te.sum())} | {rm:.2f} | {ra:.2f} | {mm:.2f} | {ma:.2f} | "
             f"{np.mean(em < ea):.0%} | {calib['within1sigma']:.0%} | {calib['within2sigma']:.0%} |"]
    for r in reg:
        if r["n"] == 0:
            lines.append(f"| {r['name']} | 0 | 0 | - | - | - | - | - | - | - |")
            continue
        lines.append(f"| {r['name']} | {r['drifters']} | {r['n']} | {r['model']:.2f} | {r['advection']:.2f} | "
                     f"{r['medianModel']:.2f} | {r['medianAdvection']:.2f} | {r['modelCloserFraction']:.0%} | "
                     f"{r['within1sigma']:.0%} | {r['within2sigma']:.0%} |")
    (OUT / "eval.md").write_text("\n".join(lines) + "\n")
    print("\n".join(lines))
    print(json.dumps(dict(calibration=calib, tenDay=td, overall=ev["overall"]), indent=2))


if __name__ == "__main__":
    main()
