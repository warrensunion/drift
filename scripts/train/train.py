"""Train the drift MLP on daily drifter displacement pairs.

Split by drifter ID 80/10/10 (seeded). Inputs and targets standardised with
train-set statistics (baked into the model, see common_train.Drift). MLP
10->128->128->4 SiLU, Gaussian NLL, Adam, early stopping on validation NLL.
Writes scripts/train/out/drift.pt, split.json, history.json.
"""
import math
import time

import numpy as np
import torch

from common_train import OUT, SEED, Drift, load_pairs, masks, save_json, split_ids

BATCH = 2048
LR = 2e-3
MAX_EPOCHS = 80
PATIENCE = 8


def nll(mu, ls, y):
    """Mean per-row Gaussian NLL (diagonal 2D, constant log(2 pi) dropped)."""
    return (ls + 0.5 * ((y - mu) * torch.exp(-ls)) ** 2).sum(1).mean()


def main():
    torch.manual_seed(SEED)
    torch.set_num_threads(1)  # a tiny MLP; extra threads only contend on a loaded machine
    d = load_pairs()
    split = split_ids(d["id"])
    mk = masks(d, split)
    X, Y = d["X"], d["Y"]
    xm, xs = X[mk["train"]].mean(0), X[mk["train"]].std(0)
    ym, ys = Y[mk["train"]].mean(0), Y[mk["train"]].std(0)
    print("rows", {k: int(v.sum()) for k, v in mk.items()},
          "drifters", {k: len(v) for k, v in split.items()})
    model = Drift(xm, xs, ym, ys)
    core = model.core
    zx = lambda a: torch.from_numpy(((a - xm) / xs).astype(np.float32))  # noqa: E731
    zy = lambda a: torch.from_numpy(((a - ym) / ys).astype(np.float32))  # noqa: E731
    Xtr, Ytr = zx(X[mk["train"]]), zy(Y[mk["train"]])
    Xva, Yva = zx(X[mk["val"]]), zy(Y[mk["val"]])
    opt = torch.optim.Adam(core.parameters(), lr=LR)
    sched = torch.optim.lr_scheduler.ReduceLROnPlateau(opt, factor=0.5, patience=3)
    best, best_state, bad, hist = math.inf, None, 0, []
    g = torch.Generator().manual_seed(SEED)
    log_det = float(np.log(ys).sum())  # standardised NLL + this = NLL in km units
    for ep in range(1, MAX_EPOCHS + 1):
        t0 = time.time()
        core.train()
        perm = torch.randperm(len(Xtr), generator=g)
        tot, nb = 0.0, 0
        for i in range(0, len(perm), BATCH):
            b = perm[i:i + BATCH]
            mu, ls = core(Xtr[b])
            loss = nll(mu, ls, Ytr[b])
            opt.zero_grad()
            loss.backward()
            opt.step()
            tot += loss.item()
            nb += 1
        core.eval()
        with torch.no_grad():
            mu, ls = core(Xva)
            v = nll(mu, ls, Yva).item()
        sched.step(v)
        hist.append(dict(epoch=ep, train_nll=tot / nb + log_det, val_nll=v + log_det,
                         lr=opt.param_groups[0]["lr"], sec=round(time.time() - t0, 1)))
        print(hist[-1], flush=True)
        if v < best - 1e-4:
            best, bad = v, 0
            best_state = {k: t.clone() for k, t in model.state_dict().items()}
        else:
            bad += 1
            if bad >= PATIENCE:
                print("early stop at epoch", ep)
                break
    model.load_state_dict(best_state)
    best_ep = min(hist, key=lambda h: h["val_nll"])["epoch"]
    torch.save(dict(state=model.state_dict(), x_mean=xm, x_std=xs, y_mean=ym, y_std=ys,
                    hidden=128, best_epoch=best_ep, seed=SEED), OUT / "drift.pt")
    save_json(OUT / "split.json", {k: v.tolist() for k, v in split.items()})
    save_json(OUT / "history.json", dict(best_epoch=best_ep, best_val_nll=best + log_det,
                                         nll_units="per row, km, log(2pi) dropped",
                                         epochs=hist))
    print("best epoch", best_ep, "val NLL", best + log_det)


if __name__ == "__main__":
    main()
