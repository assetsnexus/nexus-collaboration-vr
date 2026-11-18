# @nexus/bim-web-ifc

`web-ifc` adapter for the `@nexus/cluster-editor-core` **BimKernel** seam.

**Status: implemented and tested.** Export and import round-trip a cluster model
through a real IFC4 file.

## Why a separate package

The cluster core is dependency-free on purpose. Parsing IFC needs WASM, so the
parser lives here and implements the small `BimKernel` interface the core
defines. A host registers it once:

```ts
import { createBimKernelRegistry } from '@nexus/cluster-editor-core';
import { createWebIfcKernel } from '@nexus/bim-web-ifc';

const registry = createBimKernelRegistry();
registry.register(createWebIfcKernel());
```

A region-side `anx-bim` sidecar can implement the same interface later without a
caller changing.

## What it maps

| Cluster | IFC |
| --- | --- |
| model | `IfcProject` |
| `geoReference.anchor` | `IfcSite.RefLatitude` / `RefLongitude` / `RefElevation` |
| buildings | `IfcBuilding` |
| storeys | `IfcBuildingStorey` |
| zones | `IfcSpace` (`LongName` carries the zone kind) |
| assets | `IfcBuildingElementProxy` with `IfcLocalPlacement` |
| materials | `IfcMaterial` |
| surfaces | `IfcRelAssociatesMaterial` on the owning element |
| containment | `IfcRelAggregates` (project → site → building → storey → space/element) |

Fields IFC has no first-class slot for — product refs, model overrides, material
coverage, zone polygons, alignment and network payloads — travel in one custom
`Pset_ClusterData` property set. That keeps the file openable in a BIM tool while
the cluster round-trips exactly.

`IfcGlobalId` is a 22-character stand-in derived from the cluster id with a hash
suffix; the pset carries the original id, so identity survives the round-trip.

## Not exported yet

- Extruded-solid geometry for zones (the polygon is in the pset, not a
  representation).
- Standard `IfcElementQuantity` sets (quantities are derived by the core, not
  written into the file).

Both are additive: the seam does not change when they land.

## Tests

```sh
pnpm --filter @nexus/bim-web-ifc test
```

Three tests: a valid IFC4 header, a full round-trip (buildings, storeys, zones,
materials, surfaces, placed products with model overrides), and an empty cluster.
