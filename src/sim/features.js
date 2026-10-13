// Model input features. Mirrors scripts/train/features.py exactly (docs/spec.md, Model I/O).
// Order: lat/90, sin(lon), cos(lon), u_cur, v_cur (m/s), u_wind/10, v_wind/10 (m/s),
// sin(2 pi doy/365.25), cos(2 pi doy/365.25), windage (0..1). Computed in double, stored float32.
export const N_FEATURES = 10;

/**
 * features(lat, lon, uCur, vCur, uWind, vWind, doy, windage, out?, offset?)
 * Writes the 10 features into out[offset..offset+9] (out defaults to a new Float32Array(10))
 * and returns out.
 */
export function features(lat, lon, uCur, vCur, uWind, vWind, doy, windage, out = new Float32Array(N_FEATURES), offset = 0) {
  const lr = lon * Math.PI / 180;
  const t = 2 * Math.PI * doy / 365.25;
  out[offset] = lat / 90;
  out[offset + 1] = Math.sin(lr);
  out[offset + 2] = Math.cos(lr);
  out[offset + 3] = uCur;
  out[offset + 4] = vCur;
  out[offset + 5] = uWind / 10;
  out[offset + 6] = vWind / 10;
  out[offset + 7] = Math.sin(t);
  out[offset + 8] = Math.cos(t);
  out[offset + 9] = windage;
  return out;
}
