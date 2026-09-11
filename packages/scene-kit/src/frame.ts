import { DEFAULT_SCENE_FRAME, type SceneFrame, type ScenePose } from './types.ts'

export function normalizeFrame(raw?: Partial<SceneFrame> | null): SceneFrame {
  const up = raw?.up === 'z' ? 'z' : 'y'
  const ox = Number(raw?.origin?.x)
  const oy = Number(raw?.origin?.y)
  const oz = Number(raw?.origin?.z)
  return {
    units: 'm',
    up,
    origin: {
      x: Number.isFinite(ox) ? ox : DEFAULT_SCENE_FRAME.origin.x,
      y: Number.isFinite(oy) ? oy : DEFAULT_SCENE_FRAME.origin.y,
      z: Number.isFinite(oz) ? oz : DEFAULT_SCENE_FRAME.origin.z,
    },
  }
}

/**
 * IFC / robotics: meters, right-handed, Z-up.
 * Y-up scene: map (x,y,z)_ifc → (x, z, -y)_three so ground stays XZ.
 */
export function fromIfc(
  x: number,
  y: number,
  z: number,
  frame: SceneFrame = DEFAULT_SCENE_FRAME,
): { x: number; y: number; z: number } {
  const ox = frame.origin.x
  const oy = frame.origin.y
  const oz = frame.origin.z
  if (frame.up === 'z') {
    return { x: x + ox, y: y + oy, z: z + oz }
  }
  return { x: x + ox, y: z + oy, z: -y + oz }
}

/** Inverse of `fromIfc` for the given frame. */
export function toIfc(
  x: number,
  y: number,
  z: number,
  frame: SceneFrame = DEFAULT_SCENE_FRAME,
): { x: number; y: number; z: number } {
  const lx = x - frame.origin.x
  const ly = y - frame.origin.y
  const lz = z - frame.origin.z
  if (frame.up === 'z') {
    return { x: lx, y: ly, z: lz }
  }
  return { x: lx, y: -lz, z: ly }
}

export function normalizePose(raw: unknown, fallback?: Partial<ScenePose>): ScenePose {
  const rec = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const x = Number(rec.x ?? fallback?.x ?? 0)
  const y = Number(rec.y ?? fallback?.y ?? 0)
  const z = Number(rec.z ?? fallback?.z ?? 0)
  const yaw = Number(rec.yaw ?? rec.facing ?? fallback?.yaw ?? 0)
  return {
    x: Number.isFinite(x) ? x : 0,
    y: Number.isFinite(y) ? y : 0,
    z: Number.isFinite(z) ? z : 0,
    yaw: Number.isFinite(yaw) ? yaw : 0,
  }
}

/** Spawn 1.2 m in front of a yaw (rad), ground plane Y=0. */
export function poseInFront(
  from: ScenePose,
  distanceM = 1.2,
  heightY = 0.15,
): ScenePose {
  const d = Number.isFinite(distanceM) ? Math.max(0.1, distanceM) : 1.2
  return {
    x: from.x + Math.sin(from.yaw) * d,
    y: heightY,
    z: from.z + Math.cos(from.yaw) * d,
    yaw: from.yaw + Math.PI,
  }
}

export function xzDistance(
  a: { x: number; z: number },
  b: { x: number; z: number },
): number {
  const dx = a.x - b.x
  const dz = a.z - b.z
  return Math.hypot(dx, dz)
}
