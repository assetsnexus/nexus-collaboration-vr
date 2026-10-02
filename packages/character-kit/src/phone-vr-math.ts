/**
 * Pure phone-VR math — eye offsets, barrel distortion, yaw recenter.
 * Unit-testable; no DOM / Three dependency. Self-contained (no sibling imports).
 */

export type EyeId = 'left' | 'right'

export type Vec3 = { x: number; y: number; z: number }

export type ViewerDistortion = {
  k1: number
  k2: number
}

const IPD_MIN_M = 0.05
const IPD_MAX_M = 0.075
const IPD_DEFAULT_M = 0.064

function clampIpdM(metres: number): number {
  if (!Number.isFinite(metres)) return IPD_DEFAULT_M
  return Math.min(IPD_MAX_M, Math.max(IPD_MIN_M, metres))
}

function clampDistortionScale(scale: number): number {
  if (!Number.isFinite(scale)) return 1
  return Math.min(1.5, Math.max(0, scale))
}

/**
 * Half-IPD offset along the camera local +X for the given eye (metres).
 * Left eye is −IPD/2, right is +IPD/2 (OpenXR / three.js StereoCamera convention).
 */
export function eyeOffsetLocalX(ipdM: number, eye: EyeId): number {
  const half = clampIpdM(ipdM) * 0.5
  return eye === 'left' ? -half : half
}

/** World-space camera position for one eye given a centre pose and right-axis unit vector. */
export function eyeWorldPosition(
  centre: Vec3,
  rightAxis: Vec3,
  ipdM: number,
  eye: EyeId,
): Vec3 {
  const ox = eyeOffsetLocalX(ipdM, eye)
  return {
    x: centre.x + rightAxis.x * ox,
    y: centre.y + rightAxis.y * ox,
    z: centre.z + rightAxis.z * ox,
  }
}

/**
 * Forward radial barrel: r' = r * (1 + k1*r² + k2*r⁴) * scale.
 * Used to build distortion shader uniforms (sample from distorted → source UV).
 */
export function barrelScale(
  r: number,
  distortion: ViewerDistortion,
  scale = 1,
): number {
  const rr = r * r
  const k1 = Number.isFinite(distortion.k1) ? distortion.k1 : 0
  const k2 = Number.isFinite(distortion.k2) ? distortion.k2 : 0
  const s = clampDistortionScale(scale)
  return (1 + k1 * rr + k2 * rr * rr) * s
}

/**
 * Inverse-ish sample offset for a unit-disk UV (centred at 0, radius in [0,1]).
 * Approximates the Cardboard inverse polynomial with a few Newton steps.
 */
export function undistortRadius(
  distortedR: number,
  distortion: ViewerDistortion,
  scale = 1,
  iterations = 4,
): number {
  if (distortedR <= 1e-8) return 0
  let r = distortedR
  for (let i = 0; i < iterations; i++) {
    const f = barrelScale(r, distortion, scale)
    if (f < 1e-8) break
    r = distortedR / f
  }
  return r
}

/** Remap a centred eye UV (u,v in [-1,1]) through inverse barrel for texture lookup. */
export function distortSampleUv(
  u: number,
  v: number,
  distortion: ViewerDistortion,
  scale = 1,
): { u: number; v: number } {
  const r = Math.hypot(u, v)
  if (r < 1e-8) return { u, v }
  const r0 = undistortRadius(r, distortion, scale)
  const t = r0 / r
  return { u: u * t, v: v * t }
}

export type YawRecenterState = {
  /** Radians subtracted from sensor yaw so "forward" matches scene look. */
  yawOffsetRad: number
}

/** Capture current sensor yaw as the new zero (reset view). */
export function recenterYaw(sensorYawRad: number): YawRecenterState {
  return { yawOffsetRad: sensorYawRad }
}

/** Apply recenter offset: displayYaw = sensorYaw − offset. */
export function applyYawRecenter(sensorYawRad: number, state: YawRecenterState): number {
  return sensorYawRad - state.yawOffsetRad
}

/**
 * Convert deviceorientation (deg) + screen orientation to a yaw/pitch/roll in radians
 * suitable for a Y-up three.js camera looking along −Z when phone is landscape.
 * Returns null when beta/gamma are missing (no gyro data yet).
 */
export function orientationEulerRad(opts: {
  alpha: number | null | undefined
  beta: number | null | undefined
  gamma: number | null | undefined
  screenAngleDeg?: number
}): { yaw: number; pitch: number; roll: number } | null {
  if (opts.beta == null || opts.gamma == null) return null
  const alpha = ((opts.alpha ?? 0) * Math.PI) / 180
  const beta = (opts.beta * Math.PI) / 180
  const gamma = (opts.gamma * Math.PI) / 180
  const orient = ((opts.screenAngleDeg ?? 0) * Math.PI) / 180

  const cA = Math.cos(alpha)
  const sA = Math.sin(alpha)
  const cB = Math.cos(beta)
  const sB = Math.sin(beta)
  const cG = Math.cos(gamma)
  const sG = Math.sin(gamma)

  const _x = -cA * sG - sA * sB * cG
  const _y = -sA * sG + cA * sB * cG
  const _z = -cB * cG

  const yaw = Math.atan2(-_x, -_z) - orient
  const pitch = Math.asin(Math.max(-1, Math.min(1, _y)))
  let roll = Math.atan2(cA * sB * sG - sA * cG, cB * cG)

  if (!Number.isFinite(yaw) || !Number.isFinite(pitch)) return null
  if (!Number.isFinite(roll)) roll = 0
  return { yaw, pitch, roll }
}

/** True when consecutive orientation samples have not moved beyond epsilon for stallMs. */
export function isOrientationStalled(opts: {
  lastChangeAtMs: number
  nowMs: number
  stallMs?: number
}): boolean {
  const stall = opts.stallMs ?? 2500
  return opts.nowMs - opts.lastChangeAtMs >= stall
}

export function orientationDeltaSignificant(
  a: { yaw: number; pitch: number; roll: number },
  b: { yaw: number; pitch: number; roll: number },
  epsRad = 0.002,
): boolean {
  return (
    Math.abs(a.yaw - b.yaw) > epsRad ||
    Math.abs(a.pitch - b.pitch) > epsRad ||
    Math.abs(a.roll - b.roll) > epsRad
  )
}
