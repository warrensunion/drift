// Midpoint RK2 advection on a spherical Earth. Pure module.
const R = 6371000;
const DEG = 180 / Math.PI;

export function metersToDeg(dxM, dyM, lat) {
  const dLat = (dyM / R) * DEG;
  const dLon = (dxM / (R * Math.cos((lat * Math.PI) / 180))) * DEG;
  return [dLon, dLat];
}

function normLon(lon) {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

export function rk2Step(sampleFn, lon, lat, dtSeconds) {
  const k1 = sampleFn(lon, lat);
  if (!k1) return null;
  const [h1, h2] = metersToDeg(k1[0] * dtSeconds * 0.5, k1[1] * dtSeconds * 0.5, lat);
  const midLat = lat + h2;
  const k2 = sampleFn(normLon(lon + h1), midLat);
  if (!k2) return null;
  const [dLon, dLat] = metersToDeg(k2[0] * dtSeconds, k2[1] * dtSeconds, midLat);
  return [normLon(lon + dLon), lat + dLat];
}
