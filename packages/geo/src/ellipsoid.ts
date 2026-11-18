/**
 * Reference ellipsoids.
 *
 * The geodetic core is not Earth-only: a cluster can be a lunar site or a Mars
 * analogue, and the same ENU/ECEF math applies with a different ellipsoid. Every
 * function takes an optional ellipsoid and defaults to WGS84.
 *
 * `a` is the semi-major axis in metres, `f` the flattening. `b` and `e2` are
 * derived so callers never have to recompute them.
 */
export type Ellipsoid = {
  name: string;
  /** Semi-major axis, metres. */
  a: number;
  /** Flattening. */
  f: number;
  /** Semi-minor axis, metres. */
  b: number;
  /** First eccentricity squared. */
  e2: number;
};

function makeEllipsoid(name: string, a: number, f: number): Ellipsoid {
  const b = a * (1 - f);
  const e2 = 1 - (b * b) / (a * a);
  return { name, a, f, b, e2 };
}

/** WGS84 — the default for every function in this package. */
export const WGS84: Ellipsoid = makeEllipsoid('WGS84', 6378137.0, 1 / 298.257223563);

/** GRS 80 — the ellipsoid behind most national projected CRS (e.g. ETRS89). */
export const GRS80: Ellipsoid = makeEllipsoid('GRS80', 6378137, 1 / 298.257222101);

/** IAU 2015 mean Earth ellipsoid, used by some lunar reference frames. */
export const MOON: Ellipsoid = makeEllipsoid('MOON', 1737400, 0);

/** Mars (IAU 2015), for a Mars analogue site. */
export const MARS: Ellipsoid = makeEllipsoid('MARS', 3396190, 1 / 169.89444722361179);

export const ELLIPSOIDS: Readonly<Record<string, Ellipsoid>> = Object.freeze({
  WGS84,
  GRS80,
  MOON,
  MARS,
});

/** Resolves a named ellipsoid, defaulting to WGS84. */
export function resolveEllipsoid(name?: string | Ellipsoid | null): Ellipsoid {
  if (!name) return WGS84;
  if (typeof name !== 'string') return name;
  return ELLIPSOIDS[name.toUpperCase()] ?? WGS84;
}
