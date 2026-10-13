"""GDP 6-hourly QC drifters, one fix per drifter-day, 2012-01-01..2014-09-26 -> cache/drifters.csv."""
import datetime as dt
import io
from urllib.parse import quote

import pandas as pd

from common import CACHE, get

BASE = "https://erddap.aoml.noaa.gov/gdp/erddap/tabledap/drifter_6hour_qc.csv"
START = dt.date(2012, 1, 1)
END = dt.date(2014, 9, 27)  # exclusive: includes 2014-09-26 fixes


def fetch_range(a, b):
    q = ("ID,time,latitude,longitude,drogue_lost_date"
         f"&time>={a.isoformat()}T00:00:00Z&time<{b.isoformat()}T00:00:00Z"
         '&orderByClosest("ID,time/1day")')
    url = BASE + "?" + quote(q, safe=",&=<>/:()")
    # quote() leaves '"' encoded as %22 and '>'/'<' raw; ERDDAP accepts both
    r = get(url, timeout=(30, 600), tries=6)
    return pd.read_csv(io.StringIO(r.text), skiprows=[1])


def quarters():
    y, m = START.year, START.month
    cur = START
    while cur < END:
        nm = m + 3
        ny = y + (nm - 1) // 12
        nm = (nm - 1) % 12 + 1
        nxt = min(dt.date(ny, nm, 1), END)
        yield cur, nxt
        cur, y, m = nxt, ny, nm


def main():
    frames = []
    for a, b in quarters():
        f = CACHE / f"drifters-{a}.csv"
        if f.exists():
            df = pd.read_csv(f)
        else:
            try:
                df = fetch_range(a, b)
            except RuntimeError as e:
                print("quarter failed, trying months:", e)
                parts = []
                cur = a
                while cur < b:
                    nxt = min(dt.date(cur.year + (cur.month // 12), cur.month % 12 + 1, 1), b)
                    parts.append(fetch_range(cur, nxt))
                    cur = nxt
                df = pd.concat(parts)
            df.to_csv(f, index=False)
        print(a, b, len(df), df.ID.nunique(), flush=True)
        frames.append(df)
    df = pd.concat(frames, ignore_index=True).drop_duplicates(["ID", "time"])
    df.to_csv(CACHE / "drifters.csv", index=False)
    print("total fixes", len(df), "drifters", df.ID.nunique())


if __name__ == "__main__":
    main()
