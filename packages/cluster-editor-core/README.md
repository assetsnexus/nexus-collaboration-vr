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

| Module | Contents |
| --- | --- |
| `model.ts` | `ClusterModel`, `ClusterGeoReference`, buildings/storeys/rooms, 3D networks, assets, IFC4x3 alignments, terrain, movement vectors |
| `earthworks.ts` | current-vs-must diff (cut/fill volumes), undoable terrain edits |
| `validation.ts` | pure validation with dotted paths, so a UI can point at the offending entity |

Units: metres, Z-up, right-handed. Angles in degrees unless a field says
otherwise.

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
node --test src/model.test.ts src/earthworks.test.ts src/validation.test.ts
tsc -p tsconfig.json --noEmit
```
