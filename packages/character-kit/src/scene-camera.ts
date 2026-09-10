/** Camera placement helpers for SceneRoom (no Three.js — unit-testable). */

export const DEFAULT_FRAME_DISTANCE_M = 2.35
export const DEFAULT_FRAME_HEAD_Y = 1.45

export type FacingCameraPose = {
  camera: { x: number; y: number; z: number }
  target: { x: number; y: number; z: number }
}

/**
 * Put the camera in front of a character (along facing, +Z at facing 0)
 * looking at their head so they face the lens.
 */
export function cameraPoseFacingAvatar(opts: {
  x: number
  z: number
  facingRad: number
  headY?: number
  distance?: number
}): FacingCameraPose {
  const dist =
    Number.isFinite(opts.distance) && (opts.distance as number) > 0.4
      ? (opts.distance as number)
      : DEFAULT_FRAME_DISTANCE_M
  const headY =
    Number.isFinite(opts.headY) && (opts.headY as number) > 0.4
      ? (opts.headY as number)
      : DEFAULT_FRAME_HEAD_Y
  const yaw = Number.isFinite(opts.facingRad) ? opts.facingRad : 0
  return {
    target: { x: opts.x, y: headY, z: opts.z },
    camera: {
      x: opts.x + Math.sin(yaw) * dist,
      y: headY + 0.12,
      z: opts.z + Math.cos(yaw) * dist,
    },
  }
}

export function cameraYawTowardTarget(
  cameraX: number,
  cameraZ: number,
  targetX: number,
  targetZ: number,
): number {
  const dx = targetX - cameraX
  const dz = targetZ - cameraZ
  if (dx * dx + dz * dz < 1e-8) return 0
  return Math.atan2(dx, dz)
}
