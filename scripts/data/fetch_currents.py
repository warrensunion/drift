"""OSCAR 1/3 deg surface currents -> 1 deg monthly climatology (clim-01..12.bin)."""
import numpy as np
import xarray as xr

from common import CACHE, PUBLIC, get, write_tile

BASE = "https://coastwatch.pfeg.noaa.gov/erddap/griddap/jplOscar"
SPACE = "[(15.0)][(80):3:(-80)][(20):3:(419.67)]"
CHUNK = 6


def times():
    r = get(BASE + ".csv?time[(2011-12-06):1:(2014-09-26)]")
    lines = r.text.strip().splitlines()[2:]
    return [l.strip().replace("Z", "") for l in lines]


def main():
    ts = times()
    print(len(ts), "time steps", ts[0], ts[-1])
    cdir = CACHE / "oscar"
    cdir.mkdir(exist_ok=True)
    for i in range(0, len(ts), CHUNK):
        part = ts[i:i + CHUNK]
        f = cdir / f"oscar-{i:03d}.nc"
        if f.exists():
            continue
        a, b = part[0], part[-1]
        url = f"{BASE}.nc?u[({a}):1:({b})]{SPACE},v[({a}):1:({b})]{SPACE}"
        r = get(url, timeout=(20, 300))
        f.write_bytes(r.content)
        print("got", f.name, len(r.content), flush=True)
    ds = xr.concat([xr.open_dataset(p).load() for p in sorted(cdir.glob("oscar-*.nc"))], dim="time")
    u = ds.u.values.astype("float64")
    v = ds.v.values.astype("float64")
    if u.ndim == 4:
        u, v = u[:, 0], v[:, 0]
    lat = ds.latitude.values
    lon = ds.longitude.values
    months = ds.time.dt.month.values
    if lat[0] > lat[-1]:
        u, v, lat = u[:, ::-1], v[:, ::-1], lat[::-1]
    lon = ((lon + 180) % 360) - 180
    # 20..419.67 spans 400 deg: the last 40 deg repeat the first; keep first copy
    lon, o = np.unique(np.round(lon, 3), return_index=True)
    u, v = u[:, :, o], v[:, :, o]
    assert len(lon) == 360 and len(lat) == 161, (len(lon), len(lat))

    def shift(g):
        # integer-degree nodes -> half-degree cell centres: mean of the 4
        # surrounding nodes ignoring NaN (lon wraps); land only if all 4 NaN.
        gw = np.concatenate([g, g[:, :1]], axis=1)
        st = np.stack([gw[:-1, :-1], gw[:-1, 1:], gw[1:, :-1], gw[1:, 1:]])
        with np.errstate(all="ignore"):
            return np.nanmean(st, axis=0)

    import warnings
    warnings.simplefilter("ignore")
    for m in range(1, 13):
        sel = months == m
        mu = np.nanmean(u[sel], axis=0)  # NaN where NaN in every step
        mv = np.nanmean(v[sel], axis=0)
        cu, cv = shift(mu), shift(mv)
        land = np.isnan(cu) | np.isnan(cv)
        cu[land] = np.nan
        cv[land] = np.nan
        write_tile(PUBLIC / "currents" / f"clim-{m:02d}.bin", cu[None], cv[None],
                   -179.5, -79.5, 1.0, 1.0, 0.001)
        print(f"month {m}: {int(sel.sum())} steps, land frac {land.mean():.3f}")


if __name__ == "__main__":
    main()
