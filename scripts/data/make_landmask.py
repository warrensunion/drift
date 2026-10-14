"""Natural Earth 50m land (public domain) -> public/data/landmask.png (2048x1024, 255 = land)."""
import json

from PIL import Image, ImageDraw

from common import CACHE, PUBLIC, get

URL = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_land.geojson"
W, H = 2048, 1024


def px(ring):
    return [((x + 180) / 360 * W, (90 - y) / 180 * H) for x, y in ring]


def main():
    f = CACHE / "ne_50m_land.geojson"
    if not f.exists():
        f.write_bytes(get(URL, timeout=(20, 300)).content)
    gj = json.loads(f.read_text(encoding="utf-8"))
    img = Image.new("L", (W, H), 0)
    dr = ImageDraw.Draw(img)
    for feat in gj["features"]:
        g = feat["geometry"]
        polys = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
        for poly in polys:
            dr.polygon(px(poly[0]), fill=255)
            for hole in poly[1:]:
                dr.polygon(px(hole), fill=0)
    (PUBLIC).mkdir(parents=True, exist_ok=True)
    img.save(PUBLIC / "landmask.png", optimize=True)
    print("wrote landmask.png", img.size, "land fraction",
          sum(1 for p in img.getdata() if p) / (W * H))


if __name__ == "__main__":
    main()
