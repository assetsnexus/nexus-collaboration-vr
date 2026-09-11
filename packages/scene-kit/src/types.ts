/** OpenAI-compatible tool schema (shared with character-kit). */
export type ChatCompletionTool = {
  type: 'function'
  function: {
    name: string
    description?: string
    parameters?: Record<string, unknown>
  }
}

/** Meters, right-handed. Default display matches Three.js Y-up / ground XZ. */
export type SceneFrame = {
  units: 'm'
  /** Display up axis. Y-up keeps VRM occupancy; Z-up matches IFC. */
  up: 'y' | 'z'
  origin: { x: number; y: number; z: number }
}

export const DEFAULT_SCENE_FRAME: SceneFrame = {
  units: 'm',
  up: 'y',
  origin: { x: 0, y: 0, z: 0 },
}

export type ScenePose = {
  x: number
  y: number
  z: number
  /** Yaw radians; 0 = +Z toward default camera in Y-up frame. */
  yaw: number
}

export type SceneOwner = {
  type: 'agent' | 'user' | 'system'
  slug?: string
}

/**
 * Stable kinds. `machine` aliases `robot`. `building` / `space` / `wire` reserved for Nexus/BIM.
 */
export type SceneEntityKind =
  | 'object'
  | 'robot'
  | 'machine'
  | 'avatar'
  | 'landmark'
  | 'fx'
  | 'building'
  | 'space'
  | 'wire'
  | string

export type SceneEntity = {
  id: string
  kind: SceneEntityKind
  label: string
  pose: ScenePose
  radius: number
  tags: string[]
  owner: SceneOwner
  /** ObjectSpec / robot payload / opaque host data. */
  spec: unknown
  effects?: string[]
  bindings?: string[]
  rev: number
}

export type SceneOpKind =
  | 'spawn'
  | 'write'
  | 'move'
  | 'set_tags'
  | 'play_effect'
  | 'stop_effect'
  | 'bind_tool'
  | 'unbind_tool'
  | 'remove'

export type SceneOp = {
  opId: string
  kind: SceneOpKind
  at: number
  entityId?: string
  /** Full entity for spawn; patch fields for write/move/etc. */
  payload?: Record<string, unknown>
}

export type CompactSceneEventKind =
  | 'action'
  | 'collision'
  | 'spawned'
  | 'moved'
  | 'wrote'
  | 'effect'
  | 'removed'
  | 'tool'
  | 'robot'

export type CompactSceneEvent = {
  at: number
  kind: CompactSceneEventKind
  agent?: string
  entityId?: string
  op?: string
  target?: string
  label?: string
  other?: string
  distM?: number
}

/** Compact row for viewport PUT / LLM digest (no full spec). */
export type SceneEntityDigest = {
  id: string
  kind: string
  label: string
  x: number
  y: number
  z: number
  yaw: number
  present?: boolean
}

export type SceneGraphSnapshot = {
  v: 1
  frame: SceneFrame
  rev: number
  entities: SceneEntity[]
  bindings?: ToolBinding[]
}

export type ToolBinding = {
  id: string
  match: {
    tool: string
    agent?: string
    subagent?: boolean
  }
  target: { entityId: string } | { spawnPreset: 'sphere-front' }
  onStart?: string
  onProgress?: string
  onEnd?: string
}

export type SceneAuthority = 'client' | 'server'

export type SceneQueryOpts = {
  /** World meters from origin point. */
  radius?: number
  from?: { x: number; y?: number; z: number } | string
  kind?: string
  tag?: string
  query?: string
  ids?: string[]
  limit?: number
}
