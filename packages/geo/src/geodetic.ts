/**
 * Geodetic ↔ ECEF ↔ ENU.
 *
 * Conventions:
 * - `latitude`/`longitude` in degrees, `height` in metres above the ellipsoid.
 * - ECEF is Earth-Centred, Earth-Fixed, metres.
 * - ENU is a local tangent frame: `east`, `north`, `up`, metres, anchored at a
 *   geodetic origin. This is the frame the cluster model stores geometry in.
 */
import { resolveEllipsoid, type Ellipsoid } from './ellipsoid.ts';

export type Geodetic = { latitude: number; longitude: number; height: number };
export type Ecef = { x: number; y: number; z: number };
export type Enu = { east: number; north: number; up: number };

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

export function geodeticToEcef(point: Geodetic, ellipsoid?: Ellipsoid): Ecef {
  const { a, e2 } = resolveEllipsoid(ellipsoid);
  const lat = point.latitude * DEG;
  const lon = point.longitude * DEG;
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const sinLon = Math.sin(lon);
  const cosLon = Math.cos(lon);
  const n = a / Math.sqrt(1 - e2 * sinLat * sinLat);
  const h = point.height;
  return {
    x: (n + h) * cosLat * cosLon,
    y: (n + h) * cosLat * sinLon,
    z: (n * (1 - e2) + h) * sinLat,
  };
}

/**
 * ECEF → geodetic.
 *
 * Bowring's closed-form approximation, then one Newton refinement. Converges to
 * sub-millimetre on Earth and stays stable at the poles, where an iterative
 * latitude-only loop can stall.
 */
export function ecefToGeodetic(point: Ecef, ellipsoid?: Ellipsoid): Geodetic {
  const { a, b, e2 } = resolveEllipsoid(ellipsoid);
  const { x, y, z } = point;
  const lon = Math.atan2(y, x);
  const p = Math.hypot(x, y);

  if (p < 1e-9) {
    // On the polar axis: latitude is ±90°, height is measured along z.
    const sign = z >= 0 ? 1 : -1;
    return { latitude: 90 * sign, longitude: 0, height: Math.abs(z) - b };
  }

  const ep2 = (a * a - b * b) / (b * b);
  const theta = Math.atan2(z * a, p * b);
  const sinTheta = Math.sin(theta);
  const cosTheta = Math.cos(theta);
  let lat = Math.atan2(
    z + ep2 * b * sinTheta * sinTheta * sinTheta,
    p - e2 * a * cosTheta * cosTheta * cosTheta,
  );

  // One Newton step on the ellipsoid equation tightens the result.
  let n = a / Math.sqrt(1 - e2 * Math.sin(lat) * Math.sin(lat));
  let height = p / Math.cos(lat) - n;
  for (let i = 0; i < 2; i++) {
    const sinLat = Math.sin(lat);
    n = a / Math.sqrt(1 - e2 * sinLat * sinLat);
    const next = Math.atan2(z, p * (1 - (e2 * n) / (n + height)));
    if (Math.abs(next - lat) < 1e-14) {
      lat = next;
      break;
    }
    lat = next;
    height = p / Math.cos(lat) - n;
  }

  return { latitude: lat * RAD, longitude: lon * RAD, height };
}

/** Rotation matrix from ECEF to the ENU frame anchored at `origin`. */
function ecefToEnuMatrix(origin: Geodetic): number[][] {
  const lat = origin.latitude * DEG;
  const lon = origin.longitude * DEG;
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const sinLon = Math.sin(lon);
  const cosLon = Math.cos(lon);
  return [
    [-sinLon, cosLon, 0],
    [-sinLat * cosLon, -sinLat * sinLon, cosLat],
    [cosLat * cosLon, cosLat * sinLon, sinLat],
  ];
}

export function ecefToEnu(point: Ecef, origin: Geodetic, ellipsoid?: Ellipsoid): Enu {
  const originEcef = geodeticToEcef(origin, ellipsoid);
  const dx = point.x - originEcef.x;
  const dy = point.y - originEcef.y;
  const dz = point.z - originEcef.z;
  const m = ecefToEnuMatrix(origin);
  return {
    east: m[0][0] * dx + m[0][1] * dy + m[0][2] * dz,
    north: m[1][0] * dx + m[1][1] * dy + m[1][2] * dz,
    up: m[2][0] * dx + m[2][1] * dy + m[2][2] * dz,
  };
}

export function enuToEcef(point: Enu, origin: Geodetic, ellipsoid?: Ellipsoid): Ecef {
  const originEcef = geodeticToEcef(origin, ellipsoid);
  const m = ecefToEnuMatrix(origin);
  // The matrix is orthonormal, so its transpose is the inverse.
  return {
    x: originEcef.x + m[0][0] * point.east + m[1][0] * point.north + m[2][0] * point.up,
    y: originEcef.y + m[0][1] * point.east + m[1][1] * point.north + m[2][1] * point.up,
    z: originEcef.z + m[0][2] * point.east + m[1][2] * point.north + m[2][2] * point.up,
  };
}

export function geodeticToEnu(point: Geodetic, origin: Geodetic, ellipsoid?: Ellipsoid): Enu {
  return ecefToEnu(geodeticToEcef(point, ellipsoid), origin, ellipsoid);
}

export function enuToGeodetic(point: Enu, origin: Geodetic, ellipsoid?: Ellipsoid): Geodetic {
  return ecefToGeodetic(enuToEcef(point, origin, ellipsoid), ellipsoid);
}
