"""Monthly-climatology 10 m winds on a 2 deg grid -> public/data/wind/clim.bin.

Source: QuikSCAT SeaWinds monthly winds (ERDDAP erdQSwindmday, RSS science
quality, 1999-08..2009-10), averaged by calendar month and sampled every 16th
0.125 deg point (2 deg). The planned ICOADS dataset (esrlIcoads2gec71_LonPM180)
is no longer served by coastwatch ERDDAP (404 "unknown datasetID"), see DATA.md.
Coverage is 75S..75N. Monthly-mean speeds over 20 m/s are masked (sea-ice
contamination), then every remaining NaN cell (coast, sea ice, land) is filled
by iterative nearest-valid-neighbour extrapolation, per month frame, so the
tile has no land cells and sampling it never fails.
"""
import numpy as np
import pandas as pd
import xarray as xr

from common import CACHE, PUBLIC, get, write_tile

BASE = "https://coastwatch.pfeg.noaa.gov/erddap/griddap/erdQSwindmday.nc"
Q = "[(1999-08-16):1:(2009-10-16)][(10.0)][(-75):16:(75)][(0):16:(360)]"
MAX_MEAN_SPEED = 20.0  # m/s; monthly means above this are ice-edge contamination


def _shift(a, dy, dx):
    """a shifted by (dy, dx): lon (axis 1) wraps, lat (axis 0) pads with 0."""
    a = np.roll(a, dx, axis=1)
    if dy == 0:
        return a
    out = np.zeros_like(a)
    if dy > 0:
        out[dy:] = a[:-dy]
    else:
        out[:dy] = a[-dy:]
    return out


def fill_nan(u, v):
    """Iterative nearest-valid-neighbour extrapolation on one [ny, nx] frame.
    Each pass sets every NaN cell with at least one valid 3x3 neighbour to the
    mean of its valid neighbours (lon wraps); repeats until no NaN remains."""
    u, v = u.copy(), v.copy()
    passes = 0
    while np.isnan(u).any():
        ok = ~np.isnan(u)
        okf = ok.astype(np.float64)
        uz, vz = np.where(ok, u, 0.0), np.where(ok, v, 0.0)
        su, sv, n = np.zeros_like(u), np.zeros_like(v), np.zeros_like(u)
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                if dy or dx:
                    su += _shift(uz, dy, dx)
                    sv += _shift(vz, dy, dx)
                    n += _shift(okf, dy, dx)
        fill = ~ok & (n > 0)
        if not fill.any():
            raise RuntimeError("fill_nan: frame has no valid cells")
        u[fill] = su[fill] / n[fill]
        v[fill] = sv[fill] / n[fill]
        passes += 1
    return u, v, passes


def main():
    nc = CACHE / "quikscat-monthly.nc"
    if not nc.exists():
        r = get(f"{BASE}?x_wind{Q},y_wind{Q}".replace("[", "%5B").replace("]", "%5D"),
                timeout=(20, 300))
        nc.write_bytes(r.content)
    d = xr.open_dataset(nc, decode_times=False)
    months = pd.to_datetime(d.time.values, unit="s").month.values
    lat = d.latitude.values.astype("float64")
    lon = d.longitude.values.astype("float64")
    u = d.x_wind.values.astype("float64")[:, 0]
    v = d.y_wind.values.astype("float64")[:, 0]
    import warnings
    warnings.simplefilter("ignore")
    uu = np.stack([np.nanmean(u[months == m], axis=0) for m in range(1, 13)])
    vv = np.stack([np.nanmean(v[months == m], axis=0) for m in range(1, 13)])
    nan0 = float((np.isnan(uu) | np.isnan(vv)).mean())
    bad = np.hypot(uu, vv) > MAX_MEAN_SPEED
    print("NaN fraction after averaging", nan0, "cells over", MAX_MEAN_SPEED, "m/s:", int(bad.sum()))
    bad |= np.isnan(uu) | np.isnan(vv)
    uu[bad] = np.nan
    vv[bad] = np.nan
    # lon 0..360 (360 repeats 0) -> -180..178
    uu, vv, lon = uu[:, :, :-1], vv[:, :, :-1], lon[:-1]
    lon = ((lon + 180) % 360) - 180
    o = np.argsort(lon)
    lon, uu, vv = lon[o], uu[:, :, o], vv[:, :, o]
    print("NaN fraction before fill", float(np.isnan(uu).mean()))
    for k in range(12):
        uu[k], vv[k], passes = fill_nan(uu[k], vv[k])
        print(f"  month {k + 1:2d}: filled in {passes} passes")
    dlon, dlat = float(lon[1] - lon[0]), float(lat[1] - lat[0])
    print("grid nx,ny", len(lon), len(lat), "lon0", lon[0], "lat0", lat[0], dlon, dlat)
    write_tile(PUBLIC / "wind" / "clim.bin", uu, vv, float(lon[0]), float(lat[0]),
               dlon, dlat, 0.01)
    print("wrote clim.bin; NaN fraction", float(np.isnan(uu).mean()),
          "max |u|", float(np.nanmax(np.abs(uu))), "max speed", float(np.nanmax(np.hypot(uu, vv))))


if __name__ == "__main__":
    main()
