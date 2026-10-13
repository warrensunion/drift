"""Generate public/data/credits.json from the dataset table in DATA.md.

One object per table row, cells copied verbatim: name (Dataset), source (Source),
url (the first http(s) URL in Source), licence, fetched, processing.
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HEAD = ["Dataset", "Source", "Licence", "Fetched", "Processing"]


def rows(md):
    lines = [ln.strip() for ln in md.splitlines()]
    cells = lambda ln: [c.strip() for c in ln.strip("|").split("|")]  # noqa: E731
    i = next(k for k, ln in enumerate(lines) if ln.startswith("|") and cells(ln) == HEAD)
    out = []
    for ln in lines[i + 2:]:
        if not ln.startswith("|"):
            break
        c = cells(ln)
        assert len(c) == len(HEAD), f"bad DATA.md row: {ln[:80]}"
        out.append(dict(name=c[0], source=c[1], url=re.search(r"https?://\S+", c[1]).group(0),
                        licence=c[2], fetched=c[3], processing=c[4]))
    return out


def main():
    r = rows((ROOT / "DATA.md").read_text(encoding="utf-8"))
    (ROOT / "public" / "data" / "credits.json").write_text(json.dumps(r, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print("wrote credits.json:", len(r), "rows")


if __name__ == "__main__":
    main()
