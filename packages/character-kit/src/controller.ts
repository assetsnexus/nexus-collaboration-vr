import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { VRMLoaderPlugin, VRMUtils, type VRM, VRMHumanBoneName } from '@pixiv/three-vrm'
import { fetchCachedArrayBuffer, loadCachedGltf } from './asset-cache.js'
import { vrmSceneIsRenderable } from './vrm-ready.js'
import { loadVrmAnimations } from './vrma-loader.js'
import {
  contextAllowsRender,
  createResilientRenderer,
  type ContextRecoveryHandle,
  type ContextState,
  type RendererStatus,
  type RendererStatusListener,
} from './renderer-resilience.js'
import {
  createVRMAnimationClip,
  VRMAnimationLoaderPlugin,
} from '@pixiv/three-vrm-animation'
import { VRMLipSync } from 'three-vrm-lip-sync'
import { enqueueAudioWorkletInit, ensureAudioWorkletReady } from './lip-sync-init.js'
import { releaseLipSync } from './lip-sync-lifecycle.js'
import { BlinkController, IdleEyeSaccades } from './blink-saccades.js'
import { CharacterGaze, parseLookAtTarget, type GazeLimits, type GazeLookOptions } from './gaze.js'
import type { CharacterActionSource } from './action-feed.js'
import { resolveGestureVariant, defaultGestureTimeScale, clipPlaybackDurationMs } from './gesture-variants.js'
import {
  clipIsOverlay,
  decideGestureOverlap,
  MAX_GESTURE_QUEUE,
  shouldDropQueued,
  trackOccupancy,
  type GesturePlayResult,
  type PlayingGestureSpec,
} from './gesture-overlap.js'
import {
  bonesMissingFromClip,
  captureHumanoidRestQuats,
  filterIdleTracksForOccupancy,
  occupancySet,
  padClipWithRestHolds,
  omitNearRestTracks,
  restHoldForBone,
  restReturnBones,
  RestPoseReturn,
  type BoneRestHold,
} from './idle-rest-tracks.js'
import { applyRelaxedRestPose, buildProceduralGestureClips } from './procedural-gestures.js'
import {
  checkRigCompatibility,
  createPoseGuard,
  detectStuckPose,
  GUARD_MIN_WEIGHT,
  GUARD_OVERRUN_GRACE_SEC,
  rigBoneNames,
  type GuardActionSnapshot,
  type StuckVerdict,
} from './animation-guard.js'
import { reAnchorRootPositionTrack } from './reanchor.js'
import { V_SIGN_SHORT_ID, shortenVSignClip } from './clip-time-remap.js'
import {
  classifyExpressionName,
  resolveEmotionExpression,
  type ExpressionInfo,
} from './expressions.js'
import { FaceBlendController } from './face-blend.js'
import {
  aliasFaceName,
  FACE_FADE_IN_MS,
  FACE_FADE_REST_MS,
  normalizeFaceWeight,
  type FaceLayer,
} from './face-score.js'
import {
  applyNativeClothesVisibility,
  CLOTHES_DEFAULT_ID,
  CLOTHES_NONE_ID,
  collectClothesSlots,
  describeClothesState,
  isReservedClothesId,
  listClothesItems,
  parseClothesIdList,
  resolveClothesSelection,
  summarizeClothesSelection,
  type ClothesItem,
  type ClothesSlot,
  type ClothesSpec,
} from './clothes.js'
import { ClothesOverlayCache } from './clothes-overlay.js'
import type { ClothesOverlayPiece } from './clothes-transform.js'
import {
  createIdleScalePulse,
  stepIdleTimeScalePulse,
  type IdleScalePulseState,
} from './idle-pulse.js'
import {
  DEFAULT_WALK_TRAIL,
  WalkTrail,
  type WalkTrailOptions,
} from './walk-trail.js'
import {
  createSeatMesh,
  disposeSeatMesh,
  isSitGestureId,
  isSitRestLoopId,
  gesturePreservesSitRest,
  placeSeatUnderHips,
  SEAT_CUBE_SIZE,
} from './seat-prop.js'
import {
  LocomotionState,
  parseWalkArgs,
  relativeToWorld,
  applyAutoRun,
  gaitAnimTimeScale,
  gaitFromSpeed,
  parseGaitArg,
  parseLocomotionOverrides,
  resolveLocomotionClipId,
  speedForGait,
  type MoveInput,
  type LocoFaceMode,
  type LocoGaitId,
  type LocomotionClipOverrides,
  type LocomotionSnapshot,
} from './locomotion.js'

/** Stand still this long after locomotion before turning back to the user. */
const FACE_USER_IDLE_SEC = 60
/** Body yaw rate while returning to face the user (rad/s). */
const FACE_USER_TURN_RATE = (90 * Math.PI) / 180
import {
  SceneRegistry,
  createBuiltinSceneObjects,
  standBeside,
  parseTeleportArgs,
  parseStandSide,
  SCENE_OVERVIEW_DEFAULT_RADIUS_M,
  type SceneObject,
  type SceneObjectFilter,
  type StandSide,
} from './scene-registry.js'
import { SceneObjectLayer } from './scene-fx.js'
import { parseSceneRef, sceneRefKey, sceneRefLabel } from './scene-ref.js'
import {
  CHARACTER_TOOL_DEFINITIONS,
  CHARACTER_LOCOMOTION_TOOL_DEFINITIONS,
  SCENE_TOOL_DEFINITIONS,
  resolveCharacterToolName,
} from './tools.js'
import type {
  CharacterEvent,
  CharacterOptions,
  EmotionId,
  GestureManifest,
  LoadedGestureInfo,
  LookAtTarget,
  ToolResult,
  WalkOptions,
  WalkTarget,
} from './types.js'
import { mayAutoDownloadAvatarAsset } from './avatar-asset-gate.js'

export type LoadGesturePackOptions = {
  /** Owner-local studio preview may fetch unverified clips. */
  previewUnverified?: boolean
  /** Overall gesture-pack fetch progress (0–1 or -1 indeterminate). */
  onProgress?: (ratio: number) => void
}

export type LoadGesturePackResult = {
  skipped: Array<{ id: string; url: string; reason: string }>
}

type EventHandler = (ev: CharacterEvent) => void

interface LoadedGesture {
  id: string
  clip: THREE.AnimationClip
  loop: boolean
  /** Play on top of idle; unkeyed bones stay on the idle loop. */
  overlay?: boolean
  description?: string
}

interface OverlaySlot {
  id: string
  source: CharacterActionSource
  action: THREE.AnimationAction
  clip: THREE.AnimationClip
  loop: boolean
}

interface BodySlot {
  id: string
  source: CharacterActionSource
  action: THREE.AnimationAction
  loop: boolean
  occupied: string[]
}

interface QueuedGesture {
  id: string
  loop: boolean
  crossFade: number
  timeScale?: number
  source: CharacterActionSource
  sceneTarget?: string
}

/** Mixer fade when returning to idle. Instant fadeIn from 0 flashes bind T-pose. */
const MIN_CLIP_FADE = 0.2

function clipFade(seconds: number): number {
  return Math.max(MIN_CLIP_FADE, Number.isFinite(seconds) ? seconds : MIN_CLIP_FADE)
}

/**
 * Owns a Three.js scene + one VRM avatar: emotions, VRMA gestures, lip-sync,
 * kinematic locomotion, and a named scene-object catalog.
 */
export class CharacterController {
  readonly scene: THREE.Scene
  readonly camera: THREE.PerspectiveCamera
  readonly renderer: THREE.WebGLRenderer | null
  /**
   * WebGL context loss/restore tracker for this controller's canvas. Null when
   * the controller is embedded (an outer renderer owns the context) or when no
   * context could be created. Hosts that manage their own loop can read
   * {@link contextState} instead of touching the canvas directly.
   */
  private contextRecovery: ContextRecoveryHandle | null = null
  /** Unbind for the context-loss/restore subscription (null when embedded). */
  private unsubRendererStatus: (() => void) | null = null
  /** Pixel-ratio cap so a post-restore resize re-applies the same value. */
  private readonly maxPixelRatio: number

  private readonly clock = new THREE.Clock()
  private readonly lookTarget = new THREE.Object3D()
  private readonly eyeTarget = new THREE.Object3D()
  private readonly rig = new THREE.Group()
  private readonly gaze = new CharacterGaze()
  /** When true, gaze follows an OS-global cursor feed (desktop companion). */
  private externalPointerLook = false
  private controls: OrbitControls | null = null
  /** Coalesce container resizes into one renderer-buffer update per frame. */
  private resizeObserver: ResizeObserver | null = null
  private resizeRaf = 0
  private vrm: VRM | null = null
  private mixer: THREE.AnimationMixer | null = null
  private lipSync: VRMLipSync | null = null
  private lipSyncPending: Promise<VRMLipSync> | null = null
  /**
   * True when `ensureLipSync` was called without an AudioContext, so the
   * instance owns (and must close) the context the lip-sync engine created.
   * A caller-provided context is shared and never closed here.
   */
  private lipSyncOwnsContext = false
  private gestures = new Map<string, LoadedGesture>()
  private currentAction: THREE.AnimationAction | null = null
  private idleAction: THREE.AnimationAction | null = null
  private overlaySlots: OverlaySlot[] = []
  private bodySlot: BodySlot | null = null
  private gestureQueue: QueuedGesture[] = []
  private drainingGestureQueue = false
  private overlayIdleMask: THREE.AnimationAction | null = null
  /** Bind-pose quats captured at VRM load so idle can own bones VRMA omits. */
  private humanoidRest: BoneRestHold[] = []
  private restPaddedClips = new WeakMap<THREE.AnimationClip, THREE.AnimationClip>()
  private fadingActions = new Set<THREE.AnimationAction>()
  private pendingGestureEndGlance = false
  /** Keep overlay idle-mask until the overlay weight actually hits 0. */
  private pendingOverlayIdleRestore = false
  private readonly restReturn = new RestPoseReturn()
  private idleLoopId = 'idle'
  private currentGestureId: string | null = null
  private idleTimeScaleCenter = 1
  private idlePulseEnabled = false
  private readonly idlePulse: IdleScalePulseState = createIdleScalePulse()
  private seat: THREE.Mesh | null = null
  /**
   * Normalized names of every humanoid bone this rig actually has (captured at
   * load). Gestures keying far more than this are refused instead of leaving the
   * skeleton half-driven.
   */
  private rigBones = new Set<string>()
  /**
   * Watchdog that notices a pose the controller cannot leave on its own (an
   * orphan action holding weight, a one-shot that outlived its clip) and forces
   * the idle rest loop back. Cheap: it only samples every
   * {@link GUARD_SAMPLE_INTERVAL_MS}.
   */
  private guard: ReturnType<typeof createPoseGuard> | null = null
  private readonly face = new FaceBlendController()
  private raf = 0
  private disposed = false
  private listeners = new Set<EventHandler>()
  private logger = console
  private readonly blink = new BlinkController()
  private readonly saccades = new IdleEyeSaccades()
  private saccadesEnabled = true
  private vrmUrl: string | null = null
  private nativeClothes: ClothesSlot[] = []
  private clothesSpec: ClothesSpec = { id: CLOTHES_DEFAULT_ID, ids: undefined, url: null }
  private clothesEpoch = 0
  private overlayRoot: THREE.Group | null = null
  private overlayUrl: string | null = null
  private overlayPieceKey = ''
  private readonly overlayCache = new ClothesOverlayCache()
  private readonly loco = new LocomotionState()
  private sceneRegistry: SceneRegistry
  private readonly sceneFx: SceneObjectLayer
  private readonly ownsSceneFx: boolean
  private readonly embedded: boolean
  private readonly agentId?: string
  private facingHold = false
  private hoverY: number | null = null
  private overrideCameraYaw: number | null = null
  private walkAction: THREE.AnimationAction | null = null
  private walkClipActive = false
  private walkClipId: string | null = null
  private locoGait: LocoGaitId = 'walk'
  /** When true, stick/speed must not override the gait chosen for the active seek. */
  private locoGaitLocked = false
  private locomotionOverrides: LocomotionClipOverrides = {}
  private grid: THREE.GridHelper | null = null
  private locoListeners = new Set<(moving: boolean) => void>()
  private lastLocoMoving = false
  private turnRemainingRad = 0
  private turnSpeedRad = (120 * Math.PI) / 180
  /** Orbit look-at height (m). Raised to head once a VRM is loaded. */
  private orbitFocusY = 1.7
  /** True while Shift/Ctrl/right-drag pan is held so follow-cam does not eat the offset. */
  private orbitPanning = false
  /**
   * After locomotion, stand still this long then ease facing back to the user
   * (loco yaw 0 — gaze aims at the camera).
   */
  private faceUserArmed = false
  private faceUserIdleSec = 0
  private faceUserTurning = false
  private seekWaiters: Array<{ resolve: () => void; reject: (e: Error) => void }> = []
  private idleWaiters: Array<{ resolve: () => void; reject: (e: Error) => void }> = []
  private readonly walkTrail = new WalkTrail(DEFAULT_WALK_TRAIL)
  /** Nearby objects radius for loco tool feedback (0 = off). */
  private locoNearbyRadiusM = 8
  private readonly knownTools = new Set([
    ...CHARACTER_TOOL_DEFINITIONS.map((t) => t.function.name),
    ...CHARACTER_LOCOMOTION_TOOL_DEFINITIONS.map((t) => t.function.name),
    ...SCENE_TOOL_DEFINITIONS.map((t) => t.function.name),
  ])

  constructor(
    private readonly canvas: HTMLCanvasElement,
    options: CharacterOptions = {},
  ) {
    this.embedded = Boolean(options.embed)
    this.maxPixelRatio = Number.isFinite(options.maxPixelRatio)
      ? Number(options.maxPixelRatio)
      : 2
    this.agentId = options.agentId?.trim() || undefined
    this.scene = options.embed?.scene ?? new THREE.Scene()
    this.sceneRegistry = options.embed?.sceneRegistry ?? new SceneRegistry()
    this.ownsSceneFx = !options.embed?.sceneFx
    this.sceneFx = options.embed?.sceneFx ?? new SceneObjectLayer()

    if (!this.embedded) {
      this.scene.background = new THREE.Color(options.background ?? 0x1a1c1e)
    }

    const w = canvas.clientWidth || 640
    const h = canvas.clientHeight || 480
    this.camera = options.embed?.camera ?? new THREE.PerspectiveCamera(30, w / h, 0.1, 100)
    if (!options.embed) {
      this.camera.position.set(0, this.orbitFocusY + 0.25, 2.2)
    }

    if (this.embedded) {
      this.renderer = null
    } else {
      // Multi-window safety: retry through cheaper context flavours instead of
      // throwing when the GPU process is saturated by other companion windows.
      // A total failure leaves `renderer: null`, so this controller degrades to
      // "no stage" rather than crashing the window — same contract as `embed`.
      const acquired = createResilientRenderer<THREE.WebGLRenderer>({
        canvas: canvas as unknown as { addEventListener?: Function; removeEventListener?: Function },
        create: (params) =>
          new THREE.WebGLRenderer({
            canvas,
            antialias: params.antialias,
            alpha: params.alpha,
            powerPreference: params.powerPreference,
          }),
        dispose: (renderer) => renderer.dispose(),
        logger: this.logger,
        onDegrade: ({ id, reason }) => {
          this.logger.warn?.(
            `[character-kit] WebGL context degraded to "${id}" (${reason ?? 'unknown'})`,
          )
        },
      })
      this.renderer = acquired.renderer
      this.contextRecovery = acquired.renderer ? acquired.context : null
      // Bind once so a loss stops the loop and a restore resumes it. Without
      // this the loop keeps scheduling frames that three early-returns from,
      // burning a stalled window's CPU for no pixels.
      this.unsubRendererStatus = this.contextRecovery?.onStatus((status) => {
        this.handleRendererStatus(status)
      }) ?? null
      if (!this.renderer) {
        this.logger.warn?.(
          '[character-kit] no WebGL context available; the 3D stage is disabled in this window',
        )
      }
      this.renderer?.setSize(w, h, false)
      this.renderer?.setPixelRatio(Math.min(window.devicePixelRatio, this.maxPixelRatio))
      if (this.renderer) this.renderer.outputColorSpace = THREE.SRGBColorSpace

      const light = new THREE.DirectionalLight(0xffffff, 1.1)
      light.position.set(1.5, 2.5, 2)
      this.scene.add(light)
      this.scene.add(new THREE.AmbientLight(0xffffff, 0.45))
      this.grid = new THREE.GridHelper(12, 24, 0x2a333d, 0x1a222a)
      this.grid.position.y = 0
      this.scene.add(this.grid)
    }

    this.scene.add(this.lookTarget)
    this.eyeTarget.name = 'eye-look-target'
    this.scene.add(this.eyeTarget)
    this.rig.name = this.agentId ? `character-rig:${this.agentId}` : 'character-rig'
    this.scene.add(this.rig)
    this.scene.add(this.walkTrail.object)
    if (this.ownsSceneFx) this.scene.add(this.sceneFx.group)
    if (!options.embed?.sceneRegistry) {
      for (const o of createBuiltinSceneObjects()) this.sceneRegistry.register(o)
    }
    this.gaze.setPointerEnabled(options.pointerLook !== false)
    this.gaze.setBodyFollowCamera(options.bodyFollowCamera === true)
    if (
      options.locoNearbyRadiusM !== undefined &&
      Number.isFinite(options.locoNearbyRadiusM)
    ) {
      this.locoNearbyRadiusM = Math.max(0, Number(options.locoNearbyRadiusM))
    }
    this.lookTarget.position.copy(this.camera.position)

    if (!this.embedded && options.orbitControls !== false) {
      this.controls = new OrbitControls(this.camera, canvas)
      this.controls.target.set(0, this.orbitFocusY, 0)
      this.controls.enableDamping = true
      this.controls.enablePan = true
      this.controls.screenSpacePanning = true
      this.controls.update()
    }

    this.tick = this.tick.bind(this)
    this.onPointerMove = this.onPointerMove.bind(this)
    this.onPointerLeaveWindow = this.onPointerLeaveWindow.bind(this)
    this.onOrbitPointerDown = this.onOrbitPointerDown.bind(this)
    this.onOrbitPointerUp = this.onOrbitPointerUp.bind(this)
    if (!this.embedded) {
      window.addEventListener('pointermove', this.onPointerMove, { passive: true })
      document.documentElement.addEventListener('mouseleave', this.onPointerLeaveWindow)
      window.addEventListener('blur', this.onPointerLeaveWindow)
      this.canvas.addEventListener('pointerdown', this.onOrbitPointerDown)
      window.addEventListener('pointerup', this.onOrbitPointerUp)
      window.addEventListener('pointercancel', this.onOrbitPointerUp)
      this.observeResize()
      // A container can resize before the first observer callback fires (or with
      // no ResizeObserver at all), so size once up front too.
      this.resize()
      this.raf = requestAnimationFrame(this.tick)
    }
    this.logger.info?.('[character-kit] controller ready', {
      embedded: this.embedded,
      agentId: this.agentId ?? null,
    })
  }

  on(handler: EventHandler): () => void {
    this.listeners.add(handler)
    return () => this.listeners.delete(handler)
  }

  getAgentId(): string | undefined {
    return this.agentId
  }

  getVrm(): VRM | null {
    return this.vrm
  }

  getRig(): THREE.Group {
    return this.rig
  }

  attachHelper(object: THREE.Object3D): void {
    this.scene.add(object)
  }

  getSceneRegistry(): SceneRegistry {
    return this.sceneRegistry
  }

  setPointerNdc(x: number, y: number): void {
    this.gaze.setPointerNdc(x, y)
  }

  /**
   * Switch gaze to an OS-global cursor feed. The host then pushes NDC via
   * {@link setPointerNdc} from Electron screen coordinates (see the desktop
   * global-cursor IPC), and DOM pointer leave / blur no longer clears the aim.
   */
  setExternalPointerEnabled(on: boolean): void {
    this.externalPointerLook = on
    this.gaze.setExternalPointerEnabled(on)
  }

  isExternalPointerEnabled(): boolean {
    return this.externalPointerLook
  }

  /**
   * True while the gaze considers the pointer over the canvas (any window focus
   * state). The host uses this to pick the gaze frame: window-relative while the
   * cursor is inside, screen-relative once it has left. The external feed also
   * sets the flag, so it reflects the last known cursor side.
   */
  isPointerInside(): boolean {
    return this.gaze.isPointerOver()
  }

  clearPointerLook(): void {
    this.gaze.clearPointer()
  }

  /** Place the avatar without a locomotion seek (spawn slots). */
  placeAt(x: number, z: number, yawRad: number, y = 0): void {
    this.hoverY = y > 0.05 ? y : null
    this.loco.setPose(x, z, yawRad, y)
    this.applyLocoPose()
    this.rig.rotation.y = this.gaze.snapBodyToLocomotion()
  }

  groundPosition(): { x: number; y: number; z: number } {
    const s = this.loco.snapshot()
    return { x: s.x, y: s.y, z: s.z }
  }

  avatarRadius(): number {
    return 0.35
  }

  /** Parent-driven frame when embedded in SceneRoom. */
  tickSimulation(delta: number, cameraYawRad?: number): void {
    this.overrideCameraYaw = cameraYawRad ?? null
    this.stepSimulation(delta)
    this.overrideCameraYaw = null
  }

  private emit(ev: CharacterEvent): void {
    for (const h of this.listeners) {
      try {
        h(ev)
      } catch (err) {
        this.logger.error?.('[character-kit] event handler error', err)
      }
    }
  }

  async loadVRM(
    url: string,
    onProgress?: (ratio: number) => void,
    opts: { previewUnverified?: boolean; assetId?: string | null; validationStatus?: string | null } = {},
  ): Promise<void> {
    if (this.disposed) throw new Error('CharacterController disposed')
    this.disposeClothesOverlayGroup()
    this.nativeClothes = []
    const loader = new GLTFLoader()
    loader.register((parser) => new VRMLoaderPlugin(parser))
    loader.register((parser) => new VRMAnimationLoaderPlugin(parser))

    const gltf = await loadCachedGltf(loader, url, onProgress, {
      previewUnverified: opts.previewUnverified,
      assetId: opts.assetId,
      validationStatus: opts.validationStatus,
    })
    if (this.disposed) throw new Error('CharacterController disposed')
    const vrm = gltf.userData.vrm as VRM | undefined
    if (!vrm) throw new Error(`No VRM in ${url}`)

    if (this.vrm) {
      releaseLipSync(this.lipSync, this.lipSyncOwnsContext)
      this.lipSync = null
      this.lipSyncOwnsContext = false
      this.rig.remove(this.vrm.scene)
      VRMUtils.deepDispose(this.vrm.scene)
    }

    VRMUtils.removeUnnecessaryVertices(gltf.scene)
    VRMUtils.combineSkeletons(gltf.scene)
    // VRM 0.0 faces −Z; VRM 1.0 already faces +Z (the default camera).
    // Rotating every model 180° made VRM1 spawn with its back to the user.
    VRMUtils.rotateVRM0(vrm)
    this.rig.add(vrm.scene)
    if (!vrmSceneIsRenderable(vrm.scene)) {
      this.rig.remove(vrm.scene)
      VRMUtils.deepDispose(vrm.scene)
      throw new Error(`VRM is not renderable: ${url}`)
    }
    this.vrm = vrm
    this.vrmUrl = url
    this.mixer = new THREE.AnimationMixer(vrm.scene)
    this.gestures.clear()
    this.idleAction = null
    this.currentAction = null
    this.currentGestureId = null
    this.overlaySlots = []
    this.overlayIdleMask = null
    this.bodySlot = null
    this.walkAction = null
    this.walkClipActive = false
    this.walkClipId = null
    this.gestureQueue = []
    this.pendingOverlayIdleRestore = false
    this.humanoidRest = captureHumanoidRestQuats(vrm)
    // Canonical tokens for both the VRM enum names and the actual node names.
    // A VRoid rig names its nodes `J_Bip_L_UpperArm`, and a retargeted VRMA can
    // key `Normalized_<node.name>`; folding both through the shared resolver
    // keeps the guard comparing like with like instead of refusing every clip.
    const rigNodes: Array<{ name?: string } | null | undefined> = []
    for (const bone of Object.values(VRMHumanBoneName)) {
      const node = vrm.humanoid?.getNormalizedBoneNode(bone as VRMHumanBoneName)
      if (node) rigNodes.push(node)
    }
    this.rigBones = new Set(
      rigBoneNames(
        (bone) => vrm.humanoid?.getNormalizedBoneNode(bone as VRMHumanBoneName),
        Object.values(VRMHumanBoneName),
        rigNodes,
      ),
    )
    this.guard = createPoseGuard()
    this.restPaddedClips = new WeakMap()
    this.fadingActions.clear()
    this.pendingGestureEndGlance = false
    this.restReturn.cancel()
    this.nativeClothes = collectClothesSlots(vrm.scene)
    this.face.reset()
    this.face.syncMeta(this.listExpressions())
    this.face.bindSampler((name) => this.vrm?.expressionManager?.getValue(name) ?? 0)
    const placedQuat = this.rig.quaternion.clone()
    this.rig.quaternion.identity()
    this.rig.updateMatrixWorld(true)
    this.gaze.resetRig()
    this.gaze.bind(vrm)
    this.rig.quaternion.copy(placedQuat)
    this.rig.updateMatrixWorld(true)

    if (vrm.lookAt) {
      vrm.lookAt.target = this.lookTarget
    }

    this.frameOrbitOnHead()

    // Procedural fallbacks include a looping idle so the mixer never sits on bind T-pose.
    this.installProceduralFallbacks()

    this.logger.info?.('[character-kit] VRM loaded', {
      url,
      expressions: this.listExpressions().map((e) => e.name),
      clothes: this.listClothes().map((c) => c.id),
      metaVersion: (vrm.meta as { metaVersion?: string } | undefined)?.metaVersion ?? null,
    })

    await this.applyClothes(this.clothesSpec)
    const spawn = this.loco.snapshot()
    this.placeAt(spawn.x, spawn.z, spawn.facing, spawn.y)
    this.startIdle()
  }

  /** Relative-to-rest procedural clips for ids without VRMA. */
  installProceduralFallbacks(): void {
    if (!this.vrm || !this.mixer) {
      throw new Error('loadVRM before installProceduralFallbacks')
    }
    const overlayIds: string[] = []
    for (const g of buildProceduralGestureClips(this.vrm)) {
      if (this.gestures.has(g.id)) continue
      this.gestures.set(g.id, {
        id: g.id,
        clip: g.clip,
        loop: g.loop,
        overlay: g.overlay,
        description: g.description,
      })
      if (g.overlay) overlayIds.push(g.id)
    }
    this.logger.info?.('[character-kit] procedural fallbacks', {
      ids: [...this.gestures.keys()],
      overlay: overlayIds,
      scratchIkDist: this.gestures.get('scratch_nose')?.clip.userData.ikDist,
      scratchIkDz: this.gestures.get('scratch_nose')?.clip.userData.ikDz,
    })
  }

  /** @deprecated use installProceduralFallbacks */
  installProceduralGestures(): void {
    this.installProceduralFallbacks()
    if (!this.gestures.has('idle')) {
      applyRelaxedRestPose(this.vrm!)
    }
    this.startIdle()
  }

  private startIdle(): void {
    // Without a mixer-resolvable idle clip, don't leave the rig on the bind
    // pose: snap the relaxed rest pose so it at least reads as a rest stance.
    if (!this.gestures.has('idle') && this.vrm) {
      applyRelaxedRestPose(this.vrm)
    }
    this.setIdleLoop('idle', {
      crossFade: this.idleAction ? 0.3 : 0,
      preserveOverlays: true,
    })
  }

  /**
   * Switch the looping rest clip fidgets return to (standing idle or sit).
   * Shows a seat cube while the rest loop is a sit pose.
   */
  setIdleLoop(
    id: string,
    opts: { crossFade?: number; timeScale?: number; preserveOverlays?: boolean } = {},
  ): void {
    if (!this.mixer) {
      this.logger.warn?.('[character-kit] setIdleLoop: no mixer')
      return
    }
    const resolved = resolveGestureVariant(id, this.gestures.keys(), { preferExact: true })
    const g = this.gestures.get(resolved)
    if (!g) {
      if (id === 'idle' && this.vrm) applyRelaxedRestPose(this.vrm)
      this.logger.warn?.('[character-kit] setIdleLoop unknown', id, '→', resolved)
      return
    }
    if (opts.timeScale !== undefined && Number.isFinite(opts.timeScale)) {
      this.idleTimeScaleCenter = opts.timeScale
    }
    const crossFade = opts.crossFade ?? 0.4
    const nextClip = this.ensureRestPaddedClip(g.clip)
    const leavingSit = isSitGestureId(this.idleLoopId) && !isSitGestureId(resolved)
    const sameLoop =
      this.idleLoopId === resolved &&
      this.idleAction &&
      this.idleAction.getClip() === nextClip &&
      (this.currentAction === this.idleAction || opts.preserveOverlays)

    if (sameLoop) {
      this.idleAction!.timeScale = this.idleTimeScaleCenter
      this.syncSeatVisibility()
      return
    }

    if (this.walkClipActive && this.walkAction) {
      if (!opts.preserveOverlays) {
        this.logger.info?.('[character-kit] setIdleLoop skipped during locomotion', resolved)
        return
      }
      const parked = this.mixer.clipAction(nextClip)
      parked.setLoop(THREE.LoopRepeat, Infinity)
      parked.clampWhenFinished = false
      parked.timeScale = this.idleTimeScaleCenter
      parked.enabled = false
      parked.setEffectiveWeight(0)
      this.idleAction = parked
      this.idleLoopId = resolved
      return
    }

    // Standing up from the sit rest loop must stop the sit action itself, not
    // only crossfade away from it. `clearSitRest` owns that (padded-clip lookup,
    // seat sync, current-action adopt); delegating keeps both paths in lockstep
    // and is what makes the "stuck half-seated pose" impossible.
    if (leavingSit && resolved === 'idle' && this.gestures.has('sit')) {
      this.clearSitRest()
      return
    }

    const next = this.mixer.clipAction(nextClip)
    next.setLoop(THREE.LoopRepeat, Infinity)
    next.clampWhenFinished = false
    next.timeScale = this.idleTimeScaleCenter

    const prevIdle = this.idleAction
    this.idleAction = next
    this.idleLoopId = resolved

    if (opts.preserveOverlays && (this.overlaySlots.length || this.bodySlot)) {
      if (prevIdle && prevIdle !== next) {
        this.fadeOutAction(prevIdle, clipFade(crossFade))
      }
      this.rebuildOverlayIdleMask()
      this.syncSeatVisibility()
      this.logger.info?.('[character-kit] idle loop', {
        id: resolved,
        via: 'preserveOverlays',
        timeScale: this.idleTimeScaleCenter,
      })
      return
    }

    this.gestureQueue = []
    this.bodySlot = null
    this.stopOverlay(crossFade)

    if (this.walkAction && this.walkAction !== this.idleAction) {
      this.walkAction.fadeOut(Math.min(0.2, crossFade))
    }
    this.walkClipActive = false
    this.walkClipId = null
    this.walkAction = null

    const playStandUp =
      leavingSit &&
      this.gestures.has('stand_up') &&
      resolved === 'idle' &&
      crossFade > 0

    if (playStandUp) {
      this.syncSeatVisibility()
      this.playOneShot('stand_up', Math.min(0.28, crossFade))
      this.logger.info?.('[character-kit] idle loop', {
        id: resolved,
        via: 'stand_up',
        timeScale: this.idleTimeScaleCenter,
      })
      return
    }

    if (this.currentAction && this.currentAction !== next) {
      this.currentAction.crossFadeTo(next, Math.max(0, crossFade), false)
    } else if (prevIdle && prevIdle !== next) {
      prevIdle.crossFadeTo(next, Math.max(0, crossFade), false)
    }
    next.reset()
    // A reused action can still carry a faded-down / halted base weight; the
    // rest loop is the base pose, so it must come back at full weight.
    next.enabled = true
    next.weight = 1
    next.setEffectiveWeight(1)
    next.play()
    this.currentAction = next
    this.currentGestureId = resolved
    this.syncSeatVisibility()
    this.logger.info?.('[character-kit] idle loop', {
      id: resolved,
      timeScale: this.idleTimeScaleCenter,
      seat: isSitRestLoopId(resolved),
      tracks: next.getClip().tracks.length,
      running: next.isRunning(),
    })
  }

  /** True when this action is the id's rest loop (padded clip) or its one-shot. */
  private isActionForGesture(action: THREE.AnimationAction, id: string): boolean {
    const g = this.gestures.get(id)
    if (!g) return false
    const clip = action.getClip()
    if (clip === g.clip) return true
    return this.restPaddedClips.get(g.clip) === clip
  }

  /**
   * Every mixer action a gesture id could be playing from.
   *
   * Rest loops (idle / sit) play the *rest-padded* clone of a clip
   * (`ensureRestPaddedClip`), which is a different `AnimationClip` object than
   * the one held in `gestures`. `mixer.existingAction(rawClip)` therefore returns
   * null for a rest loop, and a lookup that misses the padded clip leaves the sit
   * action running at full weight forever — the "avatar stuck in a sit pose" bug.
   */
  private actionsForGesture(id: string): THREE.AnimationAction[] {
    if (!this.mixer) return []
    const g = this.gestures.get(id)
    if (!g) return []
    const out = new Set<THREE.AnimationAction>()
    const raw = this.mixer.existingAction(g.clip)
    if (raw) out.add(raw)
    const padded = this.mixer.existingAction(this.ensureRestPaddedClip(g.clip))
    if (padded) out.add(padded)
    return [...out]
  }

  clearSitRest(): void {
    if (!isSitRestLoopId(this.idleLoopId) && !isSitGestureId(this.currentGestureId)) return
    if (!this.mixer) return
    const g = this.gestures.get('idle')
    if (!g) return
    const prevIdle = this.idleAction
    const prevIsSit = Boolean(prevIdle && this.isActionForGesture(prevIdle, 'sit'))
    // Halt every sit action the mixer holds — a slot action (sit_wave fidget) or
    // a stray raw/padded sit clip — except the one currently fading out as the
    // rest loop, which gets a proper crossfade instead.
    const sitActions = new Set<THREE.AnimationAction>()
    const collect = (action: THREE.AnimationAction | null | undefined) => {
      if (action && action !== prevIdle) sitActions.add(action)
    }
    if (this.bodySlot && isSitGestureId(this.bodySlot.id)) collect(this.bodySlot.action)
    for (const slot of this.overlaySlots) {
      if (isSitGestureId(slot.id)) collect(slot.action)
    }
    for (const id of ['sit', 'sit_wave']) {
      for (const action of this.actionsForGesture(id)) collect(action)
    }
    for (const action of sitActions) this.haltAction(action)

    const next = this.mixer.clipAction(this.ensureRestPaddedClip(g.clip))
    next.setLoop(THREE.LoopRepeat, Infinity)
    next.clampWhenFinished = false
    next.enabled = true
    next.paused = false
    next.timeScale = this.idleTimeScaleCenter
    this.idleAction = next
    this.idleLoopId = 'idle'
    if (prevIdle && prevIdle !== next) {
      if (prevIsSit && prevIdle === this.currentAction) {
        this.fadingActions.add(prevIdle)
        prevIdle.clampWhenFinished = true
        prevIdle.crossFadeTo(next, 0.15, false)
      } else if (prevIdle === this.currentAction) {
        prevIdle.crossFadeTo(next, 0.15, false)
      } else {
        this.fadeOutAction(prevIdle, 0.15)
      }
    }
    // Adopt idle as the current action and make sure it actually runs: pointing
    // `idleAction` at a stopped action left the rig on the sit pose forever.
    next.weight = 1
    next.setEffectiveWeight(1)
    next.reset().play()
    this.currentAction = next
    this.currentGestureId = 'idle'
    this.bodySlot = null
    this.vrm?.humanoid?.resetNormalizedPose()
    this.syncSeatVisibility()
    this.logger.info?.('[character-kit] clear sit rest', {
      stopped: sitActions.size,
      current: this.currentGestureId,
    })
  }

  /** Normalized humanoid bones this rig actually has (empty until a VRM loads). */
  getRigBones(): string[] {
    return [...this.rigBones]
  }

  /**
   * Whether a clip can be expressed by this rig. Unknown rigs pass (a VRM that
   * has not reported bones yet must not block a gesture).
   */
  isRigCompatible(clip: THREE.AnimationClip): boolean {
    return checkRigCompatibility(clip, this.rigBones).compatible
  }

  /**
   * Snapshot the mixer in the shape {@link detectStuckPose} understands. A
   * running action is "tracked" when the controller owns it (idle loop, overlay
   * slot, body slot, walk clip, or an in-flight fade-out); anything else holding
   * weight is an orphan nobody will ever stop.
   */
  poseSnapshot(): GuardActionSnapshot[] {
    if (!this.mixer) return []
    const owned = new Set<THREE.AnimationAction>()
    const add = (action: THREE.AnimationAction | null | undefined) => {
      if (action) owned.add(action)
    }
    add(this.idleAction)
    add(this.overlayIdleMask)
    add(this.currentAction)
    add(this.walkAction)
    for (const slot of this.overlaySlots) add(slot.action)
    add(this.bodySlot?.action)
    for (const action of this.fadingActions) add(action)

    const actions = (this.mixer as unknown as { _actions?: THREE.AnimationAction[] })._actions ?? []
    const snapshots: GuardActionSnapshot[] = []
    for (const action of actions) {
      const clip = action.getClip()
      if (!clip) continue
      snapshots.push({
        key: `${clip.name}#${clip.tracks.length}`,
        clipName: clip.name,
        loop: action.loop === THREE.LoopRepeat,
        clampWhenFinished: action.clampWhenFinished,
        running: action.isRunning(),
        effectiveWeight: action.getEffectiveWeight(),
        time: action.time,
        durationSec: clip.duration,
        tracked: owned.has(action),
        stance: !clipIsOverlay(trackOccupancy(clip)),
        idle: action === this.idleAction,
      })
    }
    return snapshots
  }

  /** Current stuck verdict (does not recover; see {@link recoverPose}). */
  detectStuckPose(opts: { minWeight?: number; overrunGraceSec?: number } = {}): StuckVerdict {
    return detectStuckPose(this.poseSnapshot(), {
      minWeight: opts.minWeight ?? GUARD_MIN_WEIGHT,
      overrunGraceSec: opts.overrunGraceSec ?? GUARD_OVERRUN_GRACE_SEC,
    })
  }

  /**
   * Hard reset to the idle rest pose: halt every mixer action that is not the
   * idle loop, drop queued gestures and locomotion, snap the humanoid to its
   * relaxed rest pose, and restart the idle loop instantly.
   *
   * This is the escape hatch behind "Reset pose" and the auto-recovery target,
   * so it must be idempotent and safe to call at any time.
   */
  resetToIdlePose(reason = 'manual'): void {
    if (!this.mixer) return
    this.gestureQueue = []
    this.drainingGestureQueue = false
    this.stopLocomotion()
    this.restReturn.cancel()
    this.pendingOverlayIdleRestore = false
    this.pendingGestureEndGlance = false

    const keep = new Set<THREE.AnimationAction>()
    const idleEntry = this.gestures.get(this.idleLoopId) ?? this.gestures.get('idle')
    const idleClip =
      this.idleLoopId === 'sit'
        ? this.gestures.get('sit')?.clip
        : idleEntry?.clip
    if (idleClip) keep.add(this.mixer.clipAction(this.ensureRestPaddedClip(idleClip)))
    if (this.idleAction) keep.add(this.idleAction)

    for (const slot of this.overlaySlots) this.haltAction(slot.action)
    this.overlaySlots = []
    if (this.bodySlot) {
      this.haltAction(this.bodySlot.action)
      this.bodySlot = null
    }
    if (this.overlayIdleMask) {
      this.haltAction(this.overlayIdleMask)
      this.overlayIdleMask = null
    }
    for (const action of [...this.fadingActions]) this.haltAction(action)
    this.fadingActions.clear()

    const actions = (this.mixer as unknown as { _actions?: THREE.AnimationAction[] })._actions ?? []
    for (const action of actions) {
      if (keep.has(action)) continue
      if (!action.enabled && action.getEffectiveWeight() <= 0.001) continue
      this.haltAction(action)
    }

    this.bodySlot = null
    this.walkAction = null
    this.walkClipActive = false
    this.walkClipId = null
    this.currentAction = null
    this.currentGestureId = null
    this.idleAction = null
    this.idleLoopId = 'idle'

    if (this.vrm) applyRelaxedRestPose(this.vrm)
    this.vrm?.humanoid?.resetNormalizedPose()
    if (this.gestures.has('idle')) {
      this.setIdleLoop('idle', { crossFade: 0 })
    }
    this.guard?.reset()
    this.syncSeatVisibility()
    this.emit({ type: 'character.pose_reset', region: reason, at: Date.now() })
    this.logger.info?.('[character-kit] reset pose', {
      reason,
      gestures: this.listGestures().length,
    })
  }

  /** Auto-recovery entry point used by the watchdog when a pose is stuck. */
  recoverPose(verdict: StuckVerdict): void {
    this.logger.warn?.('[character-kit] auto-recovering stuck pose', verdict.detail)
    this.resetToIdlePose('auto_recover')
  }

  /** Sample the mixer and auto-recover when a stuck pose persists. */
  private tickPoseGuard(nowMs: number): void {
    const guard = this.guard
    if (!guard || !this.mixer || !this.vrm) return
    if (!guard.due(nowMs)) return
    const verdict = this.detectStuckPose()
    if (guard.observe(nowMs, verdict)) this.recoverPose(verdict)
  }

  setIdleTimeScale(center: number): void {
    if (!Number.isFinite(center)) return
    this.idleTimeScaleCenter = center
    if (this.idleAction && this.currentAction === this.idleAction) {
      this.idleAction.timeScale = center
    }
  }

  /** Ambient idle only. Pulses rest-loop timeScale like the face LFO. */
  setIdlePulseEnabled(on: boolean): void {
    this.idlePulseEnabled = on
    if (!on && this.idleAction) {
      this.idleAction.timeScale = this.idleTimeScaleCenter
    }
  }

  getIdleLoopId(): string {
    return this.idleLoopId
  }

  isIdlePlaying(): boolean {
    if (this.overlayIdleMask?.isRunning()) return true
    return Boolean(this.idleAction?.isRunning())
  }

  getGestureId(): string | null {
    return this.currentGestureId
  }

  getLocomotionSnapshot(): LocomotionSnapshot {
    return this.loco.snapshot()
  }

  getVrmUrl(): string | null {
    return this.vrmUrl
  }

  private playOneShot(id: string, crossFade: number): void {
    if (!this.mixer) return
    const g = this.gestures.get(id)
    if (!g) return
    const next = this.mixer.clipAction(g.clip)
    this.fadingActions.delete(next)
    this.pendingGestureEndGlance = false
    this.dropRestReturn(trackOccupancy(g.clip))
    next.reset()
    next.setLoop(THREE.LoopOnce, 1)
    next.clampWhenFinished = true
    next.timeScale = 1
    // See playBodyGesture: a halted action carries weight 0 through reset().
    next.enabled = true
    next.paused = false
    next.weight = 1
    next.setEffectiveWeight(1)
    if (this.currentAction && this.currentAction !== next) {
      this.currentAction.crossFadeTo(next, crossFade, false)
    }
    next.play()
    this.currentAction = next
    this.currentGestureId = id
    this.syncSeatVisibility()
    const onFinished = (e: { action: THREE.AnimationAction }) => {
      if (e.action !== next) return
      this.mixer?.removeEventListener('finished', onFinished)
      this.emit({ type: 'character.gesture_end', gestureId: id, at: Date.now() })
      this.restoreIdleLoop(clipFade(crossFade))
      this.scheduleGestureEndGlance()
    }
    this.mixer.addEventListener('finished', onFinished)
  }

  private stopOverlay(crossFade: number): void {
    const fade = Math.max(0, crossFade)
    for (const slot of this.overlaySlots) {
      if (fade > 0.001) this.fadeOutAction(slot.action, fade)
      else this.haltAction(slot.action)
    }
    this.overlaySlots = []
    this.stopOverlayIdleMask({ restoreIdle: !this.bodySlot })
  }

  /**
   * Keep idle on bones no overlay keys. Idle+overlay both at weight 1
   * otherwise 50/50-blend the right arm and the hand never reaches the face.
   */
  private startOverlayIdleMask(overlayClip: THREE.AnimationClip): void {
    this.startOverlayIdleMaskFromOccupied(trackOccupancy(overlayClip))
  }

  private startOverlayIdleMaskFromOccupied(occupiedRoots: Iterable<string>): void {
    this.stopOverlayIdleMask()
    if (!this.mixer || !this.idleAction) return
    const occupied = occupancySet(occupiedRoots)
    if (!occupied.size) return
    const idleClip = this.idleAction.getClip()
    const tracks = filterIdleTracksForOccupancy(idleClip.tracks, occupied)
    if (!tracks.length) return
    const masked = new THREE.AnimationClip(
      `${idleClip.name}__overlay_mask`,
      idleClip.duration,
      tracks,
    )
    const action = this.mixer.clipAction(masked)
    action.setLoop(THREE.LoopRepeat, Infinity)
    action.timeScale = this.idleAction.timeScale
    action.weight = 1
    action.enabled = true
    const dur = idleClip.duration || 1
    action.time = this.idleAction.time % dur
    action.play()
    this.idleAction.enabled = false
    this.idleAction.setEffectiveWeight(0)
    this.overlayIdleMask = action
  }

  private rebuildOverlayIdleMask(): void {
    const occupiedNames: string[] = []
    if (this.bodySlot) occupiedNames.push(...this.bodySlot.occupied)
    for (const slot of this.overlaySlots) {
      occupiedNames.push(...trackOccupancy(slot.clip))
    }
    if (!occupiedNames.length) {
      this.stopOverlayIdleMask({ restoreIdle: !this.bodySlot })
      return
    }
    this.startOverlayIdleMaskFromOccupied(occupancySet(occupiedNames))
  }

  private stopOverlayIdleMask(opts: { restoreIdle?: boolean } = {}): void {
    if (this.overlayIdleMask && this.idleAction) {
      const dur = this.idleAction.getClip().duration || 1
      this.idleAction.time = this.overlayIdleMask.time % dur
    }
    if (this.overlayIdleMask) {
      this.overlayIdleMask.stop()
      this.overlayIdleMask.enabled = false
      this.overlayIdleMask.setEffectiveWeight(0)
      this.overlayIdleMask = null
    }
    if (opts.restoreIdle === false) return
    if (this.idleAction) {
      this.idleAction.enabled = true
      this.idleAction.weight = 1
      this.idleAction.setEffectiveWeight(1)
      this.idleAction.timeScale = this.idleTimeScaleCenter
      if (!this.idleAction.isRunning()) this.idleAction.play()
    }
  }

  private ensureRestPaddedClip(source: THREE.AnimationClip): THREE.AnimationClip {
    const cached = this.restPaddedClips.get(source)
    if (cached) return cached
    const { clip, added } = padClipWithRestHolds(source, this.humanoidRest)
    this.restPaddedClips.set(source, clip)
    if (added.length) {
      this.logger.info?.('[character-kit] rest-loop bone holds', {
        clip: source.name,
        added: added.length,
        bones: added,
      })
    }
    return clip
  }

  private fadeOutAction(action: THREE.AnimationAction, duration: number): void {
    const fade = Math.max(0.05, duration)
    action.clampWhenFinished = true
    action.enabled = true
    this.fadingActions.add(action)
    action.fadeOut(fade)
  }

  private haltAction(action: THREE.AnimationAction): void {
    this.fadingActions.delete(action)
    action.stop()
    action.enabled = false
    action.setEffectiveWeight(0)
    // Deliberately do NOT zero `action.weight`: three's `reset()` leaves that
    // base weight untouched, so zeroing it would make every future play of this
    // action fade in from `0 × ramp = 0` (silent, frozen pose). The effective
    // weight is 0 while stopped; the play sites set `weight = 1` before fading in.
  }

  private tickFadingActions(): void {
    for (const action of [...this.fadingActions]) {
      if (action.enabled && action.getEffectiveWeight() > 0.001) continue
      this.haltAction(action)
    }
    if (
      this.pendingOverlayIdleRestore &&
      !this.overlaySlots.length &&
      !this.bodySlot &&
      !this.fadingActions.size
    ) {
      this.pendingOverlayIdleRestore = false
      this.stopOverlayIdleMask({ restoreIdle: true })
      if (this.idleAction) {
        this.currentAction = this.idleAction
        this.currentGestureId = this.idleLoopId
      }
    }
    if (
      this.pendingGestureEndGlance &&
      !this.fadingActions.size &&
      !this.restReturn.active &&
      !this.overlaySlots.length &&
      !this.bodySlot
    ) {
      this.pendingGestureEndGlance = false
      this.gaze.notifyGestureEnd()
    }
  }

  private scheduleGestureEndGlance(): void {
    if (this.overlaySlots.length || this.bodySlot) return
    if (this.fadingActions.size || this.restReturn.active) {
      this.pendingGestureEndGlance = true
      return
    }
    this.pendingGestureEndGlance = false
    this.gaze.notifyGestureEnd()
  }

  private logOverlayRestCoverage(gesture: string, clip: THREE.AnimationClip): void {
    const idleClip = this.idleAction?.getClip()
    const missing = idleClip
      ? bonesMissingFromClip(idleClip, trackOccupancy(clip))
      : trackOccupancy(clip)
    if (!missing.length) return
    this.logger.warn?.('[character-kit] idle missing overlay bones', { gesture, missing })
  }

  private beginRestReturn(occupied: readonly string[], duration: number): void {
    if (!this.vrm?.humanoid || !occupied.length) return
    const targets: Array<{ node: THREE.Object3D; rest: THREE.Quaternion }> = []
    for (const bone of occupancySet(occupied)) {
      const hold = restHoldForBone(this.humanoidRest, bone)
      if (!hold) continue
      const node = this.vrm.humanoid.getNormalizedBoneNode(hold.bone as VRMHumanBoneName)
      if (!node) continue
      targets.push({ node, rest: hold.quat })
    }
    if (!targets.length) return
    this.restReturn.begin(targets, duration)
    this.logger.info?.('[character-kit] rest-pose return', {
      bones: targets.map((t) => t.node.name),
      duration,
    })
  }

  private beginRestReturnFromClip(clip: THREE.AnimationClip, duration: number): void {
    const stillHeld = occupancySet([
      ...this.overlaySlots.flatMap((slot) => trackOccupancy(slot.clip)),
      ...(this.bodySlot?.occupied ?? []),
    ])
    const occupied = trackOccupancy(clip).filter((bone) => !stillHeld.has(bone))
    this.beginRestReturn(restReturnBones(occupied, this.idleAction?.getClip()), duration)
  }

  private dropRestReturn(occupied: readonly string[]): void {
    if (!this.vrm?.humanoid || !this.restReturn.active) return
    const nodes: THREE.Object3D[] = []
    for (const bone of occupancySet(occupied)) {
      const hold = restHoldForBone(this.humanoidRest, bone)
      if (!hold) continue
      const node = this.vrm.humanoid.getNormalizedBoneNode(hold.bone as VRMHumanBoneName)
      if (node) nodes.push(node)
    }
    this.restReturn.drop(nodes)
  }

  private syncPrimaryOverlay(): void {
    const last = this.overlaySlots[this.overlaySlots.length - 1]
    if (this.bodySlot) {
      this.currentAction = this.bodySlot.action
      this.currentGestureId = this.bodySlot.id
      return
    }
    if (last) {
      this.currentAction = last.action
      this.currentGestureId = last.id
      return
    }
    if (this.idleAction) {
      this.currentAction = this.idleAction
      this.currentGestureId = this.idleLoopId
    }
  }

  private playingSnapshot(): PlayingGestureSpec[] {
    const out: PlayingGestureSpec[] = []
    if (this.bodySlot) {
      out.push({
        id: this.bodySlot.id,
        source: this.bodySlot.source,
        overlay: false,
        occupied: this.bodySlot.occupied,
        loop: this.bodySlot.loop,
      })
    }
    for (const slot of this.overlaySlots) {
      out.push({
        id: slot.id,
        source: slot.source,
        overlay: true,
        occupied: trackOccupancy(slot.clip),
        loop: slot.loop,
      })
    }
    return out
  }

  private incomingSpec(
    g: LoadedGesture,
    resolved: string,
    looping: boolean,
    source: CharacterActionSource,
  ): PlayingGestureSpec {
    const occupied = trackOccupancy(g.clip)
    return {
      id: resolved,
      source,
      overlay: Boolean(g.overlay) || clipIsOverlay(occupied),
      occupied,
      loop: looping,
    }
  }

  private enqueueGesture(item: QueuedGesture): GesturePlayResult {
    if (shouldDropQueued(item.id, this.gestureQueue)) {
      this.logger.info?.('[character-kit] skip queued duplicate', item.id)
      return 'skipped'
    }
    if (this.gestureQueue.length >= MAX_GESTURE_QUEUE) {
      this.logger.info?.('[character-kit] skip gesture, queue full', item.id)
      return 'skipped'
    }
    this.gestureQueue.push(item)
    this.logger.info?.('[character-kit] queue gesture', {
      id: item.id,
      source: item.source,
      depth: this.gestureQueue.length,
    })
    return 'queued'
  }

  private drainGestureQueue(): void {
    if (this.drainingGestureQueue) return
    this.drainingGestureQueue = true
    try {
      while (this.gestureQueue.length) {
        const item = this.gestureQueue[0]!
        const preferExact = item.id === 'sit' || item.id === 'idle'
        const resolved = resolveGestureVariant(item.id, this.gestures.keys(), { preferExact })
        const g = this.gestures.get(resolved)
        if (!g) {
          this.gestureQueue.shift()
          this.logger.warn?.('[character-kit] drop queued unknown gesture', item.id)
          continue
        }
        const looping = item.loop || g.loop
        const incoming = this.incomingSpec(g, resolved, looping, item.source)
        const decision = decideGestureOverlap(incoming, this.playingSnapshot())
        if (decision === 'skip') {
          this.gestureQueue.shift()
          this.logger.info?.('[character-kit] skip queued gesture', {
            id: resolved,
            source: item.source,
          })
          continue
        }
        if (decision === 'queue') break
        this.gestureQueue.shift()
        this.startResolvedGesture(g, looping, item.crossFade, resolved, item.timeScale, item.source)
        if (decision === 'play' && !incoming.overlay) break
      }
    } finally {
      this.drainingGestureQueue = false
    }
  }

  private onOverlayFinished(action: THREE.AnimationAction, resolved: string, crossFade: number): void {
    const idx = this.overlaySlots.findIndex((s) => s.action === action)
    if (idx < 0) return
    const slot = this.overlaySlots[idx]!
    this.overlaySlots.splice(idx, 1)
    this.emit({ type: 'character.gesture_end', gestureId: resolved, at: Date.now() })
    this.logOverlayRestCoverage(resolved, slot.clip)
    const fade = clipFade(crossFade)

    if (this.overlaySlots.length > 0) {
      this.fadeOutAction(slot.action, fade)
      this.rebuildOverlayIdleMask()
      this.syncPrimaryOverlay()
      this.syncSeatVisibility()
      this.drainGestureQueue()
      return
    }

    if (this.bodySlot) {
      this.fadeOutAction(slot.action, fade)
      this.rebuildOverlayIdleMask()
      this.syncPrimaryOverlay()
      this.syncSeatVisibility()
      this.drainGestureQueue()
      return
    }

    // Keep the masked idle running until overlay weight hits 0. Restoring
    // full idle (or rest-returning to bind) mid-mixer-update flashes T-pose.
    this.fadeOutAction(slot.action, fade)
    this.pendingOverlayIdleRestore = true
    if (this.idleAction) {
      this.currentAction = this.idleAction
      this.currentGestureId = this.idleLoopId
    }
    this.drainGestureQueue()
    if (this.overlaySlots.length || this.bodySlot) {
      this.pendingOverlayIdleRestore = false
      this.syncSeatVisibility()
      return
    }
    this.scheduleGestureEndGlance()
    this.syncSeatVisibility()
  }

  /**
   * Head/arm overlays keep the idle loop running so unkeyed bones (the other arm)
   * stay on idle instead of snapping to T-pose. Mergable overlays stack.
   */
  private playOverlayGesture(
    g: LoadedGesture,
    looping: boolean,
    crossFade: number,
    resolved: string,
    timeScale = 1,
    source: CharacterActionSource = 'agent',
  ): void {
    if (!this.mixer) return
    const next = this.mixer.clipAction(g.clip)

    this.fadingActions.delete(next)
    this.pendingGestureEndGlance = false
    this.pendingOverlayIdleRestore = false
    this.dropRestReturn(trackOccupancy(g.clip))
    next.reset()
    next.setLoop(looping ? THREE.LoopRepeat : THREE.LoopOnce, looping ? Infinity : 1)
    next.clampWhenFinished = !looping
    next.timeScale = timeScale
    next.blendMode = THREE.NormalAnimationBlendMode
    next.enabled = true
    next.paused = false
    next.weight = 1
    next.setEffectiveWeight(1)
    next.play()

    this.overlaySlots.push({
      id: resolved,
      source,
      action: next,
      clip: g.clip,
      loop: looping,
    })
    this.rebuildOverlayIdleMask()
    this.syncPrimaryOverlay()
    this.syncSeatVisibility()
    this.logger.info?.('[character-kit] overlay gesture', {
      id: resolved,
      source,
      loop: looping,
      timeScale,
      stacked: this.overlaySlots.length,
      tracks: g.clip.tracks.length,
      weight: next.getEffectiveWeight(),
    })

    if (!looping) {
      const onFinished = (e: { action: THREE.AnimationAction }) => {
        if (e.action !== next) return
        this.mixer?.removeEventListener('finished', onFinished)
        this.onOverlayFinished(next, resolved, crossFade)
      }
      this.mixer.addEventListener('finished', onFinished)
    }
  }

  private playBodyGesture(
    g: LoadedGesture,
    looping: boolean,
    crossFade: number,
    resolved: string,
    timeScale: number,
    source: CharacterActionSource,
    keepOverlays = false,
  ): void {
    if (!this.mixer) return
    if (!keepOverlays) this.stopOverlay(crossFade)
    const next = this.mixer.clipAction(g.clip)
    this.fadingActions.delete(next)
    this.pendingGestureEndGlance = false
    this.dropRestReturn(trackOccupancy(g.clip))
    next.reset()
    next.setLoop(looping ? THREE.LoopRepeat : THREE.LoopOnce, looping ? Infinity : 1)
    next.clampWhenFinished = !looping
    next.timeScale = timeScale
    // Restore the base weight before fading in. `haltAction` writes
    // `action.weight = 0` to silence a clip, and three's `reset()` does NOT
    // restore it — so a replayed body clip would fade in as `0 × ramp = 0` and
    // leave the rig frozen on the (now faded-out) idle instead of performing.
    next.enabled = true
    next.paused = false
    next.weight = 1
    next.setEffectiveWeight(1)
    if (!keepOverlays) {
      if (this.currentAction && this.currentAction !== next) {
        this.currentAction.crossFadeTo(next, crossFade, false)
      } else if (this.idleAction && this.idleAction !== next) {
        this.idleAction.crossFadeTo(next, crossFade, false)
      }
    }
    next.play()
    this.bodySlot = {
      id: resolved,
      source,
      action: next,
      loop: looping,
      occupied: trackOccupancy(g.clip),
    }
    this.currentAction = next
    this.currentGestureId = resolved
    if (keepOverlays) this.rebuildOverlayIdleMask()
    this.syncSeatVisibility()

    if (!looping) {
      const onFinished = (e: { action: THREE.AnimationAction }) => {
        if (e.action !== next) return
        this.mixer?.removeEventListener('finished', onFinished)
        this.emit({ type: 'character.gesture_end', gestureId: resolved, at: Date.now() })
        if (this.bodySlot?.action === next) this.bodySlot = null
        if (this.overlaySlots.length) {
          this.rebuildOverlayIdleMask()
          this.syncPrimaryOverlay()
          this.syncSeatVisibility()
          this.drainGestureQueue()
          return
        }
        if (this.currentAction === next) this.restoreIdleLoop(clipFade(crossFade))
        this.scheduleGestureEndGlance()
        this.drainGestureQueue()
      }
      this.mixer.addEventListener('finished', onFinished)
    }
  }

  private startResolvedGesture(
    g: LoadedGesture,
    looping: boolean,
    crossFade: number,
    resolved: string,
    timeScale: number | undefined,
    source: CharacterActionSource,
  ): void {
    const scale =
      timeScale !== undefined && Number.isFinite(timeScale) && timeScale > 0
        ? Math.min(4, Math.max(0.25, timeScale))
        : defaultGestureTimeScale(resolved)
    // Refuse a clip the rig cannot express: a retargeted VRMA played against a
    // model missing those bones leaves the skeleton half-driven (contorted
    // T-pose). Falling back to idle is always better than a broken pose.
    const compat = checkRigCompatibility(g.clip, this.rigBones)
    if (!compat.compatible) {
      this.logger.warn?.('[character-kit] gesture incompatible with rig', {
        id: resolved,
        reason: compat.reason,
        coverage: Number(compat.coverage.toFixed(2)),
        missing: compat.missing.slice(0, 8),
      })
      if (this.currentAction !== this.idleAction) this.setIdleLoop('idle', { crossFade })
      return
    }
    const occupied = trackOccupancy(g.clip)
    const overlay = Boolean(g.overlay) || clipIsOverlay(occupied)
    if (overlay) {
      this.playOverlayGesture(g, looping, crossFade, resolved, scale, source)
      return
    }
    this.playBodyGesture(
      g,
      looping,
      crossFade,
      resolved,
      scale,
      source,
      this.overlaySlots.length > 0,
    )
  }

  private restoreIdleLoop(crossFade: number, opts: { restartIdle?: boolean } = {}): void {
    const fade = clipFade(crossFade)
    const keepIdleTime = opts.restartIdle === false
    const fromWalk = this.walkAction != null && this.currentAction === this.walkAction
    // Walk / overlay already kept a masked idle on unkeyed bones. Rest-return
    // to bind would flash T-pose over that idle as the clip ends.
    if (!keepIdleTime && !fromWalk && this.currentAction && this.currentAction !== this.idleAction) {
      this.beginRestReturnFromClip(this.currentAction.getClip(), fade)
    }
    this.stopOverlay(fade)
    this.bodySlot = null
    this.pendingOverlayIdleRestore = false
    if (!this.idleAction) {
      // No VRMA idle (gesture pack missing) — hold relaxed rest instead of bind T-pose.
      if (this.vrm) applyRelaxedRestPose(this.vrm)
      this.currentAction = null
      this.currentGestureId = this.idleLoopId
      this.syncSeatVisibility()
      return
    }
    if (this.currentAction && this.currentAction !== this.idleAction) {
      this.fadingActions.add(this.currentAction)
      this.currentAction.clampWhenFinished = true
      if (keepIdleTime) {
        // Idle is already looping at weight 1 (overlay / walk mask).
        // crossFadeTo would fadeIdle from 0 and flash bind T-pose.
        this.fadeOutAction(this.currentAction, fade)
      } else {
        this.idleAction.enabled = true
        this.idleAction.reset()
        this.idleAction.weight = 1
        this.idleAction.setEffectiveWeight(1)
        this.idleAction.play()
        this.currentAction.crossFadeTo(this.idleAction, fade, false)
      }
    }
    this.idleAction.enabled = true
    this.idleAction.timeScale = this.idleTimeScaleCenter
    if (keepIdleTime) {
      this.idleAction.weight = 1
      this.idleAction.setEffectiveWeight(1)
      if (!this.idleAction.isRunning()) this.idleAction.play()
    } else if (!this.currentAction || this.currentAction === this.idleAction) {
      this.idleAction.weight = 1
      this.idleAction.setEffectiveWeight(1)
      this.idleAction.reset().play()
    }
    this.currentAction = this.idleAction
    this.currentGestureId = this.idleLoopId
    this.syncSeatVisibility()
  }

  private ensureSeat(): THREE.Mesh {
    if (this.seat) return this.seat
    this.seat = createSeatMesh()
    this.scene.add(this.seat)
    return this.seat
  }

  private syncSeatVisibility(): void {
    const seated =
      isSitRestLoopId(this.idleLoopId) || isSitGestureId(this.currentGestureId)
    if (!seated) {
      if (this.seat?.visible) {
        this.seat.visible = false
        this.logger.info?.('[character-kit] seat', { visible: false, loop: this.idleLoopId })
      }
      return
    }
    const seat = this.ensureSeat()
    if (!seat.visible) {
      seat.visible = true
      this.logger.info?.('[character-kit] seat', { visible: true, loop: this.idleLoopId })
    }
  }

  async loadGesturePack(
    manifest: GestureManifest | string,
    opts: LoadGesturePackOptions = {},
  ): Promise<LoadGesturePackResult> {
    const skipped: LoadGesturePackResult['skipped'] = []
    const previewUnverified = opts.previewUnverified === true

    let data: GestureManifest
    if (typeof manifest === 'string') {
      const packGate = mayAutoDownloadAvatarAsset({
        url: manifest,
        previewUnverified,
      })
      if (!packGate.allow) {
        skipped.push({ id: '', url: manifest, reason: packGate.reason })
        this.logger.warn?.('[character-kit] skip unverified gesture manifest', {
          url: manifest,
          reason: packGate.reason,
        })
        return { skipped }
      }
      const buf = await fetchCachedArrayBuffer(manifest, { previewUnverified })
      data = JSON.parse(new TextDecoder().decode(buf)) as GestureManifest
    } else {
      data = manifest
    }

    if (!this.vrm || !this.mixer) {
      throw new Error('loadVRM before loadGesturePack')
    }

    this.installProceduralFallbacks()
    this.locomotionOverrides = parseLocomotionOverrides(data.locomotion)
    if (Object.keys(this.locomotionOverrides).length) {
      this.logger.info?.('[character-kit] locomotion clip overrides', this.locomotionOverrides)
    }

    const loadEntry = async (
      entry: (typeof data.gestures)[number],
      reportDone?: () => void,
    ): Promise<void> => {
      if (this.disposed) return
      if (/test\.vrma$/i.test(entry.url)) {
        this.logger.info?.('[character-kit] skip demo VRMA', entry.id, entry.url)
        reportDone?.()
        return
      }
      const gate = mayAutoDownloadAvatarAsset({
        url: entry.url,
        validationStatus: entry.validationStatus,
        previewUnverified,
      })
      if (!gate.allow) {
        skipped.push({ id: entry.id, url: entry.url, reason: gate.reason })
        this.logger.warn?.('[character-kit] skip unverified gesture clip', {
          id: entry.id,
          url: entry.url,
          reason: gate.reason,
        })
        reportDone?.()
        return
      }
      try {
        const animations = await loadVrmAnimations(entry.url, undefined, {
          previewUnverified,
          validationStatus: entry.validationStatus,
        })
        if (this.disposed || !this.vrm) return
        const vrmAnim = animations[0]
        if (!vrmAnim) {
          this.logger.warn?.('[character-kit] no VRMA in', entry.url, {
            count: animations.length,
          })
          return
        }
        let clip = createVRMAnimationClip(vrmAnim, this.vrm)
        if (!clip.tracks.length) {
          this.logger.warn?.('[character-kit] VRMA produced no tracks', {
            id: entry.id,
            url: entry.url,
            duration: vrmAnim.duration,
          })
          return
        }
        clip.name = entry.id
        reAnchorRootPositionTrack(clip, this.vrm)
        if (!(entry.loop ?? false)) {
          const stripped = omitNearRestTracks(clip, this.humanoidRest)
          if (stripped.dropped.length) {
            clip = stripped.clip
            this.logger.info?.('[character-kit] drop bind-hold tracks', {
              id: entry.id,
              dropped: stripped.dropped,
            })
          }
        }
        const occupied = trackOccupancy(clip)
        const overlay = clipIsOverlay(occupied)
        this.gestures.set(entry.id, {
          id: entry.id,
          clip,
          loop: entry.loop ?? false,
          overlay,
          description: entry.description,
        })
        if (entry.id === 'v_sign') {
          const short = shortenVSignClip(clip)
          this.gestures.set(V_SIGN_SHORT_ID, {
            id: V_SIGN_SHORT_ID,
            clip: short,
            loop: false,
            overlay,
            description: 'Short V-sign — same raise, hand down earlier',
          })
          this.logger.info?.('[character-kit] v_sign_short', {
            from: clip.duration,
            to: short.duration,
          })
        }
      } catch (err) {
        this.logger.error?.('[character-kit] gesture load failed', entry.id, err)
      } finally {
        reportDone?.()
      }
    }

    const gestures = data.gestures || []
    const idleEntry = gestures.find((g) => g.id === 'idle')
    const rest = gestures.filter((g) => g.id !== 'idle')
    const total = gestures.length
    let done = 0
    const reportProgress = () => {
      if (!opts.onProgress) return
      if (total <= 0) {
        opts.onProgress(1)
        return
      }
      opts.onProgress(Math.min(1, done / total))
    }
    const markDone = () => {
      done += 1
      reportProgress()
    }
    opts.onProgress?.(total > 0 ? 0 : 1)
    if (idleEntry) await loadEntry(idleEntry, markDone)
    if (this.disposed) throw new Error('CharacterController disposed')
    this.startIdle()
    await Promise.all(rest.map((entry) => loadEntry(entry, markDone)))
    if (this.disposed) throw new Error('CharacterController disposed')
    if (!this.isIdlePlaying()) this.startIdle()
    opts.onProgress?.(1)

    this.logger.info?.('[character-kit] gestures loaded', {
      count: this.gestures.size,
      ids: [...this.gestures.keys()],
      overlay: [...this.gestures.values()].filter((g) => g.overlay).map((g) => g.id),
      skipped: skipped.length,
    })
    return { skipped }
  }

  /** Must be called from a user gesture for AudioContext / lip-sync. */
  async ensureLipSync(audioContext?: AudioContext): Promise<VRMLipSync> {
    if (!this.vrm) throw new Error('loadVRM first')
    if (this.disposed) throw new Error('CharacterController disposed')
    if (this.lipSync && this.lipSync.vrm !== this.vrm) {
      releaseLipSync(this.lipSync, this.lipSyncOwnsContext)
      this.lipSync = null
      this.lipSyncOwnsContext = false
    }
    if (this.lipSync) return this.lipSync
    if (this.lipSyncPending) return this.lipSyncPending
    this.lipSyncPending = enqueueAudioWorkletInit(async () => {
      if (this.disposed) throw new Error('CharacterController disposed')
      if (!this.vrm) throw new Error('loadVRM first')
      if (this.lipSync && this.lipSync.vrm === this.vrm) return this.lipSync
      if (audioContext) await ensureAudioWorkletReady(audioContext)
      if (this.disposed) throw new Error('CharacterController disposed')
      if (!this.vrm) throw new Error('loadVRM first')
      if (this.lipSync && this.lipSync.vrm === this.vrm) return this.lipSync
      const created = await VRMLipSync.create(this.vrm, { audioContext })
      if (this.disposed) {
        // Nothing else holds this instance; close a context we created.
        releaseLipSync(created, !audioContext)
        throw new Error('CharacterController disposed')
      }
      this.lipSync = created
      // Only a context we implicitly created is ours to close on teardown.
      this.lipSyncOwnsContext = !audioContext
      this.logger.info?.('[character-kit] lip-sync ready', {
        visemes: this.listExpressions()
          .filter((e) => e.kind === 'viseme')
          .map((e) => e.name),
      })
      return created
    })
    try {
      return await this.lipSyncPending
    } finally {
      this.lipSyncPending = null
    }
  }

  getLipSync(): VRMLipSync | null {
    return this.lipSync
  }

  /** Feed a live TTS / mic stream into visemes. Analysis only — does not play audio. */
  async speakWithLipSync(mediaStream: MediaStream, audioContext?: AudioContext): Promise<void> {
    const lip = await this.ensureLipSync(audioContext)
    await lip.useStream(mediaStream)
  }

  stopLipSync(): void {
    this.lipSync?.stop()
  }

  /**
   * Store the mood rest face. Does not apply it — call `restoreRestFace` to ease back.
   */
  setRestFace(emotion: EmotionId, intensity = 0.35): void {
    const weight = normalizeFaceWeight(intensity)
    const requested = aliasFaceName(String(emotion))
    this.face.setRest(requested, weight)
    this.logger.info?.('[character-kit] setRestFace', { emotion: requested, intensity: weight })
  }

  getRestFace(): { emotion: string; intensity: number } {
    return this.face.getRest()
  }

  /** Ambient idle only. Off during speech / tool face cues. */
  setRestPulseEnabled(on: boolean): void {
    this.face.setPulseEnabled(on)
  }

  /** Ease every emotion channel toward the current mood rest face. */
  restoreRestFace(fadeMs = FACE_FADE_REST_MS): void {
    if (!this.vrm?.expressionManager) return
    const infos = this.listExpressions()
    this.face.syncMeta(infos)
    const rest = this.face.getRest()
    const applied = resolveEmotionExpression(
      rest.emotion,
      infos.map((e) => e.name),
    )
    this.face.applyRest(applied, fadeMs)
    this.logger.info?.('[character-kit] restoreRestFace', {
      emotion: rest.emotion,
      applied,
      intensity: rest.intensity,
      fadeMs,
    })
  }

  setFaceLayers(layers: FaceLayer[], fadeMs = FACE_FADE_IN_MS): void {
    if (!this.vrm?.expressionManager) {
      this.logger.warn?.('[character-kit] no expressionManager')
      return
    }
    const infos = this.listExpressions()
    this.face.syncMeta(infos)
    const available = infos.map((e) => e.name)
    const resolvedByRequested = new Map<string, string>()
    for (const layer of layers) {
      const requested = aliasFaceName(layer.name)
      const applied =
        resolveEmotionExpression(requested, available) ??
        available.find((n) => n.toLowerCase() === requested.toLowerCase()) ??
        requested
      resolvedByRequested.set(layer.name, applied)
      if (!available.some((n) => n.toLowerCase() === applied.toLowerCase())) {
        this.logger.warn?.('[character-kit] unknown face layer', layer.name, { available })
      }
    }
    this.face.applyLayers(layers, resolvedByRequested, fadeMs)
    this.logger.info?.('[character-kit] setFaceLayers', {
      layers: layers.map((l) => ({
        name: l.name,
        applied: resolvedByRequested.get(l.name),
        weight: l.weight,
      })),
      fadeMs,
    })
  }

  /**
   * Performance face from a tag/tool step. Does not restore between chained
   * gestures — the speech beat / holdMs eases back to the mood rest face.
   */
  applyFaceCue(opts: {
    emotion?: string
    intensity?: number
    faces?: FaceLayer[]
    fadeMs?: number
    holdMs?: number
  }): void {
    const fadeMs = opts.fadeMs ?? FACE_FADE_IN_MS
    if (opts.faces?.length) {
      this.setFaceLayers(opts.faces, fadeMs)
    } else if (opts.emotion) {
      this.setFaceLayers(
        [{ name: String(opts.emotion), weight: normalizeFaceWeight(opts.intensity ?? 0.4) }],
        fadeMs,
      )
    } else {
      return
    }
    if (opts.holdMs && opts.holdMs > 0) {
      this.face.scheduleRestore(opts.holdMs, () => this.restoreRestFace())
    }
  }

  setEmotion(emotion: EmotionId, intensity = 1, holdMs?: number, fadeMs = FACE_FADE_IN_MS): void {
    this.applyFaceCue({
      emotion: String(emotion),
      intensity,
      fadeMs,
      holdMs,
    })
  }

  setExpression(name: string, weight: number, fadeMs = 160): void {
    if (!this.vrm?.expressionManager) {
      this.logger.warn?.('[character-kit] no expressionManager')
      return
    }
    const infos = this.listExpressions()
    this.face.syncMeta(infos)
    const resolved =
      resolveEmotionExpression(name, infos.map((e) => e.name)) ?? name
    if (!infos.some((e) => e.name === resolved)) {
      this.logger.warn?.('[character-kit] unknown expression', name, {
        available: infos.map((e) => e.name),
      })
    }
    const kind = infos.find((e) => e.name === resolved)?.kind
    if (kind === 'viseme' || kind === 'blink') {
      this.vrm.expressionManager.setValue(resolved, normalizeFaceWeight(weight))
      return
    }
    this.face.applyChannel(resolved, normalizeFaceWeight(weight), fadeMs)
  }

  getExpression(name: string): number {
    return this.vrm?.expressionManager?.getValue(name) ?? 0
  }

  resetFace(): void {
    this.restoreRestFace(FACE_FADE_REST_MS)
  }

  listExpressions(): ExpressionInfo[] {
    const mgr = this.vrm?.expressionManager as
      | {
          expressionMap?: Record<string, { isBinary?: boolean }>
          expressions?: Array<{ expressionName?: string; name?: string; isBinary?: boolean }>
        }
      | undefined
    if (!mgr) return []

    const entries: Array<{ name: string; binary: boolean }> = []
    if (mgr.expressionMap && typeof mgr.expressionMap === 'object') {
      for (const [name, expr] of Object.entries(mgr.expressionMap)) {
        if (!name) continue
        entries.push({ name, binary: Boolean(expr?.isBinary) })
      }
    } else if (Array.isArray(mgr.expressions)) {
      for (const expr of mgr.expressions) {
        const name = expr.expressionName ?? expr.name
        if (!name) continue
        entries.push({ name, binary: Boolean(expr.isBinary) })
      }
    }

    const vrmMgr = this.vrm?.expressionManager
    return entries
      .map((e) => ({
        name: e.name,
        kind: classifyExpressionName(e.name),
        binary: e.binary,
        weight: vrmMgr?.getValue(e.name) ?? 0,
      }))
      .sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name))
  }

  setSaccadesEnabled(on: boolean): void {
    this.saccadesEnabled = on
    this.saccades.setEnabled(on)
    if (!on) this.saccades.snapTo(this.lookTarget)
  }

  playGesture(
    id: string,
    loop = false,
    crossFade = 0.25,
    timeScale?: number,
    source: CharacterActionSource = 'agent',
    sceneTarget?: string,
  ): GesturePlayResult {
    if (sceneTarget) this.faceSceneTarget(sceneTarget)
    if (!this.mixer) {
      // Avatar still loading / unloaded — callers (status motions, UI) race the mixer.
      this.logger.warn?.('[character-kit] playGesture: no mixer', id)
      return 'skipped'
    }
    // Don't let ambient/status gestures yank the body mid walk/turn — locomotion
    // owns the mixer until idle. Overlay faces/emotions still go through other APIs.
    if (this.isLocomoting() && id !== 'jump') {
      this.logger.info?.('[character-kit] skip gesture during locomotion', id)
      return 'skipped'
    }
    const preferExact = id === 'sit' || id === 'idle'
    const resolved = resolveGestureVariant(id, this.gestures.keys(), { preferExact })
    const g = this.gestures.get(resolved)
    if (!g) {
      // A catalog id with no clip (renamed/removed asset, failed VRMA download)
      // must degrade to a no-op on the base pose — never leave the previous
      // gesture frozen. Keep the current rest loop and warn clearly.
      this.logger.warn?.('[character-kit] unknown gesture', id, '→', resolved)
      return 'skipped'
    }
    if (resolved !== id) {
      this.logger.info?.('[character-kit] gesture variant', { requested: id, playing: resolved })
    }

    const looping = loop || g.loop
    if (resolved === 'idle') {
      this.setIdleLoop('idle', { crossFade })
      return 'played'
    }
    if (resolved === 'sit') {
      this.setIdleLoop('sit', { crossFade })
      return 'played'
    }

    if (!gesturePreservesSitRest(resolved)) this.clearSitRest()

    const incoming = this.incomingSpec(g, resolved, looping, source)
    const decision = decideGestureOverlap(incoming, this.playingSnapshot())
    if (decision === 'skip') {
      this.logger.info?.('[character-kit] skip gesture', {
        id: resolved,
        source,
        playing: this.playingSnapshot().map((p) => p.id),
      })
      return 'skipped'
    }
    if (decision === 'queue') {
      return this.enqueueGesture({
        id: resolved,
        loop: looping,
        crossFade,
        timeScale,
        source,
        sceneTarget,
      })
    }

    this.startResolvedGesture(g, looping, crossFade, resolved, timeScale, source)
    return decision === 'merge' ? 'merged' : 'played'
  }

  /**
   * One-shot clip length in ms after timeScale. Null when looping or unknown.
   */
  gesturePlaybackMs(id: string, opts: { loop?: boolean; timeScale?: number } = {}): number | null {
    const preferExact = id === 'sit' || id === 'idle'
    const resolved = resolveGestureVariant(id, this.gestures.keys(), { preferExact })
    const g = this.gestures.get(resolved)
    if (!g) return null
    const looping = Boolean(opts.loop || g.loop)
    const scale =
      opts.timeScale !== undefined && Number.isFinite(opts.timeScale) && opts.timeScale > 0
        ? opts.timeScale
        : defaultGestureTimeScale(resolved)
    return clipPlaybackDurationMs(g.clip.duration, { loop: looping, timeScale: scale })
  }

  listGestures(): string[] {
    return [...this.gestures.keys()]
  }

  /** Exact loaded clips with wall-clock length (no variant randomization). */
  listLoadedGestures(): LoadedGestureInfo[] {
    const out: LoadedGestureInfo[] = []
    for (const g of this.gestures.values()) {
      const scale = defaultGestureTimeScale(g.id)
      out.push({
        id: g.id,
        loop: g.loop,
        overlay: Boolean(g.overlay),
        description: g.description,
        durationMs: clipPlaybackDurationMs(g.clip.duration, { loop: g.loop, timeScale: scale }),
      })
    }
    out.sort((a, b) => a.id.localeCompare(b.id))
    return out
  }

  listClothes(): ClothesItem[] {
    return listClothesItems(this.nativeClothes)
  }

  async listClothesFromUrl(url: string): Promise<ClothesItem[]> {
    const trimmed = url.trim()
    if (!trimmed) return []
    try {
      return await this.overlayCache.listItems(trimmed)
    } catch (err) {
      this.logger.error?.('[character-kit] list overlay clothes failed', trimmed, err)
      return []
    }
  }

  getClothesId(): string {
    return this.clothesSpec.id ?? CLOTHES_DEFAULT_ID
  }

  getClothesIds(): string[] {
    const selection = resolveClothesSelection(this.clothesSpec)
    if (selection.mode === 'none') return []
    if (selection.mode === 'default') return this.listClothes().map((c) => c.id)
    return selection.ids
  }

  describeClothes(): ReturnType<typeof describeClothesState> {
    return describeClothesState({
      id: this.getClothesId(),
      ids: this.clothesSpec.ids,
      native: this.listClothes(),
      overlayUrl: this.overlayUrl,
    })
  }

  /**
   * Apply native slot visibility plus additive overlay pieces. Overlay meshes mix
   * with the loaded VRM's own clothes; they no longer replace them.
   */
  async setClothes(spec: ClothesSpec | string): Promise<boolean> {
    const next: ClothesSpec = typeof spec === 'string' ? { id: spec, url: null } : spec
    const selection = resolveClothesSelection(next)
    const id = summarizeClothesSelection(selection)
    this.clothesSpec = {
      id,
      ids: selection.mode === 'items' ? selection.ids : selection.mode === 'none' ? [] : undefined,
      url: next.url ?? null,
      overlayPieces: next.overlayPieces,
    }
    await this.applyClothes(this.clothesSpec)
    return true
  }

  private async applyClothes(spec: ClothesSpec): Promise<void> {
    if (!this.vrm) return
    const selection = resolveClothesSelection(spec)
    const id = summarizeClothesSelection(selection)
    const epoch = ++this.clothesEpoch

    applyNativeClothesVisibility(this.nativeClothes, spec)

    let pieces = [...(spec.overlayPieces ?? [])].filter((p) => p.sourceUrl && p.itemId)
    const legacyUrl = spec.url?.trim() || null
    if (!pieces.length && legacyUrl) {
      try {
        const items = await this.overlayCache.listItems(legacyUrl)
        if (epoch !== this.clothesEpoch) return
        pieces = items.map((item) => ({
          sourceId: legacyUrl,
          sourceUrl: legacyUrl,
          itemId: item.id,
        }))
      } catch (err) {
        this.logger.error?.('[character-kit] legacy overlay catalog failed', legacyUrl, err)
      }
    }

    if (!pieces.length) {
      this.disposeClothesOverlayGroup()
      this.logger.info?.('[character-kit] clothes', {
        id,
        ids: spec.ids,
        mode: selection.mode,
        overlay: 0,
        items: this.listClothes().map((c) => c.id),
      })
      return
    }

    const key = overlayIdentityKey(pieces)
    if (this.overlayRoot && key === this.overlayPieceKey) {
      this.overlayCache.applyTransforms(this.overlayRoot, pieces, this.rig)
      this.logger.info?.('[character-kit] clothes overlay transforms', { count: pieces.length })
      return
    }

    try {
      await this.rebuildClothesOverlay(pieces, epoch)
    } catch (err) {
      if (epoch !== this.clothesEpoch) return
      this.logger.error?.('[character-kit] clothes overlay failed', err)
      this.disposeClothesOverlayGroup()
    }
  }

  private async rebuildClothesOverlay(
    pieces: ClothesOverlayPiece[],
    epoch: number,
  ): Promise<void> {
    if (!this.vrm) return
    const host = this.vrm
    this.disposeClothesOverlayGroup()
    const built = await this.overlayCache.buildOverlayGroup(host, pieces)
    if (epoch !== this.clothesEpoch || this.disposed || this.vrm !== host) {
      this.overlayCache.releaseHost(host)
      VRMUtils.deepDispose(built.group)
      return
    }
    this.vrm.scene.add(built.group)
    this.vrm.scene.updateMatrixWorld(true)
    this.overlayCache.sealBinds(built.group, this.rig)
    this.overlayCache.applyTransforms(built.group, pieces, this.rig)
    this.overlayRoot = built.group
    this.overlayUrl = pieces[0]?.sourceUrl ?? null
    this.overlayPieceKey = overlayIdentityKey(pieces)
    this.logger.info?.('[character-kit] clothes overlay', {
      pieces: pieces.map((p) => `${p.sourceId}:${p.itemId}`),
      meshes: built.group.children.length,
      bound: built.bound,
      skipped: built.skipped,
      graftedBones: built.grafted,
    })
  }

  private disposeClothesOverlayGroup(): void {
    this.overlayCache.releaseHost(this.vrm)
    if (this.overlayRoot) {
      this.overlayRoot.parent?.remove(this.overlayRoot)
      VRMUtils.deepDispose(this.overlayRoot)
      this.overlayRoot = null
    }
    this.overlayUrl = null
    this.overlayPieceKey = ''
  }

  lookAt(target: LookAtTarget, opts: GazeLookOptions = {}): void {
    const parsed = parseLookAtTarget(target) ?? target
    this.gaze.lookAt(parsed as LookAtTarget, opts)
    this.saccades.snapTo(this.lookTarget)
    this.logger.info?.('[character-kit] look_at', {
      target: parsed,
      turn: opts.turn,
      holdMs: opts.holdMs,
    })
  }

  setPointerLookEnabled(on: boolean): void {
    this.gaze.setPointerEnabled(on)
    if (!on) this.gaze.clearPointer()
    this.logger.info?.('[character-kit] pointer look', on)
  }

  getPointerLookEnabled(): boolean {
    return this.gaze.pointerEnabled
  }

  setBodyFollowCamera(on: boolean): void {
    this.gaze.setBodyFollowCamera(on)
    if (!on) {
      this.loco.facing = this.gaze.getLocomotionYaw()
      this.faceUserArmed = false
      this.faceUserIdleSec = 0
      this.faceUserTurning = false
    }
    this.logger.info?.('[character-kit] body follow camera', on)
  }

  getBodyFollowCamera(): boolean {
    return this.gaze.bodyFollowCamera
  }

  setGazeLimits(limits: Partial<GazeLimits>): GazeLimits {
    const next = this.gaze.setLimits(limits)
    this.logger.info?.('[character-kit] gaze limits', next)
    return next
  }

  getGazeLimits(): GazeLimits {
    return this.gaze.getLimits()
  }

  /** Speech lock: watch the camera; pointer/idle wait. Explicit xyz still wins. */
  setGazeCameraLock(on: boolean): void {
    this.gaze.setCameraLock(on)
    if (on) this.saccades.snapTo(this.lookTarget)
  }

  private isPerformanceBusy(): boolean {
    if (!this.currentAction || this.currentAction === this.idleAction) return false
    return this.currentAction.isRunning()
  }

  /** Client coords → canvas NDC (may be outside ±1 when the pointer is off-canvas). */
  private pointerNdc(e: PointerEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect()
    const w = rect.width || 1
    const h = rect.height || 1
    return {
      x: ((e.clientX - rect.left) / w) * 2 - 1,
      y: -(((e.clientY - rect.top) / h) * 2 - 1),
    }
  }

  private onPointerMove(e: PointerEvent): void {
    if (this.ownsSceneFx) this.sceneFx.hoverAt(this.camera, this.canvas, e.clientX, e.clientY)
    if (!this.gaze.pointerEnabled) return
    // An OS-global cursor feed owns the aim; in-window DOM moves would fight it.
    if (this.externalPointerLook) return
    const ndc = this.pointerNdc(e)
    this.gaze.setPointerNdc(ndc.x, ndc.y)
  }

  /** Cursor left the browser chrome / window lost focus — stop tracking. */
  private onPointerLeaveWindow(): void {
    if (this.ownsSceneFx) this.sceneFx.clearHover()
    this.gaze.clearPointer()
  }

  /**
   * Observe the canvas host so a container resize (companion window drag) updates
   * the drawing buffer instead of CSS-stretching the last frame. Kept off the
   * embedded path, where an outer renderer owns sizing.
   */
  private observeResize(): void {
    if (this.embedded || this.resizeObserver) return
    if (typeof ResizeObserver === 'undefined') return
    const host = this.canvas.parentElement ?? this.canvas
    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(host)
  }

  /** Subscribe to locomotion moving start/stop (for presence pause). */
  onLocomoting(handler: (moving: boolean) => void): () => void {
    this.locoListeners.add(handler)
    return () => this.locoListeners.delete(handler)
  }

  isLocomoting(): boolean {
    return this.loco.moving || this.loco.seeking || Math.abs(this.turnRemainingRad) > 1e-3
  }

  setMoveInput(raw: Partial<MoveInput>): void {
    this.loco.setMoveInput(raw)
  }

  /** Stick / keyboard max speed (m/s). Also drives gait clip selection by band. */
  setAnalogSpeed(speed: number): void {
    this.loco.setAnalogSpeed(speed)
  }

  getAnalogSpeed(): number {
    return this.loco.getAnalogSpeed()
  }

  setWalkTrailOptions(opts: Partial<WalkTrailOptions>): void {
    this.walkTrail.setOptions(opts)
  }

  getWalkTrailOptions(): WalkTrailOptions {
    return this.walkTrail.getOptions()
  }

  clearWalkTrail(): void {
    this.walkTrail.clear()
  }

  setLocoNearbyRadius(meters: number): void {
    this.locoNearbyRadiusM = Math.max(0, Number.isFinite(meters) ? meters : 0)
  }

  getLocoNearbyRadius(): number {
    return this.locoNearbyRadiusM
  }

  /** Current ground pose + optional nearby scene objects (for tool results). */
  getPoseFeedback(nearbyRadiusM?: number): Record<string, unknown> {
    const snap = this.loco.snapshot()
    const facingDeg = (snap.facing * 180) / Math.PI
    const pose = {
      x: Number(snap.x.toFixed(3)),
      y: Number(snap.y.toFixed(3)),
      z: Number(snap.z.toFixed(3)),
      facingRad: Number(snap.facing.toFixed(4)),
      facingDeg: Number(facingDeg.toFixed(1)),
    }
    const radius =
      nearbyRadiusM !== undefined && Number.isFinite(nearbyRadiusM)
        ? Math.max(0, Number(nearbyRadiusM))
        : this.locoNearbyRadiusM
    const out: Record<string, unknown> = { pose }
    if (radius > 0) {
      this.syncLiveSceneObjects()
      const nearby = this.sceneRegistry
        .list({ limit: 32 })
        .objects.filter((o) => o.id !== 'character' && o.kind !== 'avatar')
        .map((o) => {
          const dx = o.position.x - snap.x
          const dz = o.position.z - snap.z
          const distanceM = Math.hypot(dx, dz)
          return { object: this.sceneRegistry.toPublic(o), distanceM }
        })
        .filter((n) => n.distanceM <= radius)
        .sort((a, b) => a.distanceM - b.distanceM)
        .slice(0, 12)
        .map((n) => ({
          ...n.object,
          distanceM: Number(n.distanceM.toFixed(2)),
        }))
      out.nearby = nearby
      out.nearbyRadiusM = radius
    }
    return out
  }

  registerSceneObject(obj: Partial<SceneObject> & { id: string }): SceneObject {
    return this.sceneRegistry.register(obj)
  }

  unregisterSceneObject(id: string): boolean {
    return this.sceneRegistry.unregister(id)
  }

  listSceneObjects(filter: SceneObjectFilter = {}) {
    this.syncLiveSceneObjects()
    return this.sceneRegistry.list(filter)
  }

  getSceneObject(id: string): SceneObject | undefined {
    this.syncLiveSceneObjects()
    return this.sceneRegistry.get(id)
  }

  private syncLiveSceneObjects(): void {
    this.sceneRegistry.update('camera', {
      position: {
        x: this.camera.position.x,
        y: this.camera.position.y,
        z: this.camera.position.z,
      },
    })
    if (this.seat) {
      this.sceneRegistry.update('seat', {
        position: {
          x: this.seat.position.x,
          y: this.seat.position.y,
          z: this.seat.position.z,
        },
        radius: SEAT_CUBE_SIZE / 2,
      })
    }
  }

  private notifyLocoMoving(moving: boolean): void {
    if (moving === this.lastLocoMoving) return
    this.lastLocoMoving = moving
    if (!moving) this.flushIdleWaiters(true)
    for (const h of this.locoListeners) {
      try {
        h(moving)
      } catch (err) {
        this.logger.error?.('[character-kit] loco listener', err)
      }
    }
  }

  private flushIdleWaiters(ok: boolean): void {
    const waiters = this.idleWaiters
    this.idleWaiters = []
    for (const w of waiters) {
      if (ok) w.resolve()
      else w.reject(new Error('locomotion cancelled'))
    }
  }

  private resolveArriveFace(
    face: LocoFaceMode,
    faceAt?: { x: number; z: number },
  ): { face: LocoFaceMode; faceAt?: { x: number; z: number } } {
    if (faceAt) return { face: 'keep', faceAt }
    return { face, faceAt: undefined }
  }

  /**
   * Start walking (relative, world to, or beside object). Returns a promise that
   * resolves when the seek arrives or is cancelled.
   */
  walk(args: Record<string, unknown>): ToolResult {
    const parsed = parseWalkArgs(args)
    if (!parsed.ok) {
      return { ok: false, name: 'character_walk', message: parsed.message }
    }
    const v = parsed.value
    let destX = 0
    let destZ = 0
    let face: LocoFaceMode = v.face
    let faceAt: { x: number; z: number } | undefined

    if (v.kind === 'object') {
      this.syncLiveSceneObjects()
      const obj = this.sceneRegistry.get(v.objectId!)
      if (!obj) {
        return {
          ok: false,
          name: 'character_walk',
          message: `unknown object: ${v.objectId}`,
          data: { available: this.sceneRegistry.ids() },
        }
      }
      if (obj.id === 'character' || obj.kind === 'avatar') {
        return { ok: false, name: 'character_walk', message: 'cannot walk to self' }
      }
      const pose = standBeside(obj, {
        side: v.side,
        distance: v.distance,
        orbitDeg: v.orbitDeg,
      })
      destX = pose.x
      destZ = pose.z
      faceAt = { x: obj.position.x, z: obj.position.z }
      face = 'keep'
    } else if (v.kind === 'to') {
      destX = v.to!.x
      destZ = v.to!.z
    } else {
      const world = relativeToWorld(
        this.loco.facing,
        v.forward ?? 0,
        v.right ?? 0,
        this.loco.x,
        this.loco.z,
      )
      destX = world.x
      destZ = world.z
    }

    const resolved = this.resolveArriveFace(face, faceAt)
    const dist = Math.hypot(destX - this.loco.x, destZ - this.loco.z)
    const auto = applyAutoRun(dist, v.speed, v.gait, { gaitExplicit: v.gaitExplicit })
    this.turnRemainingRad = 0
    this.locoGait = auto.gait
    this.locoGaitLocked = true
    this.loco.beginSeek({
      x: destX,
      z: destZ,
      speed: auto.speed,
      face: resolved.face,
      faceAt: resolved.faceAt,
    })
    this.notifyLocoMoving(true)
    const fromFacing = this.loco.facing
    const msg = auto.autoRan
      ? `run → (${destX.toFixed(2)}, ${destZ.toFixed(2)}) @${auto.speed}m/s (auto-run)`
      : `${auto.gait} → (${destX.toFixed(2)}, ${destZ.toFixed(2)}) @${auto.speed}m/s`
    return {
      ok: true,
      name: 'character_walk',
      message: msg,
      data: {
        x: destX,
        z: destZ,
        speed: auto.speed,
        gait: auto.gait,
        autoRan: auto.autoRan,
        kind: v.kind,
        face: resolved.face,
        from: {
          x: Number(this.loco.x.toFixed(3)),
          z: Number(this.loco.z.toFixed(3)),
          facingDeg: Number(((fromFacing * 180) / Math.PI).toFixed(1)),
        },
      },
    }
  }

  /** Await current seek arrival (or timeout). */
  waitUntilArrived(timeoutMs = 15_000): Promise<void> {
    if (!this.loco.seeking) return Promise.resolve()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.seekWaiters = this.seekWaiters.filter((w) => w.resolve !== resolve)
        reject(new Error('walk timeout'))
      }, timeoutMs)
      this.seekWaiters.push({
        resolve: () => {
          clearTimeout(timer)
          resolve()
        },
        reject: (e) => {
          clearTimeout(timer)
          reject(e)
        },
      })
    })
  }

  /** Await seek and/or continuous turn (`character_turn`) finishing. */
  waitUntilIdle(timeoutMs = 20_000): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false
      const finish = (ok: boolean, err?: Error) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        this.idleWaiters = this.idleWaiters.filter((w) => w.resolve !== onOk)
        if (ok) resolve()
        else reject(err ?? new Error('locomotion cancelled'))
      }
      const onOk = () => finish(true)
      const onErr = (e: Error) => finish(false, e)
      const timer = setTimeout(() => finish(false, new Error('locomotion timeout')), timeoutMs)

      const arm = () => {
        if (settled) return
        if (!this.isLocomoting()) {
          finish(true)
          return
        }
        this.idleWaiters.push({ resolve: onOk, reject: onErr })
      }

      // If turn/walk just armed this tick, isLocomoting is already true.
      // If not yet (0° turn / same-cell walk), give two frames then resolve.
      if (this.isLocomoting()) {
        arm()
        return
      }
      requestAnimationFrame(() => {
        requestAnimationFrame(arm)
      })
    })
  }

  private flushSeekWaiters(ok: boolean): void {
    const waiters = this.seekWaiters
    this.seekWaiters = []
    for (const w of waiters) {
      if (ok) w.resolve()
      else w.reject(new Error('walk cancelled'))
    }
  }

  turn(degrees: number, speedDegPerSec?: number): ToolResult {
    if (!Number.isFinite(degrees)) {
      return { ok: false, name: 'character_turn', message: 'degrees required' }
    }
    this.loco.cancelSeek('turn')
    this.flushSeekWaiters(false)
    this.turnRemainingRad = (degrees * Math.PI) / 180
    const spd = Number.isFinite(speedDegPerSec) ? Number(speedDegPerSec) : 120
    this.turnSpeedRad = (Math.min(360, Math.max(30, spd)) * Math.PI) / 180
    this.notifyLocoMoving(true)
    this.logger.info?.('[character-kit] turn', { degrees, speed: spd })
    return {
      ok: true,
      name: 'character_turn',
      message: `turn ${degrees}°`,
      data: { degrees, speed: spd, ...this.getPoseFeedback() },
    }
  }

  jump(): ToolResult {
    const ok = this.loco.tryJump()
    if (ok && this.gestures.has('jump')) {
      try {
        this.playGesture('jump', false, 0.12)
      } catch {
        /* ignore */
      }
    }
    return {
      ok,
      name: 'character_jump',
      message: ok ? 'jump' : 'not grounded',
    }
  }

  walkTo(target: WalkTarget, opts?: WalkOptions): void {
    const args: Record<string, unknown> = {
      ...(target.landmarkId ? { objectId: target.landmarkId } : {}),
      ...(target.x !== undefined || target.z !== undefined
        ? { to: { x: target.x ?? 0, z: target.z ?? 0 } }
        : {}),
      gait: opts?.gait,
      face: opts?.faceTarget === false ? 'keep' : 'camera',
    }
    const res = this.walk(args)
    if (!res.ok) throw new Error(res.message)
  }

  stopLocomotion(): void {
    this.loco.cancelSeek('stop')
    this.loco.setMoveInput({ x: 0, z: 0, yaw: 0, jump: false })
    this.turnRemainingRad = 0
    this.locoGaitLocked = false
    this.facingHold = false
    this.hoverY = null
    this.flushSeekWaiters(false)
    this.flushIdleWaiters(false)
    this.setWalkClip(false)
    this.notifyLocoMoving(false)
    this.logger.info?.('[character-kit] stopLocomotion')
  }

  teleport(args: Record<string, unknown> | WalkTarget): ToolResult {
    const record =
      args && typeof args === 'object' && ('objectId' in args || 'x' in args || 'landmarkId' in args)
        ? (args as Record<string, unknown>)
        : {
            x: (args as WalkTarget).x,
            z: (args as WalkTarget).z,
            objectId: (args as WalkTarget).landmarkId,
          }
    const parsed = parseTeleportArgs(record)
    if (!parsed.ok) {
      return { ok: false, name: 'character_teleport', message: parsed.message }
    }
    this.loco.cancelSeek('teleport')
    this.turnRemainingRad = 0
    this.flushSeekWaiters(false)
    this.walkTrail.clear()
    this.clearSitRest()
    if (isSitGestureId(this.currentGestureId)) this.restoreIdleLoop(0.25)

    const v = parsed.value
    if (v.kind === 'object') {
      this.syncLiveSceneObjects()
      const obj = this.sceneRegistry.get(v.objectId!)
      if (!obj) {
        return {
          ok: false,
          name: 'character_teleport',
          message: `unknown object: ${v.objectId}`,
          data: { available: this.sceneRegistry.ids() },
        }
      }
      const pose = standBeside(obj, {
        side: v.side,
        distance: v.distance,
        orbitDeg: v.orbitDeg,
      })
      this.loco.setPose(pose.x, pose.z, pose.facingRad, 0)
      this.gaze.setLocomotionYaw(pose.facingRad)
      this.applyLocoPose()
      this.rig.rotation.y = this.gaze.snapBodyToLocomotion()
      this.setWalkClip(false)
      this.notifyLocoMoving(false)
      return {
        ok: true,
        name: 'character_teleport',
        message: `teleport → ${obj.id} (${v.side ?? 'front'})`,
        data: { x: pose.x, z: pose.z, objectId: obj.id, facing: pose.facingRad },
      }
    }

    const x = v.x ?? 0
    const z = v.z ?? 0
    this.loco.setPose(x, z, this.loco.facing, 0)
    this.applyLocoPose()
    this.rig.rotation.y = this.gaze.snapBodyToLocomotion()
    this.setWalkClip(false)
    this.notifyLocoMoving(false)
    return {
      ok: true,
      name: 'character_teleport',
      message: `teleport → (${x.toFixed(2)}, ${z.toFixed(2)})`,
      data: { x, z },
    }
  }

  private applyLocoPose(): void {
    const snap = this.loco.snapshot()
    const dx = snap.x - this.rig.position.x
    const dz = snap.z - this.rig.position.z
    this.rig.position.set(snap.x, snap.y, snap.z)
    this.gaze.setLocomotionYaw(snap.facing)
    // Follow the avatar by the same XZ delta so a Shift-pan offset stays put.
    if (!this.embedded && this.controls && !this.orbitPanning && (dx !== 0 || dz !== 0)) {
      this.controls.target.x += dx
      this.controls.target.z += dz
      this.camera.position.x += dx
      this.camera.position.z += dz
    }
  }

  /**
   * Recenter orbit on the avatar (clears Shift-pan offset) and restore the
   * default front distance / height.
   */
  resetOrbit(): void {
    const snap = this.loco.snapshot()
    const y = this.orbitFocusY
    this.orbitPanning = false
    if (this.controls) {
      this.controls.target.set(snap.x, y, snap.z)
    }
    this.camera.position.set(snap.x, y + 0.25, snap.z + 2.2)
    this.controls?.update()
    this.logger.info?.('[character-kit] orbit reset', { x: snap.x, z: snap.z, y })
  }

  private onOrbitPointerDown(e: PointerEvent): void {
    const pan = e.button === 2 || e.shiftKey || e.ctrlKey || e.metaKey
    if (pan) this.orbitPanning = true
  }

  private onOrbitPointerUp(): void {
    this.orbitPanning = false
  }

  /**
   * Point the orbit target at the VRM head (eyes-ish) and lift the camera by
   * the same delta so zoom-in frames the face instead of the chest.
   */
  private frameOrbitOnHead(): void {
    if (!this.vrm || this.embedded) return
    this.rig.updateMatrixWorld(true)
    let focusY = this.orbitFocusY
    const head = this.vrm.humanoid?.getNormalizedBoneNode('head')
    if (head) {
      const p = new THREE.Vector3()
      head.getWorldPosition(p)
      if (Number.isFinite(p.y) && p.y > 0.4) focusY = p.y
    } else {
      const box = new THREE.Box3().setFromObject(this.vrm.scene)
      if (box.max.y > box.min.y) {
        focusY = box.min.y + (box.max.y - box.min.y) * 0.9
      }
    }
    const prev = this.controls?.target.y ?? this.orbitFocusY
    const dy = focusY - prev
    this.orbitFocusY = focusY
    if (this.controls) {
      this.controls.target.y = focusY
      this.camera.position.y += dy
      this.controls.update()
    } else {
      this.camera.position.y += dy
    }
    this.logger.info?.('[character-kit] orbit focus head', { y: focusY })
  }

  private setWalkClip(on: boolean): void {
    if (!on) {
      if (!this.walkClipActive) return
      this.walkClipActive = false
      this.walkClipId = null
      this.locoGaitLocked = false
      if (this.walkAction) {
        this.restoreIdleLoop(0.3, { restartIdle: false })
        this.walkAction = null
      }
      return
    }

    if (!this.mixer) return
    if (!this.loco.seeking) this.locoGaitLocked = false
    const speed = this.loco.currentMoveSpeed()
    const gait = this.locoGaitLocked ? this.locoGait : gaitFromSpeed(speed || this.loco.getAnalogSpeed())
    if (!this.locoGaitLocked) this.locoGait = gait
    const clipId = resolveLocomotionClipId(gait, this.locomotionOverrides, this.gestures.keys())
    const timeScale = gaitAnimTimeScale(speed || speedForGait(gait), gait)

    const leavingSit =
      isSitRestLoopId(this.idleLoopId) || isSitGestureId(this.currentGestureId)

    if (
      this.walkClipActive &&
      this.walkClipId === clipId &&
      this.walkAction &&
      !leavingSit
    ) {
      this.walkAction.timeScale = timeScale
      return
    }

    const g = this.gestures.get(clipId)
    if (!g) {
      this.logger.warn?.('[character-kit] locomotion clip missing', { gait, clipId })
      return
    }
    const next = this.mixer.clipAction(g.clip)
    next.setLoop(THREE.LoopRepeat, Infinity)
    next.clampWhenFinished = false
    next.timeScale = timeScale
    next.reset()
    next.enabled = true
    next.paused = false
    next.weight = 1
    next.setEffectiveWeight(1)
    this.stopOverlay(0.22)
    this.clearSitRest()
    if (this.walkAction && this.walkAction !== next) {
      this.walkAction.fadeOut(0.22)
    }
    // Walk / run VRMA and procedural loops omit bones idle owns (often arms).
    // Crossfading idle off leaves those channels on bind T-pose for the stride.
    this.startOverlayIdleMask(g.clip)
    next.play()
    this.walkAction = next
    this.bodySlot = {
      id: clipId,
      source: 'agent',
      action: next,
      loop: true,
      occupied: trackOccupancy(g.clip),
    }
    this.currentAction = next
    this.currentGestureId = clipId
    this.walkClipId = clipId
    this.walkClipActive = true
    this.syncSeatVisibility()
    this.logger.info?.('[character-kit] locomotion clip', { gait, clipId, timeScale })
  }

  private cameraYawXZ(): number {
    if (this.overrideCameraYaw != null && Number.isFinite(this.overrideCameraYaw)) {
      return this.overrideCameraYaw
    }
    // Direction from camera toward orbit target on XZ (where the stick "forward" should go).
    const tx = this.controls?.target.x ?? this.rig.position.x
    const tz = this.controls?.target.z ?? this.rig.position.z
    const dx = tx - this.camera.position.x
    const dz = tz - this.camera.position.z
    if (dx * dx + dz * dz < 1e-8) return 0
    return Math.atan2(dx, dz)
  }

  private tickLocomotion(delta: number): void {
    // Continuous turn (LLM character_turn)
    if (Math.abs(this.turnRemainingRad) > 1e-4) {
      const step =
        Math.sign(this.turnRemainingRad) *
        Math.min(Math.abs(this.turnRemainingRad), this.turnSpeedRad * delta)
      this.loco.facing += step
      this.turnRemainingRad -= step
      this.gaze.setLocomotionYaw(this.loco.facing)
      if (Math.abs(this.turnRemainingRad) <= 1e-4) {
        this.turnRemainingRad = 0
        this.notifyLocoMoving(this.loco.moving || this.loco.seeking)
      }
    }

    const result = this.loco.tick(delta, this.cameraYawXZ())
    if (this.hoverY != null) {
      const snapHover = this.loco.snapshot()
      this.loco.setPose(snapHover.x, snapHover.z, snapHover.facing, this.hoverY)
    }
    this.applyLocoPose()
    const snap = this.loco.snapshot()
    const trailMoving =
      this.loco.moving || this.loco.seeking || Math.abs(this.turnRemainingRad) > 1e-3
    this.walkTrail.update(performance.now() / 1000, snap.x, snap.z, trailMoving)

    if (result.arrived) {
      this.flushSeekWaiters(true)
      this.emit({ type: 'character.arrived', at: Date.now() })
    }
    if (result.cancelledSeek) {
      this.flushSeekWaiters(false)
    }
    if (result.jumped && this.gestures.has('jump') && !this.walkClipActive) {
      try {
        this.playGesture('jump', false, 0.1)
      } catch {
        /* ignore */
      }
    }

    const moving = this.isLocomoting()
    this.setWalkClip(this.loco.moving || this.loco.seeking)
    this.notifyLocoMoving(moving)
    this.tickFaceUserIdle(delta, moving)
  }

  /**
   * After walk/turn/seek stops, wait {@link FACE_USER_IDLE_SEC} then ease
   * locomotion yaw back to 0 so idle gaze faces the user/camera again.
   * Skipped unless body-follow-camera is on.
   */
  private tickFaceUserIdle(delta: number, locomoting: boolean): void {
    if (this.facingHold || this.embedded || !this.gaze.bodyFollowCamera) {
      this.faceUserArmed = false
      this.faceUserIdleSec = 0
      this.faceUserTurning = false
      return
    }

    const input = this.loco.getMoveInput()
    const steering =
      Math.hypot(input.x, input.z) > 0.02 || Math.abs(input.yaw) > 0.02 || input.jump
    const seated =
      isSitRestLoopId(this.idleLoopId) || isSitGestureId(this.currentGestureId)

    if (locomoting || steering) {
      this.faceUserArmed = true
      this.faceUserIdleSec = 0
      this.faceUserTurning = false
      return
    }

    if (!this.faceUserArmed || seated) {
      this.faceUserIdleSec = 0
      this.faceUserTurning = false
      return
    }

    if (!this.faceUserTurning) {
      this.faceUserIdleSec += delta
      if (this.faceUserIdleSec < FACE_USER_IDLE_SEC) return
      this.faceUserTurning = true
      this.logger.info?.('[character-kit] face user after idle', {
        afterSec: FACE_USER_IDLE_SEC,
        facing: this.loco.facing,
      })
    }

    // Neutral loco yaw 0 → gaze cameraFacingYaw aims the body at the user.
    const target = 0
    let d = target - this.loco.facing
    while (d > Math.PI) d -= Math.PI * 2
    while (d < -Math.PI) d += Math.PI * 2
    const step = Math.sign(d) * Math.min(Math.abs(d), FACE_USER_TURN_RATE * delta)
    this.loco.facing += step
    this.gaze.setLocomotionYaw(this.loco.facing)
    if (Math.abs(d) <= 0.02) {
      this.loco.facing = target
      this.gaze.setLocomotionYaw(target)
      this.faceUserArmed = false
      this.faceUserTurning = false
      this.faceUserIdleSec = 0
      this.logger.info?.('[character-kit] faced user')
    }
  }

  private syncAvatarCatalog(): void {
    const snap = this.loco.snapshot()
    const id = this.agentId || 'character'
    const existing = this.sceneRegistry.get(id)
    const payload = {
      id,
      kind: 'avatar' as const,
      label: id,
      position: { x: snap.x, y: snap.y, z: snap.z },
      yawDeg: (snap.facing * 180) / Math.PI,
      radius: this.avatarRadius(),
      tags: ['avatar'],
    }
    if (existing) this.sceneRegistry.update(id, payload)
    else this.sceneRegistry.register(payload)
  }

  resolveSceneObject(raw: unknown): SceneObject | null {
    this.syncLiveSceneObjects()
    this.syncAvatarCatalog()
    const ref = parseSceneRef(raw)
    if (!ref) return null
    const key = sceneRefKey(ref)
    return (
      this.sceneRegistry.get(key) ||
      this.sceneRegistry.get(ref.id) ||
      this.sceneRegistry.get(`avatar:${ref.id}`) ||
      null
    )
  }

  faceSceneTarget(raw: unknown): boolean {
    const obj = this.resolveSceneObject(raw)
    if (!obj) return false
    return this.turnToWorld(obj.position.x, obj.position.z, true).ok
  }

  turnToWorld(x: number, z: number, stay = true): ToolResult {
    const snap = this.loco.snapshot()
    const desired = Math.atan2(x - snap.x, z - snap.z)
    let delta = desired - snap.facing
    while (delta > Math.PI) delta -= Math.PI * 2
    while (delta < -Math.PI) delta += Math.PI * 2
    this.facingHold = stay
    this.loco.cancelSeek('turn_to')
    this.flushSeekWaiters(false)
    this.turnRemainingRad = delta
    this.turnSpeedRad = (120 * Math.PI) / 180
    this.notifyLocoMoving(true)
    const degrees = (delta * 180) / Math.PI
    return {
      ok: true,
      name: 'character_turn_to',
      message: `turn ${degrees.toFixed(1)}°`,
      data: { degrees, ...this.getPoseFeedback() },
    }
  }

  turnToTarget(args: Record<string, unknown>): ToolResult {
    const raw = args.target ?? args.objectId ?? args.id
    const obj = this.resolveSceneObject(raw)
    if (!obj) {
      return {
        ok: false,
        name: 'character_turn_to',
        message: `unknown target: ${String(raw ?? '')}`,
        data: { available: this.sceneRegistry.ids() },
      }
    }
    if (args.speed !== undefined && Number.isFinite(Number(args.speed))) {
      this.turnSpeedRad = (Math.min(360, Math.max(30, Number(args.speed))) * Math.PI) / 180
    }
    return this.turnToWorld(obj.position.x, obj.position.z, true)
  }

  approach(args: Record<string, unknown>): ToolResult {
    const raw = args.target ?? args.objectId ?? args.id
    const obj = this.resolveSceneObject(raw)
    if (!obj) {
      return {
        ok: false,
        name: 'character_approach',
        message: `unknown target: ${String(raw ?? '')}`,
        data: { available: this.sceneRegistry.ids() },
      }
    }
    const fromRaw = String(args.from ?? args.side ?? 'front').toLowerCase()
    const fromTop = fromRaw === 'top'
    const side: StandSide = fromRaw === 'from' || fromRaw === 'front' ? 'front' : parseStandSide(fromRaw)
    const pose = standBeside(obj, {
      side: fromTop ? 'front' : side,
      distance: fromTop ? 0 : args.distance !== undefined ? Number(args.distance) : undefined,
    })
    const destX = fromTop ? obj.position.x : pose.x
    const destZ = fromTop ? obj.position.z : pose.z
    const dist = Math.hypot(destX - this.loco.x, destZ - this.loco.z)
    const gaitExplicit = Boolean(args.gait) || args.run === true
    const gait = args.run === true ? 'run' : parseGaitArg(args.gait) ?? 'walk'
    const speedArg = args.speed !== undefined ? Number(args.speed) : speedForGait(gait)
    const auto = applyAutoRun(dist, speedArg, gait, { gaitExplicit, maxWalkSec: 5 })
    this.hoverY = fromTop
      ? obj.position.y + (obj.size?.y ?? obj.radius * 2) + 0.05
      : null
    this.facingHold = true
    this.turnRemainingRad = 0
    this.locoGait = auto.gait
    this.locoGaitLocked = true
    this.loco.beginSeek({
      x: destX,
      z: destZ,
      speed: auto.speed,
      face: 'keep',
      faceAt: { x: obj.position.x, z: obj.position.z },
    })
    this.notifyLocoMoving(true)
    return {
      ok: true,
      name: 'character_approach',
      message: `${auto.gait} → ${sceneRefLabel(parseSceneRef(raw) ?? { kind: 'object', id: obj.id })} from=${fromTop ? 'top' : side}`,
      data: {
        x: destX,
        z: destZ,
        from: fromTop ? 'top' : side,
        gait: auto.gait,
        autoRan: auto.autoRan,
        ...this.getPoseFeedback(),
      },
    }
  }

  sceneOverview(args: Record<string, unknown> = {}): ToolResult {
    this.syncLiveSceneObjects()
    this.syncAvatarCatalog()
    const snap = this.loco.snapshot()
    const radius = Number(args.radius ?? args.radiusM ?? SCENE_OVERVIEW_DEFAULT_RADIUS_M)
    const overview = this.sceneRegistry.overview({
      origin: { x: snap.x, z: snap.z },
      radiusM: radius,
      selfId: this.agentId || 'character',
    })
    return {
      ok: true,
      name: 'scene_overview',
      message: `${overview.objects.length}/${overview.count} within ${overview.radiusM}m`,
      data: overview,
    }
  }

  sceneMoveObject(args: Record<string, unknown>): ToolResult {
    const id = String(args.id ?? '')
    const obj = this.sceneRegistry.get(id)
    if (!obj) {
      return { ok: false, name: 'scene_move_object', message: `unknown object: ${id}` }
    }
    if (obj.kind === 'avatar' || obj.kind === 'camera') {
      return { ok: false, name: 'scene_move_object', message: `cannot move ${obj.kind}` }
    }
    const toRaw = (args.to ?? {}) as Record<string, unknown>
    const to = {
      x: toRaw.x !== undefined ? Number(toRaw.x) : obj.position.x,
      y: toRaw.y !== undefined ? Number(toRaw.y) : obj.position.y,
      z: toRaw.z !== undefined ? Number(toRaw.z) : obj.position.z,
    }
    this.sceneFx.sync(obj)
    this.sceneFx.move(
      obj,
      {
        to,
        durationMs: args.durationMs !== undefined ? Number(args.durationMs) : undefined,
        smooth: args.smooth !== false,
        trail: args.trail !== false,
        trailColor: args.trailColor !== undefined ? String(args.trailColor) : undefined,
      },
      (movedId, pos) => {
        this.sceneRegistry.update(movedId, { position: pos })
      },
    )
    this.sceneRegistry.update(id, { position: to })
    return {
      ok: true,
      name: 'scene_move_object',
      message: `move ${id}`,
      data: { id, to },
    }
  }

  sceneGlowObject(args: Record<string, unknown>): ToolResult {
    const id = String(args.id ?? '')
    const obj = this.sceneRegistry.get(id)
    if (!obj) {
      return { ok: false, name: 'scene_glow_object', message: `unknown object: ${id}` }
    }
    this.sceneFx.sync(obj)
    const ok = this.sceneFx.glow(id, {
      color: args.color !== undefined ? (args.color as string | number) : undefined,
      durationMs: args.durationMs !== undefined ? Number(args.durationMs) : undefined,
      intensity: args.intensity !== undefined ? Number(args.intensity) : undefined,
    })
    return {
      ok,
      name: 'scene_glow_object',
      message: ok ? `glow ${id}` : `no mesh for ${id}`,
    }
  }

  applyToolCall(name: string, args: Record<string, unknown>): ToolResult {
    const resolved = resolveCharacterToolName(name)
    try {
      switch (resolved) {
        case 'character_set_emotion': {
          this.applyFaceCue({
            emotion: String(args.emotion ?? 'neutral'),
            intensity: args.intensity !== undefined ? Number(args.intensity) : 0.4,
            faces: parseToolFaceLayers(args.faces),
            fadeMs: args.fadeMs !== undefined ? Number(args.fadeMs) : undefined,
            holdMs: args.holdMs !== undefined ? Number(args.holdMs) : undefined,
          })
          return { ok: true, name: resolved, message: `emotion=${args.emotion}` }
        }
        case 'character_play_gesture': {
          const emotion =
            args.emotion !== undefined && args.emotion !== null
              ? String(args.emotion)
              : undefined
          this.applyFaceCue({
            emotion,
            intensity: args.intensity !== undefined ? Number(args.intensity) : undefined,
            faces: parseToolFaceLayers(args.faces),
            fadeMs: args.fadeMs !== undefined ? Number(args.fadeMs) : undefined,
          })
          const played = this.playGesture(
            String(args.id),
            Boolean(args.loop ?? false),
            Number(args.crossFade ?? 0.25),
            undefined,
            'tool',
            args.target !== undefined ? String(args.target) : undefined,
          )
          return { ok: true, name: resolved, message: `gesture=${args.id} ${played}` }
        }
        case 'character_look_at': {
          const parsed = parseLookAtTarget(args.target)
          const target = (parsed !== undefined ? parsed : args.target) as LookAtTarget
          const holdRaw = args.holdMs
          const holdMs =
            holdRaw !== undefined && holdRaw !== null ? Number(holdRaw) : undefined
          const turn = args.turn === undefined ? undefined : Boolean(args.turn)
          this.lookAt(target, {
            turn,
            holdMs,
            lock: target === 'camera',
          })
          return { ok: true, name: resolved, message: 'look_at updated' }
        }
        case 'character_set_expression': {
          this.setExpression(String(args.name), Number(args.weight))
          return { ok: true, name: resolved, message: `expression=${args.name}` }
        }
        case 'character_list_expressions': {
          const expressions = this.listExpressions()
          const names = expressions.map((e) => e.name)
          return {
            ok: true,
            name: resolved,
            message: names.join(', ') || '(none)',
            data: { expressions, names },
          }
        }
        case 'character_list_gestures': {
          const ids = this.listGestures()
          return { ok: true, name: resolved, message: ids.join(', ') || '(none)', data: { ids } }
        }
        case 'character_list_clothes': {
          const native = this.listClothes()
          const current = this.describeClothes()
          const groups = current.groups.map((g) => ({
            category: g.category,
            label: g.label,
            ids: g.items.map((i) => i.id),
          }))
          return {
            ok: true,
            name: resolved,
            message: `current=${current.id}; groups=${groups.map((g) => `${g.category}:[${g.ids.join('+')}]`).join(' ') || '(none)'}`,
            data: { current, native, groups },
          }
        }
        case 'character_set_clothes': {
          const idsRaw = args.ids ?? args.clothes_ids
          const ids = Array.isArray(idsRaw)
            ? idsRaw.map((v) => String(v))
            : typeof idsRaw === 'string'
              ? parseClothesIdList(idsRaw)
              : undefined
          const id =
            args.id !== undefined && args.id !== null
              ? String(args.id)
              : args.clothes !== undefined && args.clothes !== null
                ? String(args.clothes)
                : undefined
          const url =
            args.url === undefined || args.url === null ? undefined : String(args.url)
          const selection = resolveClothesSelection({ id, ids })
          if (selection.mode === 'items' && !url) {
            const native = this.listClothes()
            const unknown = selection.ids.filter(
              (cid) =>
                !isReservedClothesId(cid) &&
                !native.some((c) => c.id === cid || c.category === cid),
            )
            if (unknown.length === selection.ids.length) {
              return {
                ok: false,
                name: resolved,
                message: `unknown clothes: ${unknown.join('+')}`,
                data: {
                  available: [
                    CLOTHES_NONE_ID,
                    CLOTHES_DEFAULT_ID,
                    ...native.map((c) => c.id),
                  ],
                },
              }
            }
          }
          void this.setClothes({ id, ids, url: url ?? null })
          return {
            ok: true,
            name: resolved,
            message: `clothes=${this.getClothesId()}`,
            data: this.describeClothes(),
          }
        }
        case 'character_wait':
        case 'character_run_sequence':
        case 'character_cancel':
          return {
            ok: false,
            name: resolved,
            message: 'Use AnimationDirector.runToolCall for wait/sequence/cancel',
          }
        case 'character_walk':
        case 'character_walk_to':
          return this.walk(args)
        case 'character_turn':
          return this.turn(
            Number(args.degrees),
            args.speed !== undefined ? Number(args.speed) : undefined,
          )
        case 'character_stop':
          this.stopLocomotion()
          return { ok: true, name: 'character_stop', message: 'stopped' }
        case 'character_jump':
          return this.jump()
        case 'character_teleport':
          this.hoverY = null
          this.facingHold = false
          return this.teleport(args)
        case 'character_approach':
          return this.approach(args)
        case 'character_turn_to':
          return this.turnToTarget(args)
        case 'scene_list_objects': {
          const filter = {
            query: args.query !== undefined ? String(args.query) : undefined,
            kind: args.kind !== undefined ? String(args.kind) : undefined,
            tag: args.tag !== undefined ? String(args.tag) : undefined,
            ids: Array.isArray(args.ids) ? args.ids.map(String) : undefined,
            limit: args.limit !== undefined ? Number(args.limit) : undefined,
          }
          const listed = this.listSceneObjects(filter)
          const objects = listed.objects.map((o) => this.sceneRegistry.toPublic(o))
          return {
            ok: true,
            name: resolved,
            message: `${objects.length}/${listed.total} objects`,
            data: { objects, total: listed.total },
          }
        }
        case 'scene_get_object': {
          const id = String(args.id ?? args.target ?? '')
          const obj = this.resolveSceneObject(id) ?? this.getSceneObject(id)
          if (!obj) {
            return {
              ok: false,
              name: resolved,
              message: `unknown object: ${id}`,
              data: { available: this.sceneRegistry.ids() },
            }
          }
          return {
            ok: true,
            name: resolved,
            message: obj.id,
            data: { object: this.sceneRegistry.toPublic(obj) },
          }
        }
        case 'scene_overview':
          return this.sceneOverview(args)
        case 'scene_move_object':
          return this.sceneMoveObject(args)
        case 'scene_glow_object':
          return this.sceneGlowObject(args)
        default:
          return { ok: false, name: resolved, message: `unknown tool: ${name}` }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.logger.error?.('[character-kit] tool error', resolved, message)
      return { ok: false, name: resolved, message }
    }
  }

  applyToolCallsFromMessage(message: {
    tool_calls?: Array<{
      function?: { name?: string; arguments?: string }
    }>
  }): ToolResult[] {
    const calls = message.tool_calls ?? []
    const results: ToolResult[] = []
    for (const call of calls) {
      const fname = call.function?.name
      if (!fname) continue
      const resolved = resolveCharacterToolName(fname)
      if (!this.knownTools.has(resolved)) {
        continue
      }
      let args: Record<string, unknown> = {}
      try {
        args = JSON.parse(call.function?.arguments || '{}') as Record<string, unknown>
      } catch {
        results.push({ ok: false, name: resolved, message: 'invalid JSON arguments' })
        continue
      }
      results.push(this.applyToolCall(resolved, args))
    }
    return results
  }

  /**
   * Resize the drawing buffer to the canvas' CSS box. Called by the resize
   * observer (coalesced to one rAF) and on demand by hosts that manage their own
   * layout. Without this the fixed initial buffer would be stretched by CSS and
   * the model would look distorted after a window resize.
   */
  resize(): void {
    if (this.embedded || !this.renderer) return
    if (this.resizeRaf) return
    this.resizeRaf = requestAnimationFrame(() => {
      this.resizeRaf = 0
      this.applyResize()
    })
  }

  /** Synchronous resize for hosts that must measure immediately (tests). */
  resizeNow(): void {
    if (this.embedded || !this.renderer) return
    this.applyResize()
  }

  private applyResize(): void {
    if (this.disposed || this.embedded || !this.renderer) return
    const w = this.canvas.clientWidth || 1
    const h = this.canvas.clientHeight || 1
    const size = this.renderer.getSize(new THREE.Vector2())
    if (size.x === w && size.y === h) return
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(w, h, false)
  }

  /**
   * Re-apply pixel ratio / size / colour space after a context restore. Unlike
   * {@link applyResize} this always runs, because a restored context has the new
   * buffer but not necessarily our previous renderer state.
   */
  private reapplyRendererState(): void {
    if (this.disposed || this.embedded || !this.renderer) return
    const w = this.canvas.clientWidth || 1
    const h = this.canvas.clientHeight || 1
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.maxPixelRatio))
    this.renderer.setSize(w, h, false)
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
  }

  /**
   * Current WebGL context state. `'unavailable'` means no context was ever
   * granted (the stage cannot draw); `'lost'` is transient recovery.
   */
  contextState(): ContextState {
    return this.contextRecovery?.state() ?? 'ready'
  }

  /** Subscribe to context loss/restore (drives fallback notices on the host). */
  onContextStateChange(
    listener: (state: ContextState, detail: { reason: string | null }) => void,
  ): () => void {
    return this.contextRecovery?.onStateChange(listener) ?? (() => {})
  }

  /**
   * Subscribe to renderer status. Fires `ok` at subscribe time, then `lost` /
   * `restored` as the GPU revokes and returns the context, or `failed` when no
   * context could be created. Optional and additive: hosts that ignore it keep
   * today's behaviour. Returns an unsubscribe function.
   */
  onRendererStatus(handler: RendererStatusListener): () => void {
    if (!this.contextRecovery) {
      handler({ state: 'ok' })
      return () => {}
    }
    return this.contextRecovery.onStatus(handler)
  }

  /** Current renderer status without subscribing. */
  rendererStatus(): RendererStatus {
    return this.contextRecovery?.status() ?? { state: 'ok' }
  }

  /** Stop the loop on loss, restart it on restore. */
  private handleRendererStatus(status: RendererStatus): void {
    if (status.state === 'lost') {
      // three guards `render()` internally, so pausing is purely a CPU win; the
      // simulation stops too, which is fine while no pixels are being produced.
      cancelAnimationFrame(this.raf)
      this.raf = 0
      return
    }
    if (status.state === 'restored') {
      // three re-inits its GL state in its own restore listener; re-apply the
      // host renderer state it does not own (pixel ratio, drawing-buffer size,
      // colour space) rather than `applyResize`, which early-returns when the
      // CSS box is unchanged.
      this.reapplyRendererState()
      if (!this.disposed && !this.embedded && !this.raf) {
        this.raf = requestAnimationFrame(this.tick)
      }
    }
  }

  private tick(): void {
    if (this.disposed) return
    this.raf = requestAnimationFrame(this.tick)
    // A lost/unavailable context throws on every draw call; skip rendering (the
    // simulation keeps running so nothing desyncs) until it is restored.
    const canRender = !this.renderer || contextAllowsRender(this.contextState())
    try {
      this.stepSimulation(this.clock.getDelta())
    } catch (err) {
      this.logger.error?.('[character-kit] tick', err)
    }
    if (!canRender) return
    try {
      this.renderer?.render(this.scene, this.camera)
    } catch (err) {
      this.logger.error?.('[character-kit] render', err)
    }
  }

  private stepSimulation(delta: number): void {
    this.tickLocomotion(delta)
    this.controls?.update()
    if (this.idlePulseEnabled && this.idleAction && this.currentAction === this.idleAction) {
      this.idleAction.timeScale = stepIdleTimeScalePulse(
        this.idlePulse,
        delta,
        this.idleTimeScaleCenter,
      )
    }
    this.gaze.preMixer(this.vrm)
    this.mixer?.update(delta)
    this.tickPoseGuard(performance.now())
    this.restReturn.update(delta)
    this.tickFadingActions()
    this.gaze.update({
      vrm: this.vrm,
      camera: this.camera,
      lookTarget: this.lookTarget,
      eyeTarget: this.eyeTarget,
      rig: this.rig,
      delta,
      performanceBusy: this.isPerformanceBusy(),
      locomoting: this.loco.moving || this.loco.seeking || Math.abs(this.turnRemainingRad) > 1e-3,
    })
    this.face.update(this.vrm, delta)
    this.blink.update(this.vrm, delta)
    if (this.gaze.drivesEyes()) {
      if (this.vrm?.lookAt) this.vrm.lookAt.target = this.eyeTarget
    } else {
      this.saccades.setAmplitude(this.gaze.saccadeAmplitude())
      if (this.saccadesEnabled) {
        this.saccades.update(this.vrm, this.lookTarget, delta)
      } else if (this.vrm?.lookAt) {
        this.vrm.lookAt.target = this.lookTarget
      }
    }
    this.lipSync?.update()
    this.vrm?.update(delta)
    if (this.seat?.visible && this.vrm) {
      placeSeatUnderHips(this.seat, this.vrm)
    }
    this.overlayCache.refreshBinds(this.overlayRoot)
    this.overlayCache.update(delta)
    this.syncAvatarCatalog()
    if (this.ownsSceneFx) {
      const now = performance.now()
      for (const obj of this.sceneRegistry.all()) {
        if (obj.kind === 'avatar' || obj.kind === 'camera') continue
        this.sceneFx.sync(obj)
      }
      this.sceneFx.tick(now, new Map(this.sceneRegistry.all().map((o) => [o.id, o])))
    }
  }

  dispose(): void {
    this.disposed = true
    cancelAnimationFrame(this.raf)
    if (this.resizeRaf) cancelAnimationFrame(this.resizeRaf)
    this.resizeRaf = 0
    this.resizeObserver?.disconnect()
    this.resizeObserver = null
    window.removeEventListener('pointermove', this.onPointerMove)
    document.documentElement.removeEventListener('mouseleave', this.onPointerLeaveWindow)
    window.removeEventListener('blur', this.onPointerLeaveWindow)
    this.canvas.removeEventListener('pointerdown', this.onOrbitPointerDown)
    window.removeEventListener('pointerup', this.onOrbitPointerUp)
    window.removeEventListener('pointercancel', this.onOrbitPointerUp)
    this.face.dispose()
    this.lipSyncPending = null
    releaseLipSync(this.lipSync, this.lipSyncOwnsContext)
    this.lipSync = null
    this.lipSyncOwnsContext = false
    this.controls?.dispose()
    this.disposeClothesOverlayGroup()
    this.overlayCache.dispose()
    if (this.seat) {
      this.scene.remove(this.seat)
      disposeSeatMesh(this.seat)
      this.seat = null
    }
    if (this.grid) {
      this.scene.remove(this.grid)
      this.grid.geometry.dispose()
      const mat = this.grid.material
      if (Array.isArray(mat)) for (const m of mat) m.dispose()
      else mat.dispose()
      this.grid = null
    }
    this.scene.remove(this.walkTrail.object)
    this.walkTrail.dispose()
    if (this.ownsSceneFx) {
      this.scene.remove(this.sceneFx.group)
      this.sceneFx.dispose()
    }
    this.flushSeekWaiters(false)
    this.locoListeners.clear()
    this.nativeClothes = []
    this.humanoidRest = []
    this.restPaddedClips = new WeakMap()
    this.fadingActions.clear()
    this.pendingGestureEndGlance = false
    this.restReturn.cancel()
    if (this.vrm) {
      this.rig.remove(this.vrm.scene)
      VRMUtils.deepDispose(this.vrm.scene)
      this.vrm = null
    }
    this.scene.remove(this.lookTarget)
    this.scene.remove(this.eyeTarget)
    this.scene.remove(this.rig)
    this.logger.info?.('[character-kit] disposed', { url: this.vrmUrl })
    this.vrmUrl = null
    this.unsubRendererStatus?.()
    this.unsubRendererStatus = null
    this.renderer?.dispose()
    this.contextRecovery?.dispose()
    this.contextRecovery = null
    this.listeners.clear()
  }
}

function parseToolFaceLayers(raw: unknown): FaceLayer[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined
  const layers: FaceLayer[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const rec = item as { name?: unknown; weight?: unknown; emotion?: unknown }
    const name = String(rec.name ?? rec.emotion ?? '').trim()
    if (!name) continue
    layers.push({
      name: aliasFaceName(name),
      weight: normalizeFaceWeight(
        rec.weight !== undefined ? Number(rec.weight) : Number.NaN,
      ),
    })
  }
  return layers.length ? layers : undefined
}

function overlayIdentityKey(pieces: ClothesOverlayPiece[]): string {
  return pieces.map((p) => `${p.sourceId}::${p.itemId}`).join('|')
}
