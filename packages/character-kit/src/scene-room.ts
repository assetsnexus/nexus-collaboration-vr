import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js'
import { CharacterController } from './controller.js'
import type { GazeLimits } from './gaze.js'
import { AnimationDirector } from './animation-director.js'
import { fetchRewrittenManifest } from './companion-host.js'
import { mayAutoDownloadAvatarAsset } from './avatar-asset-gate.js'
import {
  parseInlineTags,
  defaultInlineCatalog,
  type InlineSequenceStep,
  type ParsedInlineTags,
} from './inline-tags.js'
import type { CharacterActionEvent, CharacterActionListener, CharacterActionSource } from './action-feed.js'
import {
  SceneRegistry,
  createBuiltinSceneObjects,
  type SceneObject,
} from './scene-registry.js'
import { SceneObjectLayer } from './scene-fx.js'
import { SceneEventLog, type CompactSceneEvent } from './scene-events.js'
import {
  contextAllowsRender,
  createResilientRenderer,
  type ContextRecoveryHandle,
  type ContextState,
  type RendererStatus,
  type RendererStatusListener,
} from './renderer-resilience.js'
import { layoutSpawnSlots, type SpawnSlot } from './spawn-slots.js'
import { cameraPoseFacingAvatar, cameraYawTowardTarget } from './scene-camera.js'
import {
  isOccupantFallbackUrl,
  isOccupantLoadCancelled,
  isStaleOccupantLoad,
  normalizeOccupants,
  occupantRenderUrl,
  occupantWorldPose,
  resolveOccupantSpawnPose,
  OCCUPANT_LOAD_CANCELLED,
} from './scene-occupants.js'
import { StandInMarker } from './stand-in.js'
import { DEFAULT_SAMPLE_VRM } from './default-sample-vrm.js'
import {
  InteractionAck,
  type InteractionAckOptions,
} from './interaction-ack.js'
import { resolveCharacterToolName } from './tools.js'
import { PhoneVrController, type PhoneVrStatus } from './phone-vr-controller.js'
import {
  defaultPhoneVrSettings,
  type PhoneVrSettingsV1,
} from './viewer-profiles.js'
import {
  emptyAvatarAssetLoadProgress,
  type AvatarAssetLoadProgress,
  type AvatarAssetLoadProgressListener,
} from './load-progress.js'

export interface SceneRoomOptions {
  background?: number
  maxPixelRatio?: number
  orbitControls?: boolean
  pointerLook?: boolean
  spacing?: number
  logger?: Pick<Console, 'info' | 'warn' | 'error'>
  onLabelClick?: (id: string) => void
  onLabelDblClick?: (id: string) => void
  gestureManifestUrl?: string
  /** Local phone-VR viewer settings (smartphone cardboard-class glasses). */
  phoneVrSettings?: PhoneVrSettingsV1
  onPhoneVrStatus?: (status: PhoneVrStatus) => void
  /**
   * Single-occupant companion stage: skip roster nametags / status circles and
   * frame the lone avatar instead of a group. The room bounds + grid stay, so
   * `character_walk` / `character_approach` remain visibly meaningful.
   */
  soloStage?: boolean
}

export interface SceneRoomAvatarConfig {
  id: string
  vrmUrl: string
  slotIndex: number
  label?: string
  mood?: string
  /** Restored world XZ; omitted values spawn at the reserved slot. */
  x?: number
  z?: number
  facing?: number
}

export interface SceneRoomOccupant {
  id: string
  label: string
  slotIndex: number
  vrmUrl?: string | null
  /** Catalog gate for `vrmUrl`; room peers only auto-load when verified (or platform default). */
  validationStatus?: 'pending_admin' | 'rejected' | 'verified' | string | null
  mood?: string
  statusColor: number
  /** false keeps the spawn slot and draws a status-colored empty circle. */
  present: boolean
  /** Restored world XZ from a previous visit. Not part of roster identity. */
  x?: number
  z?: number
  facing?: number
}

export interface SceneRoomAvatarHandle {
  id: string
  controller: CharacterController
  director: AnimationDirector
  setMood: (mood: string, intensity?: number) => void
  playGesture: (gestureId: string, sceneTarget?: string) => Promise<boolean>
  faceToward: (x: number, z: number) => void
  worldPosition: () => THREE.Vector3
}

/** Compact XZ pose for Hermes scene prompt (no mesh). */
export type SceneOccupantPose = {
  slug: string
  x: number
  z: number
  facing: number
  present: boolean
}

interface SceneRoomAvatarState {
  id: string
  vrmUrl: string
  slotIndex: number
  controller: CharacterController
  director: AnimationDirector
  offAction: () => void
}

interface PlaceholderState {
  id: string
  slotIndex: number
  marker: StandInMarker
}

const DEFAULT_BG = 0x12171c
const DEFAULT_SPACING = 1.25
const LABEL_CLEARANCE = 0.28
const HEAD_LABEL_LIFT = 0.85
const PLACEHOLDER_LABEL_Y = 1.85
const FALLBACK_LABEL_Y = 2.2
const _headWorld = new THREE.Vector3()
const _labelWorld = new THREE.Vector3()
const _labelBox = new THREE.Box3()

export class SceneRoom {
  readonly scene: THREE.Scene
  readonly camera: THREE.PerspectiveCamera
  /** Null when no WebGL context could be acquired (stage disabled in this window). */
  readonly renderer: THREE.WebGLRenderer | null
  readonly labelRenderer: CSS2DRenderer
  /** WebGL context loss/restore tracker (null when no context was granted). */
  private contextRecovery: ContextRecoveryHandle | null = null
  /** Unbind for the context-loss/restore subscription. */
  private unsubRendererStatus: (() => void) | null = null
  /** Pixel-ratio cap so a post-restore resize re-applies the same value. */
  private readonly maxPixelRatio: number

  private readonly clock = new THREE.Clock()
  private readonly avatars = new Map<string, SceneRoomAvatarState>()
  private readonly placeholders = new Map<string, PlaceholderState>()
  private readonly labels = new Map<string, CSS2DObject>()
  private readonly canvas: HTMLCanvasElement
  private readonly logger: Pick<Console, 'info' | 'warn' | 'error'>
  private readonly spacing: number
  private readonly onLabelClick?: (id: string) => void
  /** Companion solo stage: no nametags / status circles for the lone occupant. */
  private readonly soloStage: boolean
  private controls: OrbitControls | null = null
  private resizeObserver: ResizeObserver | null = null
  private animationFrame = 0
  private pointerLookEnabled: boolean
  /** When true, gaze follows an OS-global cursor feed (desktop companion). */
  private externalPointerLook = false
  /** Occupant gaze-cone overrides; applied to avatars on add and via the setter. */
  private gazeLimits: Partial<GazeLimits> | null = null
  private audioContext: AudioContext | null = null
  private disposed = false
  private occupants: SceneRoomOccupant[] = []
  private occupantSyncing = false
  private occupantSyncPending = false
  private occupantSyncPromise: Promise<void> | null = null
  private selectedId: string | null = null
  private speakingId: string | null = null
  private readonly onLabelDblClick?: (id: string) => void
  private framedForCount = -1
  private labelLayer: HTMLDivElement
  private readonly gestureManifestUrl?: string
  readonly sceneRegistry = new SceneRegistry()
  readonly sceneFx = new SceneObjectLayer()
  readonly eventLog = new SceneEventLog()
  private readonly actionListeners = new Set<CharacterActionListener>()
  private readonly phoneVr: PhoneVrController
  private readonly onPhoneVrStatus?: (status: PhoneVrStatus) => void
  /**
   * Solo-stage click/zoom ack (nod on click). Only created for the single-avatar
   * companion stage, where a page click meaningfully targets "the avatar"; in a
   * shared meeting roster it would be ambiguous, so it stays null there.
   */
  private clickAck: InteractionAck | null = null
  private loadProgress: AvatarAssetLoadProgress = emptyAvatarAssetLoadProgress()
  private readonly loadProgressListeners = new Set<AvatarAssetLoadProgressListener>()
  private readonly modelLoadRatios = new Map<string, number>()
  private readonly gestureLoadRatios = new Map<string, number>()

  constructor(canvas: HTMLCanvasElement, options: SceneRoomOptions = {}) {
    this.canvas = canvas
    this.logger = options.logger ?? console
    this.maxPixelRatio = Number.isFinite(options.maxPixelRatio)
      ? Number(options.maxPixelRatio)
      : 2
    this.spacing = Number.isFinite(options.spacing) ? Number(options.spacing) : DEFAULT_SPACING
    this.pointerLookEnabled = options.pointerLook !== false
    this.onLabelClick = options.onLabelClick
    this.onLabelDblClick = options.onLabelDblClick
    this.gestureManifestUrl = options.gestureManifestUrl
    this.onPhoneVrStatus = options.onPhoneVrStatus
    this.soloStage = options.soloStage === true
    if (!this.gestureManifestUrl) {
      this.logger.warn?.(
        '[character-kit] SceneRoom has no gestureManifestUrl — occupants stay in T-pose without an idle clip',
      )
    }

    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(options.background ?? DEFAULT_BG)

    const width = canvas.clientWidth || 640
    const height = canvas.clientHeight || 480
    this.camera = new THREE.PerspectiveCamera(30, width / height, 0.1, 100)
    this.camera.position.set(0, 1.55, 4.4)

    // Multi-window safety: several companion windows can saturate the GPU
    // process and make it refuse a context. Degrade through cheaper flavours
    // rather than throwing, so one more stage always comes up. A total failure
    // still leaves a room object (occupants/labels render nothing) instead of
    // crashing the host window.
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
          `[character-kit] SceneRoom WebGL context degraded to "${id}" (${reason ?? 'unknown'})`,
        )
      },
    })
    this.renderer = acquired.renderer
    this.contextRecovery = acquired.renderer ? acquired.context : null
    if (!this.renderer) {
      this.logger.warn?.(
        '[character-kit] SceneRoom has no WebGL context; the 3D room is disabled in this window',
      )
    }
    // Stop the RAF loop on loss and restart it on restore, so a stalled window
    // does not keep scheduling frames three early-returns from.
    this.unsubRendererStatus = this.contextRecovery?.onStatus((status) => {
      this.handleRendererStatus(status)
    }) ?? null
    this.renderer?.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.maxPixelRatio))
    this.renderer?.setSize(width, height, false)
    if (this.renderer) this.renderer.outputColorSpace = THREE.SRGBColorSpace

    this.labelLayer = document.createElement('div')
    this.labelLayer.className = 'scene-room-labels'
    this.labelLayer.style.position = 'absolute'
    this.labelLayer.style.inset = '0'
    this.labelLayer.style.pointerEvents = 'none'
    this.labelRenderer = new CSS2DRenderer({ element: this.labelLayer })
    this.labelRenderer.setSize(width, height)
    const host = canvas.parentElement ?? canvas
    if (getComputedStyle(host).position === 'static') {
      host.style.position = 'relative'
    }
    host.appendChild(this.labelLayer)

    const key = new THREE.DirectionalLight(0xffffff, 1.15)
    key.position.set(1.5, 2.8, 2.6)
    this.scene.add(key)
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.55))
    const fill = new THREE.HemisphereLight(0xd9ebff, 0x10151c, 0.55)
    fill.position.set(0, 3, 0)
    this.scene.add(fill)

    const grid = new THREE.GridHelper(16, 32, 0x2a333d, 0x1a222a)
    this.scene.add(grid)
    this.scene.add(this.sceneFx.group)
    for (const o of createBuiltinSceneObjects()) this.sceneRegistry.register(o)

    if (options.orbitControls !== false) {
      this.controls = new OrbitControls(this.camera, canvas)
      this.controls.target.set(0, 1.45, 0)
      this.controls.enableDamping = true
      this.controls.enablePan = true
      this.controls.screenSpacePanning = true
      this.controls.update()
    }

    this.tick = this.tick.bind(this)
    this.onPointerMove = this.onPointerMove.bind(this)
    this.onPointerLeave = this.onPointerLeave.bind(this)

    window.addEventListener('pointermove', this.onPointerMove, { passive: true })
    window.addEventListener('blur', this.onPointerLeave)
    document.documentElement.addEventListener('mouseleave', this.onPointerLeave)

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.resize())
      this.resizeObserver.observe(canvas.parentElement ?? canvas)
    }

    this.animationFrame = requestAnimationFrame(this.tick)
    this.phoneVr = new PhoneVrController(
      {
        scene: this.scene,
        camera: this.camera,
        // Null when no context was granted; PhoneVrController reports
        // `no_render_context` instead of dereferencing it.
        renderer: this.renderer,
        setOrbitEnabled: (enabled) => {
          if (this.controls) this.controls.enabled = enabled
        },
        setPointerLookEnabled: (enabled) => {
          this.pointerLookEnabled = enabled
          if (!enabled) this.onPointerLeave()
        },
        setLabelsVisible: (visible) => {
          this.labelLayer.style.visibility = visible ? 'visible' : 'hidden'
        },
        onStatus: (status) => this.onPhoneVrStatus?.(status),
        logger: this.logger,
      },
      options.phoneVrSettings ?? defaultPhoneVrSettings(),
    )
    this.logger.info?.('[character-kit] SceneRoom ready')
  }

  /**
   * Enable/disable the solo click-ack (nod on page click) with a configurable
   * gesture id. Created lazily so a shared roster (meeting) never installs a
   * document click listener, where click targeting would be ambiguous.
   */
  setClickAckOptions(opts: Partial<InteractionAckOptions> & { enabled?: boolean }): void {
    const { enabled, ...rest } = opts
    if (enabled === false) {
      this.clickAck?.dispose()
      this.clickAck = null
      return
    }
    if (!this.clickAck) {
      this.clickAck = new InteractionAck(this.canvas, (id, meta) => {
        const avatar = [...this.avatars.values()][0]
        if (!avatar) return
        avatar.controller.playGesture(id, false, 0.12, meta.timeScale, 'user')
        avatar.director.pushAction('gesture', id, 'user', meta.reason)
      })
      // Zoom acks stay off: the companion surfaces do not use wheel-to-gesture.
      this.clickAck.setOptions({ zoomEnabled: false })
    }
    if (Object.keys(rest).length) this.clickAck.setOptions(rest)
    // The play handler guards on a loaded occupant, so ack readiness does not need
    // to wait for the VRM/gesture async load here.
    this.clickAck.setReady(true)
  }

  /** Current solo click-ack options (null when disabled / not installed). */
  getClickAckOptions(): (InteractionAckOptions & { enabled: boolean }) | null {
    if (!this.clickAck) return null
    return { enabled: true, ...this.clickAck.getOptions() }
  }

  /**
   * Sync the shared roster. Slot indices stay reserved; missing occupants
   * keep an empty status circle instead of closing the gap.
   *
   * Overlapping calls coalesce onto the latest roster. In-flight VRM loads
   * that no longer match `occupants[].vrmUrl` are disposed instead of being
   * registered — otherwise two meshes share a slot when the catalog changes.
   */
  async setOccupants(occupants: SceneRoomOccupant[]): Promise<void> {
    if (this.disposed) throw new Error('SceneRoom disposed')
    this.occupants = normalizeOccupants(occupants)
    this.occupantSyncPending = true
    if (this.occupantSyncing && this.occupantSyncPromise) return this.occupantSyncPromise
    this.occupantSyncPromise = this.runOccupantSync()
    return this.occupantSyncPromise
  }

  private async runOccupantSync(): Promise<void> {
    this.occupantSyncing = true
    try {
      while (this.occupantSyncPending && !this.disposed) {
        this.occupantSyncPending = false
        await this.applyOccupants()
      }
    } finally {
      this.occupantSyncing = false
      this.occupantSyncPromise = null
    }
  }

  private syncRosterShell(): void {
    const wanted = new Set(this.occupants.map((o) => o.id))
    for (const id of [...this.placeholders.keys()]) {
      if (!wanted.has(id)) this.removePlaceholder(id)
    }
    for (const id of [...this.avatars.keys()]) {
      if (!wanted.has(id)) this.removeAvatar(id)
    }
    for (const id of [...this.labels.keys()]) {
      if (!wanted.has(id)) this.removeLabel(id)
    }
    // A solo companion stage shows the avatar only: no nametags, no status
    // circles, so the single occupant is not framed like a meeting roster.
    if (this.soloStage) {
      this.selectedId = null
      this.layoutAll(false)
      return
    }
    for (const occ of this.occupants) {
      this.ensurePlaceholder(occ)
      this.ensureLabel(occ)
    }
    if (this.selectedId && !wanted.has(this.selectedId)) {
      this.selectedId = null
    }
    this.syncNametagSelection()
    this.layoutAll(false)
  }

  private async applyOccupants(): Promise<void> {
    if (this.disposed) return
    this.syncRosterShell()

    for (const occ of [...this.occupants]) {
      if (this.disposed || this.occupantSyncPending) return
      const latest = this.occupants.find((row) => row.id === occ.id)
      if (!latest) {
        this.removeAvatar(occ.id)
        continue
      }
      // A present occupant with no configured VRM still gets a body: fall back
      // to the platform sample so the agent is visible/animated instead of
      // vanishing from the stage until an avatar is chosen in the gallery.
      const url = occupantRenderUrl(latest)
      const existing = this.avatars.get(latest.id)
      if (!url) {
        if (existing) this.removeAvatar(latest.id)
        continue
      }
      if (existing && existing.vrmUrl === url) {
        existing.slotIndex = latest.slotIndex
        if (latest.mood) existing.director.getPresence().setMood(latest.mood)
        continue
      }
      if (existing) this.removeAvatar(latest.id)
      const download = mayAutoDownloadAvatarAsset({
        url,
        // The sample VRM is a platform default (always allowed); only a real
        // per-agent VRM needs the catalog validation status.
        validationStatus: isOccupantFallbackUrl(url) ? 'verified' : latest.validationStatus,
      })
      if (!download.allow) {
        this.logger.warn?.('[character-kit] SceneRoom skipped unverified occupant VRM', {
          id: latest.id,
          url,
          reason: download.reason,
          validationStatus: latest.validationStatus ?? null,
        })
        continue
      }
      try {
        await this.addAvatar({
          id: latest.id,
          vrmUrl: url,
          slotIndex: latest.slotIndex,
          label: latest.label,
          mood: latest.mood,
          x: latest.x,
          z: latest.z,
          facing: latest.facing,
        })
      } catch (err) {
        if (this.disposed) return
        if (isOccupantLoadCancelled(err) || this.occupantSyncPending) continue
        this.logger.warn?.('[character-kit] SceneRoom occupant VRM failed', latest.id, err)
        this.placeholders.get(latest.id)?.marker.setLoadFailed(true)
      }
    }
    if (this.disposed || this.occupantSyncPending) return
    this.layoutAll(true)
    this.logger.info?.('[character-kit] SceneRoom occupants', {
      count: this.occupants.length,
      present: this.occupants.filter((o) => o.present).length,
    })
  }

  async addAvatar(config: SceneRoomAvatarConfig): Promise<SceneRoomAvatarHandle> {
    if (this.disposed) throw new Error('SceneRoom disposed')
    if (this.avatars.has(config.id)) {
      throw new Error(`avatar already exists: ${config.id}`)
    }

    const controller = new CharacterController(this.canvas, {
      embed: {
        scene: this.scene,
        camera: this.camera,
        canvas: this.canvas,
        sceneRegistry: this.sceneRegistry,
        sceneFx: this.sceneFx,
      },
      orbitControls: false,
      pointerLook: this.pointerLookEnabled,
      agentId: config.id,
    })
    if (this.externalPointerLook) controller.setExternalPointerEnabled(true)
    if (this.gazeLimits) controller.setGazeLimits(this.gazeLimits)
    const director = new AnimationDirector(controller, {
      presence: { enabled: true, mood: (config.mood as 'neutral') || 'neutral' },
    })
    director.setAgentId(config.id)
    director.setController(controller)

    const spawnPose = resolveOccupantSpawnPose(config, this.slotPose(config.slotIndex))
    controller.getRig().visible = false
    controller.placeAt(spawnPose.x, spawnPose.z, spawnPose.yawRad)

    let dropped = false
    const dropUnregistered = () => {
      if (dropped) return
      dropped = true
      director.dispose()
      controller.dispose()
    }

    const markProgress = (ratio: number) => {
      this.placeholders.get(config.id)?.marker.setLoadProgress(ratio)
      this.setModelLoadRatio(config.id, ratio)
    }

    try {
      this.placeholders.get(config.id)?.marker.setLoadFailed(false)
      this.placeholders.get(config.id)?.marker.setLoadProgress(0)
      this.setModelLoadRatio(config.id, 0)
      await controller.loadVRM(config.vrmUrl || DEFAULT_SAMPLE_VRM, markProgress, {
        validationStatus: this.occupants.find((o) => o.id === config.id)?.validationStatus,
      })
      if (this.isStaleAvatarAdd(config)) {
        dropUnregistered()
        throw new Error(this.disposed ? 'SceneRoom disposed' : OCCUPANT_LOAD_CANCELLED)
      }
    } catch (err) {
      this.placeholders.get(config.id)?.marker.setLoadProgress(null)
      this.setModelLoadRatio(config.id, null)
      if (!isOccupantLoadCancelled(err)) {
        this.placeholders.get(config.id)?.marker.setLoadFailed(true)
      }
      dropUnregistered()
      throw err
    }

    if (this.isStaleAvatarAdd(config)) {
      dropUnregistered()
      throw new Error(this.disposed ? 'SceneRoom disposed' : OCCUPANT_LOAD_CANCELLED)
    }
    if (this.avatars.has(config.id)) {
      dropUnregistered()
      throw new Error(`avatar already exists: ${config.id}`)
    }

    const pose = resolveOccupantSpawnPose(
      this.occupants.find((o) => o.id === config.id) || config,
      this.slotPose(config.slotIndex),
    )
    controller.placeAt(pose.x, pose.z, pose.yawRad)
    controller.getRig().visible = true
    this.placeholders.get(config.id)?.marker.setLoadProgress(null)
    this.setModelLoadRatio(config.id, null)
    this.placeholders.get(config.id)?.marker.setOccupied(true)

    // Same boot as CompanionHost: saccades + this occupant's mood + ambient idle.
    controller.setSaccadesEnabled(true)
    director.getPresence().setMood(config.mood || 'neutral')
    director.scheduleThinking()
    if (!controller.isIdlePlaying()) {
      controller.setIdleLoop('idle', { crossFade: 0 })
    }

    const offAction = director.onAction((ev) => this.emitAction(ev))
    const offLoco = controller.onLocomoting((moving) => {
      if (moving) director.pausePresence('locomotion')
      else director.resumePresence()
    })
    const state: SceneRoomAvatarState = {
      id: config.id,
      vrmUrl: config.vrmUrl,
      slotIndex: config.slotIndex,
      controller,
      director,
      offAction: () => {
        offLoco()
        offAction()
      },
    }
    this.avatars.set(config.id, state)
    const occ = this.occupants.find((o) => o.id === config.id)
    if (occ) this.ensurePlaceholder(occ)
    this.ensureLabel({
      id: config.id,
      label: config.label || config.id,
    })
    this.layoutAll(false)
    this.kickGesturePack(config.id, controller)
    this.logger.info?.('[character-kit] SceneRoom avatar added', {
      id: config.id,
      slotIndex: config.slotIndex,
      vrmUrl: config.vrmUrl,
      x: Number(pose.x.toFixed(3)),
      z: Number(pose.z.toFixed(3)),
      facing: Number(pose.yawRad.toFixed(3)),
      idleLoop: controller.getIdleLoopId(),
      idlePlaying: controller.isIdlePlaying(),
      gestureCount: controller.listGestures().length,
    })
    return this.toAvatarHandle(state)
  }

  /**
   * Idle + leftover VRMA after the mesh is already on screen.
   * Awaiting the pack here used to leave the stand-in up until every clip
   * finished — one stalled VRMA on mobile never replaced the placeholder.
   */
  private kickGesturePack(id: string, controller: CharacterController): void {
    if (!this.gestureManifestUrl) return
    const packUrl = this.gestureManifestUrl
    const packGate = mayAutoDownloadAvatarAsset({ url: packUrl })
    if (!packGate.allow) {
      this.logger.warn?.('[character-kit] SceneRoom skipped unverified gesture manifest', {
        id,
        url: packUrl,
        reason: packGate.reason,
      })
      return
    }
    void (async () => {
      this.setGestureLoadRatio(id, 0)
      try {
        const manifest = await fetchRewrittenManifest(packUrl, {
          onSkip: (info) => {
            this.logger.warn?.('[character-kit] SceneRoom skipped gesture asset', id, info)
          },
        })
        if (this.disposed || this.avatars.get(id)?.controller !== controller) return
        const loaded = await controller.loadGesturePack(manifest, {
          onProgress: (ratio) => this.setGestureLoadRatio(id, ratio),
        })
        if (loaded.skipped.length) {
          this.logger.warn?.('[character-kit] SceneRoom skipped gesture clips', {
            id,
            skipped: loaded.skipped,
          })
        }
        if (this.disposed || this.avatars.get(id)?.controller !== controller) return
        if (!controller.isIdlePlaying()) {
          controller.setIdleLoop('idle', { crossFade: 0 })
        }
      } catch (err) {
        if (this.disposed || this.avatars.get(id)?.controller !== controller) return
        this.logger.warn?.('[character-kit] SceneRoom gesture pack failed', id, err)
      } finally {
        this.setGestureLoadRatio(id, null)
      }
    })()
  }

  /** True when this load must not be registered (room gone, or roster URL moved on). */
  private isStaleAvatarAdd(config: SceneRoomAvatarConfig): boolean {
    if (this.disposed) return true
    const latest = this.occupants.find((o) => o.id === config.id)
    if (!latest) return false
    // Compare against the *render* URL so a sample-VRM fallback registered for a
    // still-VRM-less occupant is not immediately treated as stale.
    return isStaleOccupantLoad(occupantRenderUrl(latest), config.vrmUrl || '', this.disposed)
  }

  removeAvatar(id: string): boolean {
    const state = this.avatars.get(id)
    if (!state) return false
    state.offAction()
    state.director.dispose()
    state.controller.dispose()
    this.sceneRegistry.unregister(id)
    this.sceneRegistry.unregister(`avatar:${id}`)
    this.avatars.delete(id)
    this.setModelLoadRatio(id, null)
    this.setGestureLoadRatio(id, null)
    this.layoutAll(false)
    this.logger.info?.('[character-kit] SceneRoom avatar removed', { id })
    return true
  }

  getAvatar(id: string): SceneRoomAvatarHandle | null {
    const state = this.avatars.get(id)
    return state ? this.toAvatarHandle(state) : null
  }

  /** Idle / mood snapshot for each loaded occupant (shared-scene debug). */
  debugOccupants(): Array<{
    id: string
    mood: string
    idleLoop: string
    gesture: string | null
    gestureCount: number
    idlePlaying: boolean
  }> {
    return [...this.avatars.values()].map((a) => ({
      id: a.id,
      mood: a.director.getPresence().getMood().id,
      idleLoop: a.controller.getIdleLoopId(),
      gesture: a.controller.getGestureId(),
      gestureCount: a.controller.listGestures().length,
      idlePlaying: a.controller.isIdlePlaying(),
    }))
  }

  getSelectedId(): string | null {
    return this.selectedId
  }

  /** Live spawn-slot poses for the controller scene digest. */
  snapshotOccupants(): SceneOccupantPose[] {
    return this.occupants.map((occ) => {
      const world = this.worldPosition(occ.id)
      const facing = this.avatars.get(occ.id)?.controller.getLocomotionSnapshot().facing ?? 0
      return {
        slug: occ.id,
        x: Number.isFinite(world?.x) ? world!.x : 0,
        z: Number.isFinite(world?.z) ? world!.z : 0,
        facing: Number.isFinite(facing) ? facing : 0,
        present: this.avatars.has(occ.id),
      }
    })
  }

  /** Teleport loaded avatars to saved XZ. Skips anyone mid-walk. */
  applyOccupantPoses(poses: SceneOccupantPose[]): number {
    let applied = 0
    for (const pose of poses) {
      const avatar = this.avatars.get(pose.slug)
      if (!avatar || avatar.controller.isLocomoting()) continue
      if (!occupantWorldPose(pose)) continue
      const occ = this.occupants.find((o) => o.id === pose.slug)
      const world = resolveOccupantSpawnPose(pose, this.slotPose(occ?.slotIndex ?? avatar.slotIndex))
      avatar.controller.placeAt(world.x, world.z, world.yawRad)
      applied += 1
    }
    if (applied) {
      this.logger.info?.('[character-kit] SceneRoom poses restored', {
        applied,
        requested: poses.length,
      })
    }
    return applied
  }

  /** Highlight only the nametag; no mesh/ring overlay. */
  setSelected(id: string | null): void {
    this.selectedId = id
    this.syncNametagSelection()
  }

  /** Speaker icon over the avatar whose TTS is currently playing. */
  setSpeaking(id: string | null): void {
    this.speakingId = id
    this.syncNametagSpeaking()
  }

  getSpeakingId(): string | null {
    return this.speakingId
  }

  /**
   * Orbit camera to stand in front of the character (they face the lens).
   * Returns false when the occupant is missing.
   */
  frameFacing(id: string, distance?: number): boolean {
    if (this.disposed || !this.controls) return false
    const world = this.worldPosition(id)
    if (!world) return false
    const avatar = this.avatars.get(id)
    const facing = avatar?.controller.getLocomotionSnapshot().facing ?? 0
    let headY = 1.45
    const head = avatar?.controller.getVrm()?.humanoid?.getNormalizedBoneNode('head')
    if (head) {
      head.getWorldPosition(_headWorld)
      if (Number.isFinite(_headWorld.y) && _headWorld.y > 0.4) headY = _headWorld.y
    }
    const pose = cameraPoseFacingAvatar({
      x: world.x,
      z: world.z,
      facingRad: facing,
      headY,
      distance,
    })
    this.camera.position.set(pose.camera.x, pose.camera.y, pose.camera.z)
    this.controls.target.set(pose.target.x, pose.target.y, pose.target.z)
    this.controls.update()
    this.logger.info?.('[character-kit] SceneRoom frame facing', { id, facing, headY })
    return true
  }

  private cameraYawXZ(): number {
    const tx = this.controls?.target.x ?? 0
    const tz = this.controls?.target.z ?? 0
    return cameraYawTowardTarget(this.camera.position.x, this.camera.position.z, tx, tz)
  }

  private syncNametagSelection(): void {
    for (const [id, obj] of this.labels) {
      const on = id === this.selectedId
      obj.element.classList.toggle('selected', on)
      obj.element.setAttribute('aria-pressed', on ? 'true' : 'false')
    }
  }

  private syncNametagSpeaking(): void {
    for (const [id, obj] of this.labels) {
      const on = Boolean(this.speakingId) && id === this.speakingId
      obj.element.classList.toggle('speaking', on)
      if (on) obj.element.setAttribute('aria-description', 'speaking')
      else obj.element.removeAttribute('aria-description')
    }
  }

  onAction(listener: CharacterActionListener): () => void {
    this.actionListeners.add(listener)
    return () => this.actionListeners.delete(listener)
  }

  getLoadProgress(): AvatarAssetLoadProgress {
    return { ...this.loadProgress }
  }

  onLoadProgress(listener: AvatarAssetLoadProgressListener): () => void {
    this.loadProgressListeners.add(listener)
    listener(this.getLoadProgress())
    return () => {
      this.loadProgressListeners.delete(listener)
    }
  }

  private publishLoadProgress(): void {
    const model = aggregateLoadRatio(this.modelLoadRatios)
    const gestures = aggregateLoadRatio(this.gestureLoadRatios)
    this.loadProgress = { model, gestures }
    const snapshot = this.getLoadProgress()
    for (const listener of this.loadProgressListeners) {
      try {
        listener(snapshot)
      } catch {
        /* ignore */
      }
    }
  }

  private setModelLoadRatio(id: string, ratio: number | null): void {
    if (ratio == null) this.modelLoadRatios.delete(id)
    else this.modelLoadRatios.set(id, ratio)
    this.publishLoadProgress()
  }

  private setGestureLoadRatio(id: string, ratio: number | null): void {
    if (ratio == null) this.gestureLoadRatios.delete(id)
    else this.gestureLoadRatios.set(id, ratio)
    this.publishLoadProgress()
  }

  async playInlineTags(
    id: string,
    text: string,
    opts: { enabled?: boolean; source?: CharacterActionSource; locomotionOnly?: boolean } = {},
  ): Promise<ParsedInlineTags> {
    const state = this.avatars.get(id)
    if (!state) {
      return parseInlineTags(text, defaultInlineCatalog(), { enabled: false })
    }
    const enabled = opts.enabled !== false
    const source = opts.source ?? 'tag'
    const base = defaultInlineCatalog()
    const parsed = parseInlineTags(
      text,
      {
        ...base,
        gestures: [...new Set([...base.gestures, ...state.controller.listGestures()])],
      },
      { enabled },
    )
    if (!enabled) return parsed
    const locomotionOps = new Set(['walk', 'approach', 'teleport', 'turn', 'jump', 'turn_to'])
    const withSpeech = opts.locomotionOnly
      ? parsed.withSpeech.filter((s) => locomotionOps.has(s.op))
      : parsed.withSpeech
    const afterTts = opts.locomotionOnly ? [] : parsed.afterTts
    if (!withSpeech.length && !afterTts.length) return parsed
    const gen = state.director.beginSpeechBeat()
    try {
      if (withSpeech.length) await state.director.runSequence(withSpeech, gen, source)
      if (afterTts.length && state.director.isCurrent(gen)) {
        await state.director.runSequence(afterTts, gen, source)
      }
    } finally {
      state.director.endSpeechBeat(gen)
    }
    return parsed
  }

  async playTimedSteps(
    id: string,
    steps: InlineSequenceStep[],
    source: CharacterActionSource = 'tag',
  ): Promise<void> {
    const state = this.avatars.get(id)
    if (!state || !steps.length) return
    const gen = state.director.beginSpeechBeat()
    try {
      await state.director.runSequence(steps, gen, source)
    } finally {
      state.director.endSpeechBeat(gen)
    }
  }

  applyToolCall(id: string, name: string, args: Record<string, unknown>) {
    const state = this.avatars.get(id)
    if (!state) return { ok: false, name, message: `unknown avatar: ${id}` }
    return state.director.runToolCall(name, args)
  }

  /** Route a tool call through the director so the motion feed records it. */
  async runToolCall(
    id: string,
    name: string,
    args: Record<string, unknown> = {},
  ): Promise<import('./types.js').ToolResult> {
    const state = this.avatars.get(id)
    if (!state) return { ok: false, name, message: `unknown avatar: ${id}` }
    return state.director.runToolCall(resolveCharacterToolName(name), args)
  }

  /**
   * Hard-reset one occupant (or every occupant) to the idle rest pose. The
   * escape hatch behind the scene "Reset pose" action and the auto-recovery
   * guard: no clip is left holding weight.
   */
  resetAvatarPose(id?: string | null, reason = 'manual'): boolean {
    if (id) {
      const state = this.avatars.get(id)
      if (!state) return false
      state.controller.resetToIdlePose(reason)
      return true
    }
    let any = false
    for (const state of this.avatars.values()) {
      state.controller.resetToIdlePose(reason)
      any = true
    }
    return any
  }

  setAvatarMood(
    id: string,
    mood: string,
    source: CharacterActionSource = 'user',
    detail = 'config',
  ): boolean {
    const state = this.avatars.get(id)
    if (!state) return false
    const ok = state.director.getPresence().setMood(mood)
    if (ok) state.director.pushAction('mood', mood, source, detail)
    return ok
  }

  listAvatarGestures(id: string): string[] {
    const state = this.avatars.get(id)
    return state ? state.controller.listGestures() : []
  }

  listLoadedAvatarGestures(id: string): import('./types.js').LoadedGestureInfo[] {
    const state = this.avatars.get(id)
    return state ? state.controller.listLoadedGestures() : []
  }

  isAvatarIdlePlaying(id: string): boolean {
    return this.avatars.get(id)?.controller.isIdlePlaying() ?? false
  }

  playAvatarGesture(
    id: string,
    gestureId: string,
    opts: { loop?: boolean; timeScale?: number; source?: CharacterActionSource; target?: string } = {},
  ): Promise<boolean> {
    const handle = this.getAvatar(id)
    if (!handle) return Promise.resolve(false)
    return handle.playGesture(gestureId, opts.target)
  }

  drainSceneDigest(agent: string): { events: CompactSceneEvent[]; faces: Record<string, string> } {
    return this.eventLog.drainForAgent(agent)
  }

  faceAvatar(id: string, targetId: string): boolean {
    const target = this.worldPosition(targetId)
    if (!target) return false
    return this.faceToward(id, target.x, target.z)
  }

  faceToward(id: string, x: number, z: number): boolean {
    const state = this.avatars.get(id)
    if (!state) return false
    state.controller.turnToWorld(x, z, true)
    return true
  }

  worldPosition(id: string): THREE.Vector3 | null {
    const avatar = this.avatars.get(id)
    if (avatar) {
      const p = avatar.controller.groundPosition()
      return new THREE.Vector3(p.x, p.y, p.z)
    }
    const ph = this.placeholders.get(id)
    if (ph) return ph.marker.root.position.clone()
    return null
  }

  async speakWithLipSync(
    id: string,
    mediaStream: MediaStream,
    audioContext?: AudioContext,
  ): Promise<void> {
    const state = this.avatars.get(id)
    if (!state) {
      this.logger.warn?.('[character-kit] SceneRoom speakWithLipSync: unknown avatar', id)
      return
    }
    try {
      await state.controller.speakWithLipSync(mediaStream, audioContext)
      this.logger.info?.('[character-kit] SceneRoom lip-sync attached', id)
    } catch (err) {
      this.logger.warn?.('[character-kit] SceneRoom speakWithLipSync failed', id, err)
    }
  }

  stopLipSync(id?: string): void {
    if (id) {
      this.avatars.get(id)?.controller.stopLipSync()
      return
    }
    for (const state of this.avatars.values()) state.controller.stopLipSync()
  }

  setPointerLook(enabled: boolean): void {
    this.pointerLookEnabled = enabled
    for (const avatar of this.avatars.values()) {
      avatar.controller.setPointerLookEnabled(enabled)
    }
    this.logger.info?.('[character-kit] SceneRoom pointer look', enabled)
  }

  /**
   * Push an OS-global cursor NDC to every occupant (see the desktop companion
   * global-cursor IPC). Pair with {@link setExternalPointerEnabled} so in-window
   * DOM moves and window-leave clears stop overriding the external aim.
   */
  setPointerNdc(ndcX: number, ndcY: number): void {
    for (const avatar of this.avatars.values()) {
      avatar.controller.setPointerNdc(ndcX, ndcY)
    }
  }

  /** Route every occupant's gaze through an external cursor feed. */
  setExternalPointerEnabled(on: boolean): void {
    this.externalPointerLook = on
    for (const avatar of this.avatars.values()) {
      avatar.controller.setExternalPointerEnabled(on)
    }
  }

  /**
   * Apply an in-window DOM pointer sample to every occupant. A no-op per
   * occupant while the OS-global (external) feed is armed, so the room's
   * external writer stays the single source of aim.
   */
  applyDomPointerNdc(ndcX: number, ndcY: number): void {
    for (const avatar of this.avatars.values()) {
      avatar.controller.applyDomPointerNdc(ndcX, ndcY)
    }
  }

  /**
   * Set the head/neck gaze cone (degrees) for every occupant, and remember it so
   * avatars added later inherit it. The desktop companion widens this beyond the
   * tight library default so the head visibly turns as the cursor crosses the
   * whole screen instead of barely moving.
   */
  setGazeLimits(limits: Partial<GazeLimits>): void {
    this.gazeLimits = { ...(this.gazeLimits ?? {}), ...limits }
    for (const avatar of this.avatars.values()) {
      avatar.controller.setGazeLimits(this.gazeLimits)
    }
  }

  /** Current occupant gaze cone overrides (empty when the library default is used). */
  getGazeLimits(): Partial<GazeLimits> {
    return { ...(this.gazeLimits ?? {}) }
  }

  /** Smartphone VR glasses mode (stereo + IMU / WebXR). Same enter/exit rails as portal play-webxr. */
  getPhoneVr(): PhoneVrController {
    return this.phoneVr
  }

  async enterPhoneVr(): Promise<PhoneVrStatus> {
    return this.phoneVr.enter()
  }

  async exitPhoneVr(): Promise<PhoneVrStatus> {
    return this.phoneVr.exit()
  }

  isPhoneVrActive(): boolean {
    return this.phoneVr.getStatus().active
  }

  resize(): void {
    const width = this.canvas.clientWidth || 1
    const height = this.canvas.clientHeight || 1
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    this.renderer?.setSize(width, height, false)
    this.labelRenderer.setSize(width, height)
    this.phoneVr.resize(width, height)
  }

  /** Current WebGL context state (`'unavailable'` when no context was granted). */
  contextState(): ContextState {
    return this.contextRecovery?.state() ?? 'ready'
  }

  /** Subscribe to context loss/restore so a host can show a fallback notice. */
  onContextStateChange(
    listener: (state: ContextState, detail: { reason: string | null }) => void,
  ): () => void {
    return this.contextRecovery?.onStateChange(listener) ?? (() => {})
  }

  /**
   * Subscribe to renderer status. Fires `ok` at subscribe time, then `lost` /
   * `restored` / `failed`. Optional and additive; returns an unsubscribe.
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
      cancelAnimationFrame(this.animationFrame)
      this.animationFrame = 0
      return
    }
    if (status.state === 'restored') {
      this.reapplyRendererState()
      if (!this.disposed && !this.animationFrame) {
        this.animationFrame = requestAnimationFrame(this.tick)
      }
    }
  }

  /**
   * Re-apply pixel ratio / size / colour space after a context restore. Unlike
   * {@link resize} this always runs, because the restored buffer has no memory of
   * our previous renderer state.
   */
  private reapplyRendererState(): void {
    if (this.disposed || !this.renderer) return
    const width = this.canvas.clientWidth || 1
    const height = this.canvas.clientHeight || 1
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.maxPixelRatio))
    this.renderer.setSize(width, height, false)
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.occupantSyncPending = false
    cancelAnimationFrame(this.animationFrame)
    this.phoneVr.dispose()
    window.removeEventListener('pointermove', this.onPointerMove)
    window.removeEventListener('blur', this.onPointerLeave)
    document.documentElement.removeEventListener('mouseleave', this.onPointerLeave)
    this.resizeObserver?.disconnect()
    this.resizeObserver = null
    this.clickAck?.dispose()
    this.clickAck = null
    for (const id of [...this.avatars.keys()]) this.removeAvatar(id)
    for (const id of [...this.placeholders.keys()]) this.removePlaceholder(id)
    for (const id of [...this.labels.keys()]) this.removeLabel(id)
    this.controls?.dispose()
    this.audioContext?.close().catch(() => undefined)
    this.audioContext = null
    this.sceneFx.dispose()
    this.labelLayer.remove()
    this.unsubRendererStatus?.()
    this.unsubRendererStatus = null
    this.renderer?.dispose()
    this.contextRecovery?.dispose()
    this.contextRecovery = null
  }

  private toAvatarHandle(state: SceneRoomAvatarState): SceneRoomAvatarHandle {
    return {
      id: state.id,
      controller: state.controller,
      director: state.director,
      setMood: (mood) => {
        state.director.getPresence().setMood(mood)
      },
      playGesture: async (gestureId, sceneTarget) => {
        state.director.pushAction('gesture', gestureId, 'agent', 'status', sceneTarget)
        const result = state.controller.playGesture(
          gestureId,
          false,
          0.25,
          undefined,
          'agent',
          sceneTarget,
        )
        return result !== 'skipped'
      },
      faceToward: (x, z) => {
        this.faceToward(state.id, x, z)
      },
      worldPosition: () => {
        const p = state.controller.groundPosition()
        return new THREE.Vector3(p.x, p.y, p.z)
      },
    }
  }

  private emitAction(ev: CharacterActionEvent): void {
    this.eventLog.recordAction({
      agent: ev.agent,
      op: ev.op,
      label: ev.label,
      target: ev.target,
      source: ev.source,
      at: ev.at,
    })
    for (const listener of this.actionListeners) {
      try {
        listener(ev)
      } catch (err) {
        this.logger.error?.('[character-kit] SceneRoom action listener', err)
      }
    }
  }

  private slotCount(): number {
    let max = this.occupants.length
    for (const occ of this.occupants) max = Math.max(max, occ.slotIndex + 1)
    for (const avatar of this.avatars.values()) max = Math.max(max, avatar.slotIndex + 1)
    for (const ph of this.placeholders.values()) max = Math.max(max, ph.slotIndex + 1)
    return max
  }

  private slotPose(index: number): SpawnSlot {
    const slots = layoutSpawnSlots(Math.max(1, this.slotCount()), this.spacing)
    return slots[index] ?? { index, x: index * this.spacing, z: 0, yawRad: 0 }
  }

  private layoutAll(frameCamera: boolean): void {
    const n = this.slotCount()
    if (!n) {
      if (this.controls) {
        this.controls.target.set(0, 1.45, 0)
        this.controls.update()
      }
      return
    }

    for (const occ of this.occupants) {
      const pose = this.slotPose(occ.slotIndex)
      const avatar = this.avatars.get(occ.id)
      const ph = this.placeholders.get(occ.id)
      if (avatar) {
        avatar.slotIndex = occ.slotIndex
        // Keep walked / restored world pose. Spawn snap is addAvatar's job.
      }
      if (ph) {
        ph.slotIndex = occ.slotIndex
        ph.marker.placeAt(pose.x, pose.z)
        ph.marker.setOccupied(Boolean(avatar))
      }
    }

    if (frameCamera && n !== this.framedForCount) {
      this.frameGroup()
      this.framedForCount = n
    }
  }

  private frameGroup(): void {
    const poses = layoutSpawnSlots(Math.max(1, this.slotCount()), this.spacing)
    if (!poses.length) return
    const xs = poses.map((p) => p.x)
    const zs = poses.map((p) => p.z)
    const minX = Math.min(...xs)
    const maxX = Math.max(...xs)
    const centerX = (minX + maxX) / 2
    const centerZ = (Math.min(...zs) + Math.max(...zs)) / 2
    const span = Math.max(this.spacing, maxX - minX)
    if (this.controls) {
      this.controls.target.set(centerX, 1.35, centerZ)
      this.controls.update()
    }
    this.camera.position.set(centerX, 1.7, Math.max(3.4, 3.0 + span * 0.85))
  }

  private ensurePlaceholder(occ: SceneRoomOccupant): void {
    let ph = this.placeholders.get(occ.id)
    if (!ph) {
      const marker = new StandInMarker(occ.statusColor)
      marker.root.name = `scene-room-slot:${occ.id}`
      this.scene.add(marker.root)
      ph = { id: occ.id, slotIndex: occ.slotIndex, marker }
      this.placeholders.set(occ.id, ph)
    }
    ph.slotIndex = occ.slotIndex
    ph.marker.setColor(occ.statusColor)
  }

  private removePlaceholder(id: string): void {
    const ph = this.placeholders.get(id)
    if (!ph) return
    ph.marker.dispose()
    this.placeholders.delete(id)
  }

  private ensureLabel(occ: Pick<SceneRoomOccupant, 'id' | 'label'>): void {
    let obj = this.labels.get(occ.id)
    if (!obj) {
      const el = document.createElement('button')
      el.type = 'button'
      el.className = 'scene-room-nametag'
      el.style.pointerEvents = 'auto'
      el.addEventListener('click', (ev) => {
        ev.preventDefault()
        ev.stopPropagation()
        this.setSelected(occ.id)
        this.onLabelClick?.(occ.id)
        el.blur()
      })
      el.addEventListener('dblclick', (ev) => {
        ev.preventDefault()
        ev.stopPropagation()
        this.setSelected(occ.id)
        this.frameFacing(occ.id)
        this.onLabelDblClick?.(occ.id)
        el.blur()
      })
      const icon = document.createElement('span')
      icon.className = 'scene-room-speak-icon'
      icon.setAttribute('aria-hidden', 'true')
      icon.innerHTML =
        '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M5 9v6h4l5 5V4L9 9H5Zm12.5 3A4.5 4.5 0 0 0 14 8.65v6.7A4.5 4.5 0 0 0 17.5 12Z"/></svg>'
      const name = document.createElement('span')
      name.className = 'scene-room-nametag-label'
      el.append(icon, name)
      obj = new CSS2DObject(el)
      obj.center.set(0.5, 1)
      obj.name = `scene-room-label:${occ.id}`
      this.scene.add(obj)
      this.labels.set(occ.id, obj)
    }
    const el = obj.element as HTMLElement
    const name = el.querySelector('.scene-room-nametag-label')
    if (name) name.textContent = occ.label
    else el.textContent = occ.label
    el.title = occ.label
    el.classList.toggle('selected', occ.id === this.selectedId)
    el.setAttribute('aria-pressed', occ.id === this.selectedId ? 'true' : 'false')
    this.syncNametagSpeaking()
  }

  private removeLabel(id: string): void {
    const obj = this.labels.get(id)
    if (!obj) return
    obj.parent?.remove(obj)
    obj.element.remove()
    this.labels.delete(id)
  }

  private updateLabels(): void {
    for (const [id, obj] of this.labels) {
      obj.center.set(0.5, 1)
      const avatar = this.avatars.get(id)
      if (avatar) {
        const vrm = avatar.controller.getVrm()
        const rig = avatar.controller.getRig()
        const head = vrm?.humanoid?.getNormalizedBoneNode('head')
        if (head) {
          head.getWorldPosition(_headWorld)
          obj.position.x = _headWorld.x
          obj.position.z = _headWorld.z
        } else {
          obj.position.x = rig.position.x
          obj.position.z = rig.position.z
        }
        if (vrm) {
          try {
            _labelBox.setFromObject(vrm.scene)
          } catch {
            _labelBox.makeEmpty()
          }
        }
        const meshTop = Number.isFinite(_labelBox.max.y) ? _labelBox.max.y : FALLBACK_LABEL_Y
        const headY = head ? _headWorld.y : rig.position.y + 1.5
        obj.position.y = Math.max(headY + HEAD_LABEL_LIFT, meshTop + LABEL_CLEARANCE)
        continue
      }
      const ph = this.placeholders.get(id)
      if (ph) {
        ph.marker.root.getWorldPosition(_labelWorld)
        obj.position.set(_labelWorld.x, _labelWorld.y + PLACEHOLDER_LABEL_Y, _labelWorld.z)
      }
    }
  }

  private onPointerMove(event: PointerEvent): void {
    if (this.disposed) return
    this.sceneFx.hoverAt(this.camera, this.canvas, event.clientX, event.clientY)
    if (!this.pointerLookEnabled || this.avatars.size === 0) return
    const rect = this.canvas.getBoundingClientRect()
    const width = rect.width || 1
    const height = rect.height || 1
    const ndcX = ((event.clientX - rect.left) / width) * 2 - 1
    const ndcY = -(((event.clientY - rect.top) / height) * 2 - 1)
    // No-op per occupant while the OS-global (external) feed is armed: the
    // room's external writer must remain the single source of aim.
    this.applyDomPointerNdc(ndcX, ndcY)
  }

  private onPointerLeave(): void {
    this.sceneFx.clearHover()
    for (const avatar of this.avatars.values()) {
      avatar.controller.clearPointerLook()
    }
  }

  private tickCollisions(): void {
    const bodies = [...this.avatars.values()].map((a) => {
      const p = a.controller.groundPosition()
      return { id: a.id, x: p.x, z: p.z, r: a.controller.avatarRadius() }
    })
    for (let i = 0; i < bodies.length; i++) {
      for (let j = i + 1; j < bodies.length; j++) {
        const a = bodies[i]!
        const b = bodies[j]!
        const dist = Math.hypot(a.x - b.x, a.z - b.z)
        if (dist <= a.r + b.r) {
          const ev = this.eventLog.recordCollision(a.id, b.id, dist)
          if (ev) this.logger.info?.('[character-kit] SceneRoom contact', ev)
        }
      }
    }
    for (const body of bodies) {
      for (const obj of this.sceneRegistry.all()) {
        if (obj.kind === 'avatar' || obj.kind === 'camera' || obj.id === body.id) continue
        if (obj.id === 'spawn') continue
        const dist = Math.hypot(obj.position.x - body.x, obj.position.z - body.z)
        if (dist <= body.r + obj.radius) {
          const ev = this.eventLog.recordCollision(body.id, obj.id, dist)
          if (ev) this.logger.info?.('[character-kit] SceneRoom contact', ev)
        }
      }
    }
  }

  private tick(): void {
    if (this.disposed) return
    this.animationFrame = requestAnimationFrame(this.tick)
    try {
      const delta = this.clock.getDelta()

      if (!this.phoneVr.getStatus().active) {
        this.controls?.update()
      }

      let cameraYaw = 0
      try {
        cameraYaw = this.cameraYawXZ()
      } catch (err) {
        this.logger.error?.('[character-kit] SceneRoom camera yaw', err)
      }
      for (const avatar of this.avatars.values()) {
        try {
          avatar.controller.tickSimulation(delta, cameraYaw)
        } catch (err) {
          this.logger.error?.('[character-kit] SceneRoom avatar tick', avatar.id, err)
        }
      }

      const now = performance.now()
      const objMap = new Map(this.sceneRegistry.all().map((o) => [o.id, o] as const))
      for (const obj of this.sceneRegistry.all()) {
        if (obj.kind === 'avatar' || obj.kind === 'camera') continue
        this.sceneFx.sync(obj)
      }
      this.sceneFx.tick(now, objMap as Map<string, SceneObject>)
      this.tickCollisions()

      this.updateLabels()
    } catch (err) {
      this.logger.error?.('[character-kit] SceneRoom tick', err)
    }
    // A lost/unavailable context throws on every draw call; skip rendering until
    // it is restored (the simulation above keeps running so nothing desyncs).
    if (!contextAllowsRender(this.contextState())) return
    try {
      if (this.phoneVr.renderFrame()) {
        /* stereo path rendered */
      } else if (this.renderer) {
        this.renderer.render(this.scene, this.camera)
        this.labelRenderer.render(this.scene, this.camera)
      }
    } catch (err) {
      this.logger.error?.('[character-kit] SceneRoom render', err)
    }
  }
}

/** Prefer determinate min; indeterminate (-1) wins if any in-flight load lacks Content-Length. */
function aggregateLoadRatio(ratios: Map<string, number>): number | null {
  if (!ratios.size) return null
  let hasIndeterminate = false
  let min = 1
  for (const ratio of ratios.values()) {
    if (ratio < 0) {
      hasIndeterminate = true
      continue
    }
    min = Math.min(min, ratio)
  }
  if (hasIndeterminate) return -1
  return min
}

export { layoutSpawnSlots, facingYawRad } from './spawn-slots.js'
export type { SpawnSlot } from './spawn-slots.js'
