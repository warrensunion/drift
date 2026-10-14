"""Shared helpers for the Drift data pipeline: DRFT tile IO, HTTP, bilinear sampler."""
import struct
import time
from pathlib import Path

import numpy as np
import requests

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / "scripts" / "data" / "cache"
PUBLIC = ROOT / "public" / "data"
CACHE.mkdir(parents=True, exist_ok=True)

NODATA = -32768


def write_tile(path, u, v, lon0, lat0, dlon, dlat, scale):
    """Write a DRFT tile. u, v: float arrays [frames, ny, nx], NaN = land/no data."""
    u = np.asarray(u, dtype=np.float64)
    v = np.asarray(v, dtype=np.float64)
    if u.ndim == 2:
        u, v = u[None], v[None]
    nf, ny, nx = u.shape
    assert v.shape == u.shape
    land = np.isnan(u) | np.isnan(v)
    iu = np.clip(np.rint(np.nan_to_num(u) / scale), -32767, 32767).astype("<i2")
    iv = np.clip(np.rint(np.nan_to_num(v) / scale), -32767, 32767).astype("<i2")
    iu[land] = NODATA
    iv[land] = NODATA
    data = np.stack([iu, iv], axis=-1)  # [frame][y][x][2]
    head = b"DRFT" + struct.pack("<HHHH", 1, nx, ny, nf) + struct.pack(
        "<5f", lon0, lat0, dlon, dlat, scale)
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with open(path, "wb") as f:
        f.write(head)
        f.write(data.astype("<i2").tobytes())


def read_tile(path):
    """Decode a DRFT tile; u/v float [frames, ny, nx], NaN = land."""
    b = Path(path).read_bytes()
    assert b[:4] == b"DRFT"
    ver, nx, ny, nf = struct.unpack("<HHHH", b[4:12])
    assert ver == 1
    lon0, lat0, dlon, dlat, scale = struct.unpack("<5f", b[12:32])
    d = np.frombuffer(b, dtype="<i2", offset=32).reshape(nf, ny, nx, 2)
    land = d[..., 0] == NODATA
    u = np.where(land, np.nan, d[..., 0] * scale)
    v = np.where(land, np.nan, d[..., 1] * scale)
    return dict(nx=nx, ny=ny, nframes=nf, lon0=lon0, lat0=lat0, dlon=dlon,
                dlat=dlat, scale=scale, u=u, v=v)


def sample(tile, lon, lat, frame=0):
    """Bilinear sample, mirroring src/sim/field.js: cell centres at lon0+i*dlon,
    lat0+j*dlat; lon wraps (360 periodic); lat outside [lat0, lat0+(ny-1)*dlat]
    -> NaN; any of the 4 corners NaN -> NaN. lon/lat arrays. Returns (u, v)."""
    lon = np.atleast_1d(np.asarray(lon, dtype=np.float64))
    lat = np.atleast_1d(np.asarray(lat, dtype=np.float64))
    nx, ny = tile["nx"], tile["ny"]
    gx = np.mod((lon - tile["lon0"]) / tile["dlon"], nx)
    gy = (lat - tile["lat0"]) / tile["dlat"]
    bad = (gy < 0) | (gy > ny - 1) | np.isnan(gy)
    gy = np.where(bad, 0.0, gy)
    x0 = np.floor(gx).astype(int)
    fx = gx - x0
    x0 = x0 % nx
    x1 = (x0 + 1) % nx
    y0 = np.minimum(np.floor(gy).astype(int), ny - 2)
    fy = gy - y0
    y1 = y0 + 1
    out = []
    for comp in ("u", "v"):
        g = tile[comp][frame]
        a, b, c, d = g[y0, x0], g[y0, x1], g[y1, x0], g[y1, x1]
        r = (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy
        out.append(np.where(bad, np.nan, r))  # NaN corner propagates
    return out[0], out[1]


def get(url, timeout=(20, 120), tries=10, **kw):
    """GET with retry/backoff; returns the 200 response."""
    last = None
    for i in range(tries):
        try:
            r = requests.get(url, timeout=timeout, **kw)
            if r.status_code == 200:
                return r
            last = f"HTTP {r.status_code}"
        except Exception as e:  # noqa: BLE001
            last = repr(e)
        wait = min(90, 5 * 2 ** i)
        print(f"  retry {i+1}/{tries} after {wait}s ({last}) {url[:110]}", flush=True)
        time.sleep(wait)
    raise RuntimeError(f"failed: {url} ({last})")
