# @nexus/cluster-editor-core

Framework-free GeoBIM cluster core shared by the portal, the reference app and
partner apps.

**Status: model + geodetic core.** The IFC-shaped model, the earthworks diff,
the validation and the geodetic core (`@nexus/geo`, re-exported here) are
implemented and tested. IFC import/export (`web-ifc` + `@nexus/model3d-core`)
and the rendering bindings (`cluster-editor-react`, later `cluster-editor-vue`)
land next.

## Why it is framework-free

The portal is Vue 2, the reference app is React 19, and a partner app may be
anything. If the model and the business rules lived in a UI binding, each of
them would need its own copy. This package holds the model and the pure
functions; the bindings are thin.

## Integration depths

| Depth | What you do | What you import |
| --- | --- | --- |
| 0 | Call `anx.cluster.*` / `anx.bim.*`, render your own UI | nothing |
| 1 | Embed our viewer, read-only | a binding over this model |
| 2 | Embed our editor | `cluster-editor-react` / `-vue` |
| 3 | Own editor, our model | this package + the region commands |

All four depths read the same region truth, which is why the model is
IFC-shaped: import and export are a mapping, not a translation layer.

## What is in here

| Area | Where |
| --- | --- |
| Model | `model.ts` — `ClusterModel`, `ClusterGeoReference`, buildings/storeys/rooms, 3D networks, assets, IFC4x3 alignments, terrain, movement vectors, **materials**, **surfaces**, **placed model refs** |
| Earthworks | `earthworks.ts` — current-vs-must diff (cut/fill volumes), undoable terrain edits |
| Materials & quantities | `materials.ts` — polygon area, surface area, model/slot resolution, derived product quantities |
| Large scenes | `spatial-index.ts` — id maps plus a uniform XY grid for proximity queries |
| Validation | `validation.ts` — pure validation with dotted paths, so a UI can point at the offending entity |

Units: metres, Z-up, right-handed. Angles in degrees unless a field says
otherwise.

## Products, materials and quantities

A placed asset can point at a marketplace **product** and render that product's
model, unless the placement **overrides** it:

```ts
asset.productRef = 'chair-oak';
asset.modelRef = { modelId: 'chair-oak-v2', format: 'glb' }; // wins over the product model
asset.materialOverrides = { fabric: 'linen' };               // per-slot override
```

A **surface** is the smallest thing a user paints or tiles. It belongs to a zone
or a building and carries a material:

```ts
materials: [{ id: 'paint-white', kind: 'paint', productRef: 'paint-10l',
              coverage: { unit: 'm2', perUnit: 10, wasteFactor: 0.1 } }]
surfaces:  [{ id: 's1', ownerId: 'room-1', ownerKind: 'zone', kind: 'floor',
              materialId: 'paint-white' }]
```

`computeProductQuantities(model)` turns that into a shopping list: placed assets
by count, surfaces by measured area or length divided by the material's
coverage, plus the waste factor, rounded up. A surface without its own geometry
inherits the owner's polygon (a room floor is the room area).

## IFC mapping

| Model | IFC |
| --- | --- |
| `ClusterMaterial` | `IfcMaterial` + `IfcSurfaceStyle` (`IfcColourRgb`, `IfcImageTexture`) |
| `ClusterSurface` | `IfcRelAssociatesMaterial` on the owning element |
| `ClusterAsset.modelRef` | `IfcShapeRepresentation` / an external model reference |
| `ClusterAsset.productRef` | `IfcClassificationReference` (product catalogue) |

The additions are additive: an older model without `materials`/`surfaces` still
validates and renders.

## Large scenes

`buildClusterIndex(model)` builds id maps and a uniform XY grid once per
structural edit. `queryNearby(index, point, radiusM)` answers "what is near this
point" without scanning the array. The Z axis is ignored on purpose, so a sensor
finds a camera above it; callers that need a height filter apply it to the
result. A move that stays in the same cell needs no rebuild (`assetCell`).

## Not here (on purpose)

- **No Three.js.** Rendering belongs to a binding.
- **No geodetic math.** `@anx/geo` owns WGS84/ECEF/ENU and `proj4`; this package
  only carries the georeference the math needs.
- **No IFC parser.** `web-ifc` runs in the browser behind a `BimKernel` seam, so
  a region-side `anx-bim` sidecar can replace it later without reshaping the
  model.
- **No robot format.** `urdf_ros2` rigs and the metric-to-axis mapping already
  exist in the asset blueprint; this package renders them, it does not
  re-invent them.

## Commands

```bash
node --test src/model.test.ts src/earthworks.test.ts src/validation.test.ts \
  src/materials.test.ts src/spatial-index.test.ts
tsc -p tsconfig.json --noEmit
```
