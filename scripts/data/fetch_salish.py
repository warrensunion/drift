#!/usr/bin/env python
"""Fetch SalishSeaCast near-surface currents and build the Drift Salish Sea tile.

Outputs (public/data/salish/): tide.bin (DRFT tile, 25 hourly frames),
land.png (4x land mask from NEMO tmask), meta.json.

Source: SalishSeaCast ERDDAP, https://salishsea.eos.ubc.ca/erddap/
  - ubcSSfDepthAvgdCurrents1h  VelEast5/VelNorth5 (upper-5 m mean, east/north)
  - ubcSSnBathymetryV21-08     model-grid longitude / latitude
  - ubcSSn3DMeshMaskV21-08     tmask (surface level) = land mask

The forecast dataset is a rolling ~7 day window; the raw subset is cached in
scripts/data/cache/salish/ so reruns are deterministic. Delete the cache to
re-pick a window.  Usage: python scripts/data/fetch_salish.py
"""
import io
import json
import struct
from pathlib import Path

import numpy as np
import requests
import xarray as xr
from PIL import Image
from scipy.spatial import cKDTree

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / "scripts" / "data" / "cache" / "salish"
OUT = ROOT / "public" / "data" / "salish"
ERDDAP = "https://salishsea.eos.ubc.ca/erddap/griddap/"
DS_CUR = "ubcSSfDepthAvgdCurrents1h"
DS_GRID = "ubcSSnBathymetryV21-08"
DS_MASK = "ubcSSn3DMeshMaskV21-08"

LON0, DLON, NX = -125.20, 0.01, 251
LAT0, DLAT, NY = 48.20, 0.006, 284
NFRAMES = 25
SCALE = 0.001
SS = 4  # land.png supersampling
COSLAT = np.cos(np.radians(49.25))
# Fraser mouth reference used to pick the most energetic 25 h window
REF = (49.10, -123.30)
# Fixed 25 h window (first frame, hour-centred UTC). If the rolling forecast
# archive no longer holds it, the script falls back to the strongest 25 h
# window currently available near REF and records that in meta.json.
START_FRAME = "2026-10-09T08:30:00"


def get_nc(name, dataset, query):
    path = CACHE / name
    if not path.exists():
        CACHE.mkdir(parents=True, exist_ok=True)
        r = requests.get(f"{ERDDAP}{dataset}.nc?{query}", timeout=(20, 300))
        r.raise_for_status()
        path.write_bytes(r.content)
    return xr.open_dataset(path).load()


def main():
    full = "[(0):(897)][(0):(397)]"
    g = get_nc("grid.nc", DS_GRID, f"latitude{full},longitude{full}")
    lat_m, lon_m = g["latitude"].values, g["longitude"].values
    m = get_nc("tmask.nc", DS_MASK, "tmask[0][0][(0):(897)][(0):(397)]")
    tmask = np.squeeze(m["tmask"].values) > 0

    # Model sub-box covering the target extent plus a margin
    pad = 0.05
    inb = ((lon_m > LON0 - 0.005 - pad) & (lon_m < LON0 + (NX - 1) * DLON + 0.005 + pad) &
           (lat_m > LAT0 - 0.0025 - pad) & (lat_m < LAT0 + (NY - 1) * DLAT + 0.0025 + pad))
    ys, xs = np.where(inb)
    y0, y1, x0, x1 = ys.min(), ys.max(), xs.min(), xs.max()
    print(f"model box gridY {y0}..{y1} gridX {x0}..{x1}")

    sub_lat, sub_lon = lat_m[y0:y1 + 1, x0:x1 + 1], lon_m[y0:y1 + 1, x0:x1 + 1]
    sub_mask = tmask[y0:y1 + 1, x0:x1 + 1]
    sp = f"[({y0}):({y1})][({x0}):({x1})]"

    def fetch_cur(tag, trange):
        q = f"VelEast5{trange}{sp},VelNorth5{trange}{sp}"
        return get_nc(f"cur_{tag}_{y0}_{y1}_{x0}_{x1}.nc", DS_CUR, q)

    t0 = np.datetime64(START_FRAME)
    t1 = t0 + np.timedelta64(NFRAMES - 1, "h")
    pinned = f"cur_{START_FRAME.replace(':', '')}_{y0}_{y1}_{x0}_{x1}.nc"
    c = None
    try:
        c = fetch_cur(START_FRAME.replace(":", ""), f"[({START_FRAME}Z):1:({np.datetime_as_string(t1, unit='s')}Z)]")
        if c.sizes["time"] != NFRAMES:
            c = None
    except requests.HTTPError:
        c = None
    if c is not None:
        best, t_note = 0, "fixed START_FRAME"
    else:
        (CACHE / pinned).unlink(missing_ok=True)
        print("START_FRAME not in archive; picking strongest 25 h window available")
        c = fetch_cur("all", "[0:last]")
        times_all = c["time"].values
        near = (np.abs(sub_lat - REF[0]) < 0.12) & (np.abs(sub_lon - REF[1]) < 0.2) & sub_mask
        spd = np.nan_to_num(np.hypot(c["VelEast5"].values, c["VelNorth5"].values))[:, near].mean(axis=1)
        best = max(range(len(times_all) - NFRAMES + 1), key=lambda i: spd[i:i + NFRAMES].mean())
        t_note = "strongest 25 h near Fraser mouth in the archive at fetch time"
    times = c["time"].values
    ue = c["VelEast5"].values[best:best + NFRAMES]
    vn = c["VelNorth5"].values[best:best + NFRAMES]
    # tmask water cells: NaN is acceptable only where the source has no current
    # at ALL frames (destaggered u/v undefined, mostly one-cell coastal/shallow
    # points); those are dropped from the lookup. Partial NaN is a hard error.
    nanw = np.isnan(ue[:, sub_mask])
    if (nanw.any(0) != nanw.all(0)).any() or (nanw != np.isnan(vn[:, sub_mask])).any():
        raise SystemExit("NaN current at a tmask water cell in some but not all frames / u,v mismatch")
    nodata_frac = nanw.all(0).mean()
    if nodata_frac > 0.15:
        raise SystemExit(f"{nodata_frac:.1%} of tmask water cells have no current: source incomplete")
    print(f"{int(nanw.all(0).sum())} of {nanw.shape[1]} tmask water cells ({nodata_frac:.1%}) have no source current; excluded")
    valid = sub_mask & ~np.isnan(ue[0])
    ue, vn = np.nan_to_num(ue), np.nan_to_num(vn)
    t_first = np.datetime_as_string(times[best], unit="s") + "Z"
    print(f"window {t_first} ({t_note}), {len(times)} frames fetched")

    # --- regrid: nearest model water cell within 1.5 model cells ---
    def proj(lon, lat):
        return np.column_stack([np.ravel(lon) * COSLAT, np.ravel(lat)])

    wlat, wlon = sub_lat[valid], sub_lon[valid]
    wue, wvn = ue[:, valid], vn[:, valid]
    # typical model spacing (deg, in projected units) for the distance cut-off
    dx = np.median(np.abs(np.diff(sub_lon, axis=1))) * COSLAT
    dy = np.median(np.abs(np.diff(sub_lat, axis=0)))
    cell = float(np.hypot(dx, dy))
    tree = cKDTree(proj(wlon, wlat))
    lons = LON0 + DLON * np.arange(NX)
    lats = LAT0 + DLAT * np.arange(NY)
    LG, TG = np.meshgrid(lons, lats)  # [ny, nx]
    dist, idx = tree.query(proj(LG, TG), distance_upper_bound=1.5 * cell)
    dist, idx = dist.reshape(NY, NX), idx.reshape(NY, NX)
    ok = np.isfinite(dist)
    idx = np.where(ok, idx, 0)
    out = np.full((NFRAMES, NY, NX, 2), -32768, dtype=np.int16)
    for k in range(NFRAMES):
        uu = np.clip(np.round(wue[k][idx] / SCALE), -32767, 32767)
        vv = np.clip(np.round(wvn[k][idx] / SCALE), -32767, 32767)
        out[k, ..., 0] = np.where(ok, uu, -32768)
        out[k, ..., 1] = np.where(ok, vv, -32768)

    OUT.mkdir(parents=True, exist_ok=True)
    header = (b"DRFT" + struct.pack("<HHHH", 1, NX, NY, NFRAMES) +
              struct.pack("<ffff", LON0, LAT0, DLON, DLAT) + struct.pack("<f", SCALE))
    assert len(header) == 32
    (OUT / "tide.bin").write_bytes(header + out.astype("<i2").tobytes())

    # --- land.png: 4x, north up; pixel -> nearest model cell (any), water iff tmask ---
    sx, sy = NX * SS, NY * SS
    plon = LON0 - DLON / 2 + (np.arange(sx) + 0.5) * DLON / SS
    plat = (LAT0 + (NY - 1) * DLAT + DLAT / 2) - (np.arange(sy) + 0.5) * DLAT / SS
    PG, QG = np.meshgrid(plon, plat)
    alltree = cKDTree(proj(sub_lon, sub_lat))
    d2, i2 = alltree.query(proj(PG, QG))
    water = sub_mask.ravel()[i2].reshape(sy, sx) & (d2 < 1.5 * cell).reshape(sy, sx)
    img = np.where(water, 0, 255).astype(np.uint8)
    Image.fromarray(img, "L").save(OUT / "land.png", optimize=True)

    meta = {
        "source": f"SalishSeaCast ERDDAP {DS_CUR} (VelEast5/VelNorth5, upper-5 m mean currents, "
                  f"NEMO v21-11 forecast); grid {DS_GRID}; land mask tmask from {DS_MASK}",
        "erddap": "https://salishsea.eos.ubc.ca/erddap/",
        "datasetId": DS_CUR,
        "firstFrame": t_first,
        "frameStepSeconds": 3600,
        "frames": NFRAMES,
        "grid": {"lon0": LON0, "lat0": LAT0, "dlon": DLON, "dlat": DLAT, "nx": NX, "ny": NY,
                 "scale": SCALE, "landPng": {"width": sx, "height": sy, "northUp": True}},
        "notes": (f"Frame times are hour-centred (:30 UTC) means. Window: {t_note}. "
                  "Regridded by nearest model water cell within 1.5 model cells; land.png from tmask. "
                  "Licence: Apache-2.0, (c) SalishSeaCast Project Contributors and UBC."),
    }
    (OUT / "meta.json").write_text(json.dumps(meta, indent=2))
    print("wrote", OUT, "water cells:", int((out[0, ..., 0] != -32768).sum()), "of", NX * NY)


if __name__ == "__main__":
    main()
