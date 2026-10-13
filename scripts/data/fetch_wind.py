"""Monthly-climatology 10 m winds on a 2 deg grid -> public/data/wind/clim.bin.

Source: QuikSCAT SeaWinds monthly winds (ERDDAP erdQSwindmday, RSS science
quality, 1999-08..2009-10), averaged by calendar month and sampled every 16th
0.125 deg point (2 deg). The planned ICOADS dataset (esrlIcoads2gec71_LonPM180)
is no longer served by coastwatch ERDDAP (404 "unknown datasetID"), see DATA.md.
Coverage is 75S..75N; cells without data (sea ice, coast) are NaN (land).
"""
import numpy as np
import pandas as pd
import xarray as xr

from common import CACHE, PUBLIC, get, write_tile

BASE = "https://coastwatch.pfeg.noaa.gov/erddap/griddap/erdQSwindmday.nc"
Q = "[(1999-08-16):1:(2009-10-16)][(10.0)][(-75):16:(75)][(0):16:(360)]"


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
    bad = np.hypot(uu, vv) > 25  # ice-edge contamination (monthly means never reach this)
    uu[bad] = np.nan
    vv[bad] = np.nan
    # lon 0..360 (360 repeats 0) -> -180..178
    uu, vv, lon = uu[:, :, :-1], vv[:, :, :-1], lon[:-1]
    lon = ((lon + 180) % 360) - 180
    o = np.argsort(lon)
    lon, uu, vv = lon[o], uu[:, :, o], vv[:, :, o]
    dlon, dlat = float(lon[1] - lon[0]), float(lat[1] - lat[0])
    print("grid nx,ny", len(lon), len(lat), "lon0", lon[0], "lat0", lat[0], dlon, dlat)
    write_tile(PUBLIC / "wind" / "clim.bin", uu, vv, float(lon[0]), float(lat[0]),
               dlon, dlat, 0.01)
    print("wrote clim.bin; NaN fraction", float(np.isnan(uu).mean()),
          "max |u|", float(np.nanmax(np.abs(uu))))


if __name__ == "__main__":
    main()
