/**
 * EPSG projections via `proj4`.
 *
 * A cluster's `projectedCrs` is an EPSG code (e.g. 25832 for ETRS89 / UTM 32N).
 * This module wraps proj4 behind a tiny interface so the rest of the package
 * never imports it directly and a caller can inject a different implementation.
 */
import proj4 from 'proj4';
import type { Geodetic } from './geodetic.ts';
import { ensureEpsgDefinition } from './definitions.ts';

export type Projected = { easting: number; northing: number };

export type Projector = {
  /** EPSG code, when the projector was built from one. */
  epsg?: number;
  /** Geodetic → projected (easting, northing). */
  forward(point: Geodetic): [number, number];
  /** Projected → geodetic. Height is not projected; pass it through. */
  inverse(easting: number, northing: number): [number, number];
};

const cache = new Map<string, Projector>();

/** `EPSG:25832` → `+proj=utm +zone=32 +ellps=GRS80 +units=m +no_defs` via proj4's registry. */
function definitionFor(epsg: number): string {
  if (!Number.isInteger(epsg) || epsg <= 0) {
    throw new Error(`Invalid EPSG code: ${epsg}`);
  }
  return `EPSG:${epsg}`;
}

/**
 * Builds a projector for an EPSG code or a registered definition name. Throws
 * when proj4 does not know it, so a bad `projectedCrs` fails loudly instead of
 * silently using a flat-earth approximation.
 */
export function createEpsgProjector(epsg: number): Projector;
export function createEpsgProjector(name: string): Projector;
export function createEpsgProjector(code: number | string): Projector {
  const key = typeof code === 'number' ? definitionFor(code) : String(code).trim();
  if (!key) throw new Error('Projection name is empty');
  const cached = cache.get(key);
  if (cached) return cached;

  if (typeof code === 'number') {
    // Register the common EPSG families on demand; proj4 ships only a few.
    ensureEpsgDefinition(code);
  }

  if (!proj4.defs(key)) {
    throw new Error(
      `Unknown projection ${key}. Register it with proj4.defs() before projecting.`,
    );
  }

  const projector: Projector = {
    ...(typeof code === 'number' ? { epsg: code } : {}),
    forward(point: Geodetic): [number, number] {
      const [easting, northing] = proj4(key, [point.longitude, point.latitude]);
      return [easting, northing];
    },
    inverse(easting: number, northing: number): [number, number] {
      const [longitude, latitude] = proj4(key, 'WGS84', [easting, northing]);
      return [longitude, latitude];
    },
  };
  cache.set(key, projector);
  return projector;
}

/** Geodetic → projected easting/northing. */
export function geodeticToProjected(point: Geodetic, epsg: number): Projected {
  const [easting, northing] = createEpsgProjector(epsg).forward(point);
  return { easting, northing };
}

/** Projected easting/northing → geodetic. `height` is passed through unchanged. */
export function projectedToGeodetic(
  easting: number,
  northing: number,
  epsg: number,
  height = 0,
): Geodetic {
  const [longitude, latitude] = createEpsgProjector(epsg).inverse(easting, northing);
  return { latitude, longitude, height };
}

/** Registers a custom proj4 definition (e.g. a local site grid). */
export function registerProjection(name: string, definition: string): void {
  proj4.defs(name, definition);
}
