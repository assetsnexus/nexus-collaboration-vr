/** Occupant roster helpers for SceneRoom — kept free of Three.js for unit tests. */

export type OccupantUrlFields = {
  present?: boolean
  vrmUrl?: string | null
}

export type OccupantRosterFields = OccupantUrlFields & {
  id: string
  slotIndex: number
  mood?: string
  statusColor: number
  label?: string
}

export const OCCUPANT_LOAD_CANCELLED = 'SceneRoom occupant load cancelled'

export function occupantPresentUrl(occ: OccupantUrlFields | undefined): string {
  if (!occ?.present) return ''
  return occ.vrmUrl || ''
}

export function isStaleOccupantLoad(
  wantedUrl: string,
  loadedUrl: string,
  disposed: boolean,
): boolean {
  return disposed || wantedUrl !== loadedUrl
}

export function isOccupantLoadCancelled(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return /occupant load cancelled|SceneRoom disposed/i.test(msg)
}

export function occupantRosterKey(occupants: OccupantRosterFields[]): string {
  return occupants
    .map(
      (o) =>
        `${o.id}|${o.slotIndex}|${o.present ? 1 : 0}|${occupantPresentUrl(o)}|${o.mood || ''}|${o.statusColor}|${o.label || ''}`,
    )
    .join(';')
}

/** Saved XZ pose from a previous visit. Missing/non-finite values mean "use spawn". */
export function occupantWorldPose(occ: {
  x?: number
  z?: number
  facing?: number
}): { x: number; z: number; yawRad: number } | null {
  const x = Number(occ.x)
  const z = Number(occ.z)
  const facing = Number(occ.facing)
  if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(facing)) return null
  return { x, z, yawRad: facing }
}

export function resolveOccupantSpawnPose(
  occ: { x?: number; z?: number; facing?: number },
  fallback: { x: number; z: number; yawRad: number },
): { x: number; z: number; yawRad: number } {
  const world = occupantWorldPose(occ)
  if (!world) return fallback
  // Still on the spawn pad: use current slot facing so a stored π (old VRM
  // compensation) does not keep showing the avatar's back to the camera.
  if (Math.hypot(world.x - fallback.x, world.z - fallback.z) < 0.45) {
    return { x: world.x, z: world.z, yawRad: fallback.yawRad }
  }
  return world
}

export function normalizeOccupants<T extends { id: string; slotIndex: number }>(occupants: T[]): T[] {
  return occupants
    .map((row) => ({ ...row, id: String(row.id) }))
    .sort((a, b) => a.slotIndex - b.slotIndex || a.id.localeCompare(b.id))
}
