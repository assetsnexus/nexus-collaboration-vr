/**
 * `@nexus/cluster-editor-core` — framework-free GeoBIM cluster core.
 *
 * Status: skeleton. The model, the earthworks diff and the validation are
 * implemented and tested. The geodetic core (`@anx/geo`), IFC import/export
 * (`web-ifc` + `@nexus/model3d-core`) and the rendering bindings
 * (`cluster-editor-react`, later `cluster-editor-vue`) land next.
 *
 * Integration depths this package is designed for:
 *
 * - Depth 0 — CRUD only: call `anx.cluster.*` / `anx.bim.*`, render your own UI.
 * - Depth 1 — embed our viewer: mount a read-only binding over this model.
 * - Depth 2 — embed our editor: mount `cluster-editor-react` / `-vue`.
 * - Depth 3 — own editor, our model: consume this package plus the region
 *   commands and build your own UI.
 *
 * Nothing here imports a UI framework or Three.js, which is what makes all four
 * depths possible from one model.
 */

export type {
  Vec2,
  Vec3,
  Polygon,
  ClusterGeoReference,
  ClusterBuilding,
  ClusterStorey,
  ClusterZoneKind,
  ClusterZone,
  ClusterNetworkSystem,
  ClusterNetworkSegment,
  ClusterNetworkNode,
  ClusterNetwork,
  ClusterAsset,
  ClusterAlignment,
  ClusterModel,
  ClusterTerrain,
  MovementVector,
} from './model.ts';

export {
  EARTHWORK_EPSILON_M,
  diffTerrain,
  applyTerrainEdit,
  revertTerrainEdit,
  editTerrainCell,
} from './earthworks.ts';
export type { EarthworkCell, EarthworkDiff, TerrainEdit } from './earthworks.ts';

export { validateClusterModel } from './validation.ts';
export type { ValidationIssue, ValidationResult } from './validation.ts';
