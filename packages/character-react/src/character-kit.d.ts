declare module '@nexus/character-kit' {
  import type { HTMLCanvasElement } from 'react'

  export type CompanionClothesInput = {
    id?: string
    ids?: string[]
    overlayPieces?: unknown[]
  }

  export type CompanionHostOptions = {
    background?: number
    orbitControls?: boolean
    pointerLook?: boolean
    bodyFollowCamera?: boolean
    maxPixelRatio?: number
    embed?: boolean
    agentId?: string
    logger?: Pick<Console, 'info' | 'warn' | 'error'>
  }

  export type EmbodimentFace = 'public' | 'owner'

  export type EmbodimentRoutineName = 'greeting' | 'farewell' | 'onListen' | 'onThink'

  export type EmbodimentProfileV1 = {
    v?: number
    vrmUrl?: string | null
    vrmAssetId?: string | null
    gestureManifestUrl?: string | null
    defaultMood?: string | null
    lipSyncEnabled?: boolean
    expressionMap?: Record<string, string>
    gestureAliases?: Record<string, string>
    idle?: { moodOverrides?: Record<string, Record<string, unknown>> }
    routines?: Partial<Record<EmbodimentRoutineName, Array<string | Record<string, unknown>>>>
    speaking?: { emotionIntensityScale?: number; gestureIntensityScale?: number }
    faces?: Partial<Record<EmbodimentFace, Record<string, unknown>>>
    zen?: { preferFaceOnly?: boolean }
  }

  export type AvatarAssetLoadProgress = {
    model: number | null
    gestures: number | null
  }

  export type AvatarAssetLoadProgressListener = (progress: AvatarAssetLoadProgress) => void

  export function emptyAvatarAssetLoadProgress(): AvatarAssetLoadProgress

  /** WebGL renderer status (`ok` | `lost` | `restored` | `failed`). */
  export type RendererStatus = { state: 'ok' | 'lost' | 'restored' | 'failed'; message?: string }

  export type RendererStatusListener = (status: RendererStatus) => void

  /** Action-feed source union (motion feed). */
  export type CharacterActionSource =
    | 'agent'
    | 'user'
    | 'tag'
    | 'routine'
    | 'status'
    | 'cancel'
    | 'session'
    | 'tool'
    | string

  export type CharacterActionEvent = {
    agent: string
    op: string
    label: string
    source: CharacterActionSource
    detail?: string
    target?: string
    at: number
    status?: string
    durationMs?: number
    groupId?: number
    generation?: number
  }

  /** One clip currently loaded on a character (VRMA or procedural). */
  export type LoadedGestureInfo = {
    id: string
    durationMs: number | null
    loop: boolean
    overlay: boolean
    description?: string
  }

  export type ToolResult = {
    ok: boolean
    name: string
    message: string
    data?: Record<string, unknown>
  }


  export type NativeAvatarCacheRequest =
    | {
        type: 'cachePut'
        requestId: string
        key: string
        base64: string
        contentType: string
        fetchedAt: number
        ttlMs: number
      }
    | { type: 'cacheGet'; requestId: string; key: string }
    | { type: 'cacheDelete'; requestId: string; key: string }

  export type NativeAvatarCacheResult = {
    type: 'cacheResult'
    requestId: string
    ok: boolean
    base64?: string
    contentType?: string
    fetchedAt?: number
    ttlMs?: number
    error?: string
  }

  export type NativeAvatarCacheTransport = {
    send(request: NativeAvatarCacheRequest): void
    onResult(handler: (result: NativeAvatarCacheResult) => void): () => void
  }

  export function installNativeAvatarCacheFallback(transport: NativeAvatarCacheTransport): void

  export function fetchCachedPictureObjectUrl(
    url: string,
    opts?: {
      assetId?: string | null
      userId?: string | null
      previewUnverified?: boolean
      validationStatus?: string | null
      ttlMs?: number
      nowMs?: number
      onProgress?: (ratio: number) => void
    },
  ): Promise<string>

  export function shouldPersistAssetUrl(url: string): boolean

  export class CompanionHost {
    constructor(canvas: HTMLCanvasElement, options?: CompanionHostOptions)
    load(opts: {
      vrmUrl: string
      gestureManifestUrl?: string
      mood?: string
      clothes?: CompanionClothesInput
      validationStatus?: string | null
      previewUnverified?: boolean
    }): Promise<void>
    setMood(mood: string, source?: string, detail?: string): boolean
    playGesture(id: string, loop?: boolean): void
    speakWithLipSync(mediaStream: MediaStream, audioContext?: AudioContext): Promise<void>
    stopLipSync(): void
    getLoadProgress(): AvatarAssetLoadProgress
    onLoadProgress(listener: AvatarAssetLoadProgressListener): () => void
    /** Optional WebGL renderer status feed (context loss / restore / failure). */
    onRendererStatus(handler: RendererStatusListener): () => void
    getRendererStatus(): RendererStatus
    /** Plan Part C1: install / clear the embodiment profile. */
    setEmbodiment(
      profile: EmbodimentProfileV1 | Record<string, unknown> | null | undefined,
      opts?: { face?: EmbodimentFace },
    ): { moods: string[]; mood: string | null }
    getEmbodiment(): EmbodimentProfileV1 | null
    setEmbodimentFace(face: EmbodimentFace): void
    getEmbodimentFace(): EmbodimentFace
    getSeededMoodIds(): string[]
    playEmbodimentRoutine(
      name: EmbodimentRoutineName,
      opts?: { source?: string; face?: EmbodimentFace },
    ): Promise<boolean>
    playEmbodimentInlineTags(
      text: string,
      opts?: {
        enabled?: boolean
        source?: string
        locomotionOnly?: boolean
        face?: EmbodimentFace
      },
    ): Promise<{ displayText: string; ttsText: string }>
    playInlineTags(
      text: string,
      opts?: { enabled?: boolean; source?: string; locomotionOnly?: boolean },
    ): Promise<{ displayText: string; ttsText: string }>
    pausePresence(reason?: string): void
    resumePresence(): void
    /** Hard-reset the pose: halt every clip holding weight, return to idle. */
    resetPose(reason?: string): void
    dispose(): void
  }

  export interface SceneRoomOccupant {
    id: string
    label: string
    slotIndex: number
    vrmUrl?: string | null
    validationStatus?: string | null
    mood?: string
    statusColor: number
    present: boolean
    x?: number
    z?: number
    facing?: number
  }

  export type PhoneVrSettingsV1 = {
    v: 1
    profileId: string
    ipdM: number
    distortionScale: number
    referenceSpace?: 'local-floor' | 'local'
  }

  export type PhoneVrMode = 'flat' | 'webxr' | 'imu_stereo'
  export type VrSupportStatus = 'checking' | 'ready' | 'insecure' | 'unavailable' | 'imu_fallback'
  export type PhoneVrErrorCode =
    | 'insecure_context'
    | 'motion_permission_denied'
    | 'no_gyroscope'
    | 'webxr_unavailable'
    | 'stereo_failed'
    | 'tracking_stalled'

  export type PhoneVrStatus = {
    mode: PhoneVrMode
    active: boolean
    support: VrSupportStatus
    message: string
    errorCode: PhoneVrErrorCode | null
    errorMessage: string | null
    trackingStalled: boolean
    settings: PhoneVrSettingsV1
  }

  export type ViewerDistortion = { k1: number; k2: number }
  export type ViewerProfile = {
    id: string
    label: string
    ipdM: number
    fovDeg: number
    distortion: ViewerDistortion
    note?: string
  }

  export const VIEWER_PROFILES: readonly ViewerProfile[]
  export const IPD_MIN_M: number
  export const IPD_MAX_M: number
  export const IPD_DEFAULT_M: number
  export const PHONE_VR_STORAGE_KEY: string

  export function findViewerProfile(id: string | null | undefined): ViewerProfile
  export function clampIpdM(metres: number): number
  export function clampDistortionScale(scale: number): number
  export function defaultPhoneVrSettings(): PhoneVrSettingsV1
  export function normalizePhoneVrSettings(raw: unknown): PhoneVrSettingsV1
  export function readPhoneVrSettings(scopeKey?: string): PhoneVrSettingsV1
  export function writePhoneVrSettings(scopeKey: string, settings: PhoneVrSettingsV1): void
  export function resolveActiveViewer(settings: PhoneVrSettingsV1): {
    profile: ViewerProfile
    ipdM: number
    distortionScale: number
    distortion: ViewerDistortion
    fovDeg: number
  }

  export class PhoneVrController {
    enter(): Promise<PhoneVrStatus>
    exit(): Promise<PhoneVrStatus>
    probeSupport(): Promise<PhoneVrStatus>
    getStatus(): PhoneVrStatus
    getSettings(): PhoneVrSettingsV1
    updateSettings(partial: Partial<PhoneVrSettingsV1>): void
    recenterView(): void
    setShellHooks(hooks: {
      lockLandscape?: () => void
      unlockOrientation?: () => void
    }): void
    dispose(): void
  }

  export type SceneRoomOptions = {
    background?: number
    maxPixelRatio?: number
    orbitControls?: boolean
    pointerLook?: boolean
    spacing?: number
    gestureManifestUrl?: string
    logger?: Pick<Console, 'info' | 'warn' | 'error'>
    phoneVrSettings?: PhoneVrSettingsV1
    onPhoneVrStatus?: (status: PhoneVrStatus) => void
    /** Single-occupant companion stage: no nametags/status circles. */
    soloStage?: boolean
  }

  export type SceneRoomAvatarHandle = {
    id: string
    controller: {
      speakWithLipSync: CompanionHost['speakWithLipSync']
      stopLipSync: () => void
      ensureLipSync: (ctx?: AudioContext) => Promise<unknown>
      listGestures: () => string[]
      listLoadedGestures: () => LoadedGestureInfo[]
      isIdlePlaying: () => boolean
      /** Hard-reset the pose: halt every clip holding weight, return to idle. */
      resetToIdlePose: (reason?: string) => void
      /** Whether a clip can be expressed by this rig (guards retargeted VRMA). */
      isRigCompatible: (clip: unknown) => boolean
      /**
       * Analog locomotion input (`WASD` keys / a virtual stick): `x`/`z` are
       * strafe/forward in `[-1, 1]`, `yaw` is a turn rate, `jump` is a
       * rising-edge pulse. Drives the same integrate path as `character_walk`.
       */
      setMoveInput: (input: { x?: number; z?: number; yaw?: number; jump?: boolean } | null) => void
      /** Analog speed (m/s) applied to `setMoveInput`; Shift selects the run gait. */
      setAnalogSpeed: (speed: number) => void
      /** Current ground pose (`x`/`y`/`z` + facing) for turn metadata. */
      getPoseFeedback: (nearbyRadiusM?: number) => Record<string, unknown> | null
    }
    director: {
      getPresence: () => { setMood: (mood: string) => boolean }
      pausePresence: (reason?: string) => void
      resumePresence: () => void
      pushAction: (
        op: string,
        label: string,
        source: string,
        detail?: string,
        target?: string,
      ) => void
    }
    setMood: (mood: string, intensity?: number) => void
    playGesture: (gestureId: string, sceneTarget?: string) => Promise<boolean>
    faceToward: (x: number, z: number) => void
    worldPosition: () => { x: number; y: number; z: number }
  }

  export class SceneRoom {
    constructor(canvas: HTMLCanvasElement, options?: SceneRoomOptions)
    setOccupants(occupants: SceneRoomOccupant[]): Promise<void>
    getAvatar(id: string): SceneRoomAvatarHandle | null
    runToolCall(id: string, name: string, args?: Record<string, unknown>): Promise<ToolResult>
    applyToolCall(id: string, name: string, args: Record<string, unknown>): ToolResult
    setAvatarMood(id: string, mood: string, source?: string, detail?: string): boolean
    playAvatarGesture(
      id: string,
      gestureId: string,
      opts?: { loop?: boolean; timeScale?: number; source?: string; target?: string },
    ): Promise<boolean>
    listAvatarGestures(id: string): string[]
    listLoadedAvatarGestures(id: string): LoadedGestureInfo[]
    isAvatarIdlePlaying(id: string): boolean
    /** Hard-reset one occupant (or all) to the idle rest pose. */
    resetAvatarPose(id?: string | null, reason?: string): boolean
    onAction(listener: (ev: CharacterActionEvent) => void): () => void
    speakWithLipSync(id: string, mediaStream: MediaStream, audioContext?: AudioContext): Promise<void>
    stopLipSync(id?: string): void
    playInlineTags(
      id: string,
      text: string,
      opts?: { enabled?: boolean; source?: string; locomotionOnly?: boolean },
    ): Promise<{ displayText: string; ttsText: string }>
    getPhoneVr(): PhoneVrController
    enterPhoneVr(): Promise<PhoneVrStatus>
    exitPhoneVr(): Promise<PhoneVrStatus>
    isPhoneVrActive(): boolean
    setPointerLook(enabled: boolean): void
    /** OS-global cursor feed: push gaze NDC / route gaze through the external feed. */
    setPointerNdc(ndcX: number, ndcY: number): void
    setExternalPointerEnabled(on: boolean): void
    /** Head/neck gaze cone (degrees) for a cursor that tracks across the screen. */
    setGazeLimits(limits: { headYawMaxDeg?: number; headPitchMaxDeg?: number; eyeYawMaxDeg?: number; eyePitchMaxDeg?: number }): void
    getGazeLimits(): { headYawMaxDeg: number; headPitchMaxDeg: number; eyeYawMaxDeg: number; eyePitchMaxDeg: number }
    /** Solo click-ack (nod on page click): enable + pick the gesture. */
    setClickAckOptions(opts: { enabled?: boolean; clickGesture?: string; clickSpeed?: number; clickEnabled?: boolean; zoomEnabled?: boolean; zoomInGesture?: string; zoomOutGesture?: string }): void
    getClickAckOptions(): { enabled: boolean; clickGesture: string; clickEnabled: boolean; clickSpeed: number; zoomEnabled: boolean; zoomInGesture: string; zoomOutGesture: string } | null
    resize(): void
    getLoadProgress(): AvatarAssetLoadProgress
    onLoadProgress(listener: AvatarAssetLoadProgressListener): () => void
    /** Optional WebGL renderer status feed (context loss / restore / failure). */
    onRendererStatus(handler: RendererStatusListener): () => void
    rendererStatus(): RendererStatus
    dispose(): void
  }

  export interface PresenceMoodDef {
    id: string
    description: string
  }

  export const PRESENCE_MOODS: Record<string, PresenceMoodDef>
}
