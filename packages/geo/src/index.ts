/**
 * `@nexus/geo` — framework-free geodetic core.
 *
 * Everything the GeoBIM cluster model needs to place local ENU geometry on the
 * Earth (or another body): ellipsoids, geodetic ↔ ECEF ↔ ENU, geodesics, EPSG
 * projections and `IfcMapConversion`.
 *
 * No UI framework, no Three.js, no DOM. The same functions serve the Vue portal,
 * the React reference app and a partner app.
 */
export type { Ellipsoid } from './ellipsoid.ts';
export { WGS84, GRS80, MOON, MARS, ELLIPSOIDS, resolveEllipsoid } from './ellipsoid.ts';

export type { Geodetic, Ecef, Enu } from './geodetic.ts';
export {
  geodeticToEcef,
  ecefToGeodetic,
  ecefToEnu,
  enuToEcef,
  geodeticToEnu,
  enuToGeodetic,
} from './geodetic.ts';

export type { GeodesicResult } from './geodesic.ts';
export { geodesic, geodesicDistance, initialBearing, destination } from './geodesic.ts';

export type { Projected, Projector } from './projection.ts';
export {
  createEpsgProjector,
  geodeticToProjected,
  projectedToGeodetic,
  registerProjection,
} from './projection.ts';

export { definitionForEpsg, ensureEpsgDefinition, knownEpsgCodes } from './definitions.ts';

export type { ClusterGeoReferenceLike, ProjectedPoint } from './geo-reference.ts';
export {
  enuToProjected,
  projectedToEnu,
  geodeticToLocalEnu,
  localEnuToGeodetic,
  localEnuToGeodeticProjected,
} from './geo-reference.ts';
