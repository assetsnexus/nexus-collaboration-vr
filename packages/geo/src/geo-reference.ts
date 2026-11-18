/**
 * `ClusterGeoReference` ↔ local ENU.
 *
 * The cluster model stores geometry in a local ENU frame anchored at
 * `geoReference.anchor`. To place that geometry on a map or in an IFC viewer it
 * has to be expressed in the cluster's projected CRS, which is what
 * `IfcMapConversion` describes:
 *
 * - `eastings` / `northings` / `orthogonalHeight`: the projected coordinates of
 *   the local origin.
 * - `xAxisAbscissa` (cos θ) / `xAxisOrdinate` (sin θ): the rotation of the local
 *   X axis in the projected CRS.
 * - `scale`: the scale factor (usually 1).
 *
 * When `mapConversion` is absent the anchor is projected through `projectedCrs`
 * and the rotation is taken as zero, which is the common case for a site grid
 * aligned to the CRS.
 */
import type { Enu, Geodetic } from './geodetic.ts';
import { geodeticToEnu, enuToGeodetic } from './geodetic.ts';
import { createEpsgProjector, projectedToGeodetic } from './projection.ts';
import type { Ellipsoid } from './ellipsoid.ts';

export type ClusterGeoReferenceLike = {
  anchor: { latitude: number; longitude: number; elevation: number };
  projectedCrs?: number;
  mapConversion?: {
    eastings: number;
    northings: number;
    orthogonalHeight: number;
    xAxisAbscissa?: number;
    xAxisOrdinate?: number;
    scale?: number;
  };
  gridRotationDeg?: number;
  heightModel?: string;
};

export type ProjectedPoint = { easting: number; northing: number; height: number };

function anchorGeodetic(ref: ClusterGeoReferenceLike): Geodetic {
  return {
    latitude: ref.anchor.latitude,
    longitude: ref.anchor.longitude,
    height: ref.anchor.elevation,
  };
}

type Conversion = {
  eastings: number;
  northings: number;
  orthogonalHeight: number;
  cos: number;
  sin: number;
  scale: number;
};

/**
 * Resolves the map conversion, projecting the anchor when the model does not
 * carry one. Throws when neither a `mapConversion` nor a `projectedCrs` exists —
 * a cluster with no CRS cannot be placed on a map.
 */
function resolveConversion(ref: ClusterGeoReferenceLike): Conversion {
  if (ref.mapConversion) {
    const mc = ref.mapConversion;
    return {
      eastings: mc.eastings,
      northings: mc.northings,
      orthogonalHeight: mc.orthogonalHeight,
      cos: mc.xAxisAbscissa ?? 1,
      sin: mc.xAxisOrdinate ?? 0,
      scale: mc.scale ?? 1,
    };
  }
  if (!ref.projectedCrs) {
    throw new Error(
      'ClusterGeoReference has neither mapConversion nor projectedCrs; cannot place local ENU on a map.',
    );
  }
  const [eastings, northings] = createEpsgProjector(ref.projectedCrs).forward(anchorGeodetic(ref));
  // `gridRotationDeg` rotates the local grid against true north; the projected
  // X axis is east, so a grid rotation of θ maps to a rotation of -θ here.
  const theta = (-(ref.gridRotationDeg ?? 0) * Math.PI) / 180;
  return {
    eastings,
    northings,
    orthogonalHeight: ref.anchor.elevation,
    cos: Math.cos(theta),
    sin: Math.sin(theta),
    scale: 1,
  };
}

/** Local ENU → projected easting/northing/height. */
export function enuToProjected(point: Enu, ref: ClusterGeoReferenceLike): ProjectedPoint {
  const c = resolveConversion(ref);
  return {
    easting: c.eastings + c.scale * (c.cos * point.east - c.sin * point.north),
    northing: c.northings + c.scale * (c.sin * point.east + c.cos * point.north),
    height: c.orthogonalHeight + point.up,
  };
}

/** Projected easting/northing/height → local ENU. */
export function projectedToEnu(
  easting: number,
  northing: number,
  height: number,
  ref: ClusterGeoReferenceLike,
): Enu {
  const c = resolveConversion(ref);
  const dx = (easting - c.eastings) / c.scale;
  const dy = (northing - c.northings) / c.scale;
  return {
    east: c.cos * dx + c.sin * dy,
    north: -c.sin * dx + c.cos * dy,
    up: height - c.orthogonalHeight,
  };
}

/** Geodetic → local ENU (through ECEF, so earth curvature is respected). */
export function geodeticToLocalEnu(
  point: Geodetic,
  ref: ClusterGeoReferenceLike,
  ellipsoid?: Ellipsoid,
): Enu {
  return geodeticToEnu(point, anchorGeodetic(ref), ellipsoid);
}

/** Local ENU → geodetic (through ECEF). */
export function localEnuToGeodetic(
  point: Enu,
  ref: ClusterGeoReferenceLike,
  ellipsoid?: Ellipsoid,
): Geodetic {
  return enuToGeodetic(point, anchorGeodetic(ref), ellipsoid);
}

/** Local ENU → geodetic via the projected CRS (flat-earth within the CRS). */
export function localEnuToGeodeticProjected(
  point: Enu,
  ref: ClusterGeoReferenceLike,
): Geodetic {
  if (!ref.projectedCrs) {
    throw new Error('ClusterGeoReference has no projectedCrs; cannot project local ENU.');
  }
  const projected = enuToProjected(point, ref);
  return projectedToGeodetic(projected.easting, projected.northing, ref.projectedCrs, projected.height);
}
