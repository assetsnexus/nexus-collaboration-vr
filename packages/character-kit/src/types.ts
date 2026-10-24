/** Emotion / expression ids mapped to VRM expression presets when available. */
export type EmotionId =
  | 'neutral'
  | 'happy'
  | 'angry'
  | 'sad'
  | 'relaxed'
  | 'surprised'
  | 'blink'
  | string

export type LookAtTarget = 'camera' | { x: number; y: number; z: number } | null

export interface CharacterEmbedHost {
  scene: import('three').Scene
  camera: import('three').PerspectiveCamera
  canvas: HTMLCanvasElement
  sceneRegistry?: import('./scene-registry.js').SceneRegistry
  sceneFx?: import('./scene-fx.js').SceneObjectLayer
}

export interface CharacterOptions {
  /** Background clear color */
  background?: number
  /** Enable orbit controls (playground default true) */
  orbitControls?: boolean
  /** Pixel ratio cap */
  maxPixelRatio?: number
  /**
   * Follow the pointer across the browser window (eyes + head yaw), mapped
   * against the canvas rect so view-center still means “look at the user”.
   * Default true. Toggle at runtime with `setPointerLookEnabled`.
   */
  pointerLook?: boolean
  /**
   * Yaw the hips toward the camera as it orbits. Default false.
   * Toggle at runtime with `setBodyFollowCamera`.
   */
  bodyFollowCamera?: boolean
  /**
   * Radius (m) for nearby scene objects included in walk/turn tool results.
   * Default 8. Set 0 to disable.
   */
  locoNearbyRadiusM?: number
  /**
   * Guest avatar in a shared SceneRoom: no own renderer, lights, orbit, or RAF.
   * Parent must call `tickSimulation(delta)` each frame.
   */
  embed?: CharacterEmbedHost
  /** Occupant slug stamped onto motion-feed events. */
  agentId?: string
}

export interface GestureManifestEntry {
  id: string
  url: string
  loop?: boolean
  description?: string
  /** Catalog gate: only `verified` (or platform-default URLs) auto-download in rooms. */
  validationStatus?: 'pending_admin' | 'rejected' | 'verified' | string
}

/** One clip currently loaded on a character (VRMA or procedural). */
export interface LoadedGestureInfo {
  id: string
  /** Wall-clock one-shot length. Null when the clip loops. */
  durationMs: number | null
  loop: boolean
  overlay: boolean
  description?: string
}

export interface GestureManifest {
  gestures: GestureManifestEntry[]
  /**
   * Optional per-gait clip ids for this model/pack.
   * Keys: crawl | crouch | careful | walk | run | roll → gesture id in `gestures`
   * (or a procedural id). Missing keys use defaults (walk, run, walk_crouch, …).
   */
  locomotion?: Partial<
    Record<'crawl' | 'crouch' | 'careful' | 'walk' | 'run' | 'roll', string>
  >
}

export interface WalkTarget {
  x?: number
  y?: number
  z?: number
  landmarkId?: string
}

export interface WalkOptions {
  gait?: 'crawl' | 'crouch' | 'careful' | 'walk' | 'run' | 'roll'
  faceTarget?: boolean
}

export type CharacterEventType =
  | 'character.arrived'
  | 'character.blocked'
  | 'character.contact'
  | 'character.touched'
  | 'character.gesture_end'
  | 'character.speak_end'
  /** The pose was hard-reset to idle (manual "Reset pose" or auto-recovery). */
  | 'character.pose_reset'

export interface CharacterEvent {
  type: CharacterEventType
  region?: string
  objectId?: string
  force?: number
  gestureId?: string
  at?: number
}

export interface ToolResult {
  ok: boolean
  name: string
  message: string
  data?: Record<string, unknown>
}

export interface ChatCompletionTool {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}
