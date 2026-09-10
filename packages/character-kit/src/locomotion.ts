/** Pure kinematic locomotion — no Three/VRM. Stick analog + LLM seek. */

export const LOCO_WALK_SPEED = 1.4
export const LOCO_RUN_SPEED = 2.4
export const LOCO_SPEED_MIN = 0.3
export const LOCO_SPEED_MAX = 3.5
export const LOCO_MAX_RELATIVE_M = 8
export const LOCO_ARRIVE_EPS = 0.08
export const LOCO_MOVE_EPS = 0.04
export const LOCO_TURN_RATE = 1.8
export const LOCO_JUMP_IMPULSE = 3.2
export const LOCO_GRAVITY = -18
export const LOCO_YAW_SMOOTH = 8

/** Seek auto-upgrades to run when a normal walk would take longer than this. */
export const LOCO_AUTO_RUN_SEC = 4

export const LOCO_GAIT_IDS = [
  'crawl',
  'crouch',
  'careful',
  'walk',
  'run',
  'roll',
] as const

export type LocoGaitId = (typeof LOCO_GAIT_IDS)[number]

/** Nominal m/s for each gait (also used when gait is set without speed). */
export const LOCO_GAIT_SPEED: Record<LocoGaitId, number> = {
  crawl: 0.45,
  crouch: 0.7,
  careful: 0.9,
  walk: LOCO_WALK_SPEED,
  run: LOCO_RUN_SPEED,
  roll: 1.9,
}

/** Default gesture / procedural clip id per gait. */
export const LOCO_GAIT_DEFAULT_CLIP: Record<LocoGaitId, string> = {
  crawl: 'walk_crawl',
  crouch: 'walk_crouch',
  careful: 'walk_careful',
  walk: 'walk',
  run: 'run',
  roll: 'walk_roll',
}

export type LocomotionClipOverrides = Partial<Record<LocoGaitId, string>>

export function isLocoGaitId(raw: unknown): raw is LocoGaitId {
  return typeof raw === 'string' && (LOCO_GAIT_IDS as readonly string[]).includes(raw)
}

export function parseGaitArg(raw: unknown): LocoGaitId | undefined {
  if (raw === undefined || raw === null) return undefined
  const s = String(raw).trim().toLowerCase()
  if (s === 'sneak') return 'careful'
  if (s === 'crouching') return 'crouch'
  if (s === 'crawling') return 'crawl'
  if (isLocoGaitId(s)) return s
  return undefined
}

/** Pick gait from kinematic speed when the caller did not name one. */
export function gaitFromSpeed(speed: number): LocoGaitId {
  const s = Number.isFinite(speed) ? speed : LOCO_GAIT_SPEED.walk
  if (s < 0.55) return 'crawl'
  if (s < 0.85) return 'crouch'
  if (s < 1.15) return 'careful'
  if (s < 1.95) return 'walk'
  return 'run'
}

export function speedForGait(gait: LocoGaitId): number {
  return LOCO_GAIT_SPEED[gait]
}

/**
 * Resolve which looping clip to play. Prefers model overrides, then default
 * id, then falls back through walk → run so locomotion never goes silent.
 */
export function resolveLocomotionClipId(
  gait: LocoGaitId,
  overrides: LocomotionClipOverrides | null | undefined,
  available: Iterable<string>,
): string {
  const have = available instanceof Set ? available : new Set(available)
  const candidates = [
    overrides?.[gait],
    LOCO_GAIT_DEFAULT_CLIP[gait],
    gait === 'run' ? 'walk' : undefined,
    'walk',
    'run',
  ].filter((id): id is string => Boolean(id))
  for (const id of candidates) {
    if (have.has(id)) return id
  }
  return LOCO_GAIT_DEFAULT_CLIP[gait]
}

/**
 * If a normal walk (1.4 m/s) would take longer than {@link LOCO_AUTO_RUN_SEC},
 * upgrade to run — unless the caller locked a non-walk locomotion gait.
 */
export function applyAutoRun(
  distanceM: number,
  speed: number,
  gait: LocoGaitId,
  opts: { gaitExplicit: boolean; maxWalkSec?: number } = { gaitExplicit: false },
): { speed: number; gait: LocoGaitId; autoRan: boolean } {
  const dist = Math.max(0, distanceM)
  const walkSpeed = LOCO_GAIT_SPEED.walk
  const runSpeed = LOCO_GAIT_SPEED.run
  if (opts.gaitExplicit && gait !== 'walk' && gait !== 'run') {
    return { speed, gait, autoRan: false }
  }
  if (gait === 'crawl' || gait === 'crouch' || gait === 'careful' || gait === 'roll') {
    return { speed, gait, autoRan: false }
  }
  if (gait === 'run' || speed >= runSpeed - 1e-6) {
    return { speed: Math.max(speed, runSpeed), gait: 'run', autoRan: false }
  }
  const maxWalkSec = opts.maxWalkSec ?? LOCO_AUTO_RUN_SEC
  const walkSec = dist / walkSpeed
  if (walkSec <= maxWalkSec) {
    return { speed, gait, autoRan: false }
  }
  return {
    speed: Math.max(speed, runSpeed),
    gait: 'run',
    autoRan: true,
  }
}

/** Parse optional manifest.locomotion map (gait → clip id). */
export function parseLocomotionOverrides(raw: unknown): LocomotionClipOverrides {
  if (!raw || typeof raw !== 'object') return {}
  const out: LocomotionClipOverrides = {}
  for (const gait of LOCO_GAIT_IDS) {
    const v = (raw as Record<string, unknown>)[gait]
    if (typeof v === 'string' && v.trim()) out[gait] = v.trim()
  }
  return out
}

/** Clip timeScale so animation rate tracks kinematic speed vs gait nominal. */
export function gaitAnimTimeScale(speed: number, gait: LocoGaitId): number {
  const nom = speedForGait(gait)
  if (nom < 1e-6) return 1
  return Math.min(1.5, Math.max(0.65, speed / nom))
}

export type LocoFaceMode = 'camera' | 'movement' | 'keep' | number

export interface MoveInput {
  /** Analog strafe: −1 left … +1 right (camera-relative when used with stick). */
  x: number
  /** Analog forward: −1 back … +1 forward. */
  z: number
  /** Continuous yaw: −1 left … +1 right. */
  yaw: number
  /** Rising-edge jump pulse. */
  jump: boolean
}

export interface SeekTarget {
  x: number
  z: number
  speed: number
  face: LocoFaceMode
  /** World point to face after arrive (object center). Overrides `face` when set. */
  faceAt?: { x: number; z: number }
}

export interface LocomotionSnapshot {
  x: number
  y: number
  z: number
  facing: number
  vy: number
  grounded: boolean
  moving: boolean
  seeking: boolean
}

export interface LocomotionTickResult {
  arrived: boolean
  startedMoving: boolean
  stoppedMoving: boolean
  jumped: boolean
  cancelledSeek: boolean
}

const ZERO_INPUT: MoveInput = { x: 0, z: 0, yaw: 0, jump: false }

export function clampSpeed(speed: number | undefined, gait?: LocoGaitId | 'walk' | 'run'): number {
  let v = speed
  if (v === undefined || !Number.isFinite(v)) {
    const g = parseGaitArg(gait) ?? (gait === 'run' ? 'run' : gait === 'walk' ? 'walk' : undefined)
    v = g ? speedForGait(g) : LOCO_WALK_SPEED
  }
  return Math.min(LOCO_SPEED_MAX, Math.max(LOCO_SPEED_MIN, v))
}

export function clampMoveInput(raw: Partial<MoveInput>): MoveInput {
  let x = Number.isFinite(raw.x) ? Number(raw.x) : 0
  let z = Number.isFinite(raw.z) ? Number(raw.z) : 0
  const len = Math.hypot(x, z)
  if (len > 1) {
    x /= len
    z /= len
  }
  const yaw = Math.max(-1, Math.min(1, Number.isFinite(raw.yaw) ? Number(raw.yaw) : 0))
  return { x, z, yaw, jump: Boolean(raw.jump) }
}

export function relativeOffset(
  facing: number,
  forward: number,
  right: number,
): { x: number; z: number } {
  // facing 0 = world +Z (toward default camera). +right = +X when facing 0.
  const fx = Math.sin(facing)
  const fz = Math.cos(facing)
  const rx = Math.cos(facing)
  const rz = -Math.sin(facing)
  return {
    x: fx * forward + rx * right,
    z: fz * forward + rz * right,
  }
}

export function capRelativeMeters(forward: number, right: number): { forward: number; right: number } {
  const len = Math.hypot(forward, right)
  if (len <= LOCO_MAX_RELATIVE_M || len < 1e-9) return { forward, right }
  const s = LOCO_MAX_RELATIVE_M / len
  return { forward: forward * s, right: right * s }
}

function shortestAngleDelta(from: number, to: number): number {
  let d = to - from
  while (d > Math.PI) d -= Math.PI * 2
  while (d < -Math.PI) d += Math.PI * 2
  return d
}

function faceToward(fromX: number, fromZ: number, toX: number, toZ: number): number {
  return Math.atan2(toX - fromX, toZ - fromZ)
}

export function resolveFaceRad(
  face: LocoFaceMode,
  current: number,
  moveDir: number | null,
): number {
  if (face === 'keep') return current
  if (face === 'camera') return 0
  if (face === 'movement') return moveDir ?? current
  if (typeof face === 'number' && Number.isFinite(face)) {
    return (face * Math.PI) / 180
  }
  return 0
}

export function parseFaceArg(raw: unknown): LocoFaceMode {
  // Default `keep` so turn→walk→turn squares accumulate yaw. Use face:"camera"
  // only when the caller wants to face the user after arriving.
  if (raw === undefined || raw === null || raw === '') return 'keep'
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  const s = String(raw).trim().toLowerCase()
  if (s === 'camera' || s === 'movement' || s === 'keep') return s
  const n = Number(s)
  if (Number.isFinite(n)) return n
  return 'keep'
}

export interface ParsedWalkArgs {
  kind: 'relative' | 'to' | 'object'
  forward?: number
  right?: number
  to?: { x: number; z: number }
  objectId?: string
  side?: 'front' | 'back' | 'left' | 'right'
  distance?: number
  orbitDeg?: number
  face: LocoFaceMode
  speed: number
  /** Resolved gait (from arg or inferred from speed). */
  gait: LocoGaitId
  /** True when the caller named `gait` explicitly. */
  gaitExplicit: boolean
  /** True when the caller named `speed` explicitly. */
  speedExplicit: boolean
}

export function parseWalkArgs(
  args: Record<string, unknown>,
): { ok: true; value: ParsedWalkArgs } | { ok: false; message: string } {
  const gaitExplicit = args.gait !== undefined && args.gait !== null && String(args.gait).trim() !== ''
  const speedExplicit =
    args.speed !== undefined && args.speed !== null && Number.isFinite(Number(args.speed))
  const gaitParsed = parseGaitArg(args.gait)
  const speed = clampSpeed(speedExplicit ? Number(args.speed) : undefined, gaitParsed)
  const resolvedGait: LocoGaitId = gaitParsed ?? (speedExplicit ? gaitFromSpeed(speed) : 'walk')
  const face = parseFaceArg(args.face)
  const objectId =
    args.objectId !== undefined && args.objectId !== null
      ? String(args.objectId).trim()
      : args.landmarkId !== undefined && args.landmarkId !== null
        ? String(args.landmarkId).trim()
        : ''

  const base = {
    face,
    speed,
    gait: resolvedGait,
    gaitExplicit,
    speedExplicit,
  }

  if (objectId) {
    const sideRaw = String(args.side ?? 'front').toLowerCase()
    const side =
      sideRaw === 'back' || sideRaw === 'left' || sideRaw === 'right' || sideRaw === 'front'
        ? sideRaw
        : 'front'
    const distance =
      args.distance !== undefined && Number.isFinite(Number(args.distance))
        ? Math.min(6, Math.max(0, Number(args.distance)))
        : 1
    const value: ParsedWalkArgs = {
      kind: 'object',
      objectId,
      side,
      distance,
      ...base,
    }
    if (args.orbitDeg !== undefined && Number.isFinite(Number(args.orbitDeg))) {
      value.orbitDeg = Number(args.orbitDeg)
    }
    return { ok: true, value }
  }

  const toRaw = args.to
  if (toRaw && typeof toRaw === 'object') {
    const rec = toRaw as { x?: unknown; z?: unknown }
    const x = Number(rec.x)
    const z = Number(rec.z)
    if (Number.isFinite(x) && Number.isFinite(z)) {
      return { ok: true, value: { kind: 'to', to: { x, z }, ...base } }
    }
  }

  if (
    (args.x !== undefined || args.z !== undefined) &&
    args.forward === undefined &&
    args.right === undefined
  ) {
    const x = Number(args.x ?? 0)
    const z = Number(args.z ?? 0)
    if (Number.isFinite(x) && Number.isFinite(z)) {
      return { ok: true, value: { kind: 'to', to: { x, z }, ...base } }
    }
  }

  const hasForward = args.forward !== undefined && args.forward !== null
  const hasRight = args.right !== undefined && args.right !== null
  if (hasForward || hasRight) {
    let forward = hasForward ? Number(args.forward) : 0
    let right = hasRight ? Number(args.right) : 0
    if (!Number.isFinite(forward)) forward = 0
    if (!Number.isFinite(right)) right = 0
    if (Math.abs(forward) < 1e-9 && Math.abs(right) < 1e-9) {
      return { ok: false, message: 'forward/right are both zero' }
    }
    const capped = capRelativeMeters(forward, right)
    return {
      ok: true,
      value: {
        kind: 'relative',
        forward: capped.forward,
        right: capped.right,
        ...base,
      },
    }
  }

  return {
    ok: false,
    message: 'character_walk requires forward/right, to:{x,z}, or objectId',
  }
}

export function relativeToWorld(
  facing: number,
  forward: number,
  right: number,
  originX: number,
  originZ: number,
): { x: number; z: number } {
  const off = relativeOffset(facing, forward, right)
  return { x: originX + off.x, z: originZ + off.z }
}

/**
 * Owns position / facing / jump. Analog input and seek share one integrator.
 * Stick analog with non-zero xz cancels an active seek.
 */
export class LocomotionState {
  x = 0
  y = 0
  z = 0
  facing = 0
  vy = 0
  grounded = true
  moving = false
  private seek: SeekTarget | null = null
  private input: MoveInput = { ...ZERO_INPUT }
  private analogSpeed = LOCO_WALK_SPEED
  private jumpConsumed = false

  get seeking(): boolean {
    return this.seek !== null
  }

  snapshot(): LocomotionSnapshot {
    return {
      x: this.x,
      y: this.y,
      z: this.z,
      facing: this.facing,
      vy: this.vy,
      grounded: this.grounded,
      moving: this.moving,
      seeking: this.seeking,
    }
  }

  setAnalogSpeed(speed: number): void {
    this.analogSpeed = clampSpeed(speed)
  }

  getAnalogSpeed(): number {
    return this.analogSpeed
  }

  /** Effective horizontal speed this frame (seek speed or stick * analog). */
  currentMoveSpeed(): number {
    if (this.seek) return this.seek.speed
    const len = Math.hypot(this.input.x, this.input.z)
    if (len < LOCO_MOVE_EPS) return 0
    return this.analogSpeed * Math.min(1, len)
  }

  setMoveInput(raw: Partial<MoveInput>): void {
    this.input = clampMoveInput(raw)
  }

  getMoveInput(): MoveInput {
    return { ...this.input }
  }

  /** Start seeking a world XZ point. Cancels prior seek. */
  beginSeek(target: SeekTarget): void {
    this.seek = {
      x: target.x,
      z: target.z,
      speed: clampSpeed(target.speed),
      face: target.face,
      faceAt: target.faceAt ? { ...target.faceAt } : undefined,
    }
    console.info('[character-kit] locomotion seek', {
      x: this.seek.x,
      z: this.seek.z,
      speed: this.seek.speed,
    })
  }

  cancelSeek(reason = 'cancel'): boolean {
    if (!this.seek) return false
    this.seek = null
    console.info('[character-kit] locomotion cancel', reason)
    return true
  }

  setPose(x: number, z: number, facing: number, y = 0): void {
    this.cancelSeek('teleport')
    this.x = x
    this.z = z
    this.y = Math.max(0, y)
    this.facing = facing
    this.vy = 0
    this.grounded = this.y <= 1e-4
    this.moving = false
    console.info('[character-kit] locomotion teleport', { x, z, facing, y: this.y })
  }

  /** Fire a jump if grounded. Returns whether the jump started. */
  tryJump(): boolean {
    if (!this.grounded || this.y > 1e-3) return false
    this.vy = LOCO_JUMP_IMPULSE
    this.grounded = false
    console.info('[character-kit] locomotion jump')
    return true
  }

  /**
   * Integrate one frame.
   * @param cameraYaw World yaw of camera forward on XZ (0 = +Z). Stick x/z rotate by this.
   */
  tick(dt: number, cameraYaw = 0): LocomotionTickResult {
    const safeDt = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.1) : 0
    const result: LocomotionTickResult = {
      arrived: false,
      startedMoving: false,
      stoppedMoving: false,
      jumped: false,
      cancelledSeek: false,
    }
    if (safeDt <= 0) return result

    const wasMoving = this.moving
    const analogLen = Math.hypot(this.input.x, this.input.z)
    const analogActive = analogLen > LOCO_MOVE_EPS

    if (analogActive && this.seek) {
      result.cancelledSeek = this.cancelSeek('stick')
    }

    // Jump pulse (edge: consume while held)
    if (this.input.jump) {
      if (!this.jumpConsumed && this.tryJump()) {
        result.jumped = true
      }
      this.jumpConsumed = true
    } else {
      this.jumpConsumed = false
    }

    let wishX = 0
    let wishZ = 0
    let speed = this.analogSpeed

    if (this.seek && !analogActive) {
      const dx = this.seek.x - this.x
      const dz = this.seek.z - this.z
      const dist = Math.hypot(dx, dz)
      if (dist <= LOCO_ARRIVE_EPS) {
        this.x = this.seek.x
        this.z = this.seek.z
        if (this.seek.faceAt) {
          this.facing = faceToward(this.x, this.z, this.seek.faceAt.x, this.seek.faceAt.z)
        } else {
          const moveDir = dist > 1e-6 ? Math.atan2(dx, dz) : null
          this.facing = resolveFaceRad(this.seek.face, this.facing, moveDir)
        }
        this.seek = null
        this.moving = false
        result.arrived = true
        console.info('[character-kit] locomotion arrived', { x: this.x, z: this.z })
      } else {
        wishX = dx / dist
        wishZ = dz / dist
        speed = this.seek.speed
      }
    } else if (analogActive) {
      // Camera-relative: forward = camera look on XZ; right = screen-right.
      // Negate x so stick/strafe right matches +screen-right when the camera
      // sits on +Z looking toward the origin (look yaw ≈ π).
      const cos = Math.cos(cameraYaw)
      const sin = Math.sin(cameraYaw)
      wishX = -this.input.x * cos + this.input.z * sin
      wishZ = this.input.x * sin + this.input.z * cos
      const wlen = Math.hypot(wishX, wishZ)
      if (wlen > 1e-6) {
        wishX /= wlen
        wishZ /= wlen
      }
      speed = this.analogSpeed * Math.min(1, analogLen)
    }

    const hasWish = Math.hypot(wishX, wishZ) > LOCO_MOVE_EPS
    if (hasWish) {
      // World travel facing: 0 = +Z (toward default camera). Gaze subtracts
      // restForwardYaw when applying to the rig (VRM may be loaded at π).
      const targetFacing = Math.atan2(wishX, wishZ)
      const d = shortestAngleDelta(this.facing, targetFacing)
      const maxStep = LOCO_YAW_SMOOTH * safeDt
      this.facing += Math.max(-maxStep, Math.min(maxStep, d))
      this.x += wishX * speed * safeDt
      this.z += wishZ * speed * safeDt
      this.moving = true
    } else {
      this.moving = false
    }

    // Q/E continuous yaw
    if (Math.abs(this.input.yaw) > 0.01) {
      this.facing += this.input.yaw * LOCO_TURN_RATE * safeDt
    }

    // Gravity / jump
    if (!this.grounded || this.vy !== 0 || this.y > 0) {
      this.vy += LOCO_GRAVITY * safeDt
      this.y += this.vy * safeDt
      if (this.y <= 0) {
        this.y = 0
        this.vy = 0
        this.grounded = true
      } else {
        this.grounded = false
      }
    }

    if (!wasMoving && this.moving) {
      result.startedMoving = true
      console.info('[character-kit] locomotion start')
    }
    if (wasMoving && !this.moving) {
      result.stoppedMoving = true
      console.info('[character-kit] locomotion stop')
    }

    return result
  }
}
