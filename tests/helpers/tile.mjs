// Build a DRFT ArrayBuffer. cells: function(frame, y, x) -> [u, v] int16 units.
export function buildTile({ nx, ny, nframes = 1, lon0, lat0, dlon, dlat, scale = 1, cell }) {
  const buf = new ArrayBuffer(32 + nframes * ny * nx * 4);
  const dv = new DataView(buf);
  'DRFT'.split('').forEach((c, i) => dv.setUint8(i, c.charCodeAt(0)));
  dv.setUint16(4, 1, true);
  dv.setUint16(6, nx, true);
  dv.setUint16(8, ny, true);
  dv.setUint16(10, nframes, true);
  [lon0, lat0, dlon, dlat, scale].forEach((v, i) => dv.setFloat32(12 + i * 4, v, true));
  let o = 32;
  for (let f = 0; f < nframes; f++)
    for (let y = 0; y < ny; y++)
      for (let x = 0; x < nx; x++) {
        const [u, v] = cell(f, y, x);
        dv.setInt16(o, u, true);
        dv.setInt16(o + 2, v, true);
        o += 4;
      }
  return buf;
}
