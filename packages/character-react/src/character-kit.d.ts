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
  }

  export class SceneRoom {
    constructor(canvas: HTMLCanvasElement, options?: SceneRoomOptions)
    setOccupants(occupants: SceneRoomOccupant[]): Promise<void>
    getAvatar(id: string): { controller: { speakWithLipSync: CompanionHost['speakWithLipSync']; stopLipSync: () => void } } | null
    getPhoneVr(): PhoneVrController
    enterPhoneVr(): Promise<PhoneVrStatus>
    exitPhoneVr(): Promise<PhoneVrStatus>
    isPhoneVrActive(): boolean
    getLoadProgress(): AvatarAssetLoadProgress
    onLoadProgress(listener: AvatarAssetLoadProgressListener): () => void
    dispose(): void
  }

  export interface PresenceMoodDef {
    id: string
    description: string
  }

  export const PRESENCE_MOODS: Record<string, PresenceMoodDef>
}
