// Picking helpers for the globe. Pure module (no three, no DOM) so it runs in Node tests.
//
// Globe convention (shared with ocean/particles/streamlines): unit sphere at the origin, y up,
// lon 0 / lat 0 at +z, lon +90 at +x.
//   p = (cos(lat) sin(lon), sin(lat), cos(lat) cos(lon))

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

const xyz = (v) => (Array.isArray(v) || ArrayBuffer.isView(v) ? [v[0], v[1], v[2]] : [v.x, v.y, v.z]);

/** [lon, lat] in degrees -> [x, y, z] on a sphere of radius r. */
export function lonLatToVec3(lon, lat, r = 1) {
  const la = lat * D2R, lo = lon * D2R, c = Math.cos(la);
  return [r * c * Math.sin(lo), r * Math.sin(la), r * c * Math.cos(lo)];
}

/** [x, y, z] (any length) -> [lon, lat] in degrees, lon in [-180, 180). */
export function vec3ToLonLat(x, y, z) {
  const len = Math.hypot(x, y, z) || 1;
  const lat = Math.asin(Math.max(-1, Math.min(1, y / len))) * R2D;
  let lon = Math.atan2(x, z) * R2D;
  if (lon >= 180) lon -= 360;
  return [lon, lat];
}

/**
 * Ray-sphere intersection -> [lon, lat] of the nearest hit in front of the ray origin, or null.
 * ray: {origin, direction} as THREE.Vector3-like {x,y,z} or [x,y,z]; direction need not be unit.
 */
export function rayToLonLat(ray, radius = 1) {
  if (!ray || !ray.origin || !ray.direction) return null;
  const [ox, oy, oz] = xyz(ray.origin);
  let [dx, dy, dz] = xyz(ray.direction);
  const dl = Math.hypot(dx, dy, dz);
  if (!(dl > 0)) return null;
  dx /= dl; dy /= dl; dz /= dl;
  const b = ox * dx + oy * dy + oz * dz;
  const c = ox * ox + oy * oy + oz * oz - radius * radius;
  const disc = b * b - c;
  if (!(disc >= 0)) return null;
  const s = Math.sqrt(disc);
  let t = -b - s;
  if (t < 0) t = -b + s; // origin inside the sphere
  if (t < 0) return null; // sphere behind the ray
  return vec3ToLonLat(ox + t * dx, oy + t * dy, oz + t * dz);
}

export const TAP_MAX_PX = 8;
export const TAP_MAX_MS = 300;

/**
 * A pointer down/up pair is a tap (drop/select) when it moved < 8 px and lasted < 300 ms;
 * anything else is a drag (rotate) or a scroll. down/up: {x, y, t} (px, ms).
 */
export function isTap(down, up) {
  if (!down || !up) return false;
  const moved = Math.hypot(up.x - down.x, up.y - down.y);
  const dt = up.t - down.t;
  return moved < TAP_MAX_PX && dt >= 0 && dt < TAP_MAX_MS;
}

/**
 * Land lookup in an equirectangular mask (row 0 = 90 N, column 0 = 180 W), as landmask.png.
 * mask: {width, height, data, stride?} with data a byte per pixel (or `stride` bytes, first used);
 * values >= 128 are land.
 */
export function isLandAt(mask, lon, lat) {
  const { width: w, height: h, data } = mask;
  const stride = mask.stride || 1;
  let x = Math.floor(((((lon + 180) % 360) + 360) % 360) / 360 * w);
  if (x >= w) x = w - 1;
  let y = Math.floor((90 - lat) / 180 * h);
  y = Math.max(0, Math.min(h - 1, y));
  return data[(y * w + x) * stride] >= 128;
}

export const LAND_MESSAGE = 'Drop it in the water';

/**
 * Where a tap would drop an item. Returns {ok:true, lon, lat}, or {ok:false, reason, message}
 * with reason 'miss' (the ray missed the globe) or 'land' (the tap hit land: nothing is dropped).
 * isLand: (lon, lat) -> bool, or a mask object for isLandAt.
 */
export function dropTarget(ray, isLand, radius = 1) {
  const ll = rayToLonLat(ray, radius);
  if (!ll) return { ok: false, reason: 'miss', message: '' };
  const [lon, lat] = ll;
  const land = typeof isLand === 'function' ? isLand(lon, lat) : isLand ? isLandAt(isLand, lon, lat) : false;
  if (land) return { ok: false, reason: 'land', message: LAND_MESSAGE, lon, lat };
  return { ok: true, lon, lat };
}
