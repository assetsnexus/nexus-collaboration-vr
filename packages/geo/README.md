# @nexus/geo

Framework-free geodetic core for the GeoBIM cluster model.

**Status: implemented and tested.** Ellipsoids, geodetic ↔ ECEF ↔ ENU,
geodesics, EPSG projections and `IfcMapConversion`.

## Why it exists

The cluster model stores geometry in a local ENU frame. Placing that geometry on
a map, in an IFC viewer, or next to a robot's GPS fix needs real geodetic math —
not the flat-earth `111320 m/deg` shortcut. This package is that math, with no UI
framework and no Three.js, so the Vue portal, the React reference app and a
partner app all share one implementation.

## What is in here

| Module | What it does |
| --- | --- |
| `ellipsoid` | WGS84, GRS80, Moon, Mars; `resolveEllipsoid(name)` |
| `geodetic` | `geodeticToEcef`, `ecefToGeodetic`, `ecefToEnu`, `enuToEcef`, `geodeticToEnu`, `enuToGeodetic` |
| `geodesic` | Vincenty inverse/direct with a haversine fallback for near-antipodal pairs |
| `projection` | `createEpsgProjector`, `geodeticToProjected`, `projectedToGeodetic`, `registerProjection` |
| `definitions` | Common EPSG codes registered on demand (UTM families, ETRS89/LAEA, LV95, BNG, RD New, Lambert-93, Krovak) |
| `geo-reference` | `enuToProjected`, `projectedToEnu`, `geodeticToLocalEnu`, `localEnuToGeodetic`, `localEnuToGeodeticProjected` |

## Conventions

- Latitude/longitude in **degrees**, height in **metres** above the ellipsoid.
- ENU is `{ east, north, up }` in metres, anchored at a geodetic origin.
- Bearings are degrees clockwise from true north.
- Every function takes an optional ellipsoid and defaults to WGS84.

## `IfcMapConversion`

`enuToProjected` reads a cluster's `mapConversion` exactly as IFC defines it:

```
easting  = eastings  + scale * (cosθ * east - sinθ * north)
northing = northings + scale * (sinθ * east + cosθ * north)
height   = orthogonalHeight + up
```

with `cosθ = xAxisAbscissa`, `sinθ = xAxisOrdinate`. When a cluster has no
`mapConversion`, the anchor is projected through `projectedCrs` and the rotation
is taken from `gridRotationDeg`.

## EPSG coverage

`proj4` ships only a few definitions. This package registers the common families
on demand:

- ETRS89 / UTM 28N–38N (`25828`–`25838`)
- WGS 84 / UTM north and south (`32601`–`32660`, `32701`–`32760`)
- ETRS89 / LAEA Europe (`3035`), CH1903+ / LV95 (`2056`), OSGB36 / BNG
  (`27700`), Amersfoort / RD New (`28992`), RGF93 / Lambert-93 (`2154`),
  S-JTSK / Krovak East North (`5514`)

Anything else: `registerProjection('MY_GRID', '+proj=…')` then
`createEpsgProjector('MY_GRID')`. An unknown code throws instead of silently
falling back to a flat-earth approximation.

## Tests

```sh
pnpm --filter @nexus/geo test
```

32 tests: ECEF/ENU round-trips, polar handling, another-body ellipsoids,
Vincenty distances and bearings, the near-antipodal fallback, EPSG round-trips,
map-conversion rotation, and the grid-convergence tolerance between the
projected and ECEF paths.
