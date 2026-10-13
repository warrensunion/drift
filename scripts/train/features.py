"""Model input features. Mirrors src/sim/features.js exactly (docs/spec.md, Model I/O).

Order: lat/90, sin(lon), cos(lon), u_cur, v_cur (m/s), u_wind/10, v_wind/10 (m/s),
sin(2 pi doy/365.25), cos(2 pi doy/365.25), windage (0..1).
Computed in float64, returned as float32.
"""
import numpy as np

NAMES = ["lat/90", "sin(lon)", "cos(lon)", "u_cur", "v_cur", "u_wind/10", "v_wind/10",
         "sin(2pi doy/365.25)", "cos(2pi doy/365.25)", "windage"]
N_FEATURES = 10


def features(lat, lon, u_cur, v_cur, u_wind, v_wind, doy, windage):
    """Scalars or equal-length arrays -> float32 [N, 10] (or [10] for scalars)."""
    args = [np.asarray(a, dtype=np.float64) for a in
            (lat, lon, u_cur, v_cur, u_wind, v_wind, doy, windage)]
    scalar = all(a.ndim == 0 for a in args)
    lat, lon, uc, vc, uw, vw, doy, w = np.broadcast_arrays(*[np.atleast_1d(a) for a in args])
    lr = lon * np.pi / 180.0
    t = 2.0 * np.pi * doy / 365.25
    x = np.stack([lat / 90.0, np.sin(lr), np.cos(lr), uc, vc, uw / 10.0, vw / 10.0,
                  np.sin(t), np.cos(t), w], axis=-1).astype(np.float32)
    return x[0] if scalar else x
