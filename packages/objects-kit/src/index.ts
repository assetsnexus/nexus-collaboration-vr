export type { ObjectShape, ObjectMaterialSpec, ObjectSpecV1, ObjectCatalogEntry } from './spec.ts'
export { normalizeObjectSpec, defaultSphereSpec } from './spec.ts'

export type { ExternalSourcesMode, UrlPolicy } from './url-policy.ts'
export { DEFAULT_URL_POLICY, assertUrlAllowed, parseAllowHosts } from './url-policy.ts'

export type { EffectOp, EffectClip } from './effects.ts'
export { BUILTIN_EFFECTS, resolveEffectClip, normalizeEffectClip } from './effects.ts'

export { LoadProgressBillboard, assetLoadRatio } from './load-billboard.ts'
export { createPrimitiveMesh, disposeObject3D } from './mesh.ts'
export { createDeskMesh, isDeskCatalogId } from './furniture.ts'
export type { DeskBuildOpts } from './furniture.ts'
export { ObjectSceneLayer } from './object-layer.ts'
export type { ObjectLayerOptions } from './object-layer.ts'

export {
  OBJECT_TOOL_DEFINITIONS,
  OBJECT_TOOL_ALIASES,
  OBJECT_SKILL,
  resolveObjectToolName,
  isObjectSkillTool,
} from './tools.ts'

export {
  spawnObject,
  writeObject,
  playObjectEffect,
  stopObjectEffect,
  removeObject,
  listCatalog,
  registerCustomEffect,
  floorOriginY,
} from './actions.ts'
export type { SpawnObjectArgs } from './actions.ts'
