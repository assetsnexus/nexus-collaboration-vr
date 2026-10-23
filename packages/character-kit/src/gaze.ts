import {
  Euler,
  MathUtils,
  Object3D,
  PerspectiveCamera,
  Quaternion,
  Vector3,
} from 'three'
import type { VRM } from '@pixiv/three-vrm'
import type { LookAtTarget } from './types.js'

export interface Xyz {
  x: number
  y: number
  z: number
}

/** Exponential ease toward a value (frame-rate independent). */
export function expSmooth(current: number, target: number, lambda: number, dt: number): number {
  const t = 1 - Math.exp(-Math.max(0, lambda) * Math.max(0, dt))
  return current + (target - current) * t
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

const _POS_Z = new Vector3(0, 0, 1)
const _ffEuler = new Euler()

/**
 * Quaternion that maps world +Z → VRM `lookAt.faceFront`.
 * VRM0 models use −Z (three-vrm sets `faceFront` accordingly); conjugating
 * local YXZ look deltas with this matches three-vrm's VRMLookAtBoneApplier.
 */
export function faceFrontLookSpace(
  faceFront: Vector3 | { x: number; y: number; z: number } | null | undefined,
  out: Quaternion = new Quaternion(),
): Quaternion {
  if (!faceFront) return out.identity()
  const fx = faceFront.x
  const fy = faceFront.y
  const fz = faceFront.z
  if (fx * fx + fy * fy + fz * fz < 1e-8) return out.identity()
  if ((fx - _POS_Z.x) ** 2 + (fy - _POS_Z.y) ** 2 + (fz - _POS_Z.z) ** 2 < 0.01) {
    return out.identity()
  }
  const azimuth = Math.atan2(-fz, fx)
  const altitude = Math.atan2(fy, Math.sqrt(fx * fx + fz * fz))
  _ffEuler.set(0, 0.5 * Math.PI + azimuth, altitude, 'YZX')
  return out.setFromEuler(_ffEuler)
}

/**
 * Local look delta in bone space, conjugated into the model's faceFront frame
 * (no-op for VRM1 / +Z faceFront; flips pitch for typical VRM0 −Z).
 */
export function spineLookDeltaQuat(
  yaw: number,
  pitch: number,
  faceFrontSpace: Quaternion,
  out: Quaternion = new Quaternion(),
  scratch: Quaternion = new Quaternion(),
  scratchInv: Quaternion = new Quaternion(),
): Quaternion {
  const e = new Euler(pitch, yaw, 0, 'YXZ')
  scratch.setFromEuler(e)
  if (
    faceFrontSpace.x === 0 &&
    faceFrontSpace.y === 0 &&
    faceFrontSpace.z === 0 &&
    faceFrontSpace.w === 1
  ) {
    return out.copy(scratch)
  }
  return out
    .copy(faceFrontSpace)
    .multiply(scratch)
    .multiply(scratchInv.copy(faceFrontSpace).invert())
}

/**
 * Parse camera / clear / `{x,y,z}` / `"1,1.4,-0.5"` / `"x=1 y=1.4 z=-0.5"`.
 * Returns `undefined` when the value is not a look target.
 */
export function parseLookAtTarget(raw: unknown): LookAtTarget | undefined {
  if (raw === undefined) return undefined
  if (raw === null) return null
  if (typeof raw === 'number' && !Number.isFinite(raw)) return undefined
  if (typeof raw === 'object') {
    const rec = raw as { x?: unknown; y?: unknown; z?: unknown }
    if (rec.x === undefined && rec.y === undefined && rec.z === undefined) return undefined
    const x = Number(rec.x)
    const y = Number(rec.y)
    const z = Number(rec.z)
    if (![x, y, z].every(Number.isFinite)) return undefined
    return { x, y, z }
  }
  if (typeof raw !== 'string') return undefined
  const s = raw.trim().toLowerCase()
  if (!s) return undefined
  if (s === 'camera' || s === 'user' || s === 'viewer' || s === 'me') return 'camera'
  if (s === 'null' || s === 'clear' || s === 'none' || s === 'idle' || s === 'off') {
    return null
  }
  if (s.startsWith('{')) {
    try {
      return parseLookAtTarget(JSON.parse(raw) as unknown)
    } catch {
      return undefined
    }
  }
  const named: Partial<Xyz> = {}
  const namedRe = /([xyz])\s*=\s*(-?\d+(?:\.\d+)?)/g
  let m: RegExpExecArray | null
  while ((m = namedRe.exec(s))) {
    const axis = m[1] as 'x' | 'y' | 'z'
    named[axis] = Number(m[2])
  }
  if (named.x !== undefined || named.y !== undefined || named.z !== undefined) {
    const x = named.x
    const y = named.y
    const z = named.z
    if (x === undefined || y === undefined || z === undefined) return undefined
    if (![x, y, z].every(Number.isFinite)) return undefined
    return { x, y, z }
  }
  const parts = s.split(/[,\s]+/).filter(Boolean)
  if (parts.length === 3) {
    const x = Number(parts[0])
    const y = Number(parts[1])
    const z = Number(parts[2])
    if ([x, y, z].every(Number.isFinite)) return { x, y, z }
  }
  if (parts.length === 2) {
    const x = Number(parts[0])
    const z = Number(parts[1])
    if ([x, z].every(Number.isFinite)) return { x, y: 1.4, z }
  }
  return undefined
}

/**
 * World point the character should look at for a canvas-relative pointer.
 *
 * Screen center → toward the camera (conversation). Screen edges yaw up to
 * `yawMax` (default {@link GAZE_POINTER_YAW_MAX}).
 */
export function pointerLookPoint(
  ndcX: number,
  ndcY: number,
  camera: Xyz,
  head: Xyz,
  out: Xyz = { x: 0, y: 0, z: 0 },
  opts: { yawMax?: number; pitchMax?: number } = {},
): Xyz {
  const yawMax = opts.yawMax ?? GAZE_POINTER_YAW_MAX
  const pitchMax = opts.pitchMax ?? GAZE_POINTER_PITCH_MAX
  // ndcX > 0 is screen-right = world +X when the camera sits on +Z looking at origin.
  const yaw = -clamp(ndcX, -1, 1) * yawMax
  const pitch = clamp(ndcY, -1, 1) * pitchMax
  let tx = camera.x - head.x
  let tz = camera.z - head.z
  const flat = Math.hypot(tx, tz)
  if (flat < 1e-5) {
    tx = 0
    tz = 1
  } else {
    tx /= flat
    tz /= flat
  }
  const cos = Math.cos(yaw)
  const sin = Math.sin(yaw)
  let dx = tx * cos - tz * sin
  let dz = tx * sin + tz * cos
  const cp = Math.cos(pitch)
  const sp = Math.sin(pitch)
  dx *= cp
  dz *= cp
  const dy = sp
  const dist = 1.7
  out.x = head.x + dx * dist
  out.y = head.y + dy * dist
  out.z = head.z + dz * dist
  return out
}

/** Signed yaw (rad) around Y that rotates current +Z toward the XZ target. */
export function yawTowardXZ(from: Xyz, to: Xyz, restYaw = 0): number {
  const dx = to.x - from.x
  const dz = to.z - from.z
  if (dx * dx + dz * dz < 1e-8) return restYaw
  return Math.atan2(dx, dz) - restYaw
}

/** Wrap to (−π, π]. */
export function wrapPi(rad: number): number {
  const two = Math.PI * 2
  let a = (rad + Math.PI) % two
  if (a < 0) a += two
  return a - Math.PI
}

/** Rig yaw that matches locomotion heading (VRM rest is often 180° from +Z). */
export function locoRigYaw(locoYaw: number, restForwardYaw: number): number {
  return wrapPi(locoYaw - restForwardYaw)
}

/**
 * Idle / orbit hip yaw. When body-follow-camera is off and nothing else asked
 * to face the viewer (speech lock, look-at with turn), keep locomotion heading
 * instead of auto-spinning toward the camera.
 */
export function desiredIdleBodyYaw(opts: {
  locomoting: boolean
  followViewer: boolean
  locoYaw: number
  restForwardYaw: number
  cameraFacingYaw: number
  bodyFromCamera: number
}): number {
  if (opts.locomoting || !opts.followViewer) {
    return locoRigYaw(opts.locoYaw, opts.restForwardYaw)
  }
  return wrapPi(opts.locoYaw + opts.cameraFacingYaw + opts.bodyFromCamera)
}

export function expSmoothAngle(current: number, target: number, lambda: number, dt: number): number {
  const delta = wrapPi(target - current)
  return wrapPi(current + delta * (1 - Math.exp(-Math.max(0, lambda) * Math.max(0, dt))))
}

/** Natural look offsets on top of the clip pose (radians). Cheap clamps, not IK.
 * Combined head+neck+chest defaults leave room for eyes to glance past the face. */
export const GAZE_HEAD_YAW_MAX = MathUtils.degToRad(28)
export const GAZE_HEAD_PITCH_MAX = MathUtils.degToRad(18)
export const GAZE_NECK_YAW_MAX = MathUtils.degToRad(16)
export const GAZE_NECK_PITCH_MAX = MathUtils.degToRad(12)
export const GAZE_CHEST_YAW_MAX = MathUtils.degToRad(6)
export const GAZE_CHEST_PITCH_MAX = MathUtils.degToRad(5)
/** Default total spine yaw for pointer — eyes may go further. */
export const GAZE_SPINE_YAW_MAX = MathUtils.degToRad(20)
export const GAZE_SPINE_PITCH_MAX = MathUtils.degToRad(22)
/** Default head pointer cone (matches spine). */
export const GAZE_POINTER_YAW_MAX = MathUtils.degToRad(20)
export const GAZE_POINTER_PITCH_MAX = MathUtils.degToRad(22)
/** Default eye aim cone — wider than head so irises can look past the nose. */
export const GAZE_EYE_YAW_MAX = MathUtils.degToRad(70)
export const GAZE_EYE_PITCH_MAX = MathUtils.degToRad(30)
/** Body barely turns for pointer (hips stay toward the viewer). */
export const GAZE_BODY_POINTER_MAX = MathUtils.degToRad(12)
export const GAZE_BODY_EXPLICIT_MAX = MathUtils.degToRad(140)
/** Idle glances: body only helps past this residual. */
export const GAZE_HEAD_COVER = MathUtils.degToRad(50)

/** After this long with no pointer motion, eyes ease back to the user. */
export const GAZE_EYE_IDLE_MS = 5000

export interface GazeLimits {
  /** Max head/neck/chest yaw toward the pointer (degrees). */
  headYawMaxDeg: number
  /** Max head/neck/chest pitch (degrees). */
  headPitchMaxDeg: number
  /** Max eye aim yaw from camera-facing (degrees). Should be ≥ head for visible iris offset. */
  eyeYawMaxDeg: number
  /** Max eye aim pitch (degrees). */
  eyePitchMaxDeg: number
}

export const DEFAULT_GAZE_LIMITS: GazeLimits = {
  headYawMaxDeg: 20,
  headPitchMaxDeg: 22,
  eyeYawMaxDeg: 70,
  eyePitchMaxDeg: 30,
}

export function clampGazeLimits(raw: Partial<GazeLimits> | null | undefined): GazeLimits {
  const d = DEFAULT_GAZE_LIMITS
  const num = (v: unknown, fallback: number, min: number, max: number) => {
    const n = typeof v === 'number' ? v : Number(v)
    if (!Number.isFinite(n)) return fallback
    return Math.min(max, Math.max(min, n))
  }
  return {
    headYawMaxDeg: num(raw?.headYawMaxDeg, d.headYawMaxDeg, 10, 60),
    headPitchMaxDeg: num(raw?.headPitchMaxDeg, d.headPitchMaxDeg, 8, 40),
    eyeYawMaxDeg: num(raw?.eyeYawMaxDeg, d.eyeYawMaxDeg, 0, 90),
    eyePitchMaxDeg: num(raw?.eyePitchMaxDeg, d.eyePitchMaxDeg, 10, 45),
  }
}

export interface GazeLookOptions {
  /** Yaw the rig toward world points. Default true. */
  turn?: boolean
  /** Auto-release back to idle/pointer after this many ms. */
  holdMs?: number
  /**
   * Keep looking at the camera until cleared / hold expires.
   * Without this (and without holdMs), `lookAt('camera')` is soft and does not
   * block pointer head-follow.
   */
  lock?: boolean
}

export interface GazeUpdateContext {
  vrm: VRM | null
  camera: PerspectiveCamera
  lookTarget: Object3D
  /** Dedicated VRM lookAt target for eyes (separate from head aim). */
  eyeTarget: Object3D
  rig: Object3D
  delta: number
  /** One-shot performance clip is running — keep body yaw small unless explicit. */
  performanceBusy?: boolean
  /** Stick / LLM walk active — hold body yaw at locomotion facing. */
  locomoting?: boolean
}

const _headPos = new Vector3()
const _look = new Vector3()
const _idle = new Vector3()
const _eyeWant = new Vector3()
const _inv = new Quaternion()

/**
 * Idle / pointer / speech / explicit look-at, plus a yaw rig so the body can
 * turn past VRM eye limits. Apply after the animation mixer, before `vrm.update`.
 *
 * Spine offsets are undo→apply each frame. Idle VRMA often omits head/neck tracks,
 * so multiplying onto the live quaternion would accumulate and spin forever.
 */
export class CharacterGaze {
  pointerEnabled = true
  /** Yaw hips toward the camera as it orbits. Default off. */
  bodyFollowCamera = false
  private pointerOver = false
  /**
   * When true, gaze is driven by an OS-global cursor feed (Electron screen
   * coords) rather than DOM pointer events, so window-leave must not clear it.
   */
  private externalPointer = false
  private ndcX = 0
  private ndcY = 0
  private explicit: Xyz | null = null
  private explicitIsCamera = false
  private explicitTurn = true
  private cameraLocked = false
  private bodyYaw = 0
  /** Base yaw from locomotion (walk / turn / teleport). Gaze body yaw is relative. */
  private locoYaw = 0
  private spineYaw = 0
  private spinePitch = 0
  private idleElapsed = 0
  private nextIdleAfter = 0.8 + Math.random() * 1.5
  private readonly idleOffset = new Vector3()
  private holdLeftMs = 0
  /** World yaw of the face with the rig at 0 (captures VRM0/1 + scene.y = π). */
  private restForwardYaw = 0
  private restReady = false
  /** Last look offsets applied to normalized bones (identity = none). */
  private readonly prevChestLook = new Quaternion()
  private readonly prevNeckLook = new Quaternion()
  private readonly prevHeadLook = new Quaternion()
  private spineApplied = false
  /**
   * Maps +Z → model faceFront (identity for VRM1). Conjugate spine look deltas
   * so VRM0 (−Z face) pitch matches three-vrm eye look.
   */
  private readonly faceFrontSpace = new Quaternion()
  private readonly lookDelta = new Quaternion()
  private readonly lookDeltaScratch = new Quaternion()
  private readonly lookDeltaScratchInv = new Quaternion()
  /** Last pointer motion (performance.now). */
  private lastPointerMotionAt = 0
  private readonly eyeAim = new Vector3()
  private eyeAimReady = false
  private eyeReturning = false
  private headYawMax = GAZE_SPINE_YAW_MAX
  private headPitchMax = GAZE_SPINE_PITCH_MAX
  private eyeYawMax = GAZE_EYE_YAW_MAX
  private eyePitchMax = GAZE_EYE_PITCH_MAX

  /** World facing from locomotion (0 = face camera / +Z). */
  setLocomotionYaw(yaw: number): void {
    this.locoYaw = Number.isFinite(yaw) ? yaw : 0
  }

  /** Instant hip yaw for teleports / spawn (no lerp across the avatar's back). */
  snapBodyToLocomotion(): number {
    this.bodyYaw = locoRigYaw(this.locoYaw, this.restForwardYaw)
    return this.bodyYaw
  }

  getLocomotionYaw(): number {
    return this.locoYaw
  }

  /** Runtime head / eye cones (degrees). Eyes should exceed head for visible iris offset. */
  setLimits(raw: Partial<GazeLimits>): GazeLimits {
    const lim = clampGazeLimits({
      headYawMaxDeg: MathUtils.radToDeg(this.headYawMax),
      headPitchMaxDeg: MathUtils.radToDeg(this.headPitchMax),
      eyeYawMaxDeg: MathUtils.radToDeg(this.eyeYawMax),
      eyePitchMaxDeg: MathUtils.radToDeg(this.eyePitchMax),
      ...raw,
    })
    // Eyes usually sit a little past the head so the iris can glance sideways.
    // Do not override an explicit eye yaw (0 is a valid locked-eyes setting).
    if (raw.eyeYawMaxDeg === undefined && lim.eyeYawMaxDeg < lim.headYawMaxDeg + 8) {
      lim.eyeYawMaxDeg = Math.min(90, lim.headYawMaxDeg + 8)
    }
    if (lim.eyePitchMaxDeg < lim.headPitchMaxDeg + 4) {
      lim.eyePitchMaxDeg = Math.min(45, lim.headPitchMaxDeg + 4)
    }
    this.headYawMax = MathUtils.degToRad(lim.headYawMaxDeg)
    this.headPitchMax = MathUtils.degToRad(lim.headPitchMaxDeg)
    this.eyeYawMax = MathUtils.degToRad(lim.eyeYawMaxDeg)
    this.eyePitchMax = MathUtils.degToRad(lim.eyePitchMaxDeg)
    return lim
  }

  getLimits(): GazeLimits {
    return {
      headYawMaxDeg: Math.round(MathUtils.radToDeg(this.headYawMax)),
      headPitchMaxDeg: Math.round(MathUtils.radToDeg(this.headPitchMax)),
      eyeYawMaxDeg: Math.round(MathUtils.radToDeg(this.eyeYawMax)),
      eyePitchMaxDeg: Math.round(MathUtils.radToDeg(this.eyePitchMax)),
    }
  }

  setPointerEnabled(on: boolean): void {
    this.pointerEnabled = on
    if (!on) this.pointerOver = false
  }

  /**
   * Drive gaze from an external (OS-global) cursor feed instead of DOM pointer
   * events. While enabled, DOM `mouseleave` / `blur` clears are ignored and the
   * eyes keep holding the last external target, so the avatar follows the cursor
   * even when it is outside the window. The host pushes coordinates via
   * {@link setPointerNdc}.
   */
  setExternalPointerEnabled(on: boolean): void {
    this.externalPointer = on
    if (!on) this.pointerOver = false
  }

  setBodyFollowCamera(on: boolean): void {
    this.bodyFollowCamera = on
    if (!on) {
      // Keep current hips; otherwise idle would lerp back to spawn facing.
      this.locoYaw = wrapPi(this.bodyYaw + this.restForwardYaw)
    }
  }

  setPointerNdc(ndcX: number, ndcY: number): void {
    this.pointerOver = true
    this.ndcX = clamp(ndcX, -1, 1)
    this.ndcY = clamp(ndcY, -1, 1)
    this.lastPointerMotionAt = performance.now()
    this.eyeReturning = false
  }

  clearPointer(): void {
    // An external (OS-global) feed owns the pointer: a DOM `mouseleave` / `blur`
    // is not evidence the cursor left the avatar's attention, so ignore it.
    if (this.externalPointer) return
    this.pointerOver = false
  }

  isPointerTracking(): boolean {
    return this.pointerEnabled && this.pointerOver && !this.cameraLocked && !this.hasExplicit()
  }

  /** Eyes are driven by pointer aim / smooth return — skip idle saccades. */
  drivesEyes(): boolean {
    if (!this.pointerEnabled) return false
    if (this.cameraLocked || this.explicit) return false
    if (this.isPointerEyeTracking()) return true
    // Hovering but past idle timeout (returning), or mid-return lerp.
    if (this.pointerOver && this.lastPointerMotionAt > 0) return true
    return this.eyeReturning
  }

  isPointerEyeTracking(): boolean {
    if (!this.pointerEnabled || !this.pointerOver || this.cameraLocked || this.explicit) {
      return false
    }
    return performance.now() - this.lastPointerMotionAt < GAZE_EYE_IDLE_MS
  }

  lookAt(target: LookAtTarget, opts: GazeLookOptions = {}): void {
    this.holdLeftMs = 0
    if (target === 'camera') {
      this.explicit = null
      const sticky = opts.lock === true || (opts.holdMs !== undefined && opts.holdMs > 0)
      this.explicitIsCamera = sticky
      this.explicitTurn = opts.turn === true
      if (opts.holdMs && opts.holdMs > 0) this.holdLeftMs = opts.holdMs
      return
    }
    if (target === null) {
      this.explicit = null
      this.explicitIsCamera = false
      this.explicitTurn = true
      return
    }
    this.explicitIsCamera = false
    this.explicit = { x: target.x, y: target.y, z: target.z }
    this.explicitTurn = opts.turn !== false
    if (opts.holdMs && opts.holdMs > 0) this.holdLeftMs = opts.holdMs
  }

  /** Speech: watch the user; pointer and idle wait. Explicit world looks still win. */
  setCameraLock(on: boolean): void {
    this.cameraLocked = on
  }

  /** After a one-shot gesture, glance somewhere new then return. */
  notifyGestureEnd(): void {
    if (this.hasExplicit() || this.cameraLocked || this.isPointerTracking()) return
    this.pickIdleOffset(true)
    this.idleElapsed = 0
    this.nextIdleAfter = 1.2 + Math.random() * 2
  }

  resetRig(): void {
    this.bodyYaw = 0
    this.locoYaw = 0
    this.spineYaw = 0
    this.spinePitch = 0
    this.idleOffset.set(0, 0, 0)
    this.idleElapsed = 0
    this.nextIdleAfter = 0.6 + Math.random()
    this.restReady = false
    this.restForwardYaw = 0
    this.prevChestLook.identity()
    this.prevNeckLook.identity()
    this.prevHeadLook.identity()
    this.spineApplied = false
    this.faceFrontSpace.identity()
    this.eyeAimReady = false
    this.eyeReturning = false
    this.lastPointerMotionAt = 0
  }

  /**
   * Sample face-forward after the VRM is parented (rig yaw 0). VRM0 models are
   * rotated 180° (`VRMUtils.rotateVRM0`); VRM1 already faces +Z.
   * Parent yaw must be zero while sampling — spawn `placeAt` often runs first
   * and would otherwise bake slot heading into restForwardYaw, locking every
   * avatar to the same visual facing (usually backs to camera).
   */
  bind(vrm: VRM | null): void {
    this.restReady = false
    this.restForwardYaw = 0
    this.faceFrontSpace.identity()
    if (!vrm) return
    const parent = vrm.scene.parent
    const savedParentQuat = parent?.quaternion.clone()
    if (parent) {
      parent.quaternion.identity()
      parent.updateMatrixWorld(true)
    }
    try {
      vrm.scene.updateMatrixWorld(true)
      // VRM0: lookAt.faceFront is −Z; VRM1: +Z. Falls back to metaVersion.
      const ff = vrm.lookAt?.faceFront
      if (ff) {
        faceFrontLookSpace(ff, this.faceFrontSpace)
      } else if ((vrm.meta as { metaVersion?: string } | undefined)?.metaVersion === '0') {
        faceFrontLookSpace({ x: 0, y: 0, z: -1 }, this.faceFrontSpace)
      }
      const dir = new Vector3()
      if (vrm.lookAt) {
        vrm.lookAt.getLookAtWorldDirection(dir)
      } else {
        vrm.scene.getWorldDirection(dir)
      }
      dir.y = 0
      if (dir.lengthSq() < 1e-6) {
        this.restForwardYaw = wrapPi(vrm.scene.rotation.y)
      } else {
        dir.normalize()
        this.restForwardYaw = Math.atan2(dir.x, dir.z)
      }
      this.restReady = true
      // Face world +Z (default camera) immediately so we don't lerp across the back.
      this.bodyYaw = wrapPi(-this.restForwardYaw)
    } finally {
      if (parent && savedParentQuat) {
        parent.quaternion.copy(savedParentQuat)
        parent.updateMatrixWorld(true)
      }
    }
  }

  /** 0–1 multiplier for idle eye saccades on top of the current look point. */
  saccadeAmplitude(): number {
    if (this.drivesEyes()) return 0
    if (this.cameraLocked) return 0
    if (this.hasExplicit()) return 0.12
    return 1
  }

  private hasExplicit(): boolean {
    return this.explicitIsCamera || this.explicit !== null
  }

  private pickIdleOffset(wide: boolean): void {
    const span = wide ? 0.85 : 0.38
    this.idleOffset.set((Math.random() - 0.5) * span, (Math.random() - 0.45) * 0.28, 0)
  }

  /**
   * Call before `mixer.update`. Strips last frame's look offsets so the mixer
   * writes onto the clean animation pose (or rest). Required because many idle
   * clips omit head/neck tracks — without undo those bones would accumulate.
   */
  preMixer(vrm: VRM | null): void {
    if (!this.spineApplied || !vrm?.humanoid) return
    const head = vrm.humanoid.getNormalizedBoneNode('head')
    const neck = vrm.humanoid.getNormalizedBoneNode('neck')
    const chest =
      vrm.humanoid.getNormalizedBoneNode('upperChest') ??
      vrm.humanoid.getNormalizedBoneNode('chest')
    this.undoBoneLook(chest, this.prevChestLook)
    this.undoBoneLook(neck, this.prevNeckLook)
    this.undoBoneLook(head, this.prevHeadLook)
    this.spineApplied = false
  }

  update(ctx: GazeUpdateContext): void {
    const dt = ctx.delta
    if (this.holdLeftMs > 0) {
      this.holdLeftMs -= dt * 1000
      if (this.holdLeftMs <= 0) {
        this.holdLeftMs = 0
        this.explicit = null
        this.explicitIsCamera = false
      }
    }

    if (!this.restReady && ctx.vrm) this.bind(ctx.vrm)

    this.headWorld(ctx.vrm, _headPos)
    const cam = ctx.camera.position
    let bodyMax = GAZE_BODY_POINTER_MAX
    const pointerActive =
      this.pointerEnabled && this.pointerOver && !this.cameraLocked && !this.explicit

    if (this.explicit) {
      _look.set(this.explicit.x, this.explicit.y, this.explicit.z)
      bodyMax = this.explicitTurn ? GAZE_BODY_EXPLICIT_MAX : 0
    } else if (pointerActive) {
      // Pointer wins over soft camera look: hips stay toward viewer; head uses its cone.
      pointerLookPoint(this.ndcX, this.ndcY, cam, _headPos, _look, {
        yawMax: this.headYawMax,
        pitchMax: this.headPitchMax,
      })
      bodyMax = ctx.performanceBusy ? 0 : GAZE_BODY_POINTER_MAX
    } else if (this.explicitIsCamera || this.cameraLocked) {
      _look.copy(cam)
      bodyMax = 0
    } else {
      this.idleElapsed += dt
      if (this.idleElapsed >= this.nextIdleAfter || this.nextIdleAfter < 0) {
        this.pickIdleOffset(false)
        this.idleElapsed = 0
        this.nextIdleAfter = 0.7 + Math.random() * 2.8
      }
      _look.copy(cam)
      _idle.copy(this.idleOffset)
      const fx = cam.x - _headPos.x
      const fz = cam.z - _headPos.z
      const fl = Math.hypot(fx, fz) || 1
      const rx = -fz / fl
      const rz = fx / fl
      _look.x += rx * _idle.x
      _look.y += _idle.y
      _look.z += rz * _idle.x
      // Body-follow-camera off: head may still glance at the camera; hips stay put.
      bodyMax = this.bodyFollowCamera ? MathUtils.degToRad(20) : 0
    }

    const cameraFacingYaw = wrapPi(yawTowardXZ(_headPos, cam) - this.restForwardYaw)
    const faceYaw = wrapPi(yawTowardXZ(_headPos, _look) - this.restForwardYaw)
    const fromCamera = wrapPi(faceYaw - cameraFacingYaw)
    let bodyFromCamera = 0
    if (ctx.locomoting) {
      bodyMax = 0
      bodyFromCamera = 0
    } else if (pointerActive) {
      // Only a tiny hip assist — head owns the pointer cone.
      bodyFromCamera = clamp(fromCamera * 0.15, -bodyMax, bodyMax)
    } else if (Math.abs(fromCamera) > GAZE_HEAD_COVER) {
      bodyFromCamera = fromCamera - Math.sign(fromCamera) * GAZE_HEAD_COVER
      bodyFromCamera = clamp(bodyFromCamera, -bodyMax, bodyMax)
    }
    const followViewer =
      this.bodyFollowCamera ||
      this.cameraLocked ||
      this.explicitIsCamera ||
      Boolean(this.explicit && this.explicitTurn)
    // Locomotion facing is world travel yaw (0 = +Z). Convert to rig yaw the
    // same way idle does: subtract restForwardYaw (VRM often loaded at π).
    const desiredYaw = desiredIdleBodyYaw({
      locomoting: Boolean(ctx.locomoting),
      followViewer,
      locoYaw: this.locoYaw,
      restForwardYaw: this.restForwardYaw,
      cameraFacingYaw,
      bodyFromCamera,
    })

    const yawLambda = ctx.locomoting
      ? 14
      : pointerActive
        ? 8
        : 4.2
    this.bodyYaw = expSmoothAngle(this.bodyYaw, desiredYaw, yawLambda, dt)
    ctx.rig.rotation.y = this.bodyYaw
    ctx.rig.updateMatrixWorld(true)

    ctx.lookTarget.position.copy(_look)
    this.applySpineLook(ctx.vrm, _look, dt)
    this.updateEyeAim(ctx)
  }

  /**
   * Eyes track the cursor on a plane in front of the face (independent of head
   * bone aim). After {@link GAZE_EYE_IDLE_MS} with no motion, ease eyes back to
   * the camera — head aim is left unchanged until the pointer leaves.
   */
  private updateEyeAim(ctx: GazeUpdateContext): void {
    this.headWorld(ctx.vrm, _headPos)
    const tracking = this.isPointerEyeTracking()

    if (tracking) {
      this.projectPointerEyePoint(ctx.camera, _headPos, _eyeWant)
      this.eyeReturning = false
    } else if (this.explicit) {
      _eyeWant.set(this.explicit.x, this.explicit.y, this.explicit.z)
      this.eyeReturning = false
    } else if (
      this.pointerEnabled &&
      this.pointerOver &&
      !this.cameraLocked &&
      !this.explicit &&
      this.lastPointerMotionAt > 0
    ) {
      // Still hovering, but idle past the timeout — return eyes to the user.
      _eyeWant.copy(ctx.camera.position)
      this.eyeReturning = true
    } else {
      _eyeWant.copy(ctx.camera.position)
      this.eyeReturning = false
    }

    if (!this.eyeAimReady) {
      this.eyeAim.copy(_eyeWant)
      this.eyeAimReady = true
    } else {
      const lambda = tracking ? 22 : 5
      const t = 1 - Math.exp(-lambda * Math.max(0, ctx.delta))
      this.eyeAim.lerp(_eyeWant, t)
    }

    ctx.eyeTarget.position.copy(this.eyeAim)
    ctx.eyeTarget.updateMatrixWorld(true)

    if (this.eyeReturning && this.eyeAim.distanceToSquared(ctx.camera.position) < 0.04) {
      this.eyeReturning = this.pointerOver && this.pointerEnabled
    }

    if (ctx.vrm?.lookAt && this.drivesEyes()) {
      ctx.vrm.lookAt.target = ctx.eyeTarget
    }
  }

  /** World point under the cursor at the character's depth (screen → eyes). */
  private projectPointerEyePoint(
    camera: PerspectiveCamera,
    head: Vector3,
    out: Vector3,
  ): void {
    // Prefer the same cone math as the head, but with a wider eye limit so irises
    // can look past where the neck stopped.
    pointerLookPoint(this.ndcX, this.ndcY, camera.position, head, out, {
      yawMax: this.eyeYawMax,
      pitchMax: this.eyePitchMax,
    })
  }

  /**
   * Residual after body yaw — neck/head catch the rest, clamped to configured
   * head limits. Assumes {@link preMixer} already cleared last frame's offsets.
   */
  private applySpineLook(vrm: VRM | null, worldTarget: Vector3, dt: number): void {
    if (!vrm?.humanoid) return
    const head = vrm.humanoid.getNormalizedBoneNode('head')
    const neck = vrm.humanoid.getNormalizedBoneNode('neck')
    const chest =
      vrm.humanoid.getNormalizedBoneNode('upperChest') ??
      vrm.humanoid.getNormalizedBoneNode('chest')
    if (!head) return

    head.getWorldPosition(_headPos)
    // World facing of the hips after body yaw, then residual to the look point.
    const hipsFacing = wrapPi(this.bodyYaw + this.restForwardYaw)
    const remain = wrapPi(yawTowardXZ(_headPos, worldTarget) - hipsFacing)
    const dy = worldTarget.y - _headPos.y
    const dist = Math.hypot(worldTarget.x - _headPos.x, worldTarget.z - _headPos.z) || 1
    const pitch = clamp(-Math.atan2(dy, dist), -this.headPitchMax, this.headPitchMax)
    this.spineYaw = expSmoothAngle(
      this.spineYaw,
      clamp(remain, -this.headYawMax, this.headYawMax),
      12,
      dt,
    )
    this.spinePitch = expSmooth(this.spinePitch, pitch, 12, dt)

    const yChest = this.headYawMax * 0.15
    const yNeck = this.headYawMax * 0.35
    const yHead = this.headYawMax * 0.5
    const pChest = this.headPitchMax * 0.15
    const pNeck = this.headPitchMax * 0.35
    const pHead = this.headPitchMax * 0.5

    this.applyBoneLook(
      chest,
      clamp(this.spineYaw * 0.15, -yChest, yChest),
      clamp(this.spinePitch * 0.15, -pChest, pChest),
      this.prevChestLook,
    )
    this.applyBoneLook(
      neck,
      clamp(this.spineYaw * 0.35, -yNeck, yNeck),
      clamp(this.spinePitch * 0.35, -pNeck, pNeck),
      this.prevNeckLook,
    )
    this.applyBoneLook(
      head,
      clamp(this.spineYaw * 0.5, -yHead, yHead),
      clamp(this.spinePitch * 0.5, -pHead, pHead),
      this.prevHeadLook,
    )
    this.spineApplied = true
  }

  private undoBoneLook(bone: Object3D | null, prev: Quaternion): void {
    if (!bone) return
    if (prev.x === 0 && prev.y === 0 && prev.z === 0 && prev.w === 1) return
    bone.quaternion.multiply(_inv.copy(prev).invert())
  }

  private applyBoneLook(
    bone: Object3D | null,
    yaw: number,
    pitch: number,
    prev: Quaternion,
  ): void {
    if (!bone) {
      prev.identity()
      return
    }
    spineLookDeltaQuat(
      yaw,
      pitch,
      this.faceFrontSpace,
      this.lookDelta,
      this.lookDeltaScratch,
      this.lookDeltaScratchInv,
    )
    bone.quaternion.multiply(this.lookDelta)
    prev.copy(this.lookDelta)
  }

  private headWorld(vrm: VRM | null, out: Vector3): Vector3 {
    const head = vrm?.humanoid?.getNormalizedBoneNode('head')
    if (head) {
      head.getWorldPosition(out)
      return out
    }
    return out.set(0, 1.4, 0)
  }
}
