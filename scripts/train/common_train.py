"""Shared pieces for train.py / evaluate.py / export.py: data loading, split, model."""
import json
import sys
from pathlib import Path

import numpy as np
import torch
torch.set_num_threads(1)
from torch import nn

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(ROOT / "scripts" / "data"))
from common import CACHE, PUBLIC, read_tile, sample  # noqa: E402,F401

from features import features, N_FEATURES, NAMES  # noqa: E402,F401

OUT = HERE / "out"
OUT.mkdir(exist_ok=True)
MODEL_DIR = ROOT / "public" / "model"
SEED = 20261013
KM_PER_DEG = 111.195  # same constant build_pairs.py used to make the targets
SEC_PER_DAY = 86400.0
HIDDEN = 128
LOG_SIGMA_MIN, LOG_SIGMA_MAX = -6.0, 4.0  # in standardised units


def load_pairs():
    d = dict(np.load(CACHE / "pairs.npz"))
    d["X"] = features(d["lat"], d["lon"], d["u_cur"], d["v_cur"], d["u_wind"], d["v_wind"],
                      d["doy"], d["windage"].astype(np.float64))
    d["Y"] = np.stack([d["dx_km"], d["dy_km"]], axis=1).astype(np.float32)
    return d


def split_ids(ids, seed=SEED):
    """Drifter IDs -> {'train','val','test'} id arrays, 80/10/10 by drifter."""
    u = np.unique(ids)
    rng = np.random.default_rng(seed)
    u = u[rng.permutation(len(u))]
    n = len(u)
    a, b = int(round(0.8 * n)), int(round(0.9 * n))
    return {"train": np.sort(u[:a]), "val": np.sort(u[a:b]), "test": np.sort(u[b:])}


def masks(d, split):
    return {k: np.isin(d["id"], v) for k, v in split.items()}


class Core(nn.Module):
    """Standardised features -> standardised (mu_e, mu_n, log_sigma_e, log_sigma_n)."""

    def __init__(self, hidden=HIDDEN):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(N_FEATURES, hidden), nn.SiLU(),
            nn.Linear(hidden, hidden), nn.SiLU(),
            nn.Linear(hidden, 4))

    def forward(self, z):
        o = self.net(z)
        return o[:, :2], torch.clamp(o[:, 2:], LOG_SIGMA_MIN, LOG_SIGMA_MAX)


class Drift(nn.Module):
    """Raw features [N,10] -> raw (mu [N,2] km/day, log_sigma [N,2] log km/day).
    Train-set input/target standardisation is baked in as buffers."""

    def __init__(self, x_mean, x_std, y_mean, y_std, hidden=HIDDEN):
        super().__init__()
        self.core = Core(hidden)
        self.register_buffer("x_mean", torch.as_tensor(x_mean, dtype=torch.float32))
        self.register_buffer("x_inv_std", torch.as_tensor(1.0 / np.asarray(x_std), dtype=torch.float32))
        self.register_buffer("y_mean", torch.as_tensor(y_mean, dtype=torch.float32))
        self.register_buffer("y_std", torch.as_tensor(y_std, dtype=torch.float32))
        self.register_buffer("log_y_std", torch.log(torch.as_tensor(y_std, dtype=torch.float32)))

    def forward(self, x):
        mu_n, ls_n = self.core((x - self.x_mean) * self.x_inv_std)
        return mu_n * self.y_std + self.y_mean, ls_n + self.log_y_std


def load_model(path=OUT / "drift.pt"):
    ck = torch.load(path, weights_only=False)
    m = Drift(ck["x_mean"], ck["x_std"], ck["y_mean"], ck["y_std"], ck.get("hidden", HIDDEN))
    m.load_state_dict(ck["state"])
    m.eval()
    return m, ck


def predict(model, X, batch=65536):
    mus, lss = [], []
    with torch.no_grad():
        for i in range(0, len(X), batch):
            mu, ls = model(torch.from_numpy(np.ascontiguousarray(X[i:i + batch])))
            mus.append(mu.numpy())
            lss.append(ls.numpy())
    return np.concatenate(mus), np.concatenate(lss)


def save_json(path, obj):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(json.dumps(obj, indent=2))
