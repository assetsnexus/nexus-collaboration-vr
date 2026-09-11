export type {
  ChatCompletionTool,
  SceneAuthority,
  SceneEntity,
  SceneEntityDigest,
  SceneEntityKind,
  SceneFrame,
  SceneGraphSnapshot,
  SceneOp,
  SceneOpKind,
  SceneOwner,
  ScenePose,
  SceneQueryOpts,
  CompactSceneEvent,
  CompactSceneEventKind,
  ToolBinding,
} from './types.ts'
export { DEFAULT_SCENE_FRAME } from './types.ts'

export {
  normalizeFrame,
  fromIfc,
  toIfc,
  normalizePose,
  poseInFront,
  xzDistance,
} from './frame.ts'

export { SceneGraph, createEntityId, spawnPoseAt } from './graph.ts'
export type { SceneGraphListener } from './graph.ts'

export {
  SceneEventLog,
  formatSceneDigest,
  isNoisySceneOp,
  SCENE_ACTION_LIMIT,
  SCENE_COLLISION_LIMIT,
  SCENE_GRAPH_EVENT_LIMIT,
} from './events.ts'

export {
  filterEntities,
  formatEntityRow,
  avatarsAsEntities,
  SCENE_LIST_DEFAULT_LIMIT,
  SCENE_LIST_MAX_LIMIT,
  SCENE_OVERVIEW_DEFAULT_RADIUS_M,
  SCENE_OVERVIEW_MAX_RADIUS_M,
  SCENE_OVERVIEW_MAX_ROWS,
} from './browse.ts'

export {
  SCENE_TOOL_DEFINITIONS,
  SCENE_TOOL_ALIASES,
  SCENE_IMMEDIATE_TOOLS,
  resolveSceneToolName,
  isSceneSkillTool,
  isImmediateSceneTool,
} from './tools.ts'

export {
  SCENE_SKILL,
  SCENE_SKILL_ID,
  SCENE_SKILL_PREFIX,
  buildSceneSkillPrompt,
} from './skill.ts'

export {
  formatSceneGraphPrompt,
  formatSceneDiffPrompt,
  entitiesToPromptRows,
} from './prompt.ts'
export type { OccupantPose } from './prompt.ts'

export {
  MemoryTransport,
  StorageTransport,
  SCENE_STORAGE_PREFIX,
  sceneStorageKey,
  attachAutoPersist,
  restoreGraph,
} from './transport.ts'
export type { SceneTransport, StorageLike } from './transport.ts'
