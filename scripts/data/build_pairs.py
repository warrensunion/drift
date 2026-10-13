"""Daily drifter displacement pairs + sampled current/wind -> cache/pairs.npz, pairs-summary.json."""
import json

import numpy as np
import pandas as pd

from common import CACHE, PUBLIC, read_tile, sample

KM_PER_DEG = 111.195


def main():
    df = pd.read_csv(CACHE / "drifters.csv")
    df["t"] = pd.to_datetime(df["time"], utc=True)
    df["lost"] = pd.to_datetime(df["drogue_lost_date"], utc=True, errors="coerce")
    df = df.dropna(subset=["latitude", "longitude", "t"])
    df["lon"] = ((df.longitude + 180) % 360) - 180
    df["day"] = df.t.dt.floor("D")
    df = df.sort_values(["ID", "day", "t"]).drop_duplicates(["ID", "day"])

    a = df.reset_index(drop=True)
    nxt = a.groupby("ID").shift(-1)
    ok = (nxt["day"] - a["day"]) == pd.Timedelta(days=1)
    a, nxt = a[ok], nxt[ok]
    lat0, lon0 = a.latitude.values, a.lon.values
    lat1, lon1 = nxt.latitude.values, nxt.lon.values
    dlon = ((lon1 - lon0 + 180) % 360) - 180
    latm = np.radians((lat0 + lat1) / 2)
    dx = dlon * KM_PER_DEG * np.cos(latm)
    dy = (lat1 - lat0) * KM_PER_DEG
    keep = (np.abs(dx) < 300) & (np.abs(dy) < 300)
    n_raw = int(ok.sum())
    n_disp = int(keep.sum())

    month = a.t.dt.month.values
    doy = a.t.dt.dayofyear.values
    uc = np.full(len(a), np.nan)
    vc = np.full(len(a), np.nan)
    for m in range(1, 13):
        sel = month == m
        if sel.any():
            tile = read_tile(PUBLIC / "currents" / f"clim-{m:02d}.bin")
            uc[sel], vc[sel] = sample(tile, lon0[sel], lat0[sel])
    wt = read_tile(PUBLIC / "wind" / "clim.bin")
    uw = np.full(len(a), np.nan)
    vw = np.full(len(a), np.nan)
    for m in range(1, 13):
        sel = month == m
        if sel.any():
            uw[sel], vw[sel] = sample(wt, lon0[sel], lat0[sel], frame=m - 1)

    # windage: the fix is at/after the date the drogue was lost (drogue_lost_date
    # missing = drogue never recorded as lost -> drogued, 0)
    wind_flag = (a.t >= a.lost).fillna(False).values.astype(np.int64)
    fin = keep & ~np.isnan(uc) & ~np.isnan(vc) & ~np.isnan(uw) & ~np.isnan(vw)
    n_final = int(fin.sum())
    out = dict(
        id=a.ID.values.astype(np.int64)[fin],
        lat=lat0[fin], lon=lon0[fin], doy=doy[fin].astype(np.float64),
        windage=wind_flag[fin], dx_km=dx[fin], dy_km=dy[fin],
        u_cur=uc[fin], v_cur=vc[fin], u_wind=uw[fin], v_wind=vw[fin],
    )
    np.savez(CACHE / "pairs.npz", **out)
    t = a.t.values[fin]
    summary = dict(
        drifters=int(len(np.unique(out["id"]))),
        pairs=n_final,
        drogued=int((out["windage"] == 0).sum()),
        undrogued=int((out["windage"] == 1).sum()),
        date_first=str(pd.Timestamp(t.min()).date()),
        date_last=str(pd.Timestamp(t.max()).date()),
        consecutive_day_pairs=n_raw,
        after_displacement_filter=n_disp,
        dropped_nan_field=n_disp - n_final,
        drifters_in_fixes=int(df.ID.nunique()),
    )
    (CACHE / "pairs-summary.json").write_text(json.dumps(summary, indent=2))
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
