// Field tile decoding and sampling. Pure module (worker + node tests).
const LAND = -32768;

export function decodeTile(buf) {
  if (!(buf instanceof ArrayBuffer)) {
    if (ArrayBuffer.isView(buf)) buf = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    else throw new Error('decodeTile: expected an ArrayBuffer');
  }
  if (buf.byteLength < 32) throw new Error('decodeTile: buffer too short for a DRFT header');
  const dv = new DataView(buf);
  const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (magic !== 'DRFT') throw new Error(`decodeTile: bad magic "${magic}", expected "DRFT"`);
  const version = dv.getUint16(4, true);
  if (version !== 1) throw new Error(`decodeTile: unsupported version ${version}, expected 1`);
  const nx = dv.getUint16(6, true), ny = dv.getUint16(8, true), nframes = dv.getUint16(10, true);
  const n = nframes * ny * nx * 2;
  if (buf.byteLength < 32 + n * 2) throw new Error('decodeTile: buffer shorter than header implies');
  // Copy to an aligned buffer so the Int16Array view is valid on any offset.
  const data = new Int16Array(buf.slice(32, 32 + n * 2));
  if (new Uint8Array(new Uint16Array([1]).buffer)[0] !== 1) {
    for (let i = 0; i < n; i++) data[i] = dv.getInt16(32 + i * 2, true);
  }
  return {
    nx, ny, nframes,
    lon0: dv.getFloat32(12, true), lat0: dv.getFloat32(16, true),
    dlon: dv.getFloat32(20, true), dlat: dv.getFloat32(24, true),
    scale: dv.getFloat32(28, true),
    data,
  };
}

const isGlobal = (f) => Math.abs(f.nx * f.dlon - 360) < 0.5 * f.dlon;

export function sample(field, lon, lat, frame = 0) {
  const { nx, ny, lon0, lat0, dlon, dlat, scale, data } = field;
  const fy = (lat - lat0) / dlat;
  if (!(fy >= 0 && fy <= ny - 1)) return null;
  let fx = (lon - lon0) / dlon;
  let x0, x1, tx;
  if (isGlobal(field)) {
    fx = ((fx % nx) + nx) % nx;
    x0 = Math.floor(fx);
    tx = fx - x0;
    if (x0 >= nx) x0 = nx - 1;
    x1 = (x0 + 1) % nx;
  } else {
    if (!(fx >= 0 && fx <= nx - 1)) return null;
    x0 = Math.min(Math.floor(fx), Math.max(nx - 2, 0));
    tx = fx - x0;
    x1 = Math.min(x0 + 1, nx - 1);
  }
  const y0 = Math.min(Math.floor(fy), Math.max(ny - 2, 0));
  const ty = fy - y0;
  const y1 = Math.min(y0 + 1, ny - 1);
  const base = frame * ny * nx * 2;
  const i00 = base + (y0 * nx + x0) * 2, i10 = base + (y0 * nx + x1) * 2;
  const i01 = base + (y1 * nx + x0) * 2, i11 = base + (y1 * nx + x1) * 2;
  if (data[i00] === LAND || data[i10] === LAND || data[i01] === LAND || data[i11] === LAND ||
      data[i00 + 1] === LAND || data[i10 + 1] === LAND || data[i01 + 1] === LAND || data[i11 + 1] === LAND) return null;
  const w00 = (1 - tx) * (1 - ty), w10 = tx * (1 - ty), w01 = (1 - tx) * ty, w11 = tx * ty;
  return [
    (data[i00] * w00 + data[i10] * w10 + data[i01] * w01 + data[i11] * w11) * scale,
    (data[i00 + 1] * w00 + data[i10 + 1] * w10 + data[i01 + 1] * w01 + data[i11 + 1] * w11) * scale,
  ];
}

export function sampleTime(field, lon, lat, t) {
  const n = field.nframes;
  const tw = ((t % n) + n) % n;
  const f0 = Math.floor(tw) % n;
  const f1 = (f0 + 1) % n;
  const w = tw - Math.floor(tw);
  const a = sample(field, lon, lat, f0);
  if (!a) return null;
  if (w === 0) return a;
  const b = sample(field, lon, lat, f1);
  if (!b) return null;
  return [a[0] * (1 - w) + b[0] * w, a[1] * (1 - w) + b[1] * w];
}
