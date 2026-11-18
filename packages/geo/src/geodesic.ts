/**
 * Geodesics on an ellipsoid.
 *
 * Vincenty's inverse and direct formulae, with a haversine fallback for the
 * near-antipodal case where Vincenty does not converge. Distances are metres,
 * bearings degrees clockwise from true north.
 */
import { resolveEllipsoid, type Ellipsoid } from './ellipsoid.ts';
import type { Geodetic } from './geodetic.ts';

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;
const VINCENTY_MAX_ITERATIONS = 200;
const VINCENTY_TOLERANCE = 1e-12;

export type GeodesicResult = {
  /** Metres along the ellipsoid surface. */
  distance: number;
  /** Degrees, clockwise from true north at the start point. */
  initialBearing: number;
  /** Clockwise from true north at the end point. */
  finalBearing: number;
};

/** Great-circle distance on a sphere of the ellipsoid's mean radius. */
function haversine(a: Geodetic, b: Geodetic, ellipsoid: Ellipsoid): number {
  const r = (2 * ellipsoid.a + ellipsoid.b) / 3;
  const lat1 = a.latitude * DEG;
  const lat2 = b.latitude * DEG;
  const dLat = lat2 - lat1;
  const dLon = (b.longitude - a.longitude) * DEG;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Vincenty inverse. Returns `null` when the iteration does not converge (the
 * near-antipodal case), so callers can fall back instead of returning a wrong
 * number.
 */
function vincentyInverse(a: Geodetic, b: Geodetic, ellipsoid: Ellipsoid): GeodesicResult | null {
  const { a: A, b: B, f } = ellipsoid;
  const L = (b.longitude - a.longitude) * DEG;
  const u1 = Math.atan((1 - f) * Math.tan(a.latitude * DEG));
  const u2 = Math.atan((1 - f) * Math.tan(b.latitude * DEG));
  const sinU1 = Math.sin(u1);
  const cosU1 = Math.cos(u1);
  const sinU2 = Math.sin(u2);
  const cosU2 = Math.cos(u2);

  let lambda = L;
  let sinSigma = 0;
  let cosSigma = 0;
  let sigma = 0;
  let cos2Alpha = 0;
  let cos2SigmaM = 0;
  let converged = false;

  for (let i = 0; i < VINCENTY_MAX_ITERATIONS; i++) {
    const sinLambda = Math.sin(lambda);
    const cosLambda = Math.cos(lambda);
    sinSigma = Math.sqrt(
      (cosU2 * sinLambda) ** 2 + (cosU1 * sinU2 - sinU1 * cosU2 * cosLambda) ** 2,
    );
    if (sinSigma === 0) {
      // Coincident points.
      return { distance: 0, initialBearing: 0, finalBearing: 0 };
    }
    cosSigma = sinU1 * sinU2 + cosU1 * cosU2 * cosLambda;
    sigma = Math.atan2(sinSigma, cosSigma);
    const sinAlpha = (cosU1 * cosU2 * sinLambda) / sinSigma;
    cos2Alpha = 1 - sinAlpha * sinAlpha;
    cos2SigmaM = cos2Alpha === 0 ? 0 : cosSigma - (2 * sinU1 * sinU2) / cos2Alpha;
    const c = (f / 16) * cos2Alpha * (4 + f * (4 - 3 * cos2Alpha));
    const previous = lambda;
    lambda =
      L +
      (1 - c) *
        f *
        sinAlpha *
        (sigma + c * sinSigma * (cos2SigmaM + c * cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM)));
    if (Math.abs(lambda - previous) < VINCENTY_TOLERANCE) {
      converged = true;
      break;
    }
  }

  if (!converged) return null;

  const uSq = (cos2Alpha * (A * A - B * B)) / (B * B);
  const bigA = 1 + (uSq / 16384) * (4096 + uSq * (-768 + uSq * (320 - 175 * uSq)));
  const bigB = (uSq / 1024) * (256 + uSq * (-128 + uSq * (74 - 47 * uSq)));
  const deltaSigma =
    bigB *
    sinSigma *
    (cos2SigmaM +
      (bigB / 4) *
        (cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM) -
          (bigB / 6) *
            cos2SigmaM *
            (-3 + 4 * sinSigma * sinSigma) *
            (-3 + 4 * cos2SigmaM * cos2SigmaM)));
  const distance = B * bigA * (sigma - deltaSigma);

  const sinLambda = Math.sin(lambda);
  const cosLambda = Math.cos(lambda);
  const initialBearing =
    Math.atan2(cosU2 * sinLambda, cosU1 * sinU2 - sinU1 * cosU2 * cosLambda) * RAD;
  const finalBearing =
    Math.atan2(cosU1 * sinLambda, -sinU1 * cosU2 + cosU1 * sinU2 * cosLambda) * RAD;

  return {
    distance,
    initialBearing: (initialBearing + 360) % 360,
    finalBearing: (finalBearing + 360) % 360,
  };
}

/** Full geodesic result between two points. */
export function geodesic(a: Geodetic, b: Geodetic, ellipsoid?: Ellipsoid): GeodesicResult {
  const ell = resolveEllipsoid(ellipsoid);
  const result = vincentyInverse(a, b, ell);
  if (result) return result;
  // Near-antipodal: Vincenty does not converge. Fall back to a spherical
  // distance and a great-circle bearing rather than returning a wrong value.
  const distance = haversine(a, b, ell);
  const lat1 = a.latitude * DEG;
  const lat2 = b.latitude * DEG;
  const dLon = (b.longitude - a.longitude) * DEG;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  const bearing = (Math.atan2(y, x) * RAD + 360) % 360;
  return { distance, initialBearing: bearing, finalBearing: bearing };
}

/** Surface distance in metres. */
export function geodesicDistance(a: Geodetic, b: Geodetic, ellipsoid?: Ellipsoid): number {
  return geodesic(a, b, ellipsoid).distance;
}

/** Initial bearing in degrees, clockwise from true north. */
export function initialBearing(a: Geodetic, b: Geodetic, ellipsoid?: Ellipsoid): number {
  return geodesic(a, b, ellipsoid).initialBearing;
}

/**
 * Vincenty direct: the point reached by travelling `distance` metres from
 * `from` along `bearingDeg`.
 */
export function destination(
  from: Geodetic,
  bearingDeg: number,
  distance: number,
  ellipsoid?: Ellipsoid,
): Geodetic {
  const { a: A, b: B, f } = resolveEllipsoid(ellipsoid);
  const alpha1 = bearingDeg * DEG;
  const sinAlpha1 = Math.sin(alpha1);
  const cosAlpha1 = Math.cos(alpha1);
  const tanU1 = (1 - f) * Math.tan(from.latitude * DEG);
  const cosU1 = 1 / Math.sqrt(1 + tanU1 * tanU1);
  const sinU1 = tanU1 * cosU1;
  const sigma1 = Math.atan2(tanU1, cosAlpha1);
  const sinAlpha = cosU1 * sinAlpha1;
  const cos2Alpha = 1 - sinAlpha * sinAlpha;
  const uSq = (cos2Alpha * (A * A - B * B)) / (B * B);
  const bigA = 1 + (uSq / 16384) * (4096 + uSq * (-768 + uSq * (320 - 175 * uSq)));
  const bigB = (uSq / 1024) * (256 + uSq * (-128 + uSq * (74 - 47 * uSq)));

  let sigma = distance / (B * bigA);
  let sigmaPrev = 0;
  let cos2SigmaM = 0;
  let sinSigma = 0;
  let cosSigma = 0;
  for (let i = 0; i < VINCENTY_MAX_ITERATIONS; i++) {
    cos2SigmaM = Math.cos(2 * sigma1 + sigma);
    sinSigma = Math.sin(sigma);
    cosSigma = Math.cos(sigma);
    const deltaSigma =
      bigB *
      sinSigma *
      (cos2SigmaM +
        (bigB / 4) *
          (cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM) -
            (bigB / 6) *
              cos2SigmaM *
              (-3 + 4 * sinSigma * sinSigma) *
              (-3 + 4 * cos2SigmaM * cos2SigmaM)));
    sigmaPrev = sigma;
    sigma = distance / (B * bigA) + deltaSigma;
    if (Math.abs(sigma - sigmaPrev) < VINCENTY_TOLERANCE) break;
  }

  const tmp = sinU1 * sinSigma - cosU1 * cosSigma * cosAlpha1;
  const lat2 = Math.atan2(
    sinU1 * cosSigma + cosU1 * sinSigma * cosAlpha1,
    (1 - f) * Math.sqrt(sinAlpha * sinAlpha + tmp * tmp),
  );
  const lambda = Math.atan2(
    sinSigma * sinAlpha1,
    cosU1 * cosSigma - sinU1 * sinSigma * cosAlpha1,
  );
  const c = (f / 16) * cos2Alpha * (4 + f * (4 - 3 * cos2Alpha));
  const L =
    lambda - (1 - c) * f * sinAlpha * (sigma + c * sinSigma * (cos2SigmaM + c * cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM)));

  return {
    latitude: lat2 * RAD,
    longitude: from.longitude + L * RAD,
    height: from.height,
  };
}
