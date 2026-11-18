/**
 * Common EPSG definitions.
 *
 * `proj4` ships only a handful of built-in definitions (4326, 3857, …). A
 * cluster's `projectedCrs` is usually a UTM zone or a national grid, so this
 * module registers the common ones on demand. Anything not listed here can be
 * added with `registerProjection(name, definition)`.
 *
 * The UTM families are generated, not typed out, so a zone can never be
 * mistyped.
 */
import proj4 from 'proj4';

const registered = new Set<string>();

function utm(zone: number, south: boolean, ellps: string): string {
  return `+proj=utm +zone=${zone}${south ? ' +south' : ''} +ellps=${ellps} +units=m +no_defs +type=crs`;
}

/** Static definitions that are not a simple UTM zone. */
const STATIC: Record<number, string> = {
  // ETRS89 / LAEA Europe
  3035: '+proj=laea +lat_0=52 +lon_0=10 +x_0=4321000 +y_0=3210000 +ellps=GRS80 +units=m +no_defs +type=crs',
  // CH1903+ / LV95
  2056: '+proj=somerc +lat_0=46.9524055555556 +lon_0=7.43958333333333 +k_0=1 +x_0=2600000 +y_0=1200000 +ellps=bessel +towgs84=674.374,15.056,405.346,0,0,0,0 +units=m +no_defs +type=crs',
  // OSGB36 / British National Grid
  27700: '+proj=tmerc +lat_0=49 +lon_0=-2 +k=0.9996012717 +x_0=400000 +y_0=-100000 +ellps=airy +towgs84=446.448,-125.157,542.06,0.15,0.247,0.842,-20.489 +units=m +no_defs +type=crs',
  // Amersfoort / RD New
  28992: '+proj=sterea +lat_0=52.1561605555556 +lon_0=5.38763888888889 +k=0.9999079 +x_0=155000 +y_0=463000 +ellps=bessel +towgs84=565.417,50.3319,465.552,-0.398957,0.343988,-1.8774,4.0725 +units=m +no_defs +type=crs',
  // RGF93 v1 / Lambert-93
  2154: '+proj=lcc +lat_0=46.5 +lon_0=3 +lat_1=49 +lat_2=44 +x_0=700000 +y_0=6600000 +ellps=GRS80 +units=m +no_defs +type=crs',
  // S-JTSK / Krovak East North
  5514: '+proj=krovak +lat_0=49.5 +lon_0=24.8333333333333 +alpha=30.2881397222222 +k=0.9999 +x_0=0 +y_0=0 +ellps=bessel +towgs84=589,76,480,0,0,0,0 +units=m +no_defs +type=crs',
};

/** Returns the proj4 definition for an EPSG code, or `undefined` when unknown. */
export function definitionForEpsg(epsg: number): string | undefined {
  if (!Number.isInteger(epsg) || epsg <= 0) return undefined;
  if (STATIC[epsg]) return STATIC[epsg];
  // ETRS89 / UTM 28N–38N
  if (epsg >= 25828 && epsg <= 25838) return utm(epsg - 25800, false, 'GRS80');
  // WGS 84 / UTM north
  if (epsg >= 32601 && epsg <= 32660) return utm(epsg - 32600, false, 'WGS84');
  // WGS 84 / UTM south
  if (epsg >= 32701 && epsg <= 32760) return utm(epsg - 32700, true, 'WGS84');
  return undefined;
}

/**
 * Registers an EPSG definition with proj4 when it is known and not already
 * registered. Returns true when proj4 can now project it.
 */
export function ensureEpsgDefinition(epsg: number): boolean {
  const name = `EPSG:${epsg}`;
  if (proj4.defs(name)) return true;
  if (registered.has(name)) return true;
  const definition = definitionForEpsg(epsg);
  if (!definition) return false;
  proj4.defs(name, definition);
  registered.add(name);
  return true;
}

/** Every EPSG code this package can project without extra registration. */
export function knownEpsgCodes(): number[] {
  const codes = new Set<number>(Object.keys(STATIC).map(Number));
  for (let z = 28; z <= 38; z++) codes.add(25800 + z);
  for (let z = 1; z <= 60; z++) {
    codes.add(32600 + z);
    codes.add(32700 + z);
  }
  return [...codes].sort((a, b) => a - b);
}
