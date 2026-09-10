/** Ordered spawn slots for a shared multi-avatar scene. */

export type SpawnSlot = {
  index: number;
  x: number;
  z: number;
  /** Locomotion yaw (0 = +Z, the default SceneRoom camera). */
  yawRad: number;
};

export const DEFAULT_SPAWN_SPACING = 1.25;
/** Point in front of the line so spawn facing looks at the user, not each other's backs. */
export const SPAWN_LOOK_AT_Z = 4;

/**
 * Line/crescent of slots centered on the origin, facing the camera (+Z) with a
 * slight inward toe-in. Slot indices stay stable — empty slots remain reserved
 * instead of compacting.
 */
export function layoutSpawnSlots(
  count: number,
  spacing = DEFAULT_SPAWN_SPACING,
): SpawnSlot[] {
  const n = Math.max(0, Math.floor(count));
  if (n < 1) return [];
  const mid = (n - 1) / 2;
  const depth = spacing * 0.12;
  return Array.from({ length: n }, (_, index) => {
    const t = index - mid;
    const x = t * spacing;
    const z = -Math.abs(t) * depth;
    return {
      index,
      x,
      z,
      yawRad: facingYawRad(x, z, 0, SPAWN_LOOK_AT_Z),
    };
  });
}

/**
 * Locomotion yaw toward a world XZ point. 0 = +Z (default camera).
 * Gaze converts this to rig yaw via restForwardYaw — do not add π here.
 */
export function facingYawRad(fromX: number, fromZ: number, toX: number, toZ: number): number {
  const dx = toX - fromX;
  const dz = toZ - fromZ;
  if (Math.abs(dx) < 1e-5 && Math.abs(dz) < 1e-5) return 0;
  return Math.atan2(dx, dz);
}
